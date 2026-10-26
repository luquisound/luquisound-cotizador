import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyBulkEntry, buildBulkEntryPreview, createBulkEntryDecisions, findBulkEntryDuplicates,
  BULK_ENTRY_MAX_CHARACTERS,
} from '../src/features/quotation/bulk-entry.ts'
import type { ApplyBulkEntryOptions, BulkEntryDecision, BulkEntryPreview } from '../src/features/quotation/bulk-entry.ts'
import type { CatalogItem } from '../src/features/quotation/model.ts'
import type { CatalogSelectionPredicate } from '../src/features/quotation/catalog-search.ts'

function item(overrides: Partial<CatalogItem> = {}): CatalogItem {
  return {
    id: 'synthetic-a', concept: 'Synthetic amplifier', detail: 'Synthetic detail', section: 'equipment',
    currency: 'USD', unitPrice: '12,50', supplier: 'Synthetic supplier', sku: 'SYN-A', ...overrides,
  }
}

const eligible = () => true
const options: ApplyBulkEntryOptions = { canSelect: eligible, defaultCurrency: 'ARS', existingRowCount: 0 }

function manual(decision: BulkEntryDecision, concept = decision.concept): BulkEntryDecision {
  return { ...decision, action: 'manual', itemId: null, concept }
}

function skipped(decision: BulkEntryDecision): BulkEntryDecision {
  return { ...decision, action: 'skip', itemId: null }
}

function choose(decision: BulkEntryDecision, selected: CatalogItem): BulkEntryDecision {
  return { ...decision, action: 'catalog', itemId: selected.id, section: selected.section }
}

function prepare(input: string, catalog: CatalogItem[] = [item()]): { preview: BulkEntryPreview; decisions: BulkEntryDecision[] } {
  const preview = buildBulkEntryPreview(input, catalog, eligible)
  return { preview, decisions: createBulkEntryDecisions(preview) }
}

test('bulk parsing preserves physical line numbers, trims blanks and never guesses quantities', () => {
  const catalog = [item()]
  const { preview, decisions } = prepare('\r\n SYN-A \r\n\r\n2 x SYN-A\rManual work', catalog)
  assert.deepEqual(preview.lines.map((line) => [line.lineNumber, line.query, line.resolution.status]), [
    [2, 'SYN-A', 'matched'], [4, '2 x SYN-A', 'unmatched'], [5, 'Manual work', 'unmatched'],
  ])
  assert.deepEqual(decisions.map((decision) => decision.quantity), ['1', '1', '1'])
  assert.deepEqual(decisions.map((decision) => decision.action), ['catalog', 'unresolved', 'unresolved'])
})

test('bulk parsing rejects empty input, excess lines, long lines, columns and control characters', () => {
  for (const input of ['', ' \r\n ', Array.from({ length: 51 }, () => 'Test').join('\n'),
    'X'.repeat(501), 'X'.repeat(BULK_ENTRY_MAX_CHARACTERS + 1), 'SYN-A\t2', 'SYN-A\0']) {
    assert.throws(() => buildBulkEntryPreview(input, [], eligible), Error)
  }
  assert.equal(buildBulkEntryPreview(Array.from({ length: 50 }, (_, index) => `Work ${index}`).join('\n'), [], eligible).lines.length, 50)
})

test('a missing selection predicate fails closed even for a manual-only query', () => {
  assert.throws(() => buildBulkEntryPreview('Independent work', [], undefined as unknown as CatalogSelectionPredicate), /disponibilidad/)
})

test('a unique exact selection copies the approved native price and keeps editable quantity', () => {
  const catalog = [item()]
  const { preview, decisions } = prepare('syn-a', catalog)
  decisions[0].quantity = '1,5'
  decisions[0].section = 'extras'
  const [row] = applyBulkEntry(preview, decisions, catalog, options)
  assert.equal(row.concept, catalog[0].concept)
  assert.equal(row.detail, '')
  assert.equal(row.quantity, '1,5')
  assert.equal(row.section, 'extras')
  assert.equal(row.currency, 'USD')
  assert.equal(row.unitPrice, '12,50')
  assert.equal(row.priceState, 'priced')
})

