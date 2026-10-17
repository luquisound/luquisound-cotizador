import assert from 'node:assert/strict'
import test from 'node:test'
import { applyCatalogImport, buildCatalogImportPreview, parseCatalogImport } from '../src/features/quotation/catalog.ts'
import type { CatalogImportDocument, CatalogImportItem, CatalogListPrice } from '../src/features/quotation/catalog.ts'
import {
  canSelectCatalogItem, classifyCatalogStock, getCatalogAvailabilityPolicy, getCatalogSelectionStatus, getCatalogStockObservation,
  parseCatalogStockFields,
} from '../src/features/quotation/catalog-stock.ts'
import { createWorkspace, duplicateQuotation, type CatalogItem } from '../src/features/quotation/model.ts'
import { parseWorkspace, serializeWorkspace } from '../src/features/quotation/persistence.ts'
import { getCatalogSelectionPrice, getRowPriceOverride, parseRowProvenance, rowFromCatalog } from '../src/features/quotation/row-provenance.ts'

const now = Date.parse('2026-10-17T10:05:00.000Z')
const source = {
  document: 'Synthetic private snapshot', sheet: 'Prices', row: 3, date: null,
  kind: 'snapshot' as const, version: 'synthetic-v1', checksum: 'a'.repeat(64),
}
const listPrice: CatalogListPrice = {
  amount: '125.50', currency: 'ARS', basis: 'retail-list-before-discount', provisional: true, source,
}

function historical(quantity: number | null = 3): CatalogItem {
  return {
    id: 'catalog-test', section: 'equipment', concept: 'Synthetic speaker', detail: '',
    currency: 'ARS', unitPrice: '', supplier: 'Synthetic', sku: 'SKU-1', source,
    listPrice, availabilityPolicy: 'historical-positive',
    stock: { quantity, checkedAt: null, validUntil: null, observation: 'historical', source },
  }
}

function current(quantity: number | null = 3): CatalogItem {
  return { ...historical(quantity), availabilityPolicy: 'fresh-positive', stock: {
    quantity, checkedAt: '2026-10-17T10:00:00.000Z', validUntil: '2026-10-17T10:15:00.000Z', source,
  } }
}

function incoming(changes: Partial<CatalogImportItem> = {}): CatalogImportItem {
  const item = historical()
  return {
    supplier: item.supplier!, sku: item.sku!, brand: '', name: item.concept, description: '',
    category: '', section: 'equipment', source, referencePrices: [], listPrice,
    availabilityPolicy: item.availabilityPolicy, stock: item.stock, ...changes,
  }
}

function document(item: CatalogImportItem = incoming()): CatalogImportDocument {
  return { format: 'luquisound.catalog', version: 1, items: [item] }
}

test('historical signed observations retain unknown dates without manufacturing freshness', () => {
  for (const quantity of [null, -5, 0, 3]) {
    assert.deepEqual(parseCatalogStockFields(quantity, null, null, 'historical'), {
      quantity, checkedAt: null, validUntil: null, observation: 'historical',
    })
  }
  for (const bad of [undefined, '', 'current', 'historic', false]) {
    assert.equal(parseCatalogStockFields(3, null, null, bad), null)
  }
  for (const bad of ['2026-02-30T00:00:00.000Z', '2026-01', 0, undefined]) {
    assert.equal(parseCatalogStockFields(3, bad, null, 'historical'), null)
  }
  assert.equal(parseCatalogStockFields(3, null, '2026-10-17T10:00:00.000Z', 'historical'), null)
  assert.equal(classifyCatalogStock(historical().stock, now), 'historical')
  assert.equal(classifyCatalogStock(historical(-1).stock, now), 'negative')
  assert.deepEqual(getCatalogStockObservation(historical(-1).stock, now), { quantityState: 'negative', age: 'historical' })
})

