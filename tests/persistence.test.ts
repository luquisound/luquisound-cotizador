import assert from 'node:assert/strict'
import test from 'node:test'
import { createQuotation, duplicateQuotation, hasQuotationContent, prepareWorkspaceForStorage } from '../src/features/quotation/model.ts'
import type { CatalogItem, Quotation, QuotationRow, Workspace } from '../src/features/quotation/model.ts'
import { loadWorkspace, parseWorkspace, saveWorkspace, serializeWorkspace, STORAGE_KEY } from '../src/features/quotation/persistence.ts'
import type { StorageAdapter } from '../src/features/quotation/persistence.ts'
import type { BlueDollarQuote } from '../src/features/quotation/exchange-quote.ts'
import { AUDIO_CATEGORIES } from '../src/features/quotation/audio-categories.ts'
import {
  loadCatalog, loadCurrentQuotation, parseCatalogBackup, saveCatalog, saveCurrentQuotation, serializeCatalogBackup,
} from '../src/features/quotation/working-storage.ts'

function createFixture(): Workspace {
  return {
    version: 1,
    activeQuotationId: 'quotation-1',
    quotations: [{
      id: 'quotation-1', title: 'PRUEBA', subtitle: 'Datos ficticios', currency: 'ARS',
      notes: 'Nota de prueba\nSegunda línea',
      createdAt: '2026-10-16T10:00:00.000Z', updatedAt: '2026-10-16T10:15:00.000Z',
      rows: [
        { id: 'row-1', section: 'equipment', currency: 'ARS', concept: 'Equipo de prueba', detail: 'Descripción', quantity: '2', unitPrice: '10,50', priceState: 'priced' },
        { id: 'row-2', section: 'extras', currency: 'ARS', concept: 'Trabajo sin cargo', detail: '', quantity: '1', unitPrice: '', priceState: 'included' },
        { id: 'row-3', section: 'extras', currency: 'ARS', concept: 'Precio pendiente', detail: '', quantity: '1', unitPrice: '', priceState: 'pending' },
        { id: 'row-4', section: 'extras', currency: 'ARS', concept: 'Cero explícito', detail: '', quantity: '1', unitPrice: '0', priceState: 'priced' },
      ],
    }],
    catalog: [{ id: 'catalog-1', section: 'equipment', concept: 'Equipo de prueba', detail: 'Descripción actualizada', currency: 'ARS', unitPrice: '91,25' }],
  }
}

test('all audio categories roundtrip with identities, raw draft fields and mixed price states intact', () => {
  const workspace = createFixture()
  workspace.quotations[0].rows = AUDIO_CATEGORIES.map((category, index) => ({
    ...workspace.quotations[0].rows[index % 4]!, id: `categorized-${index}`, section: category.section,
    audioCategory: category.id, currency: index % 2 === 0 ? 'USD' : 'ARS',
    concept: `Synthetic ${category.id}`, detail: ` Synthetic detail ${index}\n `,
  }))
  const snapshot = structuredClone(workspace)
  assert.deepEqual(parseWorkspace(serializeWorkspace(workspace)), snapshot)
  assert.deepEqual(workspace, snapshot)
  const duplicated = duplicateQuotation(workspace.quotations[0])
  assert.deepEqual(duplicated.rows.map((row) => row.audioCategory), AUDIO_CATEGORIES.map((category) => category.id))
  assert.equal(duplicated.rows.some((row) => workspace.quotations[0].rows.some((original) => row.id === original.id)), false)
})

test('adapter variants roundtrip independently with quantities, prices and product identities intact', () => {
  const workspace = createFixture()
  workspace.quotations[0].rows = ['6,5', '8'].map((size, index) => ({
    ...workspace.quotations[0].rows[index]!, id: `adapter-${index}`, section: 'extras', audioCategory: 'adapters',
    adapterVariant: { productKey: 'synthetic-ring', size, presentation: index === 0 ? 'pair' : 'unit' },
    concept: 'Synthetic adapter', quantity: index === 0 ? '2' : '0,5', currency: index === 0 ? 'ARS' : 'USD',
  }))
  const snapshot = structuredClone(workspace)
  const restored = parseWorkspace(serializeWorkspace(workspace))
  assert.deepEqual(restored, snapshot)
  assert.deepEqual(workspace, snapshot)
  assert.notEqual(restored.quotations[0].rows[0]?.adapterVariant, workspace.quotations[0].rows[0]?.adapterVariant)
  const duplicate = duplicateQuotation(workspace.quotations[0])
  assert.deepEqual(duplicate.rows[0]?.adapterVariant, workspace.quotations[0].rows[0]?.adapterVariant)
  assert.notEqual(duplicate.rows[0]?.adapterVariant, workspace.quotations[0].rows[0]?.adapterVariant)
  duplicate.rows[0]!.adapterVariant!.size = '10'
  assert.equal(workspace.quotations[0].rows[0]?.adapterVariant?.size, '6,5')
})

test('adapter identities coexist with frozen rates and private catalogue provenance through recovery and duplication', () => {
  const workspace = createFixture()
  const source = { document: 'Synthetic snapshot', date: null, kind: 'snapshot' as const, version: 'synthetic-v1', checksum: 'a'.repeat(64) }
  workspace.quotations[0]!.exchangeRate = '1000'
  workspace.quotations[0]!.exchangeRateMode = 'frozen'
  workspace.quotations[0]!.rows = [{
    ...workspace.quotations[0]!.rows[0]!, section: 'extras', audioCategory: 'adapters',
    adapterVariant: { productKey: 'synthetic-ring', size: '6,5', presentation: 'pair' },
    provenance: {
      catalogItemId: 'synthetic-ring', source, originalUnitPrice: '10,50', originalCurrency: 'ARS', priceBasis: 'list',
      listPrice: { amount: '10.50', currency: 'ARS', basis: 'retail-list-before-discount', provisional: true, source },
      stock: { quantity: 3, checkedAt: null, validUntil: null, observation: 'historical', source },
      availabilityPolicy: 'historical-positive',
    },
  }]
  const restored = parseWorkspace(serializeWorkspace(workspace))
  assert.deepEqual(restored, workspace)
  const copy = duplicateQuotation(restored.quotations[0]!)
  assert.equal(copy.exchangeRateMode, 'frozen')
  assert.deepEqual(copy.rows[0]!.adapterVariant, workspace.quotations[0]!.rows[0]!.adapterVariant)
  assert.deepEqual(copy.rows[0]!.provenance, workspace.quotations[0]!.rows[0]!.provenance)
  copy.rows[0]!.adapterVariant!.size = '8'
  copy.rows[0]!.provenance!.stock!.quantity = 0
  assert.equal(restored.quotations[0]!.rows[0]!.adapterVariant!.size, '6,5')
  assert.equal(restored.quotations[0]!.rows[0]!.provenance!.stock!.quantity, 3)
})

