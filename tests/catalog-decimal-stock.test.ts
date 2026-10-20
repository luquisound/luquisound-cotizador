import assert from 'node:assert/strict'
import test from 'node:test'
import { serveCatalog } from '../api/catalog.ts'
import { parseCatalogImport, parseCatalogStockSnapshot, type CatalogImportDocument } from '../src/features/quotation/catalog.ts'
import { getCatalogSelectionStatus } from '../src/features/quotation/catalog-stock.ts'
import { createQuotation } from '../src/features/quotation/model.ts'
import type { StorageAdapter } from '../src/features/quotation/persistence.ts'
import {
  createQuotationLibrary, loadQuotationLibrary, openLibraryQuotation, parseQuotationLibraryBackup,
  saveQuotationLibrary, saveQuotationToLibrary, serializeQuotationLibrary,
} from '../src/features/quotation/quotation-library.ts'
import { inspectQuotationAvailability } from '../src/features/quotation/quotation-availability.ts'
import { parseRowProvenance, rowFromCatalog } from '../src/features/quotation/row-provenance.ts'
import { loadSharedCatalog, mergeSharedCatalog } from '../src/features/quotation/shared-catalog.ts'
import {
  loadCatalog, loadCurrentQuotation, parseCatalogBackup, saveCatalog, saveCurrentQuotation, serializeCatalogBackup,
} from '../src/features/quotation/working-storage.ts'

const source = { document: 'private-synthetic-decimal.xlsx', sheet: 'Products', row: 7, date: null, kind: 'snapshot' as const }
const config = {
  url: 'https://synthetic-store.private.blob.vercel-storage.com/catalog/latest.json',
  token: 'synthetic_server_token',
}

function document(quantity: number | null): CatalogImportDocument {
  return {
    format: 'luquisound.catalog', version: 1,
    items: [{
      supplier: 'Synthetic decimal supplier', sku: 'SYN-DECIMAL', brand: 'Synthetic brand',
      name: 'Synthetic decimal product', description: '', category: 'Synthetic category',
      section: 'equipment', source, referencePrices: [], availabilityPolicy: 'historical-positive',
      listPrice: { amount: '48.25', currency: 'ARS', basis: 'retail-list-before-discount', provisional: true, source },
      stock: { quantity, checkedAt: null, validUntil: null, observation: 'historical', source },
    }],
  }
}

function memoryStorage(): StorageAdapter {
  const values = new Map<string, string>()
  return {
    getItem(key) { return values.get(key) ?? null },
    setItem(key, value) { values.set(key, value) },
  }
}

test('decimal stock survives the private endpoint, local merge and catalogue backups without repricing', async () => {
  const [original] = mergeSharedCatalog([], document(1))
  assert.ok(original)
  const saved = { ...original, currency: 'USD' as const, unitPrice: '7,60' }
  const before = structuredClone(saved)
  for (const quantity of [27.375, 0.125, -2.75, 0, null]) {
    const incoming = document(quantity)
    const response = await serveCatalog(new Request('https://quotation.example/api/catalog'), config,
      async () => new Response(JSON.stringify(incoming), { headers: { 'Content-Type': 'application/json' } }))
    assert.equal(response.status, 200)
    const loaded = await loadSharedCatalog(new AbortController().signal, async () => response)
    assert.deepEqual(loaded, parseCatalogImport(JSON.stringify(incoming)))
    assert.ok(loaded)
    const merged = mergeSharedCatalog([saved], loaded)
    assert.equal(merged[0]!.id, saved.id)
    assert.equal(merged[0]!.unitPrice, '7,60')
    assert.equal(merged[0]!.currency, 'USD')
    assert.deepEqual(merged[0]!.stock, incoming.items[0]!.stock)
    const backup = serializeCatalogBackup(merged)
    assert.deepEqual(parseCatalogBackup(backup), merged)
    const storage = memoryStorage()
    assert.equal(saveCatalog(storage, merged).ok, true)
    assert.deepEqual(loadCatalog(storage).catalog, merged)
    assert.deepEqual(saved, before)
  }
})

test('decimal stock provenance survives current recovery and frozen library snapshots while later blocks preserve rows', () => {
  const catalog = mergeSharedCatalog([], document(0.125))
  const quotation = createQuotation()
  quotation.title = 'Synthetic decimal quotation'
  quotation.exchangeRate = '1.000'
  quotation.rows = [rowFromCatalog(catalog[0]!, 'equipment')]
  quotation.rows[0]!.quantity = '2,5'
  quotation.rows[0]!.unitPrice = '19,75'
  quotation.rows[0]!.currency = 'USD'
  const before = structuredClone(quotation)
  const provenance = quotation.rows[0]!.provenance!
  assert.deepEqual(parseRowProvenance(provenance), provenance)
  const storage = memoryStorage()
  assert.equal(saveCurrentQuotation(storage, quotation).ok, true)
  assert.deepEqual(loadCurrentQuotation(storage).quotation, before)
  const library = saveQuotationToLibrary(createQuotationLibrary(), quotation, 'Synthetic saved decimal')
  const restored = parseQuotationLibraryBackup(serializeQuotationLibrary(library))
  assert.deepEqual(restored, library)
  assert.equal(saveQuotationLibrary(storage, restored, { expectedRaw: null }).ok, true)
  assert.deepEqual(loadQuotationLibrary(storage).library, restored)
  const opened = openLibraryQuotation(restored.entries[0]!)
  assert.deepEqual(opened.rows[0]!.provenance, provenance)
  assert.equal(opened.rows[0]!.quantity, '2,5')
  assert.equal(opened.rows[0]!.unitPrice, '19,75')
  assert.equal(opened.rows[0]!.currency, 'USD')
  assert.equal(opened.exchangeRateMode, 'frozen')
  for (const quantity of [-0.125, 0, null]) {
    const updated = mergeSharedCatalog(catalog, document(quantity))
    assert.equal(getCatalogSelectionStatus(updated[0]!).selectable, false)
    assert.equal(inspectQuotationAvailability(quotation, updated).issues.length, 1)
    assert.deepEqual(quotation, before)
    assert.equal(restored.entries[0]!.quotation.rows[0]!.provenance!.stock!.quantity, 0.125)
  }
  opened.rows[0]!.provenance!.stock!.quantity = 0
  assert.equal(provenance.stock!.quantity, 0.125)
  assert.equal(restored.entries[0]!.quotation.rows[0]!.provenance!.stock!.quantity, 0.125)
})

test('invalid numeric stock is rejected before serialization and overflowing JSON numbers cannot cross the endpoint', async () => {
  const catalog = mergeSharedCatalog([], document(1))
  for (const quantity of [Number.NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, -Number.MAX_SAFE_INTEGER - 1]) {
    const invalid = { ...catalog[0]!, stock: { ...catalog[0]!.stock!, quantity } }
    assert.throws(() => parseCatalogStockSnapshot(invalid.stock))
    assert.throws(() => serializeCatalogBackup([invalid]))
  }
  const raw = JSON.stringify(document(0))
  assert.ok(raw.includes('"quantity":0'))
  for (const token of ['1e309', '-1e309', '9007199254740992', '-9007199254740992', '"0.125"', 'false']) {
    const invalidJson = raw.replace('"quantity":0', `"quantity":${token}`)
    assert.throws(() => parseCatalogImport(invalidJson))
    const response = await serveCatalog(new Request('https://quotation.example/api/catalog'), config,
      async () => new Response(invalidJson, { headers: { 'Content-Type': 'application/json' } }))
    assert.equal(response.status, 502)
  }
})
