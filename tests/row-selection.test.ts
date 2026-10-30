import assert from 'node:assert/strict'
import test from 'node:test'
import type { CatalogItem, QuotationRow } from '../src/features/quotation/model.ts'
import { getRowPriceOverride } from '../src/features/quotation/row-provenance.ts'
import { selectCatalogForRow } from '../src/features/quotation/row-selection.ts'

const now = Date.parse('2026-10-17T10:05:00.000Z')
const source = {
  document: 'synthetic-catalog.xlsx', sheet: 'Products', row: 2, date: null,
  kind: 'snapshot' as const, version: 'synthetic-v1', checksum: 'a'.repeat(64),
}

test('selecting another product preserves the independent inactive bypass selection', () => {
  const original = row({ audioCategory: 'harness', harnessSelection: { enabled: false } })
  const before = structuredClone(original)
  const selected = selectCatalogForRow(original, item(), 'ARS', now)
  assert.deepEqual(selected.harnessSelection, { enabled: false })
  assert.notEqual(selected.harnessSelection, original.harnessSelection)
  assert.equal(selected.provenance?.catalogItemId, item().id)
  assert.equal(selected.unitPrice, '12,50')
  assert.deepEqual(original, before)
})

function item(changes: Partial<CatalogItem> = {}): CatalogItem {
  return {
    id: 'synthetic-catalog-item', concept: 'Synthetic selected component', detail: 'Selected description',
    section: 'equipment', currency: 'ARS', unitPrice: '', supplier: 'Synthetic Supplier', sku: 'SYN-1',
    source, listPrice: {
      amount: '12.50', currency: 'USD', basis: 'retail-list-before-discount', provisional: true, source,
    },
    availabilityPolicy: 'fresh-positive', stock: {
      quantity: 3, checkedAt: '2026-10-17T10:00:00.000Z', validUntil: '2026-10-17T10:15:00.000Z', source,
    },
    ...changes,
  }
}

function row(changes: Partial<QuotationRow> = {}): QuotationRow {
  return {
    id: 'synthetic-row', section: 'extras', audioCategory: 'cables', quantity: '2,500',
    concept: 'Previous manual description', detail: 'Previous manual detail',
    currency: 'ARS', unitPrice: '99', priceState: 'priced', ...changes,
  }
}

test('selection keeps fixed service quantity at one while copying the native list price and private trace', () => {
  const draft = row()
  const selectedItem = item()
  const selected = selectCatalogForRow(draft, selectedItem, 'ARS', now)
  assert.notEqual(selected, draft)
  assert.equal(selected.id, draft.id)
  assert.equal(selected.quantity, '1')
  assert.equal(selected.section, 'extras')
  assert.equal(selected.audioCategory, 'cables')
  assert.equal(selected.concept, selectedItem.concept)
  assert.equal(selected.detail, '')
  assert.equal(selected.currency, 'USD')
  assert.equal(selected.unitPrice, '12,50')
  assert.equal(selected.priceState, 'priced')
  assert.deepEqual(selected.provenance, {
    catalogItemId: selectedItem.id, supplier: 'Synthetic Supplier', sku: 'SYN-1',
    source, originalUnitPrice: '12,50', originalCurrency: 'USD', priceBasis: 'provisional-list',
    listPrice: selectedItem.listPrice, stock: selectedItem.stock, availabilityPolicy: 'fresh-positive',
  })
  assert.equal(getRowPriceOverride(selected), false)
  assert.equal(draft.quantity, '2,500')
})

test('coded selections keep the complete approved title without copying supplier specifications', () => {
  const draft = row({ section: 'equipment', audioCategory: 'speakers' })
  for (const concept of ['Synthetic RX-65 6.5-inch MK-II (pair)', 'Synthetic RX-8 8-inch | Series II (set)']) {
    const selectedItem = item({ sku: ' SYN-1 ', concept, detail: 'Input and output specifications. '.repeat(40) })
    const before = structuredClone({ draft, selectedItem })
    const selected = selectCatalogForRow(draft, selectedItem, 'ARS', now)
    assert.equal(selected.concept, concept)
    assert.equal(selected.detail, '')
    assert.equal(selected.id, draft.id)
    assert.equal(selected.quantity, draft.quantity)
    assert.equal(selected.unitPrice, '12,50')
    assert.equal(selected.currency, 'USD')
    assert.equal(selected.priceState, 'priced')
    assert.equal(selected.provenance?.sku, selectedItem.sku)
    assert.deepEqual(selected.provenance?.stock, selectedItem.stock)
    assert.deepEqual(selected.provenance?.listPrice, selectedItem.listPrice)
    assert.deepEqual({ draft, selectedItem }, before)
  }
})