test('availability requires an explicit policy and preserves manual independent concepts', () => {
  const item = historical()
  assert.equal(getCatalogSelectionStatus(item, now).provisional, true)
  assert.equal(canSelectCatalogItem(item, now), true)
  for (const quantity of [null, -1, 0]) assert.equal(canSelectCatalogItem(historical(quantity), now), false)
  for (const quantity of [null, -1, 0, 1]) {
    const { availabilityPolicy: _policy, ...manual } = historical(quantity)
    assert.equal(canSelectCatalogItem(manual, now), true)
  }
  assert.equal(canSelectCatalogItem({ ...item, availabilityPolicy: 'fresh-positive' }, now), false)
  assert.equal(canSelectCatalogItem({ ...item, selectionBlock: 'Conflicting private source rows' }, now), false)
  assert.equal(getCatalogSelectionStatus({ ...item, selectionBlock: 'Conflict' }, now).reason, 'blocked')
  assert.throws(() => rowFromCatalog({ ...item, selectionBlock: 'Conflict' }, 'equipment'), /disponibilidad/)
  assert.throws(() => rowFromCatalog(historical(0), 'equipment'), /disponibilidad/)
})

test('current stock must be positive and fresh and keeps expired quantity separate', () => {
  assert.equal(canSelectCatalogItem(current(), now), true)
  assert.equal(getCatalogSelectionStatus(current(), now).provisional, false)
  assert.equal(canSelectCatalogItem(current(), now + 3600000), false)
  assert.equal(getCatalogSelectionStatus(current(), now + 3600000).quantityState, 'positive')
  assert.equal(getCatalogSelectionStatus(current(), now + 3600000).age, 'stale')
  assert.equal(canSelectCatalogItem(current(), now - 3600000), false)
  assert.equal(canSelectCatalogItem(current(), Number.NaN), false)
  for (const quantity of [null, -1, 0]) assert.equal(canSelectCatalogItem(current(quantity), now), false)
})

test('only an explicit list approval copies a price and never applies a discount or a cost', () => {
  const item = historical()
  assert.deepEqual(getCatalogSelectionPrice(item), { unitPrice: '125,50', currency: 'ARS', priceBasis: 'provisional-list' })
  const manual = { ...item, unitPrice: '72,25', currency: 'USD' as const }
  assert.deepEqual(getCatalogSelectionPrice(manual), { unitPrice: '72,25', currency: 'USD', priceBasis: 'manual' })
  const { listPrice: _listPrice, ...referenceOnly } = item
  referenceOnly.referencePrices = [{ amount: '200', currency: 'USD', role: 'cost', date: null, historical: true }]
  assert.equal(getCatalogSelectionPrice(referenceOnly).unitPrice, '')
  assert.equal(getCatalogSelectionPrice({ ...item, listPrice: { ...listPrice, amount: '0', currency: 'USD', provisional: false } }).unitPrice, '0')
  const row = rowFromCatalog(item, 'extras', 'USD', undefined, now)
  assert.equal(row.unitPrice, '125,50')
  assert.equal(row.currency, 'ARS')
  assert.equal(row.section, 'extras')
  assert.equal(row.priceState, 'priced')
})

test('private provenance survives editing, includes explicit override state and has no aliases', () => {
  const item = historical()
  const row = rowFromCatalog(item, 'equipment', 'ARS', 'speakers', now)
  assert.equal(row.provenance?.sku, 'SKU-1')
  assert.equal(row.provenance?.source?.checksum, source.checksum)
  assert.equal(row.provenance?.stock?.checkedAt, null)
  assert.equal(getRowPriceOverride(row), false)
  assert.equal(getRowPriceOverride({ ...row, concept: 'Edited description', unitPrice: '125,5' }), false)
  assert.equal(getRowPriceOverride({ ...row, unitPrice: '100' }), true)
  assert.equal(getRowPriceOverride({ ...row, currency: 'USD' }), true)
  assert.equal(getRowPriceOverride({ ...row, priceState: 'included' }), true)
  assert.equal(getRowPriceOverride({ ...row, unitPrice: '', priceState: 'pending' }), true)
  row.provenance!.source!.document = 'Changed copy'
  row.provenance!.stock!.source.document = 'Changed stock copy'
  row.provenance!.listPrice!.source.document = 'Changed price copy'
  assert.equal(item.source?.document, source.document)
  assert.equal(item.stock?.source.document, source.document)
  assert.equal(item.listPrice?.source.document, source.document)
})

