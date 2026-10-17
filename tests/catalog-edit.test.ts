import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildCatalogEdit, captureCatalogEditBaseline,
} from '../src/features/quotation/catalog-edit.ts'
import type { CatalogEditBaseline } from '../src/features/quotation/catalog-edit.ts'
import type { CatalogItem } from '../src/features/quotation/model.ts'

function item(id = 'synthetic-1', changes: Partial<CatalogItem> = {}): CatalogItem {
  return {
    id, concept: 'Synthetic speaker', detail: 'Synthetic description', section: 'equipment',
    currency: 'ARS', unitPrice: '', supplier: 'Synthetic Supplier', sku: `SKU-${id}`,
    brand: 'Synthetic Brand', category: 'Speakers', unit: 'pair', presentation: 'Two units',
    ...changes,
  }
}

function importedItem(id = 'synthetic-1'): CatalogItem {
  return item(id, {
    unitPrice: '1.234,56',
    source: {
      document: 'synthetic-catalog.xlsx', sheet: 'Products', row: 2, page: 1,
      date: null, kind: 'snapshot', version: 'synthetic-v1', checksum: 'a'.repeat(64),
    },
    referencePrices: [{
      amount: '12.340000', currency: 'USD', role: 'list', date: '2026-01', historical: true,
      source: { document: 'synthetic-reference.pdf', page: 3, date: '2026-01' },
    }],
    stock: {
      quantity: 3, checkedAt: '2026-10-17T10:00:00.000Z', validUntil: '2026-10-17T11:00:00.000Z',
      observation: 'current', source: { document: 'synthetic-stock.xlsx', sheet: 'Stock', row: 9, date: null },
    },
    listPrice: {
      amount: '15.25', currency: 'USD', basis: 'retail-list-before-discount', provisional: true,
      source: { document: 'synthetic-list.xlsx', sheet: 'List', row: 4, date: '2026-10' },
    },
    availabilityPolicy: 'fresh-positive', selectionBlock: 'Synthetic source review',
  })
}

function rejected(operation: () => unknown): void {
  assert.throws(operation, (error: unknown) => {
    assert.ok(error instanceof Error)
    assert.equal(error.name, 'Error', 'Validation should report a readable application error.')
    assert.ok(error.message.trim().length > 0)
    assert.doesNotMatch(error.message, /PRIVATE-SYNTHETIC-CONTENT/)
    return true
  })
}

function add(draft: CatalogItem, catalog: readonly CatalogItem[] = []): CatalogItem[] {
  return buildCatalogEdit(catalog, draft, captureCatalogEditBaseline(draft, false))
}

test('an existing baseline captures the complete literal JSON snapshot without changing the item', () => {
  const current = importedItem()
  const before = structuredClone(current)
  const baseline = captureCatalogEditBaseline(current, true)
  assert.deepEqual(baseline, { id: current.id, snapshot: JSON.stringify(before) })
  assert.deepEqual(current, before)
  current.stock!.quantity = 7
  assert.equal(baseline.snapshot, JSON.stringify(before))
})

test('a new baseline records the exact ID and a null snapshot even if the draft has metadata', () => {
  const draft = importedItem('synthetic-new')
  assert.deepEqual(captureCatalogEditBaseline(draft, false), { id: 'synthetic-new', snapshot: null })
})

test('an existing edit replaces only its matching entry and preserves unrelated entries and order', () => {
  const first = item('first')
  const current = importedItem()
  const last = item('last')
  const catalog = Object.freeze([first, current, last])
  const draft = { ...structuredClone(current), concept: 'Edited synthetic speaker', unitPrice: '99,50' }
  const result = buildCatalogEdit(catalog, draft, captureCatalogEditBaseline(current, true))
  assert.notEqual(result, catalog)
  assert.equal(result.length, 3)
  assert.equal(result[0], first)
  assert.equal(result[2], last)
  assert.notEqual(result[1], current)
  assert.equal(result[1].id, current.id)
  assert.equal(result[1].concept, draft.concept)
  assert.equal(result[1].unitPrice, draft.unitPrice)
})

