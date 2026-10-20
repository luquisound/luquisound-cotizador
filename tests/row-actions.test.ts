import assert from 'node:assert/strict'
import test from 'node:test'
import { AUDIO_CATEGORIES, hasRepeatCategoryAction, isSingleRowCategory } from '../src/features/quotation/audio-categories.ts'
import { calculateQuotation } from '../src/features/quotation/calculation.ts'
import { createQuotation, createRow } from '../src/features/quotation/model.ts'
import type { Quotation, QuotationRow } from '../src/features/quotation/model.ts'
import { createQuotationRowDraft, saveQuotationRow } from '../src/features/quotation/row-actions.ts'
import type { QuotationRowProvenance } from '../src/features/quotation/row-provenance.ts'
import { prepareFixedServiceRow } from '../src/features/quotation/fixed-services.ts'
import { parseWorkspace, serializeWorkspace } from '../src/features/quotation/persistence.ts'
import {
  createQuotationLibrary, openLibraryQuotation, parseQuotationLibraryBackup, saveQuotationToLibrary, serializeQuotationLibrary,
} from '../src/features/quotation/quotation-library.ts'
import { updateRowUnitPrice } from '../src/features/quotation/row-price.ts'
import { changeRowCurrency } from '../src/features/quotation/row-currency.ts'

function adapter(id: string, fields: Partial<QuotationRow> = {}): QuotationRow {
  return {
    ...createRow('extras'), id, audioCategory: 'adapters', concept: 'Synthetic ring', detail: 'Synthetic detail',
    quantity: '1', unitPrice: '10', priceState: 'priced',
    adapterVariant: { productKey: 'synthetic-ring', size: '6,5', presentation: 'unit' }, ...fields,
  }
}

function quotation(rows: QuotationRow[]): Quotation {
  return { ...createQuotation(), rows, exchangeRate: '1000' }
}

test('converted adapters remain separate to preserve each original rounded amount on currency restoration', () => {
  for (const [firstPrice, secondPrice, quantity] of [
    ['0,01', '0,02', '1'], ['0,01', '0,01', '0,5'],
  ] as const) {
    const originals = [adapter('first', { unitPrice: firstPrice, quantity }), adapter('second', { unitPrice: secondPrice, quantity })]
    const converted = originals.map((row) => changeRowCurrency(row, 'USD', '1000'))
    assert.equal(converted.every((row) => row.unitPrice === '0'), true)
    const result = saveQuotationRow(quotation([converted[0]!]), converted[1]!, 'new')
    assert.equal(result.ok, true)
    if (!result.ok) continue
    assert.equal(result.merged, false)
    assert.equal(result.rows.length, 2)
    const restored = result.rows.map((row) => changeRowCurrency(row, 'ARS', '1000'))
    assert.deepEqual(calculateQuotation(quotation(restored)).nativeTotals, calculateQuotation(quotation(originals)).nativeTotals)
  }
})

function provenance(): QuotationRowProvenance {
  const source = { document: 'Synthetic snapshot', date: null, kind: 'snapshot' as const, version: 'synthetic-v1', checksum: 'a'.repeat(64) }
  return {
    catalogItemId: 'synthetic-ring', supplier: 'Synthetic supplier', sku: 'synthetic-1', source,
    originalUnitPrice: '10', originalCurrency: 'ARS', priceBasis: 'manual',
    listPrice: { amount: '10.00', currency: 'ARS', basis: 'retail-list-before-discount', provisional: true, source },
    stock: { quantity: 3, checkedAt: null, validUntil: null, observation: 'historical', source },
    availabilityPolicy: 'historical-positive',
  }
}

test('category policies keep equipment and adapters repeatable and singleton rules narrow', () => {
  assert.deepEqual(AUDIO_CATEGORIES.filter((category) => hasRepeatCategoryAction(category.id)).map((category) => category.id), [
    'amplifier-dsp', 'additional-amplifier', 'subwoofer', 'speakers', 'adapters',
  ])
  assert.deepEqual(AUDIO_CATEGORIES.filter((category) => isSingleRowCategory(category.id)).map((category) => category.id), ['cables', 'labor'])
  assert.equal(isSingleRowCategory(undefined), false)
})

