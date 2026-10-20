import assert from 'node:assert/strict'
import test from 'node:test'
import { createQuotation, createRow, hasQuotationContent } from '../src/features/quotation/model.ts'
import type { CatalogItem, Workspace } from '../src/features/quotation/model.ts'
import { parseWorkspace, serializeWorkspace, STORAGE_KEY } from '../src/features/quotation/persistence.ts'
import type { StorageAdapter } from '../src/features/quotation/persistence.ts'
import {
  CATALOG_STORAGE_KEY, CURRENT_QUOTATION_STORAGE_KEY, loadCatalog, loadCurrentQuotation,
  parseCatalogBackup, saveCatalog, saveCurrentQuotation, serializeCatalogBackup,
} from '../src/features/quotation/working-storage.ts'
import type { WorkingSaveOptions } from '../src/features/quotation/working-storage.ts'

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  const writes: string[] = []
  const storage: StorageAdapter = {
    getItem(key) { return values.get(key) ?? null },
    setItem(key, text) { values.set(key, text); writes.push(key) },
  }
  return { storage, values, writes }
}

function catalogFixture(): CatalogItem[] {
  return [{
    id: 'test-catalog-1', concept: 'Synthetic equipment', detail: 'Synthetic description',
    section: 'equipment', currency: 'USD', unitPrice: '0', supplier: 'Synthetic supplier',
    sku: '0007-A', brand: 'Synthetic brand', category: 'Synthetic category', unit: 'pair',
    presentation: 'Two test units', source: { document: 'synthetic.pdf', page: 3, date: null },
    referencePrices: [
      { amount: null, currency: null, role: 'unknown', date: null, historical: true },
      { amount: '0', currency: 'USD', role: 'cost', date: '2024-02', historical: true,
        source: { document: 'synthetic.xlsx', sheet: 'Source', row: 2, date: '2024-02-29' } },
      { amount: '9.123400', currency: 'ARS', role: 'sale', date: '2026-03-01', historical: true },
    ],
  }, {
    id: 'test-catalog-2', concept: 'Synthetic labor', detail: '', section: 'extras',
    currency: 'ARS', unitPrice: '',
  }]
}

function stockFixture(): NonNullable<CatalogItem['stock']> {
  return {
    quantity: 3, checkedAt: '2020-01-10T15:00:00.000Z', validUntil: '2020-01-10T16:00:00.000Z',
    source: { document: 'synthetic-stock.xlsx', sheet: 'Stock', row: 7, date: '2020-01-10' },
  }
}

function legacyFixture(): Workspace {
  const first = createQuotation()
  first.title = 'Synthetic earlier quotation'
  const second = createQuotation()
  second.subtitle = 'Synthetic latest quotation'
  return { version: 1, activeQuotationId: second.id, quotations: [first, second], catalog: catalogFixture() }
}

function workingStorageCases() {
  const catalog = catalogFixture()
  const nextCatalog = structuredClone(catalog)
  nextCatalog[0]!.concept = 'Synthetic replacement equipment'
  const quotation = createQuotation()
  quotation.notes = 'Synthetic original current work'
  const nextQuotation = { ...quotation, notes: 'Synthetic replacement current work' }
  const quotationText = serializeWorkspace({
    version: 1, activeQuotationId: quotation.id, quotations: [quotation], catalog: [],
  })
  return [{
    name: 'catalogue', key: CATALOG_STORAGE_KEY,
    normalizedOriginal: serializeCatalogBackup(catalog),
    original: `\ufeff${serializeCatalogBackup(catalog)}\n`,
    replacement: serializeCatalogBackup(nextCatalog), load: loadCatalog,
    save: (storage: StorageAdapter, options?: WorkingSaveOptions) => saveCatalog(storage, nextCatalog, options),
  }, {
    name: 'current quotation', key: CURRENT_QUOTATION_STORAGE_KEY,
    normalizedOriginal: quotationText, original: `\ufeff${quotationText}\n`,
    replacement: serializeWorkspace({
      version: 1, activeQuotationId: nextQuotation.id, quotations: [nextQuotation], catalog: [],
    }),
    load: loadCurrentQuotation,
    save: (storage: StorageAdapter, options?: WorkingSaveOptions) => saveCurrentQuotation(storage, nextQuotation, options),
  }]
}

test('categorized current recovery preserves all row data without modifying catalogue or legacy stores', () => {
  const legacyText = `\ufeff${JSON.stringify(legacyFixture())}`
  const catalog = catalogFixture()
  const catalogText = serializeCatalogBackup(catalog)
  const memory = memoryStorage({ [STORAGE_KEY]: legacyText, [CATALOG_STORAGE_KEY]: catalogText })
  const quotation = createQuotation()
  quotation.rows = [
    { ...createRow('equipment', 'USD'), audioCategory: 'speakers', concept: 'Synthetic first speaker', quantity: '2', unitPrice: '10,25', priceState: 'priced' },
    { ...createRow('equipment', 'ARS'), audioCategory: 'speakers', concept: 'Synthetic second speaker', unitPrice: '0', priceState: 'priced' },
    { ...createRow('extras', 'ARS'), audioCategory: 'labor', concept: 'Synthetic included labor', priceState: 'included' },
    { ...createRow('extras', 'USD'), audioCategory: 'harness', concept: 'Synthetic pending harness', quantity: 'quantity pending' },
    { ...createRow('extras'), concept: 'Synthetic free work', detail: 'Unclassified retained detail' },
  ]
  const snapshot = structuredClone(quotation)
  assert.equal(saveCurrentQuotation(memory.storage, quotation).ok, true)
  assert.deepEqual(loadCurrentQuotation(memory.storage), {
    quotation: snapshot, error: null, raw: memory.values.get(CURRENT_QUOTATION_STORAGE_KEY),
  })
  assert.deepEqual(quotation, snapshot)
  assert.deepEqual(loadCatalog(memory.storage).catalog, catalog)
  assert.equal(memory.values.get(CATALOG_STORAGE_KEY), catalogText)
  assert.equal(memory.values.get(STORAGE_KEY), legacyText)
  assert.deepEqual(memory.writes, [CURRENT_QUOTATION_STORAGE_KEY])
})