test('invalid adapter metadata is discarded without losing any required row data', () => {
  const workspace = createFixture()
  const row: QuotationRow = { ...workspace.quotations[0].rows[1]!, audioCategory: 'adapters' }
  for (const adapterVariant of [
    undefined, null, [], {}, '6,5',
    { productKey: 'synthetic', size: '6,5', presentation: 'invalid' },
    { productKey: 'with spaces', size: '6,5', presentation: 'unit' },
    { productKey: 'synthetic', size: '0', presentation: 'unit' },
  ]) {
    const input = { ...workspace, quotations: [{ ...workspace.quotations[0], rows: [{ ...row, adapterVariant }] }] }
    const restored = parseWorkspace(JSON.stringify(input))
    assert.deepEqual(restored.quotations[0].rows, [row])
    assert.equal(Object.hasOwn(restored.quotations[0].rows[0]!, 'adapterVariant'), false)
  }
})

test('adapter metadata is normalized and discarded when its row classification is incompatible', () => {
  const workspace = createFixture()
  const adapterVariant = { productKey: 'synthetic', size: '06.500', presentation: 'pair', unknown: 'discard' }
  const classified = { ...workspace.quotations[0].rows[1]!, audioCategory: 'adapters' }
  const restored = parseWorkspace(JSON.stringify({
    ...workspace, quotations: [{ ...workspace.quotations[0], rows: [{ ...classified, adapterVariant }] }],
  }))
  assert.deepEqual(restored.quotations[0].rows[0]?.adapterVariant, { productKey: 'synthetic', size: '6,5', presentation: 'pair' })
  for (const row of [
    workspace.quotations[0].rows[0]!,
    { ...classified, audioCategory: 'harness' },
    { ...classified, audioCategory: undefined },
  ]) {
    const input = { ...workspace, quotations: [{ ...workspace.quotations[0], rows: [{ ...row, adapterVariant }] }] }
    const retained = parseWorkspace(JSON.stringify(input)).quotations[0].rows[0]!
    assert.equal(Object.hasOwn(retained, 'adapterVariant'), false)
    assert.equal(retained.concept, row.concept)
    assert.equal(retained.quantity, row.quantity)
  }
})

test('legacy adapter descriptions never infer size, presentation or product identity', () => {
  const workspace = createFixture()
  workspace.quotations[0].rows[1] = {
    ...workspace.quotations[0].rows[1]!, audioCategory: 'adapters', concept: 'Aros adaptadores 3D 6,5 pulgadas',
    detail: 'Synthetic pair', quantity: '2',
  }
  const restored = parseWorkspace(serializeWorkspace(workspace))
  assert.deepEqual(restored, workspace)
  assert.equal(Object.hasOwn(restored.quotations[0].rows[1]!, 'adapterVariant'), false)
})

test('adapter metadata alone leaves quotation content empty', () => {
  const quotation = createQuotation()
  quotation.rows[1] = {
    ...quotation.rows[1]!, audioCategory: 'adapters',
    adapterVariant: { productKey: 'synthetic', size: '6,5', presentation: 'unit' },
  }
  assert.equal(hasQuotationContent(quotation), false)
  assert.deepEqual(prepareWorkspaceForStorage({
    version: 1, activeQuotationId: quotation.id, quotations: [quotation], catalog: [],
  }, new Set()), { version: 1, activeQuotationId: null, quotations: [], catalog: [] })
})

test('unknown, malformed or incompatible audio categories discard only optional classification', () => {
  const workspace = createFixture()
  const first = workspace.quotations[0].rows[0]!
  for (const audioCategory of [null, '', 'other', 'AMP', 'labor', 5, true, {}, [], { id: 'amplifier-dsp' }]) {
    const input = {
      ...workspace,
      quotations: [{ ...workspace.quotations[0], rows: [{ ...first, audioCategory }] }],
    }
    const restored = parseWorkspace(JSON.stringify(input))
    assert.deepEqual(restored.quotations[0].rows, [first])
    assert.equal(Object.hasOwn(restored.quotations[0].rows[0]!, 'audioCategory'), false)
  }
  const invalidExtras = {
    ...workspace,
    quotations: [{ ...workspace.quotations[0], rows: [{ ...workspace.quotations[0].rows[1], audioCategory: 'subwoofer' }] }],
  }
  assert.deepEqual(parseWorkspace(JSON.stringify(invalidExtras)).quotations[0].rows, [workspace.quotations[0].rows[1]])
})

test('legacy rows keep their existing order and never infer a category from descriptions', () => {
  const workspace = createFixture()
  workspace.quotations[0].rows[0].concept = 'Amplificador / DSP'
  workspace.quotations[0].rows[1].concept = 'Mano de obra'
  const restored = parseWorkspace(serializeWorkspace(workspace))
  assert.deepEqual(restored, workspace)
  assert.equal(restored.quotations[0].rows.every((row) => !Object.hasOwn(row, 'audioCategory')), true)
})

test('valid audio metadata never relaxes required commercial field validation', () => {
  const workspace = createFixture()
  const first = { ...workspace.quotations[0].rows[0], audioCategory: 'amplifier-dsp' }
  for (const fields of [
    { currency: 'EUR' }, { concept: null }, { detail: 1 }, { quantity: false },
    { unitPrice: 0 }, { priceState: 'free' }, { section: 'invalid' },
  ]) {
    const input = {
      ...workspace,
      quotations: [{ ...workspace.quotations[0], rows: [{ ...first, ...fields }] }],
    }
    assert.throws(() => parseWorkspace(JSON.stringify(input)))
  }
})

test('legacy rows inherit the original quotation currency without changing raw data or identities', () => {
  for (const currency of ['ARS', 'USD'] as const) {
    const workspace = createFixture()
    workspace.quotations[0].currency = currency
    const legacy = {
      ...workspace,
      quotations: workspace.quotations.map((quotation) => ({
        ...quotation,
        rows: quotation.rows.map(({ currency: _currency, ...row }) => row),
      })),
    }
    const raw = JSON.stringify(legacy)
    const restored = parseWorkspace(raw)
    assert.deepEqual(restored.quotations[0].rows.map((row) => row.currency), [currency, currency, currency, currency])
    assert.deepEqual(restored.quotations[0].rows.map((row) => row.id), workspace.quotations[0].rows.map((row) => row.id))
    assert.equal(JSON.stringify(legacy), raw)
    assert.deepEqual(parseWorkspace(serializeWorkspace(restored)), restored)
  }
})