test('only a new harness draft receives the editable ARS preset even from a USD quotation', () => {
  const current = quotation([])
  current.currency = 'USD'
  const before = structuredClone(current)
  const draft = createQuotationRowDraft('extras', current.currency, 'harness')
  assert.equal(draft.audioCategory, 'harness')
  assert.equal(draft.quantity, '1')
  assert.equal(draft.unitPrice, '70.000')
  assert.equal(draft.currency, 'ARS')
  assert.equal(draft.priceState, 'priced')
  assert.deepEqual(current, before)
  for (const category of ['cables', 'labor', 'adapters'] as const) {
    const other = createQuotationRowDraft('extras', 'USD', category)
    assert.equal(other.unitPrice, '')
    assert.equal(other.currency, 'USD')
    assert.equal(other.priceState, 'pending')
  }
  const edited = { ...updateRowUnitPrice(draft, '81.250,50'), quantity: '2' }
  const applied = saveQuotationRow(current, edited, 'new')
  assert.equal(applied.ok, true)
  if (!applied.ok) return
  const saved = { ...current, rows: applied.rows }
  assert.equal(saved.rows[0]!.unitPrice, '81.250,50')
  assert.equal(saved.rows[0]!.quantity, '2')
  const text = serializeWorkspace({ version: 1, activeQuotationId: saved.id, quotations: [saved], catalog: [] })
  assert.deepEqual(parseWorkspace(text).quotations[0], saved)
  const library = saveQuotationToLibrary(createQuotationLibrary(), saved, 'Synthetic edited harness')
  const libraryText = serializeQuotationLibrary(library)
  const restored = parseQuotationLibraryBackup(libraryText)
  for (const duplicate of [false, true]) {
    const opened = openLibraryQuotation(restored.entries[0]!, { duplicate })
    assert.equal(opened.rows[0]!.unitPrice, '81.250,50')
    assert.equal(opened.rows[0]!.quantity, '2')
    assert.equal(opened.rows[0]!.currency, 'ARS')
    assert.equal(opened.exchangeRateMode, 'frozen')
  }
  assert.equal(serializeQuotationLibrary(restored), libraryText)
})

test('reading, reopening and reclassifying old harnesses never apply the new-row preset', () => {
  for (const fields of [
    { unitPrice: '', priceState: 'pending' as const },
    { unitPrice: '0', priceState: 'priced' as const },
    { unitPrice: '25,75', priceState: 'priced' as const },
    { unitPrice: '99', priceState: 'included' as const },
  ]) {
    const row = {
      ...createRow('extras', 'USD'), audioCategory: 'harness' as const,
      concept: 'Synthetic legacy harness', quantity: '3', ...fields,
    }
    const original = quotation([row])
    const text = serializeWorkspace({ version: 1, activeQuotationId: original.id, quotations: [original], catalog: [] })
    assert.deepEqual(parseWorkspace(text).quotations[0], original)
    const library = saveQuotationToLibrary(createQuotationLibrary(), original, 'Synthetic historical harness')
    for (const duplicate of [false, true]) {
      const opened = openLibraryQuotation(library.entries[0]!, { duplicate })
      assert.equal(opened.rows[0]!.unitPrice, row.unitPrice)
      assert.equal(opened.rows[0]!.priceState, row.priceState)
      assert.equal(opened.rows[0]!.currency, 'USD')
      assert.equal(opened.rows[0]!.quantity, '3')
    }
  }
  const manual = { ...createRow('extras', 'USD'), concept: 'Synthetic custom connector', quantity: '2,5' }
  const result = saveQuotationRow(quotation([manual]), { ...manual, audioCategory: 'harness' }, 'existing')
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.rows[0]!.unitPrice, '')
    assert.equal(result.rows[0]!.currency, 'USD')
    assert.equal(result.rows[0]!.priceState, 'pending')
    assert.equal(result.rows[0]!.quantity, '2,5')
  }
})

test('new matching adapters accumulate into the surviving row without mutating either input', () => {
  const current = quotation([adapter('survivor', { quantity: '2', concept: ' Synthetic ring ', detail: 'Synthetic detail\n' })])
  const incoming = adapter('draft', { quantity: '3', unitPrice: '10,00' })
  const snapshot = structuredClone({ current, incoming })
  const result = saveQuotationRow(current, incoming, 'new')
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.rowId, 'survivor')
  assert.equal(result.merged, true)
  assert.deepEqual(result.rows, [{ ...current.rows[0], quantity: '5' }])
  assert.deepEqual({ current, incoming }, snapshot)
  assert.notEqual(result.rows[0], current.rows[0])
})