test('current adapter recovery keeps independent variants and leaves catalogue and legacy bytes untouched', () => {
  const legacyText = serializeWorkspace(legacyFixture())
  const catalogText = serializeCatalogBackup(catalogFixture())
  const memory = memoryStorage({ [STORAGE_KEY]: legacyText, [CATALOG_STORAGE_KEY]: catalogText })
  const quotation = createQuotation()
  quotation.rows = ['6,5', '8'].map((size, index) => ({
    ...createRow('extras', index === 0 ? 'ARS' : 'USD'), audioCategory: 'adapters',
    adapterVariant: { productKey: 'synthetic-ring', size, presentation: 'pair' },
    concept: 'Synthetic adapter', quantity: '2', unitPrice: index === 0 ? '10,25' : '20,50', priceState: 'priced',
  }))
  const snapshot = structuredClone(quotation)
  assert.equal(saveCurrentQuotation(memory.storage, quotation).ok, true)
  assert.deepEqual(loadCurrentQuotation(memory.storage), {
    quotation: snapshot, error: null, raw: memory.values.get(CURRENT_QUOTATION_STORAGE_KEY),
  })
  assert.equal(memory.values.get(CATALOG_STORAGE_KEY), catalogText)
  assert.equal(memory.values.get(STORAGE_KEY), legacyText)
  assert.deepEqual(memory.writes, [CURRENT_QUOTATION_STORAGE_KEY])
  assert.deepEqual(quotation, snapshot)
})

test('adapter metadata without commercial content never creates a recoverable quotation', () => {
  const quotation = createQuotation()
  quotation.rows[1] = {
    ...quotation.rows[1]!, audioCategory: 'adapters',
    adapterVariant: { productKey: 'synthetic-ring', size: '6,5', presentation: 'unit' },
  }
  const memory = memoryStorage()
  assert.equal(saveCurrentQuotation(memory.storage, quotation).ok, true)
  assert.deepEqual(parseWorkspace(memory.values.get(CURRENT_QUOTATION_STORAGE_KEY)!), {
    version: 1, activeQuotationId: null, quotations: [], catalog: [],
  })
  assert.equal(hasQuotationContent(loadCurrentQuotation(memory.storage).quotation), false)
})

test('category-only suggestions never persist as current work or alter catalogue and legacy bytes', () => {
  const legacyText = serializeWorkspace(legacyFixture())
  const catalogText = serializeCatalogBackup(catalogFixture())
  const memory = memoryStorage({ [STORAGE_KEY]: legacyText, [CATALOG_STORAGE_KEY]: catalogText })
  const quotation = createQuotation()
  quotation.rows[0].audioCategory = 'subwoofer'
  quotation.rows[1].audioCategory = 'labor'
  assert.equal(saveCurrentQuotation(memory.storage, quotation).ok, true)
  assert.deepEqual(parseWorkspace(memory.values.get(CURRENT_QUOTATION_STORAGE_KEY)!), {
    version: 1, activeQuotationId: null, quotations: [], catalog: [],
  })
  assert.equal(hasQuotationContent(loadCurrentQuotation(memory.storage).quotation), false)
  assert.equal(memory.values.get(CATALOG_STORAGE_KEY), catalogText)
  assert.equal(memory.values.get(STORAGE_KEY), legacyText)
  assert.deepEqual(memory.writes, [CURRENT_QUOTATION_STORAGE_KEY])
})

test('invalid optional category metadata recovers the item without changing stored bytes', () => {
  for (const audioCategory of ['labor', 'unknown-category', null, {}, 1]) {
    const quotation = createQuotation()
    quotation.rows[0].concept = 'Synthetic retained equipment'
    quotation.rows[0].currency = 'USD'
    quotation.rows[0].unitPrice = '0'
    quotation.rows[0].priceState = 'priced'
    const raw = JSON.stringify({ version: 1, activeQuotationId: quotation.id, catalog: [], quotations: [{
      ...quotation, rows: [{ ...quotation.rows[0], audioCategory }, quotation.rows[1]],
    }] })
    const memory = memoryStorage({ [CURRENT_QUOTATION_STORAGE_KEY]: raw })
    assert.deepEqual(loadCurrentQuotation(memory.storage), { quotation, error: null, raw })
    assert.equal(memory.values.get(CURRENT_QUOTATION_STORAGE_KEY), raw)
    assert.deepEqual(memory.writes, [])
  }
})

