import assert from 'node:assert/strict'
import test from 'node:test'
import type { CatalogImportDocument } from '../src/features/quotation/catalog.ts'
import {
  CATALOG_SOURCE_READING_MAX_AGE_MS, getCatalogSelectionStatus,
} from '../src/features/quotation/catalog-stock.ts'
import { createQuotation, type CatalogItem, type Quotation } from '../src/features/quotation/model.ts'
import { STORAGE_KEY, type StorageAdapter } from '../src/features/quotation/persistence.ts'
import {
  createQuotationLibrary, LIBRARY_STORAGE_KEY, loadQuotationLibrary, openLibraryQuotation,
  saveQuotationLibrary, saveQuotationToLibrary, serializeQuotationLibrary,
} from '../src/features/quotation/quotation-library.ts'
import {
  getRowAvailabilityItem, inspectQuotationAvailability,
} from '../src/features/quotation/quotation-availability.ts'
import { changeRowCurrency } from '../src/features/quotation/row-currency.ts'
import { rowFromCatalog } from '../src/features/quotation/row-provenance.ts'
import { loadSharedCatalog, mergeSharedCatalog } from '../src/features/quotation/shared-catalog.ts'
import {
  CATALOG_STORAGE_KEY, CURRENT_QUOTATION_STORAGE_KEY, loadCatalog, loadCurrentQuotation,
  saveCatalog, saveCurrentQuotation,
} from '../src/features/quotation/working-storage.ts'
import { buildInstalerCatalogCandidate, type InstalerCatalogPolicy } from '../src/server/instaler-catalog.ts'
import type { ObservationSnapshot, ObservationTable } from '../src/server/instaler-observation.ts'

const READ_AT = '2026-10-22T12:00:00.000Z'
const NOW = Date.parse(READ_AT)
const DAY = 24 * 60 * 60 * 1000

function snapshot(
  rows: ObservationTable['rows'] = [
    { row: 2, values: ['SYN-A', 'Synthetic speaker', '123.45', '12.75', 'Speakers'] },
    { row: 3, values: ['SYN-B', 'Synthetic amplifier', '250.00', '3', 'Amplifiers'] },
  ],
  readAt = READ_AT,
): ObservationSnapshot {
  return {
    readAt, modifiedTime: '2026-10-20T12:00:00.000Z',
    table: {
      source: { document: 'synthetic-private-list.xlsx', version: 'synthetic', checksum: 'a'.repeat(64) },
      headerRow: 1, headers: ['SKU', 'DESCRIPCION', 'PRECIO', 'STOCK', 'CATEGORIA'], rows,
    },
  }
}

function empty(): CatalogImportDocument {
  return { format: 'luquisound.catalog', version: 1, items: [] }
}

function storage(): StorageAdapter & { values: Map<string, string>; writes: string[] } {
  const values = new Map([[STORAGE_KEY, 'Preserved legacy bytes']])
  const writes: string[] = []
  return {
    values, writes,
    getItem: (key) => values.get(key) ?? null,
    setItem(key, value) { values.set(key, value); writes.push(key) },
  }
}

function product(catalog: CatalogItem[], sku: string): CatalogItem {
  const item = catalog.find((entry) => entry.sku === sku)
  assert.ok(item)
  return item
}

async function transport(document: CatalogImportDocument): Promise<CatalogImportDocument> {
  const loaded = await loadSharedCatalog(new AbortController().signal, async () => new Response(JSON.stringify(document), {
    headers: { 'content-type': 'application/json' },
  }))
  assert.ok(loaded)
  return loaded
}

function preparedQuotation(catalog: CatalogItem[]): Quotation {
  const selected = rowFromCatalog(product(catalog, 'SYN-A'), 'equipment', 'ARS', 'speakers', NOW)
  const manual = changeRowCurrency({
    ...selected, id: crypto.randomUUID(), unitPrice: '2.876,54', detail: 'Manual quotation detail',
  }, 'USD', '1.400')
  return {
    ...createQuotation(), title: 'Synthetic installation', rows: [selected, manual],
    exchangeRate: '1.400', exchangeRateMode: 'frozen',
  }
}