test('persistence and duplication retain frozen rate and complete private provenance independently', () => {
  const workspace = createWorkspace()
  workspace.catalog = [historical(-1)]
  workspace.quotations[0].rows = [rowFromCatalog(historical(), 'equipment', 'ARS', undefined, now)]
  workspace.quotations[0].exchangeRate = '1500'
  workspace.quotations[0].exchangeRateMode = 'frozen'
  const restored = parseWorkspace(serializeWorkspace(workspace))
  assert.deepEqual(restored, workspace)
  const copy = duplicateQuotation(restored.quotations[0])
  assert.equal(copy.exchangeRateMode, 'frozen')
  assert.equal(copy.exchangeRate, '1500')
  copy.rows[0].provenance!.stock!.source.document = 'Changed duplicate'
  assert.equal(restored.quotations[0].rows[0].provenance!.stock!.source.document, source.document)
})

test('source and policy metadata import exactly, update idempotently and clear on authoritative replacement', () => {
  const parsed = parseCatalogImport(JSON.stringify(document()))
  assert.deepEqual(parsed.items[0].listPrice, listPrice)
  assert.deepEqual(parsed.items[0].stock, historical().stock)
  const existing = applyCatalogImport([], buildCatalogImportPreview([], parsed), { allowUpdates: true })
  existing[0].unitPrice = '90,00'
  existing[0].currency = 'USD'
  const updatedSource = { ...source, version: 'synthetic-v2', checksum: 'b'.repeat(64) }
  const next = document(incoming({ source: updatedSource, listPrice: { ...listPrice, amount: '180', source: updatedSource } }))
  const updated = applyCatalogImport(existing, buildCatalogImportPreview(existing, next), { allowUpdates: true })
  assert.equal(updated[0].unitPrice, '90,00')
  assert.equal(updated[0].currency, 'USD')
  assert.equal(updated[0].listPrice?.amount, '180')
  assert.equal(updated[0].source?.version, 'synthetic-v2')
  assert.equal(buildCatalogImportPreview(updated, next).summary.unchanged, 1)
  const clean: CatalogImportDocument = {
    ...document(incoming({ listPrice: undefined, stock: undefined, availabilityPolicy: undefined })),
    replaceSourceDocuments: [source.document],
  }
  const replaced = applyCatalogImport(updated, buildCatalogImportPreview(updated, clean), { allowUpdates: true })
  for (const field of ['listPrice', 'stock', 'availabilityPolicy']) assert.equal(Object.hasOwn(replaced[0], field), false)
  assert.equal(replaced[0].unitPrice, '90,00')
})

test('explicit approval and provenance parsers reject malformed or ambiguous commercial metadata', () => {
  const badPrices = [
    { amount: 0 }, { amount: '1,50' }, { amount: '-1' }, { amount: '1.234' }, { amount: '01' },
    { amount: '90071992547409.92' }, { currency: null }, { currency: 'EUR' }, { basis: 'cost' },
    { provisional: 'true' }, { source: undefined }, { source: { ...source, checksum: 'x'.repeat(64) } },
    { source: { ...source, version: '' } }, { source: { ...source, kind: 'api' } },
  ]
  for (const change of badPrices) {
    assert.throws(() => parseCatalogImport(JSON.stringify(document(incoming({ listPrice: { ...listPrice, ...change } as CatalogListPrice })))))
  }
  const provenance = rowFromCatalog(historical(), 'equipment').provenance!
  for (const change of [{ originalCurrency: 'EUR' }, { originalUnitPrice: '' }, { priceBasis: 'cost' },
    { catalogItemId: 'invalid id' }, { selectionBlock: '' }, { availabilityPolicy: 'all' }]) {
    assert.throws(() => parseRowProvenance({ ...provenance, ...change }))
  }
  const workspace = createWorkspace()
  const row = rowFromCatalog(historical(), 'equipment')
  workspace.quotations[0].rows = [row]
  assert.throws(() => parseWorkspace(JSON.stringify({ ...workspace, quotations: [{ ...workspace.quotations[0], exchangeRateMode: 'auto' }] })))
  assert.throws(() => parseWorkspace(JSON.stringify({ ...workspace, quotations: [{ ...workspace.quotations[0], rows: [{ ...row, provenance: { ...provenance, priceBasis: 'cost' } }] }] })))
  assert.deepEqual(parseRowProvenance({ ...provenance, ignored: 'discard' }), provenance)
})