test('legacy current recovery migrates row currencies and stores mixed work without touching the old workspace', () => {
  const quotation = createQuotation()
  quotation.title = 'Synthetic old USD quotation'
  quotation.currency = 'USD'
  quotation.notes = 'Synthetic retained notes'
  quotation.rows[0].concept = 'Legacy USD item'
  quotation.rows[0].unitPrice = '20'
  quotation.rows[0].priceState = 'priced'
  const rawCurrent = JSON.stringify({ version: 1, activeQuotationId: quotation.id, catalog: [], quotations: [{
    ...quotation, rows: quotation.rows.map(({ currency: _currency, ...row }) => row),
  }] })
  const rawLegacy = JSON.stringify(legacyFixture())
  const memory = memoryStorage({ [CURRENT_QUOTATION_STORAGE_KEY]: rawCurrent, [STORAGE_KEY]: rawLegacy })
  const loaded = loadCurrentQuotation(memory.storage)
  assert.equal(loaded.error, null)
  assert.deepEqual(loaded.quotation.rows.map((row) => row.currency), ['USD', 'USD'])
  assert.equal(memory.values.get(CURRENT_QUOTATION_STORAGE_KEY), rawCurrent)
  assert.deepEqual(memory.writes, [])
  loaded.quotation.rows.push({ ...createRow('extras', 'ARS'), concept: 'New ARS item', unitPrice: '1000', priceState: 'priced' })
  assert.equal(saveCurrentQuotation(memory.storage, loaded.quotation).ok, true)
  assert.deepEqual(loadCurrentQuotation(memory.storage).quotation, loaded.quotation)
  assert.equal(loaded.quotation.notes, quotation.notes)
  assert.equal(memory.values.get(STORAGE_KEY), rawLegacy)
  assert.deepEqual(memory.writes, [CURRENT_QUOTATION_STORAGE_KEY])
})

test('an invalid explicit row currency blocks recovery and never overwrites saved data', () => {
  const quotation = createQuotation()
  quotation.title = 'Synthetic invalid currency'
  const raw = JSON.stringify({ version: 1, activeQuotationId: quotation.id, catalog: [], quotations: [{
    ...quotation, rows: [{ ...quotation.rows[0], currency: 'EUR' }],
  }] })
  const memory = memoryStorage({ [CURRENT_QUOTATION_STORAGE_KEY]: raw })
  assert.notEqual(loadCurrentQuotation(memory.storage).error, null)
  assert.equal(saveCurrentQuotation(memory.storage, quotation).ok, false)
  assert.equal(memory.values.get(CURRENT_QUOTATION_STORAGE_KEY), raw)
  assert.deepEqual(memory.writes, [])
})

test('legacy migration seeds only the catalog without reading old quotations into the current work or changing any bytes', () => {
  const legacy = legacyFixture()
  const raw = `\ufeff${JSON.stringify(legacy)}`
  const memory = memoryStorage({ [STORAGE_KEY]: raw })
  assert.deepEqual(loadCatalog(memory.storage), { catalog: legacy.catalog, stored: false, error: null, raw: null })
  const current = loadCurrentQuotation(memory.storage)
  assert.equal(current.error, null)
  assert.equal(hasQuotationContent(current.quotation), false)
  assert.equal(legacy.quotations.some((quotation) => quotation.id === current.quotation.id), false)
  assert.deepEqual(memory.writes, [])
  assert.equal(saveCatalog(memory.storage, legacy.catalog).ok, true)
  current.quotation.subtitle = 'Synthetic new work'
  assert.equal(saveCurrentQuotation(memory.storage, current.quotation).ok, true)
  assert.equal(memory.values.get(STORAGE_KEY), raw)
  assert.deepEqual(memory.writes, [CATALOG_STORAGE_KEY, CURRENT_QUOTATION_STORAGE_KEY])
})

test('an explicit new catalog including an empty catalog always takes precedence over legacy values', () => {
  for (const catalog of [[], [{ ...catalogFixture()[0]!, unitPrice: '17,25' }]]) {
    const memory = memoryStorage({
      [STORAGE_KEY]: serializeWorkspace(legacyFixture()),
      [CATALOG_STORAGE_KEY]: serializeCatalogBackup(catalog),
    })
    assert.deepEqual(loadCatalog(memory.storage), {
      catalog, stored: true, error: null, raw: memory.values.get(CATALOG_STORAGE_KEY),
    })
    assert.deepEqual(memory.writes, [])
  }
})

test('a valid new catalog does not depend on reading a corrupt or unavailable legacy key', () => {
  const text = serializeCatalogBackup(catalogFixture())
  const storage: StorageAdapter = {
    getItem(key) {
      if (key === STORAGE_KEY) throw new Error('Legacy unavailable')
      return key === CATALOG_STORAGE_KEY ? text : null
    },
    setItem() {},
  }
  assert.equal(loadCatalog(storage).error, null)
  assert.equal(saveCatalog(storage, catalogFixture()).ok, true)
})