test('fractional accumulation is exact to thousandths and preserves both currency totals', () => {
  for (const [first, second, expected] of [['0,1', '0.2', '0,3'], ['0,125', '0,375', '0,5'], ['0,001', '0,009', '0,01']]) {
    const original = adapter('survivor', { quantity: first!, unitPrice: '1000' })
    const incoming = adapter('draft', { quantity: second!, unitPrice: '1000' })
    const current = quotation([original, { ...createRow(), concept: 'Synthetic other currency', currency: 'USD', quantity: '2', unitPrice: '10', priceState: 'priced' }])
    const before = calculateQuotation({ ...current, rows: [...current.rows, incoming] })
    const result = saveQuotationRow(current, incoming, 'new')
    assert.equal(result.ok, true)
    if (!result.ok) continue
    assert.equal(result.merged, true)
    assert.equal(result.rows[0]?.quantity, expected)
    const after = calculateQuotation({ ...current, rows: result.rows })
    assert.deepEqual(after.nativeTotals, before.nativeTotals)
    assert.deepEqual(after.totals, before.totals)
  }
})

test('an accumulation that would change half-up row rounding keeps the two independent entries', () => {
  const existing = adapter('survivor', { quantity: '0,5', unitPrice: '0,01' })
  const incoming = adapter('draft', { quantity: '0,5', unitPrice: '0,01' })
  const current = quotation([existing])
  const result = saveQuotationRow(current, incoming, 'new')
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.merged, false)
  assert.equal(result.rowId, incoming.id)
  assert.deepEqual(result.rows, [existing, incoming])
  assert.equal(calculateQuotation({ ...current, rows: result.rows }).nativeTotals.ARS, 2)
})

test('automatic accumulation requires the same explicit identity and commercial snapshot', () => {
  const existing = adapter('survivor')
  const incoming = adapter('draft')
  const changes: Partial<QuotationRow>[] = [
    { concept: 'Synthetic other ring' }, { detail: 'Synthetic other detail' }, { currency: 'USD' },
    { unitPrice: '10,01' }, { priceState: 'included' }, { priceState: 'pending', unitPrice: '' },
    { adapterVariant: undefined },
    { adapterVariant: { ...incoming.adapterVariant!, productKey: 'other-ring' } },
    { adapterVariant: { ...incoming.adapterVariant!, size: '8' } },
    { adapterVariant: { ...incoming.adapterVariant!, presentation: 'pair' } },
  ]
  for (const change of changes) {
    const result = saveQuotationRow(quotation([existing]), { ...incoming, ...change }, 'new')
    assert.equal(result.ok, true)
    if (!result.ok) continue
    assert.equal(result.merged, false)
    assert.equal(result.rows.length, 2)
    assert.equal(result.rows[0], existing)
  }
})

test('adapters from distinct provenance or availability snapshots never accumulate', () => {
  const originalProvenance = provenance()
  const current = quotation([adapter('survivor', { provenance: originalProvenance })])
  const changes: (QuotationRowProvenance | undefined)[] = [
    undefined,
    { ...originalProvenance, catalogItemId: 'another-catalog-item' },
    { ...originalProvenance, supplier: 'Another supplier' },
    { ...originalProvenance, sku: 'another-sku' },
    { ...originalProvenance, source: { ...originalProvenance.source!, version: 'synthetic-v2' } },
    { ...originalProvenance, source: { ...originalProvenance.source!, checksum: 'b'.repeat(64) } },
    { ...originalProvenance, originalUnitPrice: '9' },
    { ...originalProvenance, originalCurrency: 'USD' },
    { ...originalProvenance, priceBasis: 'list' },
    { ...originalProvenance, listPrice: { ...originalProvenance.listPrice!, provisional: false } },
    { ...originalProvenance, stock: { ...originalProvenance.stock!, quantity: 2 } },
    { ...originalProvenance, availabilityPolicy: 'fresh-positive' },
    { ...originalProvenance, selectionBlock: 'Synthetic private source conflict' },
  ]
  const snapshot = structuredClone(current)
  for (const different of changes) {
    const incoming = adapter('draft', { provenance: different })
    const result = saveQuotationRow(current, incoming, 'new')
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.equal(result.merged, false)
      assert.equal(result.rows.length, 2)
      assert.deepEqual(result.rows[0]?.provenance, originalProvenance)
      assert.deepEqual(result.rows[1]?.provenance, different)
    }
  }
  assert.deepEqual(current, snapshot)
})