test('a new manual entry is appended without replacing existing entries or reusing the draft object', () => {
  const current = item('current')
  const draft = item('new')
  const result = add(draft, [current])
  assert.equal(result[0], current)
  assert.deepEqual(result[1], draft)
  assert.notEqual(result[1], draft)
})

test('all editable fields are trimmed while internal text and the exact approved amount remain intact', () => {
  const current = importedItem()
  const draft = item(current.id, {
    concept: '  Edited  concept  ', detail: '  First line\nSecond line  ', section: 'extras', currency: 'USD',
    unitPrice: '  1.234,50  ', supplier: '  Supplier  Beta  ', sku: '  SKU  Beta  ',
    brand: '  Brand Beta  ', category: '  Installation  ', unit: '  unit  ', presentation: '  One unit  ',
  })
  const [saved] = buildCatalogEdit([current], draft, captureCatalogEditBaseline(current, true))
  assert.deepEqual({
    concept: saved.concept, detail: saved.detail, section: saved.section, currency: saved.currency,
    unitPrice: saved.unitPrice, supplier: saved.supplier, sku: saved.sku, brand: saved.brand,
    category: saved.category, unit: saved.unit, presentation: saved.presentation,
  }, {
    concept: 'Edited  concept', detail: 'First line\nSecond line', section: 'extras', currency: 'USD',
    unitPrice: '1.234,50', supplier: 'Supplier  Beta', sku: 'SKU  Beta', brand: 'Brand Beta',
    category: 'Installation', unit: 'unit', presentation: 'One unit',
  })
})

test('omitting an optional editable field clears the old value without removing imported metadata', () => {
  const current = importedItem()
  const draft: CatalogItem = {
    id: current.id, concept: 'Edited synthetic entry', detail: '', section: 'equipment', currency: 'ARS', unitPrice: '',
  }
  const [saved] = buildCatalogEdit([current], draft, captureCatalogEditBaseline(current, true))
  for (const field of ['supplier', 'sku', 'brand', 'category', 'unit', 'presentation'] as const) {
    assert.equal(Object.hasOwn(saved, field), false, field)
  }
  assert.deepEqual(saved.source, current.source)
  assert.deepEqual(saved.referencePrices, current.referencePrices)
  assert.deepEqual(saved.stock, current.stock)
  assert.deepEqual(saved.listPrice, current.listPrice)
  assert.equal(saved.availabilityPolicy, current.availabilityPolicy)
  assert.equal(saved.selectionBlock, current.selectionBlock)
})

test('existing metadata comes from current state even when a draft replaces or removes every protected field', () => {
  const current = importedItem()
  const baseline = captureCatalogEditBaseline(current, true)
  const draft = item(current.id, {
    source: { document: 'injected-source', date: null },
    referencePrices: [{ amount: '999', currency: 'ARS', role: 'sale', date: null, historical: true }],
    stock: { quantity: 999, checkedAt: null, validUntil: null, source: { document: 'injected-stock', date: null } },
    listPrice: {
      amount: '999', currency: 'ARS', basis: 'retail-list-before-discount', provisional: false,
      source: { document: 'injected-list', date: null },
    },
    availabilityPolicy: 'historical-positive', selectionBlock: 'Injected block',
  })
  for (const candidate of [draft, item(current.id)]) {
    const [saved] = buildCatalogEdit([current], candidate, baseline)
    for (const field of ['source', 'referencePrices', 'stock', 'listPrice', 'availabilityPolicy', 'selectionBlock'] as const) {
      assert.deepEqual(saved[field], current[field], field)
    }
  }
})