test('corrupt new catalog data blocks replacement without falling back to legacy data', () => {
  for (const text of ['not JSON', serializeWorkspace(legacyFixture())]) {
    const memory = memoryStorage({
      [STORAGE_KEY]: serializeWorkspace(legacyFixture()), [CATALOG_STORAGE_KEY]: text,
    })
    const loaded = loadCatalog(memory.storage)
    assert.notEqual(loaded.error, null)
    assert.deepEqual(loaded.catalog, [])
    assert.equal(loaded.stored, false)
    assert.equal(loaded.raw, text)
    assert.equal(saveCatalog(memory.storage, catalogFixture()).ok, false)
    assert.equal(memory.values.get(CATALOG_STORAGE_KEY), text)
    assert.deepEqual(memory.writes, [])
  }
})

test('unreadable legacy data is reported and remains intact when new storage is explicitly initialized', () => {
  const memory = memoryStorage({ [STORAGE_KEY]: '{broken legacy' })
  assert.notEqual(loadCatalog(memory.storage).error, null)
  assert.deepEqual(memory.writes, [])
  assert.equal(saveCatalog(memory.storage, []).ok, true)
  assert.equal(memory.values.get(STORAGE_KEY), '{broken legacy')
  assert.deepEqual(loadCatalog(memory.storage), {
    catalog: [], stored: true, error: null, raw: memory.values.get(CATALOG_STORAGE_KEY),
  })
})

test('catalog-only backups preserve approved zero, missing sale price and historical provenance exactly', () => {
  const catalog = catalogFixture()
  const snapshot = structuredClone(catalog)
  const text = serializeCatalogBackup(catalog)
  assert.deepEqual(parseCatalogBackup(text), snapshot)
  assert.equal(Object.hasOwn(parseCatalogBackup(text)[0]!, 'stock'), false)
  assert.deepEqual(parseWorkspace(text), { version: 1, activeQuotationId: null, quotations: [], catalog: snapshot })
  assert.deepEqual(catalog, snapshot)
  const memory = memoryStorage()
  assert.equal(saveCatalog(memory.storage, catalog).ok, true)
  assert.deepEqual(loadCatalog(memory.storage), { catalog: snapshot, error: null, stored: true, raw: text })
})

test('stock snapshots roundtrip catalogue backups and both storage keys without inventing or refreshing values', () => {
  for (const quantity of [null, 0, 3]) {
    const catalog = catalogFixture()
    catalog[0]!.stock = { ...stockFixture(), quantity }
    const snapshot = structuredClone(catalog)
    const legacy = { ...legacyFixture(), catalog }
    const raw = `\ufeff${JSON.stringify(legacy)}`
    const memory = memoryStorage({ [STORAGE_KEY]: raw })
    assert.deepEqual(loadCatalog(memory.storage), { catalog: snapshot, error: null, stored: false, raw: null })
    assert.deepEqual(parseCatalogBackup(serializeCatalogBackup(catalog)), snapshot)
    assert.equal(saveCatalog(memory.storage, catalog).ok, true)
    assert.deepEqual(loadCatalog(memory.storage), {
      catalog: snapshot, error: null, stored: true, raw: memory.values.get(CATALOG_STORAGE_KEY),
    })
    assert.equal(memory.values.get(STORAGE_KEY), raw)
    assert.deepEqual(memory.writes, [CATALOG_STORAGE_KEY])
    assert.deepEqual(catalog, snapshot)
  }
})

test('catalogue-only recovery preserves stock without replacing the current quotation or legacy bytes', () => {
  const legacy = legacyFixture()
  legacy.catalog[0]!.stock = stockFixture()
  const raw = `\ufeff${JSON.stringify(legacy)}`
  const current = createQuotation()
  current.notes = 'Synthetic independent current work'
  const currentText = serializeWorkspace({ version: 1, activeQuotationId: current.id, quotations: [current], catalog: [] })
  const memory = memoryStorage({ [STORAGE_KEY]: raw, [CURRENT_QUOTATION_STORAGE_KEY]: currentText })
  const restoredCatalog = parseCatalogBackup(raw)
  assert.equal(saveCatalog(memory.storage, restoredCatalog).ok, true)
  assert.deepEqual(loadCatalog(memory.storage).catalog, legacy.catalog)
  assert.deepEqual(loadCurrentQuotation(memory.storage).quotation, current)
  assert.equal(memory.values.get(CURRENT_QUOTATION_STORAGE_KEY), currentText)
  assert.equal(memory.values.get(STORAGE_KEY), raw)
  assert.deepEqual(memory.writes, [CATALOG_STORAGE_KEY])
})

test('malformed stock never replaces valid catalogue, current recovery or legacy bytes', () => {
  const legacyText = serializeWorkspace(legacyFixture())
  const catalogText = serializeCatalogBackup(catalogFixture())
  const current = createQuotation()
  current.notes = 'Synthetic recoverable work'
  const currentText = serializeWorkspace({ version: 1, activeQuotationId: current.id, quotations: [current], catalog: [] })
  const memory = memoryStorage({
    [STORAGE_KEY]: legacyText, [CATALOG_STORAGE_KEY]: catalogText, [CURRENT_QUOTATION_STORAGE_KEY]: currentText,
  })
  const before = new Map(memory.values)
  const stock = stockFixture()
  for (const invalidStock of [
    null, {}, { ...stock, quantity: -Number.MAX_SAFE_INTEGER - 1 }, { ...stock, quantity: 1.5 }, { ...stock, quantity: '0' },
    { ...stock, checkedAt: undefined }, { ...stock, validUntil: stock.checkedAt },
    { ...stock, source: undefined }, { ...stock, source: { document: '', date: null } },
  ]) {
    const invalid = [{ ...catalogFixture()[0]!, stock: invalidStock }] as CatalogItem[]
    assert.throws(() => parseCatalogBackup(JSON.stringify({ version: 1, activeQuotationId: null, quotations: [], catalog: invalid })))
    assert.equal(saveCatalog(memory.storage, invalid).ok, false)
    assert.deepEqual(memory.values, before)
    assert.deepEqual(memory.writes, [])
  }
})