test('candidate transport and refresh preserve manual catalogue values, open recovery and saved-library bytes', async () => {
  const first = buildInstalerCatalogCandidate(snapshot(), empty()).document
  let catalog = mergeSharedCatalog([], await transport(first))
  const manual = product(catalog, 'SYN-B')
  manual.unitPrice = '0'
  manual.currency = 'USD'
  manual.detail = 'Manual catalogue detail'
  const manualBefore = structuredClone(manual)
  const quotation = preparedQuotation(catalog)
  assert.equal(quotation.rows[0].unitPrice, '123,45')
  assert.equal(quotation.rows[0].currency, 'ARS')
  assert.equal(quotation.rows[1].currency, 'USD')
  assert.ok(quotation.rows[1].currencyConversionOrigin)
  const quotationBefore = JSON.stringify(quotation)
  const library = saveQuotationToLibrary(createQuotationLibrary(), quotation, 'Synthetic saved quotation')
  const opened = openLibraryQuotation(library.entries[0])
  const openedBefore = JSON.stringify(opened)
  const adapter = storage()
  const initialCatalogSave = saveCatalog(adapter, catalog, { expectedRaw: null })
  assert.equal(initialCatalogSave.ok, true)
  assert.equal(saveCurrentQuotation(adapter, quotation, { expectedRaw: null }).ok, true)
  assert.equal(saveQuotationLibrary(adapter, library, { expectedRaw: null }).ok, true)
  const recoveryBytes = adapter.values.get(CURRENT_QUOTATION_STORAGE_KEY)
  const libraryBytes = adapter.values.get(LIBRARY_STORAGE_KEY)
  const writesBefore = adapter.writes.length

  const later = snapshot([
    { row: 5, values: ['SYN-A', 'Updated synthetic speaker', '175.75', '8.5', 'Speakers'] },
    { row: 6, values: ['SYN-B', 'Updated synthetic amplifier', '300.00', '2', 'Amplifiers'] },
  ], '2026-10-23T12:00:00.000Z')
  const candidate = buildInstalerCatalogCandidate(later, first)
  catalog = mergeSharedCatalog(catalog, await transport(candidate.document))
  const updated = product(catalog, 'SYN-B')
  assert.equal(updated.id, manualBefore.id)
  assert.equal(updated.unitPrice, '0')
  assert.equal(updated.currency, 'USD')
  assert.equal(updated.detail, manualBefore.detail)
  assert.equal(updated.listPrice?.amount, '300')
  assert.equal(saveCatalog(adapter, catalog, { expectedRaw: initialCatalogSave.raw }).ok, true)
  assert.deepEqual(loadCatalog(adapter).catalog, catalog)
  assert.deepEqual(adapter.writes.slice(writesBefore), [CATALOG_STORAGE_KEY])
  assert.equal(adapter.values.get(CURRENT_QUOTATION_STORAGE_KEY), recoveryBytes)
  assert.equal(adapter.values.get(LIBRARY_STORAGE_KEY), libraryBytes)
  assert.equal(adapter.values.get(STORAGE_KEY), 'Preserved legacy bytes')
  assert.equal(JSON.stringify(quotation), quotationBefore)
  assert.equal(JSON.stringify(opened), openedBefore)
  assert.deepEqual(loadCurrentQuotation(adapter).quotation, quotation)
  assert.equal(serializeQuotationLibrary(loadQuotationLibrary(adapter).library), libraryBytes)

  const next = rowFromCatalog(product(catalog, 'SYN-A'), 'equipment', 'USD', 'speakers', NOW + DAY)
  assert.equal(next.unitPrice, '175,75')
  assert.equal(next.currency, 'ARS')
  const manualNext = rowFromCatalog(updated, 'equipment', 'ARS', undefined, NOW + DAY)
  assert.equal(manualNext.unitPrice, '0')
  assert.equal(manualNext.currency, 'USD')
  assert.equal(manualNext.provenance?.priceBasis, 'manual')
  assert.equal(quotation.rows[0].provenance?.originalUnitPrice, '123,45')
  assert.equal(inspectQuotationAvailability(quotation, catalog, NOW + DAY).issues.length, 0)
  assert.equal(inspectQuotationAvailability(opened, catalog, NOW + DAY).issues.length, 0)
  assert.equal(JSON.stringify(quotation), quotationBefore)
})