test('mixed row currencies roundtrip with prices, explicit zero, included and pending state intact', () => {
  const workspace = createFixture()
  workspace.quotations[0].rows[0].currency = 'USD'
  workspace.quotations[0].rows[2].currency = 'USD'
  const snapshot = structuredClone(workspace)
  assert.deepEqual(parseWorkspace(serializeWorkspace(workspace)), snapshot)
  assert.deepEqual(workspace, snapshot)
  for (const currency of [null, '', 'EUR', 'usd', 0]) {
    const invalid = structuredClone(workspace)
    const input = { ...invalid.quotations[0], rows: [{ ...invalid.quotations[0].rows[0], currency }] }
    assert.throws(() => parseWorkspace(JSON.stringify({ ...invalid, quotations: [input] })))
  }
})

function createMetadataFixture(): Workspace {
  const workspace = createFixture()
  workspace.quotations[0]!.exchangeRate = '1.234,567890'
  workspace.catalog[0] = {
    ...workspace.catalog[0]!, unitPrice: '0', supplier: ' Synthetic supplier ', sku: '0007-A',
    brand: 'Synthetic brand', category: 'Synthetic category', unit: 'pair', presentation: 'Two test units',
    source: { document: 'synthetic-current.pdf', page: 3, sheet: ' Example ', row: 17, date: null },
    referencePrices: [
      { amount: '0', currency: 'USD', role: 'cost', date: '2024-02', historical: true,
        source: { document: 'synthetic-history.xlsx', sheet: 'Original', row: 12, date: '2024-02-29' } },
      { amount: null, currency: null, role: 'unknown', date: null, historical: true },
      { amount: '123.450000', currency: 'ARS', role: 'list', date: '2025-11-30', historical: true,
        source: { document: 'synthetic-other.pdf', page: 2, date: '2025-11' } },
      { amount: '2', currency: 'USD', role: 'sale', date: '2026-01', historical: true },
    ],
  }
  return workspace
}

function stockFixture(): NonNullable<CatalogItem['stock']> {
  return {
    quantity: 3, checkedAt: '2020-01-10T15:00:00.000Z', validUntil: '2020-01-10T16:00:00.000Z',
    source: { document: 'synthetic-stock.xlsx', sheet: 'Stock', row: 7, date: '2020-01-10' },
  }
}

test('new quotations have an empty exchange rate while legacy backups keep the field absent', () => {
  assert.equal(createQuotation().exchangeRate, '')
  const legacy = createFixture()
  assert.equal(Object.hasOwn(legacy.quotations[0]!, 'exchangeRate'), false)
  const restored = parseWorkspace(serializeWorkspace(legacy))
  assert.deepEqual(restored, legacy)
  assert.equal(Object.hasOwn(restored.quotations[0]!, 'exchangeRate'), false)
  assert.equal(Object.hasOwn(restored.catalog[0]!, 'source'), false)
  assert.equal(Object.hasOwn(restored.catalog[0]!, 'referencePrices'), false)
  assert.equal(Object.hasOwn(restored.catalog[0]!, 'stock'), false)
})

test('raw exchange-rate draft strings survive backup, storage and duplication without coercion', () => {
  for (const exchangeRate of ['', '0', '1.234,567890', 'tasa pendiente', ' 1,25 ']) {
    const workspace = createFixture()
    workspace.quotations[0]!.exchangeRate = exchangeRate
    assert.deepEqual(parseWorkspace(serializeWorkspace(workspace)), workspace)
    const storage = createMemoryStorage()
    assert.equal(saveWorkspace(storage, workspace).ok, true)
    assert.equal(loadWorkspace(storage).workspace.quotations[0]!.exchangeRate, exchangeRate)
    assert.equal(duplicateQuotation(workspace.quotations[0]!).exchangeRate, exchangeRate)
  }
  const quotation = createQuotation()
  quotation.exchangeRate = '0'
  assert.equal(hasQuotationContent(quotation), true)
  const workspace: Workspace = { version: 1, activeQuotationId: quotation.id, quotations: [quotation], catalog: [] }
  assert.deepEqual(prepareWorkspaceForStorage(workspace, new Set()), workspace)
})

test('exchange-rate input must be an optional bounded string', () => {
  const workspace = createFixture()
  for (const exchangeRate of [null, 0, {}, [], '1'.repeat(65)]) {
    rejectBackup({ ...workspace, quotations: [{ ...workspace.quotations[0]!, exchangeRate }] })
  }
})

function historicalQuote(): BlueDollarQuote {
  return {
    rate: '1.234,56', source: 'DolarAPI', market: 'blue', side: 'sell',
    updatedAt: '2023-01-10T15:00:00.000Z', fetchedAt: '2023-01-10T15:01:00.000Z',
  }
}

test('historical automatic quotes roundtrip storage and backups without refreshing or expiring', () => {
  const workspace = createFixture()
  workspace.quotations[0]!.exchangeRate = '1234,560000'
  workspace.quotations[0]!.exchangeRateQuote = historicalQuote()
  const snapshot = structuredClone(workspace)
  assert.deepEqual(parseWorkspace(serializeWorkspace(workspace)), snapshot)
  const storage = createMemoryStorage()
  assert.equal(saveWorkspace(storage, workspace).ok, true)
  assert.deepEqual(loadWorkspace(storage).workspace, snapshot)
  assert.deepEqual(workspace, snapshot)
})

test('quote provenance is rejected when absent, invalid or inconsistent with its actual rate', () => {
  const workspace = createFixture()
  const quotation = { ...workspace.quotations[0]!, exchangeRate: '1.234,56', exchangeRateQuote: historicalQuote() }
  for (const exchangeRate of [undefined, '', '0', 'invalid', '1.234,57']) {
    rejectBackup({ ...workspace, quotations: [{ ...quotation, exchangeRate }] })
  }
  for (const exchangeRateQuote of [null, {}, [], { ...historicalQuote(), source: 'Unknown' },
    { ...historicalQuote(), updatedAt: '2023-02-30T15:00:00.000Z' }]) {
    rejectBackup({ ...workspace, quotations: [{ ...quotation, exchangeRateQuote }] })
  }
  const invalid = { ...workspace, quotations: [{ ...quotation, exchangeRate: '9.999' }] }
  const original = serializeWorkspace(workspace)
  const storage = createMemoryStorage(original)
  assert.equal(saveWorkspace(storage, invalid).ok, false)
  assert.equal(storage.current(), original)
})