test('legacy full-workspace backups restore only their catalog with approved prices intact', () => {
  const workspace = legacyFixture()
  assert.deepEqual(parseCatalogBackup(serializeWorkspace(workspace)), workspace.catalog)
  assert.throws(() => parseCatalogBackup('{invalid'))
  assert.throws(() => parseCatalogBackup(JSON.stringify({ ...workspace, version: 2 })))
})

test('current work overwrites one recovery quotation and retains incomplete raw values, zero and included rows', () => {
  const memory = memoryStorage()
  let quotation = createQuotation()
  for (let index = 0; index < 3; index += 1) {
    if (index === 2) quotation = createQuotation()
    quotation.subtitle = `Synthetic work ${index}`
    quotation.rows[0] = {
      ...quotation.rows[0]!, concept: 'Synthetic unfinished row', quantity: 'quantity pending',
      unitPrice: '', priceState: 'pending',
    }
    quotation.rows[1] = { ...quotation.rows[1]!, concept: 'Synthetic explicit zero', unitPrice: '0', priceState: 'priced' }
    quotation.rows.push({ ...quotation.rows[0]!, id: `included-${index}`, concept: 'Synthetic included', quantity: '1', priceState: 'included' })
    assert.equal(saveCurrentQuotation(memory.storage, quotation).ok, true)
    const parsed = parseWorkspace(memory.values.get(CURRENT_QUOTATION_STORAGE_KEY)!)
    assert.equal(parsed.quotations.length, 1)
    assert.equal(parsed.activeQuotationId, quotation.id)
    assert.deepEqual(parsed.catalog, [])
    assert.deepEqual(loadCurrentQuotation(memory.storage), {
      quotation, error: null, raw: memory.values.get(CURRENT_QUOTATION_STORAGE_KEY),
    })
  }
  assert.deepEqual([...memory.values.keys()], [CURRENT_QUOTATION_STORAGE_KEY])
})

test('a new blank explicitly replaces recovery with an empty envelope without altering catalog or legacy', () => {
  const legacy = serializeWorkspace(legacyFixture())
  const catalog = serializeCatalogBackup(catalogFixture())
  const memory = memoryStorage({ [STORAGE_KEY]: legacy, [CATALOG_STORAGE_KEY]: catalog })
  const previous = createQuotation()
  previous.notes = 'Synthetic current work'
  assert.equal(saveCurrentQuotation(memory.storage, previous).ok, true)
  const blank = createQuotation()
  assert.equal(saveCurrentQuotation(memory.storage, blank).ok, true)
  assert.deepEqual(parseWorkspace(memory.values.get(CURRENT_QUOTATION_STORAGE_KEY)!), {
    version: 1, activeQuotationId: null, quotations: [], catalog: [],
  })
  const loaded = loadCurrentQuotation(memory.storage)
  assert.equal(loaded.error, null)
  assert.equal(hasQuotationContent(loaded.quotation), false)
  assert.notEqual(loaded.quotation.id, previous.id)
  assert.equal(memory.values.get(STORAGE_KEY), legacy)
  assert.equal(memory.values.get(CATALOG_STORAGE_KEY), catalog)
})

test('automatic exchange lookup metadata alone does not store a blank quotation', () => {
  const quotation = createQuotation()
  quotation.exchangeRate = '1.234,56'
  quotation.exchangeRateQuote = {
    rate: '1.234,56', source: 'DolarAPI', market: 'blue', side: 'sell',
    updatedAt: '2026-10-16T10:00:00.000Z', fetchedAt: '2026-10-16T10:01:00.000Z',
  }
  const memory = memoryStorage()
  assert.equal(saveCurrentQuotation(memory.storage, quotation).ok, true)
  assert.equal(parseWorkspace(memory.values.get(CURRENT_QUOTATION_STORAGE_KEY)!).quotations.length, 0)
  quotation.subtitle = 'Synthetic current quotation'
  assert.equal(saveCurrentQuotation(memory.storage, quotation).ok, true)
  assert.deepEqual(loadCurrentQuotation(memory.storage).quotation.exchangeRateQuote, quotation.exchangeRateQuote)
})

test('current work rejects history, embedded catalog, mismatched active ID and corrupt payloads without overwriting', () => {
  const history = legacyFixture()
  const quotation = history.quotations[0]!
  const invalid = [
    '{broken current',
    serializeWorkspace({ ...history, catalog: [] }),
    serializeWorkspace({ ...history, activeQuotationId: quotation.id, quotations: [quotation] }),
    JSON.stringify({ version: 1, activeQuotationId: 'other', quotations: [quotation], catalog: [] }),
  ]
  for (const text of invalid) {
    const memory = memoryStorage({ [CURRENT_QUOTATION_STORAGE_KEY]: text })
    const loaded = loadCurrentQuotation(memory.storage)
    assert.notEqual(loaded.error, null)
    assert.equal(loaded.raw, text)
    assert.equal(hasQuotationContent(loaded.quotation), false)
    assert.equal(saveCurrentQuotation(memory.storage, createQuotation()).ok, false)
    assert.equal(memory.values.get(CURRENT_QUOTATION_STORAGE_KEY), text)
    assert.deepEqual(memory.writes, [])
  }
})