test('catalogue entries without a nonblank SKU keep their explicitly maintained detail', () => {
  for (const sku of [undefined, '', ' \t ']) {
    const selectedItem = item({ sku, detail: 'Customer detail for an independent catalogue entry' })
    const before = structuredClone(selectedItem)
    const selected = selectCatalogForRow(row(), selectedItem, 'ARS', now)
    assert.equal(selected.concept, selectedItem.concept)
    assert.equal(selected.detail, selectedItem.detail)
    assert.deepEqual(selectedItem, before)
  }
})

test('Instaler selection preserves codes, models and names without inventing missing code text', () => {
  const draft = row({ section: 'equipment', audioCategory: 'speakers', concept: 'Existing title (SYN-A)' })
  for (const [sku, concept] of [
    ['SYN-A', 'Synthetic RX-65 MK-II 6.5-inch (pair)(SYN-A)'],
    ['SYN-A', 'SYN-A Synthetic RX-65 [SYN-A] (pair)'],
    ['RX-65', 'Synthetic RX-65 6.5-inch (pair)'],
    ['SYN-A', 'Synthetic RX-65 MK-II 6.5-inch (pair)'],
  ]) {
    const selectedItem = item({ supplier: 'Instaler', sku, concept })
    const before = structuredClone({ draft, selectedItem })
    const selected = selectCatalogForRow(draft, selectedItem, 'ARS', now)
    assert.equal(selected.concept, concept)
    assert.equal(selected.detail, '')
    assert.equal(selected.id, draft.id)
    assert.equal(selected.quantity, draft.quantity)
    assert.equal(selected.audioCategory, draft.audioCategory)
    assert.equal(selected.unitPrice, '12,50')
    assert.equal(selected.currency, 'USD')
    assert.equal(selected.provenance?.sku, sku)
    assert.equal(selected.provenance?.supplier, 'Instaler')
    assert.deepEqual(selected.provenance?.source, source)
    assert.deepEqual({ draft, selectedItem }, before)
  }
})

test('catalogue selection preserves quantities for equipment, adapters, harnesses and unclassified concepts', () => {
  for (const fields of [
    { section: 'equipment' as const, audioCategory: 'speakers' as const },
    { section: 'extras' as const, audioCategory: 'adapters' as const },
    { section: 'extras' as const, audioCategory: 'harness' as const },
    { section: 'extras' as const, audioCategory: undefined },
  ]) {
    const draft = row(fields)
    const before = structuredClone(draft)
    const selected = selectCatalogForRow(draft, item(), 'ARS', now)
    assert.equal(selected.quantity, '2,500')
    assert.equal(selected.section, draft.section)
    assert.equal(selected.audioCategory, draft.audioCategory)
    assert.equal(selected.unitPrice, '12,50')
    assert.equal(selected.currency, 'USD')
    assert.deepEqual(draft, before)
  }
  const labor = row({ audioCategory: 'labor', quantity: 'invalid legacy quantity' })
  const selected = selectCatalogForRow(labor, item(), 'ARS', now)
  assert.equal(selected.quantity, '1')
  assert.equal(selected.unitPrice, '12,50')
  assert.equal(selected.priceState, 'priced')
  assert.equal(labor.quantity, 'invalid legacy quantity')
})

test('a previous manual override and previous product provenance never migrate to the selected product', () => {
  const draft = row({
    currency: 'ARS', unitPrice: '99', priceState: 'included', provenance: {
      catalogItemId: 'previous-product', originalUnitPrice: '1', originalCurrency: 'ARS',
      priceBasis: 'manual', supplier: 'Previous synthetic supplier', sku: 'PREVIOUS',
    },
  })
  assert.equal(getRowPriceOverride(draft), true)
  const selected = selectCatalogForRow(draft, item(), 'ARS', now)
  assert.equal(selected.priceState, 'priced')
  assert.equal(selected.unitPrice, '12,50')
  assert.equal(selected.currency, 'USD')
  assert.equal(selected.provenance?.catalogItemId, 'synthetic-catalog-item')
  assert.equal(selected.provenance?.sku, 'SYN-1')
  assert.equal(getRowPriceOverride(selected), false)
  assert.equal(draft.priceState, 'included')
  assert.equal(draft.unitPrice, '99')
  assert.equal(draft.provenance?.catalogItemId, 'previous-product')
})

test('an independent manual pending selection clears an old price without using historical references or inventing a category', () => {
  const draft = row({ audioCategory: undefined, priceState: 'included' })
  const selectedItem = item({
    currency: 'USD', listPrice: undefined, availabilityPolicy: undefined, stock: undefined, source: undefined,
    referencePrices: [{ amount: '999', currency: 'USD', role: 'cost', date: null, historical: true }],
  })
  const selected = selectCatalogForRow(draft, selectedItem, 'ARS', now)
  assert.equal(selected.unitPrice, '')
  assert.equal(selected.currency, 'USD')
  assert.equal(selected.priceState, 'pending')
  assert.equal(selected.audioCategory, undefined)
  assert.equal(Object.hasOwn(selected, 'audioCategory'), false)
  assert.equal(selected.provenance?.originalUnitPrice, '')
  assert.equal(selected.provenance?.priceBasis, 'pending')
  assert.equal(selected.quantity, draft.quantity)
})

