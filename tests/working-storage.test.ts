import assert from 'node:assert/strict'
import test from 'node:test'
import { createQuotation, hasQuotationContent } from '../src/features/quotation/model.ts'
import type { CatalogItem, Workspace } from '../src/features/quotation/model.ts'
import { parseWorkspace, serializeWorkspace, STORAGE_KEY } from '../src/features/quotation/persistence.ts'
import type { StorageAdapter } from '../src/features/quotation/persistence.ts'
import {
  CATALOG_STORAGE_KEY, CURRENT_QUOTATION_STORAGE_KEY, loadCatalog, loadCurrentQuotation,
  parseCatalogBackup, saveCatalog, saveCurrentQuotation, serializeCatalogBackup,
} from '../src/features/quotation/working-storage.ts'

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

test('legacy migration seeds only the catalog without reading old quotations into the current work or changing any bytes', () => {
  const legacy = legacyFixture()
  const raw = `\ufeff${JSON.stringify(legacy)}`
  const memory = memoryStorage({ [STORAGE_KEY]: raw })
  assert.deepEqual(loadCatalog(memory.storage), { catalog: legacy.catalog, stored: false, error: null })
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
    assert.deepEqual(loadCatalog(memory.storage), { catalog, stored: true, error: null })
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
  assert.deepEqual(loadCatalog(memory.storage), { catalog: [], stored: true, error: null })
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
  assert.deepEqual(loadCatalog(memory.storage), { catalog: snapshot, error: null, stored: true })
})

test('stock snapshots roundtrip catalogue backups and both storage keys without inventing or refreshing values', () => {
  for (const quantity of [null, 0, 3]) {
    const catalog = catalogFixture()
    catalog[0]!.stock = { ...stockFixture(), quantity }
    const snapshot = structuredClone(catalog)
    const legacy = { ...legacyFixture(), catalog }
    const raw = `\ufeff${JSON.stringify(legacy)}`
    const memory = memoryStorage({ [STORAGE_KEY]: raw })
    assert.deepEqual(loadCatalog(memory.storage), { catalog: snapshot, error: null, stored: false })
    assert.deepEqual(parseCatalogBackup(serializeCatalogBackup(catalog)), snapshot)
    assert.equal(saveCatalog(memory.storage, catalog).ok, true)
    assert.deepEqual(loadCatalog(memory.storage), { catalog: snapshot, error: null, stored: true })
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
    null, {}, { ...stock, quantity: -1 }, { ...stock, quantity: 1.5 }, { ...stock, quantity: '0' },
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
    assert.deepEqual(loadCurrentQuotation(memory.storage), { quotation, error: null })
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
  assert.deepEqual(loadCurrentQuotation(memory.storage), { quotation, error: null })
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