test('invalid input never replaces valid catalog or current recovery, including an invalid blank quotation', () => {
  const memory = memoryStorage()
  const quotation = createQuotation()
  quotation.subtitle = 'Synthetic recoverable work'
  assert.equal(saveCurrentQuotation(memory.storage, quotation).ok, true)
  assert.equal(saveCatalog(memory.storage, catalogFixture()).ok, true)
  const before = new Map(memory.values)
  assert.equal(saveCatalog(memory.storage, [{ ...catalogFixture()[0]!, unitPrice: '1'.repeat(65) }]).ok, false)
  const blank = createQuotation()
  blank.id = 'invalid id'
  assert.equal(hasQuotationContent(blank), false)
  assert.equal(saveCurrentQuotation(memory.storage, blank).ok, false)
  assert.deepEqual(memory.values, before)
})

test('an explicitly authorized reset or catalog recovery can replace invalid new-key data without touching legacy', () => {
  const legacy = serializeWorkspace(legacyFixture())
  const memory = memoryStorage({
    [STORAGE_KEY]: legacy, [CURRENT_QUOTATION_STORAGE_KEY]: '{broken', [CATALOG_STORAGE_KEY]: '{broken',
  })
  assert.equal(saveCurrentQuotation(memory.storage, createQuotation(), { overwriteInvalid: true }).ok, true)
  assert.equal(saveCatalog(memory.storage, catalogFixture(), { overwriteInvalid: true }).ok, true)
  assert.equal(loadCurrentQuotation(memory.storage).error, null)
  assert.deepEqual(loadCatalog(memory.storage).catalog, catalogFixture())
  assert.equal(memory.values.get(STORAGE_KEY), legacy)
})

test('catalog failure leaves current recovery available and current recovery failure leaves catalog available', () => {
  const quotation = createQuotation()
  quotation.notes = 'Synthetic work'
  const memory = memoryStorage({ [CATALOG_STORAGE_KEY]: '{invalid catalog' })
  assert.notEqual(loadCatalog(memory.storage).error, null)
  assert.equal(saveCurrentQuotation(memory.storage, quotation).ok, true)
  assert.deepEqual(loadCurrentQuotation(memory.storage), {
    quotation, error: null, raw: memory.values.get(CURRENT_QUOTATION_STORAGE_KEY),
  })
  const inverse = memoryStorage({ [CURRENT_QUOTATION_STORAGE_KEY]: '{invalid current' })
  assert.notEqual(loadCurrentQuotation(inverse.storage).error, null)
  assert.equal(saveCatalog(inverse.storage, catalogFixture()).ok, true)
  assert.deepEqual(loadCatalog(inverse.storage).catalog, catalogFixture())
})

test('read and write adapter failures return errors without crossing storage boundaries', () => {
  const inaccessible: StorageAdapter = {
    getItem() { throw new Error('Blocked') }, setItem() { assert.fail('Must not write after a failed read') },
  }
  assert.notEqual(loadCatalog(inaccessible).error, null)
  assert.notEqual(loadCurrentQuotation(inaccessible).error, null)
  assert.equal(saveCatalog(inaccessible, []).ok, false)
  assert.equal(saveCurrentQuotation(inaccessible, createQuotation()).ok, false)
  const full: StorageAdapter = { getItem() { return null }, setItem() { throw new Error('Quota exceeded') } }
  assert.equal(saveCatalog(full, catalogFixture()).ok, false)
  assert.equal(saveCurrentQuotation(full, createQuotation()).ok, false)
})

test('loads expose the exact new-key bytes including formatting and retain corrupt raw values', () => {
  for (const scenario of workingStorageCases()) {
    const memory = memoryStorage({ [scenario.key]: scenario.original })
    assert.equal(scenario.load(memory.storage).error, null, scenario.name)
    assert.equal(scenario.load(memory.storage).raw, scenario.original, scenario.name)
    assert.notEqual(scenario.original, scenario.normalizedOriginal)
    for (const raw of ['', '{broken-A', '\ufeffnot JSON\n']) {
      memory.values.set(scenario.key, raw)
      const loaded = scenario.load(memory.storage)
      assert.notEqual(loaded.error, null, scenario.name)
      assert.equal(loaded.raw, raw, scenario.name)
    }
    assert.deepEqual(memory.writes, [])
  }
})