test('bulk code selections keep model, variant and presentation in the approved title without specifications', () => {
  const selectedItem = item({
    sku: ' SYN-A ', concept: 'Synthetic RX-65 6.5-inch | MK-II (pair)',
    detail: 'Technical supplier specifications. '.repeat(40),
  })
  const catalog = [selectedItem]
  const { preview, decisions } = prepare('syn-a', catalog)
  const before = structuredClone({ catalog, preview, decisions })
  const [row] = applyBulkEntry(preview, decisions, catalog, options)
  assert.equal(row.concept, selectedItem.concept)
  assert.equal(row.detail, '')
  assert.equal(row.unitPrice, selectedItem.unitPrice)
  assert.equal(row.currency, selectedItem.currency)
  assert.equal(row.priceState, 'priced')
  assert.equal(row.provenance?.sku, selectedItem.sku)
  assert.equal(row.provenance?.originalUnitPrice, selectedItem.unitPrice)
  assert.equal(row.provenance?.originalCurrency, selectedItem.currency)
  assert.deepEqual({ catalog, preview, decisions }, before)
})

test('bulk selections by name keep independent catalogue details when the SKU is absent or blank', () => {
  for (const sku of [undefined, '', ' \t ']) {
    const catalog = [item({ sku, concept: 'Independent catalogue work', detail: 'Customer instructions' })]
    const before = structuredClone(catalog)
    const { preview, decisions } = prepare('Independent catalogue work', catalog)
    const [row] = applyBulkEntry(preview, decisions, catalog, options)
    assert.equal(row.concept, catalog[0].concept)
    assert.equal(row.detail, catalog[0].detail)
    assert.deepEqual(catalog, before)
  }
})

test('bulk Instaler code selection cleans the copied title without changing searchable source data', (context) => {
  context.mock.method(Date, 'now', () => Date.parse('2026-10-17T10:05:00.000Z'))
  const source = {
    document: 'synthetic-catalog.xlsx', kind: 'snapshot' as const, date: null,
    version: 'synthetic-v1', checksum: 'a'.repeat(64),
  }
  const selectedItem = item({
    supplier: 'Instaler', concept: 'Synthetic RX-65 MK-II (pair) [SYN-A]',
    stock: {
      quantity: 3, checkedAt: '2026-10-17T10:00:00.000Z',
      validUntil: '2026-10-17T10:15:00.000Z', source,
    },
  })
  const catalog = [selectedItem]
  const { preview, decisions } = prepare('syn-a', catalog)
  const before = structuredClone({ catalog, preview, decisions })
  decisions[0].quantity = '2'
  const [row] = applyBulkEntry(preview, decisions, catalog, options)
  assert.equal(row.concept, 'Synthetic RX-65 MK-II (pair)')
  assert.equal(row.quantity, '2')
  assert.equal(row.unitPrice, selectedItem.unitPrice)
  assert.equal(row.currency, selectedItem.currency)
  assert.equal(row.provenance?.sku, 'SYN-A')
  assert.deepEqual(catalog, before.catalog)
  assert.deepEqual(preview, before.preview)
})

test('explicit zero remains a priced selection and historical references never approve an amount', () => {
  const catalog = [item({ unitPrice: '0' }), item({
    id: 'synthetic-b', sku: 'SYN-B', concept: 'Synthetic cable', unitPrice: '', referencePrices: [
      { amount: '99.95', currency: 'USD', role: 'list', date: null, historical: true },
    ],
  })]
  const { preview, decisions } = prepare('SYN-A\nSYN-B', catalog)
  const rows = applyBulkEntry(preview, decisions, catalog, options)
  assert.deepEqual(rows.map((row) => [row.unitPrice, row.priceState, row.currency]), [
    ['0', 'priced', 'USD'], ['', 'pending', 'USD'],
  ])
})