test('an absent-product tombstone blocks current and reopened quotations without reviving stored positive stock', async () => {
  const first = buildInstalerCatalogCandidate(snapshot(), empty()).document
  const initialCatalog = mergeSharedCatalog([], await transport(first))
  const quotation = preparedQuotation(initialCatalog)
  const library = saveQuotationToLibrary(createQuotationLibrary(), quotation, 'Synthetic saved quotation')
  const libraryBytes = serializeQuotationLibrary(library)
  const quotationBytes = JSON.stringify(quotation)
  assert.equal(quotation.rows[0].provenance?.stock?.quantity, 12.75)
  assert.equal(inspectQuotationAvailability(quotation, initialCatalog, NOW).issues.length, 0)

  const absent = buildInstalerCatalogCandidate(snapshot([
    { row: 3, values: ['SYN-B', 'Synthetic amplifier', '250.00', '3', 'Amplifiers'] },
  ], '2026-10-23T12:00:00.000Z'), first)
  assert.equal(absent.summary.absent, 1)
  const catalog = mergeSharedCatalog(initialCatalog, await transport(absent.document))
  const tombstone = product(catalog, 'SYN-A')
  assert.equal(tombstone.id, product(initialCatalog, 'SYN-A').id)
  assert.equal(tombstone.stock?.quantity, null)
  assert.equal(tombstone.listPrice, undefined)
  assert.ok(tombstone.selectionBlock)
  assert.equal(getCatalogSelectionStatus(tombstone, NOW + DAY).reason, 'blocked')
  const active = getRowAvailabilityItem(quotation.rows[0], catalog)
  assert.equal(active?.stock?.quantity, null)
  assert.equal(active?.selectionBlock, tombstone.selectionBlock)
  assert.equal(inspectQuotationAvailability(quotation, catalog, NOW + DAY).issues.length, 2)
  assert.throws(() => rowFromCatalog(tombstone, 'equipment', 'ARS', undefined, NOW + DAY), /disponibilidad/)

  const opened = openLibraryQuotation(library.entries[0])
  // Older browser archives may refer to an ID from another catalogue installation.
  opened.rows[0].provenance!.catalogItemId = 'synthetic-old-browser-id'
  assert.equal(getRowAvailabilityItem(opened.rows[0], catalog)?.stock?.quantity, null)
  assert.equal(inspectQuotationAvailability(opened, catalog, NOW + DAY).issues.length, 2)
  assert.equal(JSON.stringify(quotation), quotationBytes)
  assert.equal(serializeQuotationLibrary(library), libraryBytes)
  assert.equal(opened.rows[0].provenance?.stock?.quantity, 12.75)
  assert.equal(opened.rows[0].unitPrice, '123,45')
  assert.deepEqual(opened.rows[1].currencyConversionOrigin, quotation.rows[1].currencyConversionOrigin)
})

test('reading age expires at seven days without inventing supplier freshness or rewriting historical archives', async () => {
  const first = buildInstalerCatalogCandidate(snapshot(), empty()).document
  const catalog = mergeSharedCatalog([], await transport(first))
  const quotation = preparedQuotation(catalog)
  const library = saveQuotationToLibrary(createQuotationLibrary(), quotation, 'Synthetic saved quotation')
  const quotationBytes = JSON.stringify(quotation)
  const libraryBytes = serializeQuotationLibrary(library)
  const item = product(catalog, 'SYN-A')
  assert.equal(CATALOG_SOURCE_READING_MAX_AGE_MS, 7 * DAY)
  assert.equal(item.stock?.source.readAt, READ_AT)
  assert.equal(item.stock?.checkedAt, null)
  assert.equal(item.stock?.validUntil, null)
  assert.equal(item.stock?.observation, 'historical')
  assert.equal(item.source?.date, null)
  assert.equal(first.instalerObservation?.supplierFreshnessEstablished, false)
  assert.equal(getCatalogSelectionStatus(item, NOW + 7 * DAY - 1).reason, 'historical-positive')
  assert.equal(getCatalogSelectionStatus(item, NOW + 7 * DAY).reason, 'stale-stock')
  assert.equal(inspectQuotationAvailability(quotation, catalog, NOW + 7 * DAY - 1).issues.length, 0)
  assert.equal(inspectQuotationAvailability(quotation, catalog, NOW + 7 * DAY).issues.length, 2)

  const renewedSnapshot = snapshot(undefined, '2026-10-28T12:00:00.000Z')
  const renewed = buildInstalerCatalogCandidate(renewedSnapshot, first)
  const refreshed = mergeSharedCatalog(catalog, await transport(renewed.document))
  assert.equal(getCatalogSelectionStatus(product(refreshed, 'SYN-A'), NOW + 7 * DAY).reason, 'historical-positive')
  assert.equal(inspectQuotationAvailability(quotation, refreshed, NOW + 7 * DAY).issues.length, 0)
  assert.equal(renewed.document.instalerObservation?.supplierFreshnessEstablished, false)
  assert.equal(product(refreshed, 'SYN-A').stock?.checkedAt, null)
  assert.equal(JSON.stringify(quotation), quotationBytes)
  assert.equal(serializeQuotationLibrary(library), libraryBytes)

  const legacy = structuredClone(catalog)
  for (const entry of legacy) {
    if (entry.source) delete entry.source.readAt
    if (entry.stock) delete entry.stock.source.readAt
    if (entry.listPrice) delete entry.listPrice.source.readAt
  }
  const adapter = storage()
  assert.equal(saveCatalog(adapter, legacy, { expectedRaw: null }).ok, true)
  const recoveredLegacy = loadCatalog(adapter)
  assert.equal(recoveredLegacy.error, null)
  assert.equal(product(recoveredLegacy.catalog, 'SYN-A').stock?.source.readAt, undefined)
  assert.equal(getCatalogSelectionStatus(product(recoveredLegacy.catalog, 'SYN-A'), NOW + 30 * DAY).reason, 'historical-positive')
  assert.equal(serializeQuotationLibrary(library), libraryBytes)
})