test('an absent new key exposes a null baseline and catalogue fallback never uses legacy bytes as its baseline', () => {
  const legacy = serializeWorkspace(legacyFixture())
  for (const scenario of workingStorageCases()) {
    const memory = memoryStorage({ [STORAGE_KEY]: legacy })
    assert.equal(scenario.load(memory.storage).raw, null, scenario.name)
    assert.equal(scenario.load(memory.storage).error, null, scenario.name)
    const result = scenario.save(memory.storage, { expectedRaw: null })
    assert.deepEqual(result, { ok: true, error: null, raw: scenario.replacement, conflict: false })
    assert.equal(memory.values.get(STORAGE_KEY), legacy)
    assert.deepEqual(memory.writes, [scenario.key])
  }
  const corruptLegacy = memoryStorage({ [STORAGE_KEY]: '{broken legacy' })
  assert.notEqual(loadCatalog(corruptLegacy.storage).error, null)
  assert.equal(loadCatalog(corruptLegacy.storage).raw, null)
})

test('valid concurrent replacements conflict without overwriting any store even before a storage event is handled', () => {
  for (const scenario of workingStorageCases()) {
    const legacy = serializeWorkspace(legacyFixture())
    const memory = memoryStorage({ [scenario.key]: scenario.original, [STORAGE_KEY]: legacy })
    const baseline = scenario.load(memory.storage).raw
    memory.values.set(scenario.key, scenario.replacement)
    const before = new Map(memory.values)
    const result = scenario.save(memory.storage, { expectedRaw: baseline })
    assert.equal(result.ok, false, scenario.name)
    assert.equal(result.conflict, true, scenario.name)
    assert.equal(result.raw, scenario.replacement, scenario.name)
    assert.ok(result.error)
    assert.deepEqual(memory.values, before)
    assert.deepEqual(memory.writes, [])
  }
})

test('raw equality uses exact stored text rather than an equivalent normalized serialization', () => {
  for (const scenario of workingStorageCases()) {
    const memory = memoryStorage({ [scenario.key]: scenario.original })
    const result = scenario.save(memory.storage, { expectedRaw: scenario.normalizedOriginal })
    assert.equal(result.conflict, true, scenario.name)
    assert.equal(result.raw, scenario.original, scenario.name)
    assert.equal(memory.values.get(scenario.key), scenario.original)
    assert.deepEqual(memory.writes, [])
  }
})

test('concurrent corrupt values conflict before validation and overwriteInvalid cannot bypass the baseline', () => {
  for (const scenario of workingStorageCases()) {
    for (const original of [scenario.original, '{broken-A']) {
      for (const overwriteInvalid of [false, true]) {
        const memory = memoryStorage({ [scenario.key]: original })
        const baseline = scenario.load(memory.storage).raw
        memory.values.set(scenario.key, '{broken-B')
        const result = scenario.save(memory.storage, { expectedRaw: baseline, overwriteInvalid })
        assert.equal(result.ok, false, scenario.name)
        assert.equal(result.conflict, true, scenario.name)
        assert.equal(result.raw, '{broken-B', scenario.name)
        assert.equal(memory.values.get(scenario.key), '{broken-B')
        assert.deepEqual(memory.writes, [])
      }
    }
  }
})

test('a corrupt unchanged baseline requires explicit overwrite authorization and then returns the bytes written', () => {
  for (const scenario of workingStorageCases()) {
    const memory = memoryStorage({ [scenario.key]: '{broken-A' })
    const baseline = scenario.load(memory.storage).raw
    const rejected = scenario.save(memory.storage, { expectedRaw: baseline })
    assert.equal(rejected.ok, false, scenario.name)
    assert.equal(rejected.conflict, false, scenario.name)
    assert.equal(rejected.raw, '{broken-A', scenario.name)
    assert.deepEqual(memory.writes, [])
    const saved = scenario.save(memory.storage, { expectedRaw: baseline, overwriteInvalid: true })
    assert.deepEqual(saved, { ok: true, error: null, raw: scenario.replacement, conflict: false })
    assert.equal(memory.values.get(scenario.key), scenario.replacement)
    assert.deepEqual(memory.writes, [scenario.key])
  }
})

test('an explicit null baseline rejects newly created valid, corrupt and empty-string values', () => {
  for (const scenario of workingStorageCases()) {
    for (const actual of [scenario.original, '{broken', '']) {
      const memory = memoryStorage()
      assert.equal(scenario.load(memory.storage).raw, null, scenario.name)
      memory.values.set(scenario.key, actual)
      const result = scenario.save(memory.storage, { expectedRaw: null, overwriteInvalid: true })
      assert.equal(result.ok, false, scenario.name)
      assert.equal(result.conflict, true, scenario.name)
      assert.equal(result.raw, actual, scenario.name)
      assert.equal(memory.values.get(scenario.key), actual)
      assert.deepEqual(memory.writes, [])
    }
  }
})

test('concurrent deletion conflicts with a nonnull baseline and cannot resurrect removed data', () => {
  for (const scenario of workingStorageCases()) {
    const memory = memoryStorage({ [scenario.key]: scenario.original })
    const baseline = scenario.load(memory.storage).raw
    memory.values.delete(scenario.key)
    const result = scenario.save(memory.storage, { expectedRaw: baseline, overwriteInvalid: true })
    assert.equal(result.ok, false, scenario.name)
    assert.equal(result.conflict, true, scenario.name)
    assert.equal(result.raw, null, scenario.name)
    assert.equal(memory.values.has(scenario.key), false)
    assert.deepEqual(memory.writes, [])
  }
})