test('an explicitly approved provisional list price keeps its native amount and private provenance', () => {
  const catalog = [item({
    unitPrice: '', currency: 'ARS', listPrice: {
      amount: '123.45', currency: 'USD', basis: 'retail-list-before-discount', provisional: true,
      source: { document: 'synthetic-list.xlsx', sheet: 'Prices', row: 7, date: null },
    },
  })]
  const { preview, decisions } = prepare('SYN-A', catalog)
  const [row] = applyBulkEntry(preview, decisions, catalog, options)
  assert.equal(row.currency, 'USD')
  assert.equal(row.unitPrice, '123,45')
  assert.equal(row.priceState, 'priced')
  assert.equal(row.provenance?.priceBasis, 'provisional-list')
  assert.equal(row.provenance?.catalogItemId, catalog[0].id)
  assert.equal(row.provenance?.sku, 'SYN-A')
  assert.deepEqual(row.provenance?.listPrice, catalog[0].listPrice)
  assert.notEqual(row.provenance?.listPrice, catalog[0].listPrice)
  if (row.provenance?.listPrice) row.provenance.listPrice.source.document = 'Quotation-only mutation'
  assert.equal(catalog[0].listPrice?.source.document, 'synthetic-list.xlsx')
})

test('ambiguous suppliers never select automatically and require a listed alternative', () => {
  const catalog = [item(), item({ id: 'synthetic-other', supplier: 'Another synthetic supplier', unitPrice: '7' })]
  const { preview, decisions } = prepare('SYN-A', catalog)
  assert.equal(preview.lines[0].resolution.status, 'ambiguous')
  assert.equal(decisions[0].action, 'unresolved')
  assert.throws(() => applyBulkEntry(preview, decisions, catalog, options), /elegí una opción/)
  const [row] = applyBulkEntry(preview, [choose(decisions[0], catalog[1])], catalog, options)
  assert.equal(row.unitPrice, '7')
})

test('a partial unique search still requires the user to choose the product', () => {
  const catalog = [item()]
  const { preview, decisions } = prepare('amplifier', catalog)
  assert.equal(preview.lines[0].resolution.status, 'ambiguous')
  assert.equal(decisions[0].action, 'unresolved')
  const [row] = applyBulkEntry(preview, [choose(decisions[0], catalog[0])], catalog, options)
  assert.equal(row.concept, catalog[0].concept)
})

test('manual work is an explicit independent pending row in the quotation default currency', () => {
  const { preview, decisions } = prepare('Cables\nMano de obra', [])
  const rows = applyBulkEntry(preview, decisions.map((decision) => ({ ...manual(decision), section: 'extras' })), [], {
    ...options, defaultCurrency: 'USD',
  })
  assert.deepEqual(rows.map((row) => [row.concept, row.section, row.currency, row.quantity, row.unitPrice, row.priceState]), [
    ['Cables', 'extras', 'USD', '1', '', 'pending'], ['Mano de obra', 'extras', 'USD', '1', '', 'pending'],
  ])
  assert.notEqual(rows[0].id, rows[1].id)
})

test('a blocked exact SKU has no manual or alternate-variant escape path', () => {
  const catalog = [item(), item({ id: 'synthetic-variant', sku: 'SYN-A-PLUS', concept: 'Synthetic variant' })]
  const canSelect = (entry: CatalogItem) => entry.id !== catalog[0].id
  const preview = buildBulkEntryPreview('SYN-A', catalog, canSelect)
  const [decision] = createBulkEntryDecisions(preview)
  assert.equal(preview.lines[0].resolution.status, 'blocked')
  assert.equal(preview.lines[0].resolution.manualAllowed, false)
  assert.throws(() => applyBulkEntry(preview, [manual(decision)], catalog, { ...options, canSelect }), /bloqueado/)
  assert.throws(() => applyBulkEntry(preview, [choose(decision, catalog[1])], catalog, { ...options, canSelect }), /no está disponible/)
})