test('identical provenance merges independently of object property insertion order', () => {
  const originalProvenance = provenance()
  const reordered: QuotationRowProvenance = {
    ...Object.fromEntries(Object.entries(originalProvenance).toReversed()),
    catalogItemId: originalProvenance.catalogItemId,
    originalUnitPrice: originalProvenance.originalUnitPrice,
    originalCurrency: originalProvenance.originalCurrency,
    priceBasis: originalProvenance.priceBasis,
    source: { ...Object.fromEntries(Object.entries(originalProvenance.source!).toReversed()), document: originalProvenance.source!.document, date: null },
  }
  const current = quotation([adapter('survivor', { provenance: originalProvenance })])
  const result = saveQuotationRow(current, adapter('draft', { provenance: reordered }), 'new')
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.merged, true)
    assert.equal(result.rows[0]?.quantity, '2')
    assert.deepEqual(result.rows[0]?.provenance, originalProvenance)
  }
})

test('pending entries and legacy text never acquire an implicit identity or merge', () => {
  const { adapterVariant: _variant, ...legacy } = adapter('legacy')
  for (const rows of [
    [legacy],
    [adapter('pending', { unitPrice: '', priceState: 'pending' })],
  ]) {
    const current = quotation(rows)
    const result = saveQuotationRow(current, adapter('draft', rows[0]?.priceState === 'pending' ? { unitPrice: '', priceState: 'pending' } : {}), 'new')
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.equal(result.merged, false)
      assert.equal(result.rows.length, 2)
      assert.equal(result.rows[0], rows[0])
    }
  }
})

test('included adapters and explicitly zero-priced adapters each accumulate within their own state', () => {
  for (const fields of [{ priceState: 'included', unitPrice: '' }, { priceState: 'priced', unitPrice: '0' }] as const) {
    const current = quotation([adapter('survivor', fields)])
    const result = saveQuotationRow(current, adapter('draft', fields), 'new')
    assert.equal(result.ok, true)
    if (!result.ok) continue
    assert.equal(result.merged, true)
    assert.equal(result.rows[0]?.quantity, '2')
    assert.equal(result.rows[0]?.priceState, fields.priceState)
  }
})

test('ambiguous matching adapters stay independent instead of choosing a survivor', () => {
  const current = quotation([adapter('first'), adapter('second')])
  const result = saveQuotationRow(current, adapter('draft'), 'new')
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.merged, false)
  assert.equal(result.rows.length, 3)
  assert.deepEqual(result.rows.slice(0, 2), current.rows)
})

test('subwoofers and components always retain their individual rows', () => {
  for (const category of ['subwoofer', 'speakers', 'amplifier-dsp', 'additional-amplifier'] as const) {
    const first = { ...adapter('first'), section: 'equipment' as const, audioCategory: category }
    const incoming = { ...first, id: 'draft' }
    const result = saveQuotationRow(quotation([first]), incoming, 'new')
    assert.equal(result.ok, true)
    if (!result.ok) continue
    assert.equal(result.merged, false)
    assert.equal(result.rows.length, 2)
    assert.equal(Object.hasOwn(result.rows[1]!, 'adapterVariant'), false)
  }
})

test('editing an existing adapter never merges or rewrites another row', () => {
  const current = quotation([adapter('first'), adapter('second', { quantity: '3' })])
  const result = saveQuotationRow(current, adapter('second', { quantity: '2' }), 'existing')
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.merged, false)
  assert.equal(result.rowId, 'second')
  assert.equal(result.rows.length, 2)
  assert.equal(result.rows[0], current.rows[0])
  assert.equal(result.rows[1]?.quantity, '2')
})

test('changing category removes obsolete adapter metadata without losing its row data', () => {
  const original = adapter('existing')
  const edited = { ...original, audioCategory: 'harness' as const }
  const result = saveQuotationRow(quotation([original]), edited, 'existing')
  assert.equal(result.ok, true)
  if (!result.ok) return
  const { adapterVariant: _variant, ...expected } = edited
  assert.deepEqual(result.rows, [expected])
  assert.equal(Object.hasOwn(result.rows[0]!, 'adapterVariant'), false)
  assert.ok(original.adapterVariant)
})