test('edited metadata is deeply cloned while unknown current metadata is preserved without accepting draft additions', () => {
  const current = {
    ...importedItem(), localAnnotation: { revision: 1, labels: ['synthetic'] },
  }
  const draft = {
    ...structuredClone(current), concept: 'Edited', localAnnotation: { revision: 99, labels: ['injected'] },
    injectedProperty: { value: 'discard' },
  }
  const [saved] = buildCatalogEdit([current], draft, captureCatalogEditBaseline(current, true))
  assert.notEqual(saved.source, current.source)
  assert.notEqual(saved.referencePrices, current.referencePrices)
  assert.notEqual(saved.referencePrices![0], current.referencePrices![0])
  assert.notEqual(saved.referencePrices![0].source, current.referencePrices![0].source)
  assert.notEqual(saved.stock, current.stock)
  assert.notEqual(saved.stock!.source, current.stock!.source)
  assert.notEqual(saved.listPrice, current.listPrice)
  assert.notEqual(saved.listPrice!.source, current.listPrice!.source)
  const annotation = (saved as typeof current).localAnnotation
  assert.deepEqual(annotation, current.localAnnotation)
  assert.notEqual(annotation, current.localAnnotation)
  assert.notEqual(annotation.labels, current.localAnnotation.labels)
  assert.equal(Object.hasOwn(saved, 'injectedProperty'), false)
  saved.source!.document = 'Changed returned source'
  saved.referencePrices![0].source!.document = 'Changed returned reference'
  saved.stock!.source.document = 'Changed returned stock'
  saved.listPrice!.source.document = 'Changed returned list'
  annotation.labels.push('changed')
  assert.equal(current.source!.document, 'synthetic-catalog.xlsx')
  assert.equal(current.referencePrices![0].source!.document, 'synthetic-reference.pdf')
  assert.equal(current.stock!.source.document, 'synthetic-stock.xlsx')
  assert.equal(current.listPrice!.source.document, 'synthetic-list.xlsx')
  assert.deepEqual(current.localAnnotation.labels, ['synthetic'])
  assert.equal(draft.localAnnotation.revision, 99)
})

test('new manual entries discard protected and arbitrary draft metadata without approving reference prices', () => {
  const draft = { ...importedItem('new'), injectedProperty: { value: 'discard' } }
  const before = structuredClone(draft)
  const [saved] = add(draft)
  for (const field of [
    'source', 'referencePrices', 'stock', 'listPrice', 'availabilityPolicy', 'selectionBlock', 'injectedProperty',
  ]) assert.equal(Object.hasOwn(saved, field), false, field)
  assert.equal(saved.unitPrice, '1.234,56')
  assert.equal(saved.currency, 'ARS')
  assert.deepEqual(draft, before)
})

test('successful edits and new additions leave the input catalogue, draft and baseline untouched', () => {
  const current = importedItem()
  const catalog = [current, item('other')]
  const draft = Object.freeze({ ...structuredClone(current), concept: '  Edited  ', unitPrice: '  0  ' })
  const baseline = Object.freeze(captureCatalogEditBaseline(current, true))
  const before = structuredClone({ catalog, draft, baseline })
  buildCatalogEdit(Object.freeze(catalog), draft, baseline)
  assert.deepEqual({ catalog, draft, baseline }, before)
  const fresh = Object.freeze(item('fresh', { concept: '  New  ' }))
  const freshBefore = structuredClone(fresh)
  add(fresh, catalog)
  assert.deepEqual(fresh, freshBefore)
  assert.deepEqual(catalog, before.catalog)
})

test('a stale edit cannot resurrect a removed item or overwrite another ID with the same contents', () => {
  const current = importedItem()
  const baseline = captureCatalogEditBaseline(current, true)
  const draft = { ...current, concept: 'Edited' }
  rejected(() => buildCatalogEdit([], draft, baseline))
  const replacement = { ...structuredClone(current), id: 'replacement-id' }
  const catalog = [replacement]
  const before = structuredClone(catalog)
  rejected(() => buildCatalogEdit(catalog, draft, baseline))
  assert.deepEqual(catalog, before)
})