test('blocked products can be skipped while independent manual labour remains possible', () => {
  const catalog = [item()]
  const canSelect = () => false
  const preview = buildBulkEntryPreview('SYN-A\nIndependent installation', catalog, canSelect)
  const decisions = createBulkEntryDecisions(preview)
  const rows = applyBulkEntry(preview, [skipped(decisions[0]), manual(decisions[1])], catalog, { ...options, canSelect })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].concept, 'Independent installation')
})

test('changing an unmatched manual concept into an exact blocked SKU is rejected at apply', () => {
  const catalog = [item()]
  const canSelect = () => false
  const preview = buildBulkEntryPreview('Independent work', catalog, canSelect)
  const [decision] = createBulkEntryDecisions(preview)
  assert.throws(() => applyBulkEntry(preview, [manual(decision, 'SYN-A')], catalog, { ...options, canSelect }), /bloqueado/)
})

test('selection eligibility is reevaluated at apply even when the catalogue bytes are unchanged', () => {
  const catalog = [item()]
  let available = true
  const canSelect = () => available
  const preview = buildBulkEntryPreview('SYN-A', catalog, canSelect)
  const decisions = createBulkEntryDecisions(preview)
  available = false
  assert.throws(() => applyBulkEntry(preview, decisions, catalog, { ...options, canSelect }), /no está disponible/)
})

test('catalogue price or metadata changes invalidate the preview without changing existing work', () => {
  const catalog = [item()]
  const { preview, decisions } = prepare('SYN-A', catalog)
  for (const change of [{ unitPrice: '99' }, { detail: 'Changed source' }, { supplier: 'Changed supplier' }]) {
    assert.throws(() => applyBulkEntry(preview, decisions, [{ ...catalog[0], ...change }], options), /catálogo cambió/)
  }
  assert.equal(catalog[0].unitPrice, '12,50')
})

test('repeated queries require explicit duplicate confirmation or skipping', () => {
  const catalog = [item()]
  const { preview, decisions } = prepare('SYN-A\nsyn-a', catalog)
  assert.equal(preview.lines[1].duplicateOfLine, 1)
  assert.deepEqual([...findBulkEntryDuplicates(preview, decisions, catalog)], [[2, 1]])
  assert.throws(() => applyBulkEntry(preview, decisions, catalog, options), /repetido/)
  const confirmed = applyBulkEntry(preview, [decisions[0], { ...decisions[1], confirmDuplicate: true }], catalog, options)
  assert.equal(confirmed.length, 2)
  assert.notEqual(confirmed[0].id, confirmed[1].id)
  assert.equal(applyBulkEntry(preview, [decisions[0], skipped(decisions[1])], catalog, options).length, 1)
})

test('a SKU and its exact product name are recognized as the same selected product', () => {
  const catalog = [item()]
  const { preview, decisions } = prepare('SYN-A\nSynthetic amplifier', catalog)
  assert.equal(preview.lines[1].duplicateOfLine, null)
  assert.deepEqual([...findBulkEntryDuplicates(preview, decisions, catalog)], [[2, 1]])
  assert.throws(() => applyBulkEntry(preview, decisions, catalog, options), /repetido/)
})

test('a repeated query is still flagged after explicitly selecting different suppliers', () => {
  const catalog = [item(), item({ id: 'synthetic-other', supplier: 'Other supplier' })]
  const { preview, decisions } = prepare('SYN-A\nSYN-A\nSynthetic amplifier', catalog)
  const selected = [choose(decisions[0], catalog[0]), choose(decisions[1], catalog[1]), choose(decisions[2], catalog[1])]
  assert.deepEqual([...findBulkEntryDuplicates(preview, selected, catalog)], [[2, 1], [3, 2]])
})