test('new or reclassified cable and labor rows point to the occupied row', () => {
  for (const category of ['cables', 'labor'] as const) {
    const occupied = { ...createRow('extras'), id: 'occupied', audioCategory: category, concept: 'Synthetic existing work' }
    const other = adapter('other')
    const current = quotation([occupied, other])
    const snapshot = structuredClone(current)
    for (const [kind, row] of [
      ['new', { ...occupied, id: 'draft' }],
      ['existing', { ...other, audioCategory: category }],
    ] as const) {
      const result = saveQuotationRow(current, row, kind)
      assert.equal(result.ok, false)
      if (!result.ok) assert.equal(result.existingRowId, occupied.id)
    }
    assert.deepEqual(current, snapshot)
  }
})

test('legacy duplicate singleton rows remain independently editable without implicit cleanup', () => {
  for (const category of ['cables', 'labor'] as const) {
    const first = { ...createRow('extras'), id: 'first', audioCategory: category, concept: 'Synthetic first work' }
    const second = { ...first, id: 'second', concept: 'Synthetic second work' }
    const current = quotation([first, second])
    const result = saveQuotationRow(current, { ...second, detail: 'Synthetic edited detail' }, 'existing')
    assert.equal(result.ok, true)
    if (!result.ok) continue
    assert.equal(result.rows.length, 2)
    assert.equal(result.rows[0], first)
    assert.equal(result.rows[1]?.detail, 'Synthetic edited detail')
  }
})

test('empty singleton suggestions do not occupy a category for new or reclassified work', () => {
  for (const category of ['cables', 'labor'] as const) {
    const blank = { ...createRow('extras'), id: 'blank', audioCategory: category }
    const other = { ...createRow('extras'), id: 'other', concept: 'Synthetic work' }
    const current = quotation([blank, other])
    for (const [kind, incoming] of [
      ['new', { ...other, id: 'new', audioCategory: category }],
      ['existing', { ...other, audioCategory: category }],
    ] as const) {
      const result = saveQuotationRow(current, incoming, kind)
      assert.equal(result.ok, true)
      if (result.ok) {
        assert.equal(result.rows[0], blank)
        assert.equal(result.rows.find((row) => row.id === incoming.id)?.audioCategory, category)
      }
    }
    const preserved = saveQuotationRow(current, blank, 'existing')
    assert.equal(preserved.ok, true)
    if (preserved.ok) assert.deepEqual(preserved.rows, current.rows)
  }
})

test('saving an existing classified singleton unchanged preserves legacy duplicates', () => {
  for (const category of ['cables', 'labor'] as const) {
    const existing = { ...createRow('extras'), id: 'existing', audioCategory: category, concept: 'Synthetic work' }
    const duplicate = { ...existing, id: 'legacy-duplicate' }
    const current = quotation([existing, duplicate])
    const result = saveQuotationRow(current, existing, 'existing')
    assert.equal(result.ok, true)
    if (result.ok) assert.deepEqual(result.rows, current.rows)
  }
})

test('service saves reject noncanonical quantities without coercing, repricing or changing existing work', () => {
  for (const audioCategory of ['cables', 'labor'] as const) {
    const existing = { ...createRow('extras'), id: 'fixed-service', audioCategory, concept: 'Synthetic service', unitPrice: '100', priceState: 'priced' as const }
    const current = quotation([existing])
    const before = structuredClone(current)
    for (const quantity of ['2', '1,0', ' 1 ', '', 'invalid quantity']) {
      const incoming = { ...existing, quantity }
      const snapshot = structuredClone(incoming)
      const result = saveQuotationRow(current, incoming, 'existing')
      assert.equal(result.ok, false)
      if (!result.ok) assert.match(result.error, /cantidad 1/)
      assert.deepEqual(incoming, snapshot)
      assert.deepEqual(current, before)
      const added = saveQuotationRow(quotation([]), { ...incoming, id: 'new-fixed-service' }, 'new')
      assert.equal(added.ok, false)
    }
    const legacy = { ...existing, quantity: '2' }
    const prepared = prepareFixedServiceRow(legacy)
    const result = saveQuotationRow(quotation([legacy]), prepared, 'existing')
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.equal(result.rows[0]!.quantity, '1')
      assert.equal(result.rows[0]!.unitPrice, '200,00')
      assert.equal(result.rows[0]!.fixedServiceOrigin!.quantity, '2')
      assert.equal(calculateQuotation(quotation(result.rows)).nativeTotals.ARS, 20000)
    }
    assert.equal(legacy.quantity, '2')
    assert.equal(legacy.unitPrice, '100')
  }
})