test('full-snapshot concurrency checks reject changes to every editable and protected metadata field', () => {
  const changes: { label: string; change: (entry: CatalogItem) => void }[] = [
    { label: 'concept', change: (entry) => { entry.concept = 'Concurrent concept' } },
    { label: 'detail', change: (entry) => { entry.detail = 'Concurrent detail' } },
    { label: 'section', change: (entry) => { entry.section = 'extras' } },
    { label: 'currency', change: (entry) => { entry.currency = 'USD' } },
    { label: 'unitPrice', change: (entry) => { entry.unitPrice = '0' } },
    { label: 'supplier', change: (entry) => { entry.supplier = 'Concurrent supplier' } },
    { label: 'sku', change: (entry) => { entry.sku = 'CONCURRENT' } },
    { label: 'brand', change: (entry) => { entry.brand = 'Concurrent brand' } },
    { label: 'category', change: (entry) => { entry.category = 'Concurrent category' } },
    { label: 'unit', change: (entry) => { entry.unit = 'unit' } },
    { label: 'presentation', change: (entry) => { entry.presentation = 'Concurrent presentation' } },
    { label: 'source', change: (entry) => { entry.source!.version = 'synthetic-v2' } },
    { label: 'referencePrices', change: (entry) => { entry.referencePrices![0].amount = '17.250000' } },
    { label: 'reference source', change: (entry) => { entry.referencePrices![0].source!.page = 4 } },
    { label: 'stock quantity', change: (entry) => { entry.stock!.quantity = 0 } },
    { label: 'stock source', change: (entry) => { entry.stock!.source.row = 10 } },
    { label: 'stock validity', change: (entry) => { entry.stock!.validUntil = '2026-10-17T12:00:00.000Z' } },
    { label: 'list price', change: (entry) => { entry.listPrice!.amount = '16.25' } },
    { label: 'list source', change: (entry) => { entry.listPrice!.source.row = 5 } },
    { label: 'availability policy', change: (entry) => { entry.availabilityPolicy = 'historical-positive' } },
    { label: 'selection block', change: (entry) => { delete entry.selectionBlock } },
  ]
  for (const { label, change } of changes) {
    const original = importedItem()
    const baseline = captureCatalogEditBaseline(original, true)
    const current = structuredClone(original)
    change(current)
    const draft = { ...structuredClone(original), concept: `Edited after ${label}` }
    const before = structuredClone({ current, draft, baseline })
    rejected(() => buildCatalogEdit([current], draft, baseline))
    assert.deepEqual({ current, draft, baseline }, before, label)
  }
})

test('same-ID source replacement and unknown current metadata changes also invalidate a captured baseline', () => {
  const original = importedItem()
  const baseline = captureCatalogEditBaseline(original, true)
  rejected(() => buildCatalogEdit([item(original.id)], original, baseline))
  rejected(() => buildCatalogEdit([{ ...original, localRevision: 2 } as CatalogItem], original, baseline))
})

test('unrelated concurrent catalogue changes do not block an unchanged target or restore removed entries', () => {
  const target = importedItem()
  const removed = item('removed')
  const baseline = captureCatalogEditBaseline(target, true)
  const prior = [target, removed]
  const added = item('concurrent-addition')
  const changed = item('other', { concept: 'Concurrent edit' })
  const result = buildCatalogEdit([added, target, changed], { ...target, concept: 'Edited target' }, baseline)
  assert.deepEqual(result.map((entry) => entry.id), [added.id, target.id, changed.id])
  assert.equal(result[0], added)
  assert.equal(result[2], changed)
  assert.deepEqual(prior, [target, removed])
})

test('new-ID collisions and every duplicate existing ID are rejected before a result is returned', () => {
  const target = item()
  const draft = { ...target, concept: 'Edited' }
  rejected(() => add(draft, [target]))
  rejected(() => buildCatalogEdit([target, { ...target }], draft, captureCatalogEditBaseline(target, true)))
  const duplicate = item('duplicate')
  rejected(() => buildCatalogEdit(
    [target, duplicate, { ...duplicate }], draft, captureCatalogEditBaseline(target, true),
  ))
  rejected(() => add(item('new'), [duplicate, { ...duplicate }]))
})

test('baseline and draft IDs must be nonblank and exactly equal without trimming them into a match', () => {
  const draft = item()
  for (const id of ['', ' ', 'other-id', ` ${draft.id}`, `${draft.id} `]) {
    const baseline: CatalogEditBaseline = { id, snapshot: null }
    rejected(() => buildCatalogEdit([], draft, baseline))
  }
  for (const id of ['', ' ', '\t\n']) {
    const invalid = item(id)
    rejected(() => add(invalid))
  }
})