test('missing supplier fields replace old source values atomically while manual prices survive behind availability blocks', async () => {
  const first = buildInstalerCatalogCandidate(snapshot(), empty()).document
  const initialCatalog = mergeSharedCatalog([], await transport(first))
  const manual = product(initialCatalog, 'SYN-B')
  manual.unitPrice = '0'
  manual.currency = 'USD'
  const quotation = preparedQuotation(initialCatalog)
  const quotationBytes = JSON.stringify(quotation)
  const candidate = buildInstalerCatalogCandidate(snapshot([
    { row: 2, values: ['SYN-A', 'Synthetic speaker', '175.75', null, 'Speakers'] },
    { row: 3, values: ['SYN-B', 'Synthetic amplifier', null, '3', 'Amplifiers'] },
  ], '2026-10-23T12:00:00.000Z'), first)
  const catalog = mergeSharedCatalog(initialCatalog, await transport(candidate.document))
  const missingStock = product(catalog, 'SYN-A')
  assert.equal(missingStock.stock?.quantity, null)
  assert.equal(missingStock.listPrice?.amount, '175.75')
  assert.equal(getCatalogSelectionStatus(missingStock, NOW + DAY).reason, 'blocked')
  const missingPrice = product(catalog, 'SYN-B')
  assert.equal(missingPrice.listPrice, undefined)
  assert.equal(missingPrice.unitPrice, '0')
  assert.equal(missingPrice.currency, 'USD')
  assert.equal(missingPrice.id, manual.id)
  assert.equal(getCatalogSelectionStatus(missingPrice, NOW + DAY).reason, 'blocked')
  assert.equal(inspectQuotationAvailability(quotation, catalog, NOW + DAY).issues.length, 2)
  assert.equal(quotation.rows[0].provenance?.stock?.quantity, 12.75)
  assert.equal(JSON.stringify(quotation), quotationBytes)
})