test('legacy configured supplier entries without stock are blocked without approving their historical references', () => {
  const legacy: CatalogItem = {
    ...historical(), supplier: '  InStAlEr  ', availabilityPolicy: undefined, stock: undefined, listPrice: undefined,
    referencePrices: [{ amount: '125.50', currency: 'ARS', role: 'list', date: null, historical: true }],
  }
  assert.equal(getCatalogAvailabilityPolicy(legacy), 'fresh-positive')
  assert.equal(canSelectCatalogItem(legacy, now), false)
  assert.equal(getCatalogSelectionStatus(legacy, now).reason, 'unknown-stock')
  assert.equal(getCatalogSelectionPrice(legacy).unitPrice, '')
  assert.throws(() => rowFromCatalog(legacy, 'equipment', 'ARS', undefined, now), /disponibilidad/)
  const available = { ...legacy, stock: current().stock, unitPrice: '100' }
  assert.equal(rowFromCatalog(available, 'equipment', 'ARS', undefined, now).provenance?.availabilityPolicy, 'fresh-positive')
})

test('an explicit historical supplier policy permits only recorded positives and keeps unrelated manual sources independent', () => {
  const approved = { ...historical(), supplier: 'Instaler' }
  assert.equal(getCatalogAvailabilityPolicy(approved), 'historical-positive')
  assert.equal(canSelectCatalogItem(approved, now), true)
  assert.equal(getCatalogSelectionStatus(approved, now).provisional, true)
  assert.equal(rowFromCatalog(approved, 'equipment', 'ARS', undefined, now).provenance?.availabilityPolicy, 'historical-positive')
  assert.equal(canSelectCatalogItem({ ...approved, stock: historical(0).stock }, now), false)
  for (const supplier of ['', 'Synthetic Supplier', 'Installer', 'Instaler Other']) {
    const manual = { ...approved, supplier, availabilityPolicy: undefined, stock: undefined }
    assert.equal(getCatalogAvailabilityPolicy(manual), undefined)
    assert.equal(canSelectCatalogItem(manual, now), true)
  }
})

test('controlled catalogue selections require a valid approved price as well as positive stock', () => {
  const pending = { ...historical(), supplier: 'Instaler', listPrice: undefined }
  assert.equal(canSelectCatalogItem(pending, now), false)
  assert.equal(getCatalogSelectionStatus(pending, now).reason, 'pending-price')
  assert.throws(() => rowFromCatalog(pending, 'equipment', 'ARS', undefined, now), /disponibilidad/)
  assert.equal(canSelectCatalogItem({ ...pending, unitPrice: '123,45' }, now), true)
  assert.equal(canSelectCatalogItem({ ...pending, unitPrice: '0' }, now), true)
  assert.equal(getCatalogSelectionStatus({ ...pending, unitPrice: 'invalid' }, now).reason, 'invalid-price')
  const cost = { ...pending, referencePrices: [{ amount: '10', currency: 'ARS' as const, role: 'cost' as const, date: null, historical: true as const }] }
  assert.equal(canSelectCatalogItem(cost, now), false)
  assert.equal(canSelectCatalogItem({ ...pending, supplier: 'Synthetic independent supplier', availabilityPolicy: undefined }, now), true)
  assert.equal(canSelectCatalogItem({ ...historical(), unitPrice: 'invalid' }, now), false)
  assert.equal(canSelectCatalogItem({ ...historical(), listPrice: { ...listPrice, amount: '1.234' } }, now), false)
})