test('explicit zero, pending blank and valid Argentine prices remain distinct without conversion or reformatting', () => {
  for (const [unitPrice, expected] of [
    ['', ''], ['  ', ''], ['0', '0'], [' 0,00 ', '0,00'], ['1.234,56', '1.234,56'],
    ['1234,5', '1234,5'], ['90071992547409,91', '90071992547409,91'],
  ]) {
    const [saved] = add(item('new', { currency: 'USD', unitPrice }))
    assert.equal(saved.unitPrice, expected)
    assert.equal(saved.currency, 'USD')
    assert.equal(Object.hasOwn(saved, 'referencePrices'), false)
  }
})

test('invalid, negative, fractional-cent, unsafe and non-Argentine prices are rejected', () => {
  for (const unitPrice of ['-1', '+1', '1.23', '1,234', '1.000.00', '1e2', 'NaN', 'Infinity',
    '90071992547409,92', 'PRIVATE-SYNTHETIC-CONTENT']) {
    rejected(() => add(item('new', { unitPrice })))
  }
})

test('required concept and detail limits validate raw lengths before trimming', () => {
  for (const concept of ['', ' ', '\t\n', 'x'.repeat(501), ` ${'x'.repeat(500)}`]) {
    rejected(() => add(item('new', { concept })))
  }
  rejected(() => add(item('new', { detail: 'x'.repeat(2001) })))
  rejected(() => add(item('new', { detail: ` ${'x'.repeat(2000)}` })))
  const [saved] = add(item('new', { concept: 'x'.repeat(500), detail: 'y'.repeat(2000) }))
  assert.equal(saved.concept.length, 500)
  assert.equal(saved.detail.length, 2000)
  assert.equal(add(item('empty-detail', { detail: '  ' }))[0].detail, '')
})

test('optional editable fields accept their exact limits and reject oversized raw text', () => {
  const limits = { supplier: 200, sku: 128, brand: 200, category: 200, unit: 200, presentation: 200 } as const
  for (const field of Object.keys(limits) as (keyof typeof limits)[]) {
    const limit = limits[field]
    assert.equal(add(item('new', { [field]: 'x'.repeat(limit) }))[0][field]?.length, limit, field)
    rejected(() => add(item('new', { [field]: 'x'.repeat(limit + 1) })))
    rejected(() => add(item('new', { [field]: ` ${'x'.repeat(limit)}` })))
  }
})

test('price text has a raw 64-character limit even when the numeric value or trimmed content is small', () => {
  assert.equal(add(item('new', { unitPrice: `${' '.repeat(63)}0` }))[0].unitPrice, '0')
  assert.equal(add(item('new', { unitPrice: ' '.repeat(64) }))[0].unitPrice, '')
  rejected(() => add(item('new', { unitPrice: `${' '.repeat(64)}0` })))
  rejected(() => add(item('new', { unitPrice: ' '.repeat(65) })))
})

test('only equipment/extras and ARS/USD values are accepted without coercion or case normalization', () => {
  for (const section of ['equipment', 'extras'] as const) {
    for (const currency of ['ARS', 'USD'] as const) {
      const [saved] = add(item('new', { section, currency }))
      assert.equal(saved.section, section)
      assert.equal(saved.currency, currency)
    }
  }
  for (const section of ['Equipment', ' equipment ', 'other', '', null, 0]) {
    rejected(() => add({ ...item('new'), section } as unknown as CatalogItem))
  }
  for (const currency of ['ars', ' USD ', 'EUR', '', null, 0]) {
    rejected(() => add({ ...item('new'), currency } as unknown as CatalogItem))
  }
})

test('runtime non-string values are rejected for required and optional editable text fields', () => {
  const required = ['id', 'concept', 'detail', 'unitPrice'] as const
  const optional = ['supplier', 'sku', 'brand', 'category', 'unit', 'presentation'] as const
  for (const field of [...required, ...optional]) {
    for (const value of [null, 0, true, [], {}, ...(required.includes(field as typeof required[number]) ? [undefined] : [])]) {
      const draft = { ...item('new'), [field]: value } as unknown as CatalogItem
      rejected(() => buildCatalogEdit([], draft, { id: 'new', snapshot: null }))
    }
  }
})