test('skipped lines do not force duplicate confirmation on the first retained occurrence', () => {
  const catalog = [item()]
  const { preview, decisions } = prepare('SYN-A\nSYN-A', catalog)
  const rows = applyBulkEntry(preview, [skipped(decisions[0]), decisions[1]], catalog, options)
  assert.equal(rows.length, 1)
  assert.deepEqual([...findBulkEntryDuplicates(preview, [skipped(decisions[0]), decisions[1]], catalog)], [])
})

test('manual duplicates also need an explicit decision', () => {
  const { preview, decisions } = prepare('Mano de obra\nMANO DE OBRA', [])
  const selected = decisions.map((decision) => manual(decision))
  assert.deepEqual([...findBulkEntryDuplicates(preview, selected, [])], [[2, 1]])
  assert.throws(() => applyBulkEntry(preview, selected, [], options), /repetido/)
})

test('invalid quantities block the entire batch, while decimals remain unconverted', () => {
  const catalog = [item()]
  const { preview, decisions } = prepare('SYN-A', catalog)
  for (const quantity of ['', '0', '-1', '2,1234', 'NaN', '9'.repeat(31)]) {
    assert.throws(() => applyBulkEntry(preview, [{ ...decisions[0], quantity }], catalog, options), /cantidad positiva/)
  }
  const [row] = applyBulkEntry(preview, [{ ...decisions[0], quantity: '0.125' }], catalog, options)
  assert.equal(row.quantity, '0.125')
})

test('the current quotation row limit is rechecked against only the retained lines', () => {
  const { preview, decisions } = prepare('Work A\nWork B', [])
  const selected = decisions.map((decision) => manual(decision))
  assert.throws(() => applyBulkEntry(preview, selected, [], { ...options, existingRowCount: 999 }), /1000 conceptos/)
  assert.equal(applyBulkEntry(preview, [selected[0], skipped(selected[1])], [], { ...options, existingRowCount: 999 }).length, 1)
  assert.throws(() => applyBulkEntry(preview, selected.map(skipped), [], options), /al menos una línea/)
})

test('forged or incomplete decision sets cannot apply a different product or duplicate a line id', () => {
  const catalog = [item(), item({ id: 'unrelated', sku: 'SYN-B', concept: 'Unrelated item' })]
  const { preview, decisions } = prepare('SYN-A', catalog)
  assert.throws(() => applyBulkEntry(preview, [], catalog, options), /no coincide/)
  assert.throws(() => applyBulkEntry(preview, [decisions[0], decisions[0]], catalog, options), /no coincide/)
  assert.throws(() => applyBulkEntry(preview, [{ ...decisions[0], lineNumber: 99 }], catalog, options), /no coincide/)
  assert.throws(() => applyBulkEntry(preview, [choose(decisions[0], catalog[1])], catalog, options), /no está disponible/)
})

test('manual fields preserve normal descriptions but reject empty, multiline and oversized concepts', () => {
  const { preview, decisions } = prepare('Independent work', [])
  for (const concept of ['', ' ', 'X'.repeat(501), 'Work\nOther', 'Work\t2']) {
    assert.throws(() => applyBulkEntry(preview, [manual(decisions[0], concept)], [], options), /concepto manual/)
  }
})

test('building and applying a batch never mutate catalogue, decisions or the preview', () => {
  const catalog = [item()]
  const beforeCatalog = structuredClone(catalog)
  const { preview, decisions } = prepare('SYN-A', catalog)
  const beforePreview = structuredClone(preview)
  const beforeDecisions = structuredClone(decisions)
  const rows = applyBulkEntry(preview, decisions, catalog, options)
  rows[0].concept = 'Changed quotation only'
  assert.deepEqual(catalog, beforeCatalog)
  assert.deepEqual(preview, beforePreview)
  assert.deepEqual(decisions, beforeDecisions)
})