test('automatic exchange metadata strips unknown properties and duplicates independent fixed snapshots', () => {
  const workspace = createFixture()
  const quote = historicalQuote()
  workspace.quotations[0] = { ...workspace.quotations[0]!, exchangeRate: quote.rate, exchangeRateQuote: quote }
  const expanded = {
    ...workspace, quotations: [{ ...workspace.quotations[0]!, exchangeRateQuote: { ...quote, unrecognized: 'discard' } }],
  }
  assert.deepEqual(parseWorkspace(JSON.stringify(expanded)), workspace)
  const duplicate = duplicateQuotation(workspace.quotations[0]!)
  assert.deepEqual(duplicate.exchangeRateQuote, quote)
  assert.notEqual(duplicate.exchangeRateQuote, quote)
  duplicate.exchangeRateQuote!.rate = '9.999'
  assert.equal(workspace.quotations[0]!.exchangeRateQuote!.rate, '1.234,56')
})

test('an automatic rate alone leaves a new proposal blank while manual rates remain meaningful', () => {
  const quotation = createQuotation()
  quotation.exchangeRateQuote = historicalQuote()
  quotation.exchangeRate = quotation.exchangeRateQuote.rate
  assert.equal(hasQuotationContent(quotation), false)
  const workspace: Workspace = { version: 1, activeQuotationId: quotation.id, quotations: [quotation], catalog: [] }
  assert.deepEqual(prepareWorkspaceForStorage(workspace, new Set()), {
    version: 1, activeQuotationId: null, quotations: [], catalog: [],
  })
  assert.deepEqual(prepareWorkspaceForStorage(workspace, new Set([quotation.id])), workspace)
  quotation.rows[0]!.concept = 'Partial concept'
  assert.equal(hasQuotationContent(quotation), true)
  quotation.rows[0]!.concept = ''
  delete quotation.exchangeRateQuote
  assert.equal(hasQuotationContent(quotation), true)
})

test('catalogue metadata and independent historical price sources roundtrip exactly', () => {
  const workspace = createMetadataFixture()
  const original = structuredClone(workspace)
  const restored = parseWorkspace(serializeWorkspace(workspace))
  assert.deepEqual(restored, original)
  assert.notEqual(restored.catalog[0]!.source, workspace.catalog[0]!.source)
  assert.notEqual(restored.catalog[0]!.referencePrices, workspace.catalog[0]!.referencePrices)
  assert.notEqual(restored.catalog[0]!.referencePrices![0]!.source, workspace.catalog[0]!.referencePrices![0]!.source)
  assert.equal(restored.catalog[0]!.referencePrices![1]!.source, undefined)
  assert.equal(restored.catalog[0]!.referencePrices![1]!.amount, null)
  assert.equal(restored.catalog[0]!.referencePrices![1]!.currency, null)
  assert.equal(restored.catalog[0]!.referencePrices![1]!.date, null)
  assert.equal(restored.catalog[0]!.referencePrices![0]!.amount, '0')
  assert.equal(restored.catalog[0]!.unitPrice, '0')
  restored.catalog[0]!.source!.document = 'synthetic-edited.pdf'
  restored.catalog[0]!.referencePrices![0]!.source!.sheet = 'Edited reference'
  assert.deepEqual(workspace, original)
  const storage = createMemoryStorage()
  assert.equal(saveWorkspace(storage, workspace).ok, true)
  assert.deepEqual(loadWorkspace(storage).workspace, original)
})

test('reading timestamps survive catalogue storage, backups and current-quotation recovery without changing dates or prices', () => {
  const workspace = createMetadataFixture()
  const readAt = '2026-10-22T12:34:56.789Z'
  const item = workspace.catalog[0]!
  item.source = { ...item.source!, sheet: 'Example', readAt }
  item.stock = {
    quantity: 3, checkedAt: null, validUntil: null, observation: 'historical',
    source: { document: 'synthetic-stock.xlsx', date: null, readAt },
  }
  item.listPrice = {
    amount: '123.45', currency: 'ARS', basis: 'retail-list-before-discount', provisional: true,
    source: { document: 'synthetic-list.xlsx', date: null, readAt },
  }
  item.referencePrices![0]!.source = { ...item.referencePrices![0]!.source!, readAt }
  workspace.quotations[0]!.rows[0]!.provenance = {
    catalogItemId: item.id, source: structuredClone(item.source), stock: structuredClone(item.stock),
    listPrice: structuredClone(item.listPrice), originalUnitPrice: '10,50', originalCurrency: 'ARS',
    priceBasis: 'manual', availabilityPolicy: 'historical-positive',
  }
  const snapshot = structuredClone(workspace)
  assert.deepEqual(parseWorkspace(serializeWorkspace(workspace)), snapshot)
  assert.deepEqual(parseCatalogBackup(serializeCatalogBackup(workspace.catalog)), snapshot.catalog)
  const values = new Map([[STORAGE_KEY, 'legacy bytes preserved']])
  const storage: StorageAdapter = {
    getItem(key) { return values.get(key) ?? null },
    setItem(key, value) { values.set(key, value) },
  }
  assert.equal(saveCatalog(storage, workspace.catalog).ok, true)
  assert.deepEqual(loadCatalog(storage).catalog, snapshot.catalog)
  assert.equal(saveCurrentQuotation(storage, workspace.quotations[0]!).ok, true)
  assert.deepEqual(loadCurrentQuotation(storage).quotation, snapshot.quotations[0])
  assert.equal(values.get(STORAGE_KEY), 'legacy bytes preserved')
  assert.deepEqual(workspace, snapshot)
})

test('malformed reading timestamps cannot be discarded or overwrite valid stored catalogue metadata', () => {
  const workspace = createMetadataFixture()
  const item = workspace.catalog[0]!
  const original = serializeCatalogBackup(workspace.catalog)
  const values = new Map<string, string>()
  const storage: StorageAdapter = {
    getItem(key) { return values.get(key) ?? null },
    setItem(key, value) { values.set(key, value) },
  }
  assert.equal(saveCatalog(storage, workspace.catalog).ok, true)
  const stored = new Map(values)
  for (const readAt of [null, 0, '', 'invalid', '2026-10-22', '2026-10-22T12:34:56Z',
    '2026-02-30T12:34:56.789Z', '2026-10-22T09:34:56.789-03:00', ' 2026-10-22T12:34:56.789Z']) {
    const source = { document: 'synthetic.xlsx', date: null, readAt }
    for (const change of [
      { source }, { stock: { ...stockFixture(), source } },
      { referencePrices: [{ ...item.referencePrices![0], source }] },
      { listPrice: { amount: '123.45', currency: 'ARS', basis: 'retail-list-before-discount', provisional: true, source } },
    ]) {
      const invalid = { ...workspace, catalog: [{ ...item, ...change }] }
      rejectBackup(invalid)
      assert.equal(saveCatalog(storage, invalid.catalog as CatalogItem[]).ok, false)
      assert.deepEqual(values, stored)
    }
  }
  assert.equal(serializeCatalogBackup(workspace.catalog), original)
})