test('a protected pending product cannot be selected even with positive stock and a historical reference', () => {
  const draft = row()
  const selectedItem = item({
    listPrice: undefined,
    referencePrices: [{ amount: '999', currency: 'USD', role: 'list', date: null, historical: true }],
  })
  const before = structuredClone({ draft, selectedItem })
  assert.throws(() => selectCatalogForRow(draft, selectedItem, 'ARS', now), /precio|disponibilidad/)
  assert.deepEqual({ draft, selectedItem }, before)
})

test('an approved manual zero takes priority over the list and remains an ordinary priced row', () => {
  const selected = selectCatalogForRow(row({ priceState: 'included' }), item({
    currency: 'ARS', unitPrice: ' 0,00 ',
  }), 'USD', now)
  assert.equal(selected.unitPrice, '0,00')
  assert.equal(selected.currency, 'ARS')
  assert.equal(selected.priceState, 'priced')
  assert.equal(selected.provenance?.originalUnitPrice, '0,00')
  assert.equal(selected.provenance?.priceBasis, 'manual')
  assert.equal(getRowPriceOverride(selected), false)
})

test('availability is checked again at the supplied selection time including the exact expiry boundary', () => {
  const draft = row()
  const selectedItem = item()
  const before = structuredClone({ draft, selectedItem })
  assert.equal(selectCatalogForRow(draft, selectedItem, 'ARS', now).provenance?.catalogItemId, selectedItem.id)
  for (const time of [
    Date.parse('2026-10-17T10:15:00.000Z'), Date.parse('2026-10-17T11:00:00.000Z'),
    Date.parse('2026-10-17T09:59:59.999Z'), Number.NaN,
  ]) {
    assert.throws(() => selectCatalogForRow(draft, selectedItem, 'ARS', time), /disponibilidad/)
    assert.deepEqual({ draft, selectedItem }, before)
  }
})

test('the default clock is read for every selection rather than retaining an earlier availability check', (context) => {
  const draft = row()
  const selectedItem = item()
  context.mock.method(Date, 'now', () => now)
  assert.equal(selectCatalogForRow(draft, selectedItem, 'ARS').priceState, 'priced')
  context.mock.method(Date, 'now', () => Date.parse('2026-10-17T10:15:00.000Z'))
  assert.throws(() => selectCatalogForRow(draft, selectedItem, 'ARS'), /disponibilidad/)
})

test('blocked, zero, negative and unknown-stock selections throw without changing the existing draft', () => {
  const draft = row()
  const original = structuredClone(draft)
  const candidates = [item({ selectionBlock: 'Synthetic source conflict' })]
  for (const quantity of [0, -1, null]) {
    const candidate = item()
    candidate.stock!.quantity = quantity
    candidates.push(candidate)
  }
  for (const candidate of candidates) {
    const before = structuredClone(candidate)
    assert.throws(() => selectCatalogForRow(draft, candidate, 'ARS', now), /disponibilidad/)
    assert.deepEqual(draft, original)
    assert.deepEqual(candidate, before)
  }
})

test('invalid manual prices throw instead of falling back to a list price or altering the draft', () => {
  const draft = Object.freeze(row())
  const before = structuredClone(draft)
  for (const unitPrice of ['-1', '1.23', '1,234', '90071992547409,92']) {
    const selectedItem = item({ unitPrice })
    const itemBefore = structuredClone(selectedItem)
    assert.throws(() => selectCatalogForRow(draft, selectedItem, 'ARS', now), /precio|disponibilidad/)
    assert.deepEqual(draft, before)
    assert.deepEqual(selectedItem, itemBefore)
  }
})

test('selected provenance is independent of both the original item and the existing draft', () => {
  const draft = Object.freeze(row())
  const selectedItem = item()
  const before = structuredClone({ draft, selectedItem })
  const selected = selectCatalogForRow(draft, selectedItem, 'ARS', now)
  assert.deepEqual({ draft, selectedItem }, before)
  assert.notEqual(selected.provenance?.source, selectedItem.source)
  assert.notEqual(selected.provenance?.listPrice, selectedItem.listPrice)
  assert.notEqual(selected.provenance?.listPrice?.source, selectedItem.listPrice?.source)
  assert.notEqual(selected.provenance?.stock, selectedItem.stock)
  assert.notEqual(selected.provenance?.stock?.source, selectedItem.stock?.source)
  selected.provenance!.source!.document = 'Changed returned source'
  selected.provenance!.listPrice!.source.document = 'Changed returned list source'
  selected.provenance!.stock!.source.document = 'Changed returned stock source'
  assert.deepEqual({ draft, selectedItem }, before)
})