test('successful saves return a usable next baseline and stale prior baselines cannot be reused', () => {
  for (const scenario of workingStorageCases()) {
    const memory = memoryStorage({ [scenario.key]: scenario.original })
    const baseline = scenario.load(memory.storage).raw
    const first = scenario.save(memory.storage, { expectedRaw: baseline })
    assert.deepEqual(first, { ok: true, error: null, raw: scenario.replacement, conflict: false })
    assert.equal(scenario.load(memory.storage).raw, first.raw, scenario.name)
    const stale = scenario.save(memory.storage, { expectedRaw: baseline })
    assert.equal(stale.ok, false, scenario.name)
    assert.equal(stale.conflict, true, scenario.name)
    assert.equal(stale.raw, first.raw, scenario.name)
    assert.deepEqual(memory.writes, [scenario.key])
    assert.deepEqual(scenario.save(memory.storage, { expectedRaw: first.raw }), first)
    assert.deepEqual(memory.writes, [scenario.key, scenario.key])
  }
})

test('blank recovery writes return the stored empty envelope as a nonnull next baseline', () => {
  const quotation = createQuotation()
  quotation.notes = 'Synthetic recoverable original'
  const original = serializeWorkspace({ version: 1, activeQuotationId: quotation.id, quotations: [quotation], catalog: [] })
  const memory = memoryStorage({ [CURRENT_QUOTATION_STORAGE_KEY]: original })
  const result = saveCurrentQuotation(memory.storage, createQuotation(), { expectedRaw: original })
  assert.equal(result.ok, true)
  assert.equal(result.conflict, false)
  assert.equal(result.raw, serializeCatalogBackup([]))
  assert.equal(loadCurrentQuotation(memory.storage).raw, result.raw)
  assert.equal(saveCurrentQuotation(memory.storage, quotation, { expectedRaw: null }).conflict, true)
  assert.equal(saveCurrentQuotation(memory.storage, quotation, { expectedRaw: result.raw }).ok, true)
  assert.deepEqual(memory.writes, [CURRENT_QUOTATION_STORAGE_KEY, CURRENT_QUOTATION_STORAGE_KEY])
})

test('omitting expectedRaw or passing undefined preserves the legacy no-comparison save contract', () => {
  for (const scenario of workingStorageCases()) {
    for (const options of [undefined, {}, { expectedRaw: undefined }]) {
      const memory = memoryStorage({ [scenario.key]: scenario.original })
      const result = scenario.save(memory.storage, options)
      assert.deepEqual(result, { ok: true, error: null, raw: scenario.replacement, conflict: false })
      assert.deepEqual(memory.writes, [scenario.key])
    }
  }
})

test('the comparison is repeated after validation to reject changes between the first read and write', () => {
  for (const scenario of workingStorageCases()) {
    for (const changed of [scenario.replacement, '{concurrent corrupt', '', null]) {
      let reads = 0
      const storage: StorageAdapter = {
        getItem(key) {
          assert.equal(key, scenario.key)
          reads += 1
          return reads === 1 ? scenario.original : changed
        },
        setItem() { assert.fail('A concurrent change must not be overwritten') },
      }
      const result = scenario.save(storage, { expectedRaw: scenario.original, overwriteInvalid: true })
      assert.equal(result.ok, false, scenario.name)
      assert.equal(result.conflict, true, scenario.name)
      assert.equal(result.raw, changed, scenario.name)
      assert.equal(reads, 2, scenario.name)
    }
  }
})

test('failed reads never write even with overwrite authorization and do not masquerade as conflicts', () => {
  for (const scenario of workingStorageCases()) {
    const unavailable: StorageAdapter = {
      getItem() { throw new Error('Synthetic read failure') },
      setItem() { assert.fail('A failed read must never allow a write') },
    }
    assert.equal(scenario.load(unavailable).raw, null, scenario.name)
    assert.notEqual(scenario.load(unavailable).error, null, scenario.name)
    for (const expectedRaw of [undefined, null, scenario.original]) {
      const result = scenario.save(unavailable, { expectedRaw, overwriteInvalid: true })
      assert.equal(result.ok, false, scenario.name)
      assert.equal(result.conflict, false, scenario.name)
      assert.equal(result.raw, null, scenario.name)
      assert.ok(result.error)
    }
    let reads = 0
    const lostDuringValidation: StorageAdapter = {
      getItem() {
        if (++reads === 1) return scenario.original
        throw new Error('Synthetic second read failure')
      },
      setItem() { assert.fail('A failed second read must never allow a write') },
    }
    const result = scenario.save(lostDuringValidation, { expectedRaw: scenario.original, overwriteInvalid: true })
    assert.equal(result.ok, false, scenario.name)
    assert.equal(result.conflict, false, scenario.name)
    assert.equal(result.raw, null, scenario.name)
    assert.equal(reads, 2)
  }
})

test('write failures report the observed prior bytes without advancing the caller baseline', () => {
  for (const scenario of workingStorageCases()) {
    for (const actual of [scenario.original, null]) {
      const storage: StorageAdapter = {
        getItem(key) { assert.equal(key, scenario.key); return actual },
        setItem() { throw new Error('Synthetic quota failure') },
      }
      const result = scenario.save(storage, { expectedRaw: actual })
      assert.equal(result.ok, false, scenario.name)
      assert.equal(result.conflict, false, scenario.name)
      assert.equal(result.raw, actual, scenario.name)
      assert.ok(result.error)
    }
  }
})