test('reviewed commercial titles resolve copied specifications for new selections without rewriting existing quotations', async () => {
  const sourceText = 'Synthetic RX-65 MK-II 6.5-inch (pair) | Supplier input and output specifications'
  const contradictoryText = 'Synthetic vehicle tweeter\n' + 'Copied four-inch center speaker specifications. '.repeat(15)
  const input = snapshot([
    { row: 2, values: ['SYN-A', sourceText, '123.45', '12.75', 'Speakers'] },
    { row: 3, values: ['SYN-B', contradictoryText, '250.00', '3', 'Speakers'] },
  ])
  const oldPolicy: InstalerCatalogPolicy = {
    format: 'luquisound.instaler-catalog-policy', version: 1,
    names: [{ sku: 'SYN-A', sourceText, name: sourceText }],
    exclusions: [], allowIdenticalDuplicates: false,
  }
  const previous = buildInstalerCatalogCandidate(input, empty(), oldPolicy)
  assert.equal(previous.summary.unresolvedNames, 1)
  const initialCatalog = mergeSharedCatalog([], previous.document)
  product(initialCatalog, 'SYN-A').detail = 'Retained catalogue specifications'
  const historicalRow = {
    ...rowFromCatalog(product(initialCatalog, 'SYN-A'), 'equipment', 'ARS', 'speakers', NOW),
    concept: sourceText, detail: 'Previously saved customer detail',
  }
  const previouslyShortenedRow = {
    ...historicalRow, id: crypto.randomUUID(), concept: 'Synthetic RX-65 MK-II 6.5-inch (pair)',
    detail: 'Previously saved customer installation detail',
  }
  const quotation = {
    ...createQuotation(), rows: [historicalRow, previouslyShortenedRow],
    exchangeRate: '1.400', exchangeRateMode: 'frozen' as const,
  }
  const quotationBytes = JSON.stringify(quotation)
  const library = saveQuotationToLibrary(createQuotationLibrary(), quotation, 'Previously saved title')
  const libraryBytes = serializeQuotationLibrary(library)
  const adapter = storage()
  assert.equal(saveCurrentQuotation(adapter, quotation, { expectedRaw: null }).ok, true)
  assert.equal(saveQuotationLibrary(adapter, library, { expectedRaw: null }).ok, true)
  const recoveryBytes = adapter.values.get(CURRENT_QUOTATION_STORAGE_KEY)
  const writesBefore = adapter.writes.length

  const title = 'Synthetic RX-65 MK-II 6.5-inch (pair) (SYN-A)'
  const nextPolicy: InstalerCatalogPolicy = { ...oldPolicy, names: [
    { sku: 'SYN-A', sourceText, name: title },
    { sku: 'SYN-B', sourceText: contradictoryText, name: 'Synthetic vehicle tweeter' },
  ] }
  const updated = buildInstalerCatalogCandidate(input, previous.document, nextPolicy)
  assert.equal(updated.summary.unresolvedNames, 0)
  assert.equal(updated.document.instalerObservation?.readAt, READ_AT)
  const catalog = mergeSharedCatalog(initialCatalog, await transport(updated.document))
  const selected = rowFromCatalog(product(catalog, 'SYN-A'), 'equipment', 'USD', 'speakers', NOW)
  assert.equal(selected.concept, title)
  assert.equal(selected.detail, '')
  assert.equal(selected.unitPrice, historicalRow.unitPrice)
  assert.equal(selected.currency, historicalRow.currency)
  assert.deepEqual(selected.provenance?.stock, historicalRow.provenance?.stock)
  assert.equal(product(catalog, 'SYN-A').detail, 'Retained catalogue specifications')
  const resolved = rowFromCatalog(product(catalog, 'SYN-B'), 'equipment', 'ARS', undefined, NOW)
  assert.equal(resolved.concept, 'Synthetic vehicle tweeter')
  assert.equal(resolved.detail, '')
  assert.equal(resolved.unitPrice, '250')
  assert.equal(saveCatalog(adapter, catalog, { expectedRaw: null }).ok, true)

  assert.deepEqual(adapter.writes.slice(writesBefore), [CATALOG_STORAGE_KEY])
  assert.equal(adapter.values.get(CURRENT_QUOTATION_STORAGE_KEY), recoveryBytes)
  assert.equal(adapter.values.get(LIBRARY_STORAGE_KEY), libraryBytes)
  assert.equal(JSON.stringify(quotation), quotationBytes)
  assert.deepEqual(loadCurrentQuotation(adapter).quotation, quotation)
  const reopened = openLibraryQuotation(loadQuotationLibrary(adapter).library.entries[0])
  assert.equal(reopened.rows[0].concept, sourceText)
  assert.equal(reopened.rows[0].detail, historicalRow.detail)
  assert.equal(reopened.rows[0].unitPrice, historicalRow.unitPrice)
  assert.equal(serializeQuotationLibrary(library), libraryBytes)
  assert.equal(getCatalogSelectionStatus(product(catalog, 'SYN-A'), NOW + 7 * DAY).reason, 'stale-stock')

  const drift = structuredClone(input)
  drift.table.rows[1].values[1] = contradictoryText + ' Changed source wording.'
  const unreviewed = buildInstalerCatalogCandidate(drift, updated.document, nextPolicy)
  assert.equal(unreviewed.summary.unresolvedNames, 1)
  assert.ok(unreviewed.document.items.find((item) => item.sku === 'SYN-B')?.selectionBlock)
})