test('fixed service save guards leave quantities for harnesses, adapters and equipment editable', () => {
  for (const fields of [
    { section: 'extras' as const, audioCategory: 'harness' as const },
    { section: 'extras' as const, audioCategory: 'adapters' as const },
    { section: 'equipment' as const, audioCategory: 'speakers' as const },
  ]) {
    const incoming = { ...createRow(fields.section), ...fields, concept: 'Synthetic independent work', quantity: '2,5' }
    const result = saveQuotationRow(quotation([]), incoming, 'new')
    assert.equal(result.ok, true)
    if (result.ok) assert.equal(result.rows[0]!.quantity, '2,5')
  }
})

test('harness remains addable without a rigid singleton restriction', () => {
  const first = { ...createRow('extras'), id: 'first', audioCategory: 'harness' as const, concept: 'Synthetic harness' }
  const result = saveQuotationRow(quotation([first]), { ...first, id: 'second' }, 'new')
  assert.equal(result.ok, true)
  if (result.ok) assert.equal(result.rows.length, 2)
})

test('safe quantity overflow introduced by accumulation rejects the operation unchanged', () => {
  const current = quotation([adapter('survivor', { quantity: '9007199254740,991', unitPrice: '0' })])
  const snapshot = structuredClone(current)
  const result = saveQuotationRow(current, adapter('draft', { quantity: '0,001', unitPrice: '0' }), 'new')
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.error, /cantidad acumulada.*límite/)
  assert.deepEqual(current, snapshot)
})

test('safe subtotal overflow introduced by accumulation rejects the operation unchanged', () => {
  const current = quotation([adapter('survivor', { unitPrice: '90071992547409,91' })])
  const snapshot = structuredClone(current)
  const result = saveQuotationRow(current, adapter('draft', { unitPrice: '90071992547409,91' }), 'new')
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.error, /subtotal acumulado.*límite/)
  assert.deepEqual(current, snapshot)
})

test('1000-row limit is applied after a possible safe accumulation', () => {
  const existing = adapter('survivor')
  const current = quotation([existing, ...Array.from({ length: 999 }, (_, index) => ({
    ...createRow(), id: `other-${index}`, concept: `Synthetic equipment ${index}`,
  }))])
  const result = saveQuotationRow(current, adapter('draft'), 'new')
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.merged, true)
    assert.equal(result.rows.length, 1000)
    assert.equal(result.rows[0]?.quantity, '2')
  }
  for (const incoming of [
    adapter('draft', { adapterVariant: { productKey: 'other', size: '8', presentation: 'pair' } }),
    adapter('draft', { quantity: '0,5', unitPrice: '0,01' }),
  ]) {
    const rejected = saveQuotationRow(current, incoming, 'new')
    assert.equal(rejected.ok, false)
    if (!rejected.ok) assert.match(rejected.error, /1000 conceptos/)
  }
  const roundingCurrent = {
    ...current, rows: [adapter('survivor', { quantity: '0,5', unitPrice: '0,01' }), ...current.rows.slice(1)],
  }
  const roundingRejected = saveQuotationRow(roundingCurrent, adapter('draft', { quantity: '0,5', unitPrice: '0,01' }), 'new')
  assert.equal(roundingRejected.ok, false)
  if (!roundingRejected.ok) assert.match(roundingRejected.error, /1000 conceptos/)
})

test('the last row slot can be used and existing rows can still be edited at the limit', () => {
  const rows = Array.from({ length: 999 }, (_, index) => ({ ...createRow(), id: `other-${index}` }))
  const current = quotation(rows)
  const result = saveQuotationRow(current, adapter('last'), 'new')
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.rows.length, 1000)
  const edited = saveQuotationRow({ ...current, rows: result.rows }, adapter('last', { detail: 'Updated' }), 'existing')
  assert.equal(edited.ok, true)
})

test('invalid raw drafts remain recoverable without unsafe accumulation', () => {
  const current = quotation([adapter('survivor')])
  const incoming = adapter('draft', { quantity: 'quantity pending', unitPrice: 'price pending' })
  const result = saveQuotationRow(current, incoming, 'new')
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.merged, false)
    assert.deepEqual(result.rows[1], incoming)
  }
})

test('stale or conflicting draft identities never overwrite another row', () => {
  const current = quotation([adapter('existing')])
  const snapshot = structuredClone(current)
  assert.equal(saveQuotationRow(current, adapter('missing'), 'existing').ok, false)
  assert.equal(saveQuotationRow(current, adapter('existing'), 'new').ok, false)
  assert.deepEqual(current, snapshot)
})