test('stock snapshots preserve zero, unknown quantity, expired timestamps and independent sources exactly', () => {
  for (const quantity of [0, null, -2.75, 0.125, 27.375, 3, Number.MAX_SAFE_INTEGER]) {
    const workspace = createMetadataFixture()
    workspace.catalog[0]!.stock = { ...stockFixture(), quantity }
    const snapshot = structuredClone(workspace)
    const restored = parseWorkspace(serializeWorkspace(workspace))
    assert.deepEqual(restored, snapshot)
    assert.notEqual(restored.catalog[0]!.stock, workspace.catalog[0]!.stock)
    assert.notEqual(restored.catalog[0]!.stock!.source, workspace.catalog[0]!.stock!.source)
    assert.notDeepEqual(restored.catalog[0]!.stock!.source, restored.catalog[0]!.source)
    const storage = createMemoryStorage()
    assert.equal(saveWorkspace(storage, workspace).ok, true)
    assert.deepEqual(loadWorkspace(storage).workspace, snapshot)
    restored.catalog[0]!.stock!.source.sheet = 'Edited stock'
    assert.deepEqual(workspace, snapshot)
  }
})

test('stock whitelists discard unknown properties without substituting product source or dates', () => {
  const workspace = createMetadataFixture()
  workspace.catalog[0]!.stock = stockFixture()
  const item = workspace.catalog[0]!
  const stock = item.stock!
  const expanded = {
    ...workspace, catalog: [{
      ...item, stock: { ...stock, unrecognized: 'discard', source: { ...stock.source, unrecognized: 'discard' } },
    }],
  }
  assert.deepEqual(parseWorkspace(JSON.stringify(expanded)), workspace)
  assert.deepEqual(JSON.parse(serializeWorkspace(expanded)), workspace)
  const withoutItemSource = { ...workspace, catalog: [{ ...item, source: undefined }] }
  const restored = parseWorkspace(serializeWorkspace(withoutItemSource))
  assert.equal(Object.hasOwn(restored.catalog[0]!, 'source'), false)
  assert.deepEqual(restored.catalog[0]!.stock, stock)
})

test('invalid stock quantity, timestamps, intervals and provenance cannot overwrite good stored work', () => {
  const workspace = createMetadataFixture()
  const stock = stockFixture()
  const invalidStocks: unknown[] = [
    null, [], {},
    ...[undefined, '0', '', true, Number.MAX_SAFE_INTEGER + 1, -Number.MAX_SAFE_INTEGER - 1].map((quantity) => ({ ...stock, quantity })),
    ...[undefined, null, '', 0, '2020-01-10', '2020-02-30T15:00:00.000Z', '2020-01-10T15:00:00Z',
      '2020-01-10T15:00:00.000+00:00'].flatMap((timestamp) => [
      { ...stock, checkedAt: timestamp }, { ...stock, validUntil: timestamp },
    ]),
    { ...stock, validUntil: stock.checkedAt },
    { ...stock, validUntil: '2020-01-10T14:59:59.999Z' },
    ...[undefined, null, [], {}, { document: '', date: null }, { document: 'synthetic.xlsx' },
      { document: 'synthetic.xlsx', row: 0, date: null },
      { document: 'synthetic.xlsx', date: '2020-02-30' }].map((source) => ({ ...stock, source })),
  ]
  const original = serializeWorkspace(workspace)
  const storage = createMemoryStorage(original)
  for (const invalidStock of invalidStocks) {
    const invalid = { ...workspace, catalog: [{ ...workspace.catalog[0]!, stock: invalidStock }] }
    rejectBackup(invalid)
    assert.equal(saveWorkspace(storage, invalid as Workspace).ok, false)
    assert.equal(storage.current(), original)
    assert.equal(storage.writeCount(), 0)
  }
  for (const quantity of [NaN, Infinity, -Infinity]) {
    const invalid = { ...workspace, catalog: [{ ...workspace.catalog[0]!, stock: { ...stock, quantity } }] }
    assert.equal(saveWorkspace(storage, invalid).ok, false)
    assert.equal(storage.current(), original)
    assert.equal(storage.writeCount(), 0)
  }
})

test('restoring old historical prices never assigns the current item source retroactively', () => {
  const workspace = createMetadataFixture()
  const oldReference = workspace.catalog[0]!.referencePrices![1]!
  assert.equal(Object.hasOwn(oldReference, 'source'), false)
  let restored = workspace
  for (let index = 0; index < 3; index += 1) restored = parseWorkspace(serializeWorkspace(restored))
  assert.deepEqual(restored.catalog[0]!.source, workspace.catalog[0]!.source)
  assert.deepEqual(restored.catalog[0]!.referencePrices![0]!.source, workspace.catalog[0]!.referencePrices![0]!.source)
  assert.deepEqual(restored.catalog[0]!.referencePrices![1], oldReference)
  assert.equal(Object.hasOwn(restored.catalog[0]!.referencePrices![1]!, 'source'), false)
})

test('source and historical reference whitelists discard unknown properties independently', () => {
  const workspace = createMetadataFixture()
  const item = workspace.catalog[0]!
  const expanded = {
    ...workspace,
    catalog: [{
      ...item, unrecognized: 'discard', source: { ...item.source!, unrecognized: 'discard' },
      referencePrices: item.referencePrices!.map((reference) => ({
        ...reference, unrecognized: 'discard',
        ...(reference.source === undefined ? {} : { source: { ...reference.source, unrecognized: 'discard' } }),
      })),
    }],
  }
  assert.deepEqual(parseWorkspace(JSON.stringify(expanded)), workspace)
  assert.deepEqual(JSON.parse(serializeWorkspace(expanded)), workspace)
})

test('catalogue metadata text fields remain raw bounded strings', () => {
  const workspace = createMetadataFixture()
  const item = workspace.catalog[0]!
  for (const [field, limit] of [
    ['supplier', 200], ['sku', 128], ['brand', 200], ['category', 200], ['unit', 200], ['presentation', 200],
  ] as const) {
    for (const invalid of [null, 0, {}, 'X'.repeat(limit + 1)]) {
      rejectBackup({ ...workspace, catalog: [{ ...item, [field]: invalid }] })
    }
    const valid = { ...workspace, catalog: [{ ...item, [field]: 'X'.repeat(limit) }] }
    assert.deepEqual(parseWorkspace(serializeWorkspace(valid)), valid)
  }
})