test('new supplier and SKU duplicates are rejected using trim, collapsed whitespace and lowercase', () => {
  const existing = item('existing', { supplier: ' Synthetic  Supplier ', sku: ' AB\t12 ' })
  const draft = item('new', { supplier: '\tSYNTHETIC\nSUPPLIER ', sku: 'ab   12' })
  const before = structuredClone({ existing, draft })
  rejected(() => add(draft, [existing]))
  assert.deepEqual({ existing, draft }, before)
})

test('editing into another supplier/SKU key is rejected but keeping the target key is allowed', () => {
  const current = item('target', { supplier: 'Synthetic Alpha', sku: 'A 1' })
  const other = item('other', { supplier: 'Synthetic Beta', sku: 'B 2' })
  const baseline = captureCatalogEditBaseline(current, true)
  rejected(() => buildCatalogEdit([current, other], {
    ...current, supplier: ' synthetic\tbeta ', sku: ' b   2 ',
  }, baseline))
  const result = buildCatalogEdit([current, other], {
    ...current, supplier: ' SYNTHETIC  ALPHA ', sku: ' a\t1 ', concept: 'Edited',
  }, baseline)
  assert.equal(result[0].concept, 'Edited')
  assert.equal(result[1], other)
})

test('supplier/SKU identity does not strip punctuation or accents and does not join keys ambiguously', () => {
  const existing = item('existing', { supplier: 'Synthetic', sku: 'AB-1' })
  assert.equal(add(item('compact', { supplier: 'Synthetic', sku: 'AB1' }), [existing]).length, 2)
  assert.equal(add(item('accented', { supplier: 'Syntheti\u0107', sku: 'AB-1' }), [existing]).length, 2)
  const delimited = item('delimited', { supplier: 'A|B', sku: 'C' })
  assert.equal(add(item('distinct', { supplier: 'A', sku: 'B|C' }), [delimited]).length, 2)
})

test('duplicate identity checks skip records with either supplier or SKU absent or blank', () => {
  const combinations: Partial<CatalogItem>[] = [
    { supplier: undefined, sku: 'SAME' }, { supplier: '', sku: 'SAME' }, { supplier: '  ', sku: 'SAME' },
    { supplier: 'SAME', sku: undefined }, { supplier: 'SAME', sku: '' }, { supplier: 'SAME', sku: '\t' },
    { supplier: undefined, sku: undefined },
  ]
  for (const fields of combinations) {
    const current = item('current', fields)
    const [retained, added] = add(item('new', fields), [current])
    assert.equal(retained, current)
    assert.equal(added.id, 'new')
  }
})

test('an addition can reach 2000 entries, an edit at the limit succeeds and the next addition fails', () => {
  const catalog = Array.from({ length: 1999 }, (_, index) => item(`entry-${index}`))
  const result = add(item('last'), catalog)
  assert.equal(result.length, 2000)
  assert.equal(result[0], catalog[0])
  const baseline = captureCatalogEditBaseline(result[100], true)
  const edited = buildCatalogEdit(result, { ...result[100], concept: 'Edited at capacity' }, baseline)
  assert.equal(edited.length, 2000)
  assert.equal(edited[100].concept, 'Edited at capacity')
  assert.equal(edited[101], result[101])
  rejected(() => add(item('one-too-many'), result))
  assert.equal(result.length, 2000)
})

test('rejected edits expose neither draft text nor partial mutations of existing state', () => {
  const current = importedItem()
  const draft = {
    ...structuredClone(current), concept: 'PRIVATE-SYNTHETIC-CONTENT'.repeat(30), unitPrice: '0',
  }
  const baseline = captureCatalogEditBaseline(current, true)
  const before = structuredClone({ current, draft, baseline })
  rejected(() => buildCatalogEdit([current], draft, baseline))
  assert.deepEqual({ current, draft, baseline }, before)
})