test('item and individual reference sources require valid dates, document names and locations', () => {
  const workspace = createMetadataFixture()
  const item = workspace.catalog[0]!
  const reference = item.referencePrices![0]!
  const invalidSources: unknown[] = [
    null, [], {}, { document: '', date: null }, { document: '   ', date: null },
    { document: 'X'.repeat(501), date: null }, { document: 'synthetic.pdf' },
    { document: 'synthetic.xlsx', sheet: null, date: null },
    { document: 'synthetic.xlsx', sheet: 'X'.repeat(129), date: null },
  ]
  for (const field of ['page', 'row']) {
    for (const position of [null, '1', 0, -1, 1.5, 1000001]) {
      invalidSources.push({ document: 'synthetic.pdf', [field]: position, date: null })
    }
  }
  for (const date of [undefined, '', 20240101, '2024-13', '2024-00', '2024-02-30', '2023-02-29', '2024-01-01T00:00:00Z']) {
    invalidSources.push({ document: 'synthetic.pdf', date })
  }
  for (const source of invalidSources) {
    rejectBackup({ ...workspace, catalog: [{ ...item, source }] })
    rejectBackup({ ...workspace, catalog: [{ ...item, referencePrices: [{ ...reference, source }] }] })
    rejectBackup({ ...workspace, catalog: [{ ...item, stock: { ...stockFixture(), source } }] })
  }
  const source = { document: 'synthetic.xlsx', page: 1000000, row: 1, sheet: '', date: '2024-02-29' }
  const valid = { ...workspace, catalog: [{ ...item, source, referencePrices: [{ ...reference, source }] }] }
  const restored = parseWorkspace(serializeWorkspace(valid))
  assert.deepEqual(restored, valid)
  assert.notEqual(restored.catalog[0]!.source, restored.catalog[0]!.referencePrices![0]!.source)
})

test('historical price references validate exact amounts, nullable currency/date, roles and historical true', () => {
  const workspace = createMetadataFixture()
  const item = workspace.catalog[0]!
  const reference = item.referencePrices![0]!
  const invalidChanges: Record<string, unknown>[] = [
    ...[undefined, '', 0, '-1', '+1', '01', '1,25', '1.000,00', 'NaN', 'Infinity', '1e2', '1.1234567', '1000000000000000000'].map((amount) => ({ amount })),
    ...[undefined, '', 'EUR', 0].map((currency) => ({ currency })),
    ...[undefined, '', 'retail', null].map((role) => ({ role })),
    ...[undefined, false, 'true', 1].map((historical) => ({ historical })),
    ...[undefined, '', 0, '2024-13', '2024-02-30', '2023-02-29', '2024-01-01T00:00:00Z'].map((date) => ({ date })),
  ]
  for (const changes of invalidChanges) {
    rejectBackup({ ...workspace, catalog: [{ ...item, referencePrices: [{ ...reference, ...changes }] }] })
  }
  for (const amount of [null, '0', '0.000001', '999999999999999999.999999']) {
    const valid = { ...workspace, catalog: [{ ...item, referencePrices: [{ ...reference, amount, currency: null, date: null }] }] }
    assert.deepEqual(parseWorkspace(serializeWorkspace(valid)), valid)
  }
  for (const referencePrices of [null, {}, [null], Array.from({ length: 51 }, () => reference)]) {
    rejectBackup({ ...workspace, catalog: [{ ...item, referencePrices }] })
  }
  const valid = { ...workspace, catalog: [{ ...item, referencePrices: Array.from({ length: 50 }, () => reference) }] }
  assert.equal(parseWorkspace(serializeWorkspace(valid)).catalog[0]!.referencePrices!.length, 50)
})

test('duplicating a maximum-length imported title remains recoverable', () => {
  const workspace = createFixture()
  workspace.quotations[0]!.title = 'A'.repeat(500)
  const duplicate = duplicateQuotation(workspace.quotations[0]!)
  workspace.quotations.push(duplicate)
  workspace.activeQuotationId = duplicate.id
  assert.equal(duplicate.title.length, 500)
  assert.ok(duplicate.title.endsWith(' (copia)'))
  assert.equal(parseWorkspace(serializeWorkspace(workspace)).quotations.length, 2)
  assert.equal(workspace.quotations[0]!.title, 'A'.repeat(500))
})

function createMemoryStorage(initial: string | null = null) {
  let value = initial
  let writes = 0
  return {
    getItem(key: string): string | null {
      assert.equal(key, STORAGE_KEY)
      return value
    },
    setItem(key: string, next: string): void {
      assert.equal(key, STORAGE_KEY)
      writes += 1
      value = next
    },
    current: () => value,
    writeCount: () => writes,
  }
}

function rejectBackup(value: unknown): void {
  assert.throws(() => parseWorkspace(JSON.stringify(value)), /formato válido de Luquisound/)
}

test('an empty storage starts a blank workspace without writing', () => {
  const storage = createMemoryStorage()
  const result = loadWorkspace(storage)
  assert.equal(result.error, null)
  assert.equal(result.stored, false)
  assert.equal(result.workspace.quotations.length, 1)
  assert.equal(result.workspace.activeQuotationId, result.workspace.quotations[0].id)
  assert.deepEqual(result.workspace.catalog, [])
  assert.ok(result.workspace.quotations[0].rows.every((row) => row.concept === '' && row.unitPrice === '' && row.priceState === 'pending'))
  assert.equal(storage.writeCount(), 0)
})

test('saving and loading retains drafts, explicit zero, included and pending amounts', () => {
  const workspace = createFixture()
  const storage = createMemoryStorage()
  assert.deepEqual(saveWorkspace(storage, workspace), { ok: true, error: null })
  assert.equal(storage.writeCount(), 1)
  const loaded = loadWorkspace(storage)
  assert.equal(loaded.error, null)
  assert.equal(loaded.stored, true)
  assert.deepEqual(loaded.workspace, workspace)
  assert.notEqual(loaded.workspace, workspace)
  assert.notEqual(loaded.workspace.quotations[0].rows, workspace.quotations[0].rows)
})

test('JSON backup roundtrips raw draft input without coercion', () => {
  const workspace = createFixture()
  workspace.quotations[0].rows[0].quantity = '1,25'
  workspace.quotations[0].rows[0].unitPrice = 'importe por revisar'
  workspace.quotations[0].currency = 'USD'
  const backup = serializeWorkspace(workspace)
  assert.deepEqual(parseWorkspace(backup), workspace)
  assert.deepEqual(parseWorkspace(`\ufeff${backup}`), workspace)
})

test('import and serialization keep only known fields at every data boundary', () => {
  const workspace = createFixture()
  const expanded = {
    ...workspace, unrecognized: 'discard',
    quotations: workspace.quotations.map((quotation) => ({
      ...quotation, unrecognized: 'discard',
      rows: quotation.rows.map((row) => ({ ...row, unrecognized: 'discard' })),
    })),
    catalog: workspace.catalog.map((item) => ({ ...item, unrecognized: 'discard' })),
  }
  assert.deepEqual(parseWorkspace(JSON.stringify(expanded)), workspace)
  assert.deepEqual(JSON.parse(serializeWorkspace(expanded)), workspace)
})

test('unexpected prototype-shaped JSON fields are discarded', () => {
  const backup = serializeWorkspace(createFixture())
  const expanded = backup.replace('"version": 1,', '"version": 1, "__proto__": {"polluted": true}, "constructor": {"polluted": true},')
  const loaded = parseWorkspace(expanded)
  assert.deepEqual(loaded, createFixture())
  assert.equal(Object.hasOwn(loaded, '__proto__'), false)
  assert.equal(Object.hasOwn(loaded, 'constructor'), false)
})

test('corrupted stored data remains untouched and yields a visible safe error', () => {
  const corruptText = '{"privateValue":"do-not-echo",'
  const storage = createMemoryStorage(corruptText)
  const loaded = loadWorkspace(storage)
  assert.match(loaded.error ?? '', /No se pudieron leer/)
  assert.equal(loaded.stored, false)
  assert.doesNotMatch(loaded.error ?? '', /do-not-echo/)
  assert.equal(loaded.workspace.quotations.length, 1)
  assert.equal(storage.current(), corruptText)
  assert.equal(storage.writeCount(), 0)
})

test('an empty or unsupported stored backup is not silently treated as a new workspace', () => {
  for (const text of ['', 'null', JSON.stringify({ version: 9 })]) {
    const storage = createMemoryStorage(text)
    const loaded = loadWorkspace(storage)
    assert.notEqual(loaded.error, null)
    assert.equal(loaded.stored, false)
    assert.equal(storage.current(), text)
    assert.equal(storage.writeCount(), 0)
  }
})

test('storage access failure does not crash or expose the thrown error', () => {
  const storage: StorageAdapter = {
    getItem() { throw new Error('private browser diagnostic') },
    setItem() { assert.fail('load must not write') },
  }
  const loaded = loadWorkspace(storage)
  assert.match(loaded.error ?? '', /No se pudo acceder/)
  assert.equal(loaded.stored, false)
  assert.doesNotMatch(loaded.error ?? '', /private browser diagnostic/)
  assert.equal(loaded.workspace.quotations.length, 1)
})

test('quota or denied writes are reported as failed saves', () => {
  const storage: StorageAdapter = {
    getItem() { return null },
    setItem() { throw new Error('private quota diagnostic') },
  }
  const result = saveWorkspace(storage, createFixture())
  assert.equal(result.ok, false)
  assert.match(result.error ?? '', /No se pudo guardar/)
  assert.doesNotMatch(result.error ?? '', /private quota diagnostic/)
})

test('invalid workspace cannot overwrite an existing stored backup', () => {
  const original = serializeWorkspace(createFixture())
  const storage = createMemoryStorage(original)
  const invalid = createFixture()
  invalid.activeQuotationId = 'missing-quotation'
  assert.equal(saveWorkspace(storage, invalid).ok, false)
  assert.equal(storage.current(), original)
  assert.equal(storage.writeCount(), 0)
})

test('invalid JSON errors are safe and never reproduce the input', () => {
  assert.throws(() => parseWorkspace('{"private":"do-not-echo"'), (error: unknown) => {
    assert.ok(error instanceof Error)
    assert.match(error.message, /formato válido de Luquisound/)
    assert.doesNotMatch(error.message, /do-not-echo/)
    return true
  })
})

test('import rejects invalid top-level shapes and absent active references', () => {
  const workspace = createFixture()
  const invalids: unknown[] = [
    null, [], 1, true, 'workspace', {},
    { ...workspace, version: '1' }, { ...workspace, version: 2 },
    { ...workspace, activeQuotationId: 'absent' },
    { ...workspace, activeQuotationId: null },
    { ...workspace, quotations: [] }, { ...workspace, quotations: null },
    { ...workspace, catalog: {} }, { ...workspace, activeQuotationId: '' },
  ]
  invalids.forEach(rejectBackup)
})

test('a stored empty workspace roundtrips without creating phantom quotation IDs', () => {
  const workspace: Workspace = { version: 1, activeQuotationId: null, quotations: [], catalog: createFixture().catalog }
  const serialized = serializeWorkspace(workspace)
  assert.deepEqual(parseWorkspace(serialized), workspace)
  const storage = createMemoryStorage(serialized)
  const loaded = loadWorkspace(storage)
  assert.equal(loaded.error, null)
  assert.equal(loaded.stored, true)
  assert.deepEqual(loaded.workspace, workspace)
  assert.equal(storage.writeCount(), 0)
  assert.equal(storage.current(), serialized)
  assert.deepEqual(saveWorkspace(storage, loaded.workspace), { ok: true, error: null })
  assert.deepEqual(parseWorkspace(storage.current() ?? ''), workspace)
})

test('import rejects invalid row, catalogue, currency and price-state shapes', () => {
  const workspace = createFixture()
  const quotation = workspace.quotations[0]
  const row = quotation.rows[0]
  const item = workspace.catalog[0]
  const invalidQuotations: unknown[] = [
    { ...quotation, currency: 'EUR' }, { ...quotation, rows: {} },
    { ...quotation, title: null }, { ...quotation, notes: 0 },
    ...[
      { ...row, section: 'other' }, { ...row, priceState: 'free' },
      { ...row, unitPrice: 0 }, { ...row, quantity: 1 },
      { ...row, detail: null }, { ...row, concept: undefined },
    ].map((invalidRow) => ({ ...quotation, rows: [invalidRow] })),
  ]
  invalidQuotations.forEach((invalidQuotation) => rejectBackup({ ...workspace, quotations: [invalidQuotation] }))
  for (const invalidItem of [null, { ...item, currency: 'EUR' }, { ...item, section: 'other' }, { ...item, unitPrice: 0 }]) {
    rejectBackup({ ...workspace, catalog: [invalidItem] })
  }
})

test('import rejects duplicate identities and unsafe or overlong IDs', () => {
  const workspace = createFixture()
  const quotation = workspace.quotations[0]
  const row = quotation.rows[0]
  const item = workspace.catalog[0]
  rejectBackup({ ...workspace, quotations: [quotation, quotation] })
  rejectBackup({ ...workspace, quotations: [{ ...quotation, rows: [row, row] }] })
  rejectBackup({ ...workspace, quotations: [quotation, { ...quotation, id: 'quotation-2' }] })
  rejectBackup({ ...workspace, catalog: [item, item] })
  rejectBackup({ ...workspace, catalog: [{ ...item, id: row.id }] })
  for (const id of ['', 'with spaces', '../path', 'a'.repeat(129)]) {
    rejectBackup({ ...workspace, catalog: [{ ...item, id }] })
  }
})

test('import validates full ISO timestamps including real calendar dates', () => {
  const workspace = createFixture()
  const quotation = workspace.quotations[0]
  for (const timestamp of ['', 'yesterday', '2026-10-16', '2026-02-30T10:00:00.000Z', '2026-10-16T10:00:00Z', '2026-10-16T10:00:00.000+00:00']) {
    rejectBackup({ ...workspace, quotations: [{ ...quotation, createdAt: timestamp }] })
    rejectBackup({ ...workspace, quotations: [{ ...quotation, updatedAt: timestamp }] })
  }
})

test('import rejects excessive field and collection lengths', () => {
  const workspace = createFixture()
  const quotation = workspace.quotations[0]
  const row = quotation.rows[0]
  const item = workspace.catalog[0]
  for (const longQuotation of [
    { ...quotation, title: 'a'.repeat(501) }, { ...quotation, subtitle: 'a'.repeat(1001) },
    { ...quotation, notes: 'a'.repeat(10001) },
    { ...quotation, rows: [{ ...row, concept: 'a'.repeat(501) }] },
    { ...quotation, rows: [{ ...row, detail: 'a'.repeat(2001) }] },
    { ...quotation, rows: [{ ...row, quantity: '1'.repeat(65) }] },
    { ...quotation, rows: [{ ...row, unitPrice: '1'.repeat(65) }] },
    { ...quotation, rows: Array.from({ length: 1001 }, (_, index) => ({ ...row, id: `long-row-${index}` })) },
  ]) rejectBackup({ ...workspace, quotations: [longQuotation] })
  rejectBackup({ ...workspace, quotations: Array.from({ length: 501 }, (_, index) => ({ ...quotation, id: `long-quotation-${index}`, rows: [] })) })
  rejectBackup({ ...workspace, catalog: Array.from({ length: 2001 }, (_, index) => ({ ...item, id: `long-catalog-${index}` })) })
})

test('valid collection boundaries are accepted', () => {
  const workspace = createFixture()
  const quotation = workspace.quotations[0]
  const row = quotation.rows[0]
  const item = workspace.catalog[0]
  const quotations: Quotation[] = Array.from({ length: 500 }, (_, index) => ({ ...quotation, id: `limit-quotation-${index}`, rows: [] }))
  const rows: QuotationRow[] = Array.from({ length: 1000 }, (_, index) => ({ ...row, id: `limit-row-${index}` }))
  const catalog: CatalogItem[] = Array.from({ length: 2000 }, (_, index) => ({ ...item, id: `limit-catalog-${index}` }))
  assert.equal(parseWorkspace(JSON.stringify({ ...workspace, activeQuotationId: quotations[0].id, quotations })).quotations.length, 500)
  assert.equal(parseWorkspace(JSON.stringify({ ...workspace, quotations: [{ ...quotation, rows }] })).quotations[0].rows.length, 1000)
  assert.equal(parseWorkspace(JSON.stringify({ ...workspace, catalog })).catalog.length, 2000)
})

test('backup size is limited by UTF-8 bytes as well as character count', () => {
  assert.throws(() => parseWorkspace(' '.repeat(5 * 1024 * 1024 + 1)), /límite de 5 MB/)
  assert.throws(() => parseWorkspace('á'.repeat(3 * 1024 * 1024)), /límite de 5 MB/)
  const workspace = createFixture()
  workspace.quotations[0].rows = Array.from({ length: 1000 }, (_, index) => ({
    ...workspace.quotations[0].rows[0], id: `oversized-row-${index}`, concept: '€'.repeat(500), detail: '€'.repeat(2000),
  }))
  assert.throws(() => serializeWorkspace(workspace), /límite de 5 MB/)
  const storage = createMemoryStorage('previous backup')
  assert.equal(saveWorkspace(storage, workspace).ok, false)
  assert.equal(storage.writeCount(), 0)
  assert.equal(storage.current(), 'previous backup')
})

test('duplicating regenerates quotation and row IDs while preserving price snapshots', () => {
  const original = createFixture().quotations[0]
  const before = structuredClone(original)
  const copy = duplicateQuotation(original)
  assert.notEqual(copy.id, original.id)
  assert.equal(copy.title, 'PRUEBA (copia)')
  assert.equal(copy.currency, original.currency)
  assert.equal(copy.notes, original.notes)
  assert.notEqual(copy.rows, original.rows)
  assert.equal(new Set([copy.id, ...copy.rows.map((row) => row.id)]).size, copy.rows.length + 1)
  copy.rows.forEach((row, index) => {
    assert.notEqual(row.id, original.rows[index].id)
    assert.deepEqual({ ...row, id: original.rows[index].id }, original.rows[index])
  })
  copy.rows[0].concept = 'Cambio en copia'
  copy.rows[0].unitPrice = '999,00'
  copy.rows.push({ ...copy.rows[0], id: 'new-copy-row' })
  assert.deepEqual(original, before)
  const workspace = createFixture()
  workspace.quotations.push(copy)
  assert.deepEqual(parseWorkspace(serializeWorkspace(workspace)), workspace)
})

test('catalogue edits and removal never update saved quotation prices or their copies', () => {
  const workspace = parseWorkspace(serializeWorkspace(createFixture()))
  const original = structuredClone(workspace.quotations[0])
  workspace.catalog[0].unitPrice = '125,50'
  workspace.catalog[0].detail = 'Nueva descripción del catálogo'
  assert.deepEqual(workspace.quotations[0], original)
  const copy = duplicateQuotation(workspace.quotations[0])
  workspace.quotations.push(copy)
  workspace.catalog = []
  const storage = createMemoryStorage()
  assert.equal(saveWorkspace(storage, workspace).ok, true)
  const loaded = loadWorkspace(storage)
  assert.equal(loaded.error, null)
  assert.deepEqual(loaded.workspace.quotations[0], original)
  assert.equal(loaded.workspace.quotations[1].rows[0].unitPrice, '10,50')
  loaded.workspace.quotations[1].rows[0].unitPrice = '25,00'
  assert.equal(loaded.workspace.quotations[0].rows[0].unitPrice, '10,50')
})
