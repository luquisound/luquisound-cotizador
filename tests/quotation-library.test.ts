import assert from 'node:assert/strict'
import test from 'node:test'
import { createQuotation, type Quotation, type Workspace } from '../src/features/quotation/model.ts'
import { serializeWorkspace, STORAGE_KEY, type StorageAdapter } from '../src/features/quotation/persistence.ts'
import {
  createQuotationLibrary, hasArchivableQuotationContent, LIBRARY_STORAGE_KEY, loadQuotationLibrary, openLibraryQuotation,
  parseQuotationLibrary, parseQuotationLibraryBackup, previewQuotationLibraryBackup,
  QUOTATION_LIBRARY_MAX_BYTES, saveQuotationLibrary, saveQuotationToLibrary, serializeQuotationLibrary,
} from '../src/features/quotation/quotation-library.ts'
import { CATALOG_STORAGE_KEY, CURRENT_QUOTATION_STORAGE_KEY } from '../src/features/quotation/working-storage.ts'

function quotation(): Quotation {
  const result = createQuotation()
  result.title = 'Trabajo sintético'
  result.subtitle = 'Vehículo de prueba'
  result.notes = 'Observación sintética'
  result.exchangeRate = '1.250'
  result.exchangeRateQuote = {
    rate: '1.250', source: 'DolarAPI', market: 'blue', side: 'sell',
    fetchedAt: '2026-10-17T10:00:00.000Z', updatedAt: '2026-10-17T09:59:00.000Z',
  }
  result.rows = [{
    id: crypto.randomUUID(), section: 'equipment', audioCategory: 'subwoofer', currency: 'USD',
    concept: 'Equipo sintético', detail: 'Detalle de prueba', quantity: '1,5', unitPrice: '23,40', priceState: 'priced',
  }]
  return result
}

function storage(initial: Record<string, string> = {}): StorageAdapter & { values: Map<string, string>; reads: string[]; writes: string[] } {
  const values = new Map(Object.entries(initial))
  const reads: string[] = []
  const writes: string[] = []
  return {
    values, reads, writes,
    getItem(key) { reads.push(key); return values.get(key) ?? null },
    setItem(key, value) { writes.push(key); values.set(key, value) },
  }
}

test('an empty library loads without reading or rewriting legacy, current or catalogue stores', () => {
  const adapter = storage({ [STORAGE_KEY]: 'legacy bytes', [CATALOG_STORAGE_KEY]: 'catalogue bytes', [CURRENT_QUOTATION_STORAGE_KEY]: 'current bytes' })
  const loaded = loadQuotationLibrary(adapter)
  assert.deepEqual(loaded.library, createQuotationLibrary())
  assert.equal(loaded.raw, null)
  assert.equal(loaded.error, null)
  assert.equal(loaded.stored, false)
  assert.deepEqual(adapter.reads, [LIBRARY_STORAGE_KEY])
  assert.deepEqual(adapter.writes, [])
})

test('saving creates an independent frozen snapshot and a lossless library-only backup', () => {
  const original = quotation()
  const before = structuredClone(original)
  const library = saveQuotationToLibrary(createQuotationLibrary(), original, '  Vehículo A  ')
  const entry = library.entries[0]!
  assert.equal(entry.name, 'Vehículo A')
  assert.equal(entry.quotation.exchangeRateMode, 'frozen')
  assert.notEqual(entry.quotation.id, original.id)
  assert.notEqual(entry.quotation.rows[0]!.id, original.rows[0]!.id)
  assert.notEqual(entry.id, entry.quotation.id)
  assert.deepEqual(original, before)
  assert.deepEqual(entry.quotation.exchangeRateQuote, original.exchangeRateQuote)
  assert.equal(entry.quotation.rows[0]!.audioCategory, original.rows[0]!.audioCategory)
  assert.deepEqual(parseQuotationLibrary(serializeQuotationLibrary(library)), library)
  assert.deepEqual(parseQuotationLibraryBackup(serializeQuotationLibrary(library)), library)
  assert.deepEqual(Object.keys(JSON.parse(serializeQuotationLibrary(library))), ['schema', 'version', 'entries'])
  original.rows[0]!.concept = 'Changed outside snapshot'
  original.exchangeRateQuote!.rate = '999'
  assert.equal(entry.quotation.rows[0]!.concept, before.rows[0]!.concept)
  assert.equal(entry.quotation.exchangeRateQuote!.rate, before.exchangeRateQuote!.rate)
})

test('opening and duplicating keep amounts and rate provenance frozen with independent identities', () => {
  const library = saveQuotationToLibrary(createQuotationLibrary(), quotation(), 'Original')
  const entry = library.entries[0]!
  const before = structuredClone(entry)
  const opened = openLibraryQuotation(entry)
  const duplicate = openLibraryQuotation(entry, { duplicate: true })
  assert.equal(opened.exchangeRateMode, 'frozen')
  assert.equal(duplicate.exchangeRateMode, 'frozen')
  assert.equal(opened.title, entry.quotation.title)
  assert.equal(duplicate.title, `${entry.quotation.title} (copia)`)
  assert.notEqual(opened.id, duplicate.id)
  assert.notEqual(opened.id, entry.quotation.id)
  assert.notEqual(opened.rows[0]!.id, duplicate.rows[0]!.id)
  assert.equal(opened.rows[0]!.currency, 'USD')
  assert.equal(opened.rows[0]!.unitPrice, '23,40')
  assert.equal(opened.rows[0]!.quantity, '1,5')
  assert.equal(opened.exchangeRate, '1.250')
  opened.exchangeRateQuote!.rate = '999'
  opened.rows[0]!.detail = 'Edited after opening'
  assert.deepEqual(entry, before)
})

test('catalogue provenance and historical stock remain private deep snapshots through backup and opening', () => {
  const original = quotation()
  original.rows[0]!.provenance = {
    catalogItemId: 'synthetic-catalogue', supplier: 'Proveedor sintético', sku: 'SYN-1',
    source: { document: 'Private synthetic list', date: '2026-01-01', kind: 'snapshot', version: 'synthetic-v1', checksum: 'a'.repeat(64), sheet: 'Products', row: 2 },
    originalUnitPrice: '23,40', originalCurrency: 'USD', priceBasis: 'provisional-list',
    listPrice: {
      amount: '23.40', currency: 'USD', basis: 'retail-list-before-discount', provisional: true,
      source: { document: 'Private synthetic list', date: '2026-01-01', sheet: 'Products', row: 2 },
    },
    stock: {
      quantity: 3, checkedAt: null, validUntil: null, observation: 'historical',
      source: { document: 'Private synthetic stock', date: null, sheet: 'Products', row: 2 },
    },
    availabilityPolicy: 'historical-positive',
  }
  const expected = structuredClone(original.rows[0]!.provenance)
  const library = saveQuotationToLibrary(createQuotationLibrary(), original, 'With private provenance')
  const restored = parseQuotationLibraryBackup(serializeQuotationLibrary(library))
  assert.deepEqual(restored.entries[0]!.quotation.rows[0]!.provenance, expected)
  original.rows[0]!.provenance.source!.document = 'Changed source'
  original.rows[0]!.provenance.stock!.source.document = 'Changed stock source'
  const opened = openLibraryQuotation(restored.entries[0]!)
  opened.rows[0]!.provenance!.listPrice!.amount = '999'
  assert.deepEqual(restored.entries[0]!.quotation.rows[0]!.provenance, expected)
  assert.deepEqual(library.entries[0]!.quotation.rows[0]!.provenance, expected)
})

test('blank proposals are not archived but incomplete meaningful concepts can be saved', () => {
  const blank = createQuotation()
  assert.throws(() => saveQuotationToLibrary(createQuotationLibrary(), blank, 'Name alone'), /vacío/)
  blank.rows[0]!.concept = 'Precio todavía pendiente'
  const next = saveQuotationToLibrary(createQuotationLibrary(), blank, 'Borrador')
  assert.equal(next.entries.length, 1)
  assert.equal(next.entries[0]!.quotation.rows[0]!.priceState, 'pending')
})

test('an edited title, subtitle, notes or exchange rate without row content is not archivable', () => {
  const blank = createQuotation()
  blank.title = 'Only an edited title'
  blank.subtitle = 'Only an edited subtitle'
  blank.notes = 'Only notes'
  blank.exchangeRate = '1.250'
  assert.equal(hasArchivableQuotationContent(blank), false)
  assert.throws(() => saveQuotationToLibrary(createQuotationLibrary(), blank, 'Not a quotation'), /vacío/)
})

test('quantity and category alone do not create an archive but partial row content does', () => {
  const blank = createQuotation()
  blank.rows[0]!.quantity = '2'
  blank.rows[0]!.audioCategory = 'subwoofer'
  assert.equal(hasArchivableQuotationContent(blank), false)
  assert.throws(() => saveQuotationToLibrary(createQuotationLibrary(), blank, 'Quantity alone'), /vacío/)
  for (const content of [{ detail: 'Partial detail' }, { unitPrice: '0' }, { priceState: 'included' as const }]) {
    const partial = createQuotation()
    Object.assign(partial.rows[0]!, content)
    assert.equal(hasArchivableQuotationContent(partial), true)
    assert.equal(saveQuotationToLibrary(createQuotationLibrary(), partial, 'Partial row').entries.length, 1)
  }
})

test('a repeated trimmed or case-equivalent name requires an explicit replacement identity', () => {
  const original = saveQuotationToLibrary(createQuotationLibrary(), quotation(), 'Vehículo A')
  const before = structuredClone(original)
  assert.throws(() => saveQuotationToLibrary(original, quotation(), '  VEHÍCULO A  '), /Confirmá/)
  assert.deepEqual(original, before)
  const entry = original.entries[0]!
  const replacing = quotation()
  replacing.rows[0]!.unitPrice = '99'
  const updated = saveQuotationToLibrary(original, replacing, ' Vehículo A ', { replaceEntryId: entry.id })
  assert.equal(updated.entries.length, 1)
  assert.equal(updated.entries[0]!.id, entry.id)
  assert.equal(updated.entries[0]!.quotation.rows[0]!.unitPrice, '99')
  assert.notEqual(updated.entries[0]!.quotation.id, entry.quotation.id)
  assert.deepEqual(original, before)
  assert.throws(() => saveQuotationToLibrary(original, replacing, 'Another', { replaceEntryId: 'missing' }), /ya no/)
})

test('the 100-entry limit rejects additions without truncation and permits explicit replacement', () => {
  let library = createQuotationLibrary()
  for (let i = 0; i < 100; i++) library = saveQuotationToLibrary(library, quotation(), `Trabajo ${i}`)
  const before = serializeQuotationLibrary(library)
  assert.throws(() => saveQuotationToLibrary(library, quotation(), 'Trabajo 101'), /100/)
  assert.equal(serializeQuotationLibrary(library), before)
  const entry = library.entries[0]!
  assert.equal(saveQuotationToLibrary(library, quotation(), entry.name, { replaceEntryId: entry.id }).entries.length, 100)
})

test('parsing rejects duplicate identities, names, invalid dates and blank stored quotations', () => {
  const library = saveQuotationToLibrary(createQuotationLibrary(), quotation(), 'Original')
  const entry = library.entries[0]!
  const inputs: unknown[] = [
    { ...library, version: 2 },
    { ...library, entries: [entry, { ...entry, id: 'another-entry' }] },
    { ...library, entries: [{ ...entry, name: '   ' }] },
    { ...library, entries: [{ ...entry, savedAt: '2026-02-30T00:00:00.000Z' }] },
    { ...library, entries: [{ ...entry, quotation: createQuotation() }] },
    { ...library, entries: [{ ...entry, id: entry.quotation.id }] },
    { ...library, entries: [{ ...entry, quotation: { ...entry.quotation, rows: [entry.quotation.rows[0], entry.quotation.rows[0]] } }] },
  ]
  for (const value of inputs) assert.throws(() => parseQuotationLibrary(JSON.stringify(value)))
})

test('the backup limit counts UTF-8 bytes before parsing, including multibyte input', () => {
  assert.throws(() => parseQuotationLibrary(' '.repeat(QUOTATION_LIBRARY_MAX_BYTES + 1)), /5 MiB/)
  assert.throws(() => parseQuotationLibrary('é'.repeat(QUOTATION_LIBRARY_MAX_BYTES / 2 + 1)), /5 MiB/)
})

test('serialization discards unrelated fields rather than placing catalogue data in a backup', () => {
  const library = saveQuotationToLibrary(createQuotationLibrary(), quotation(), 'Original')
  const input = { ...library, catalog: [{ privateCost: 'should-not-appear' }], arbitrary: 'should-not-appear' }
  const text = serializeQuotationLibrary(input)
  assert.equal(text.includes('should-not-appear'), false)
  assert.deepEqual(parseQuotationLibrary(`\ufeff${text}`), library)
})

test('corrupt library bytes remain intact until an explicit validated replacement', () => {
  const corrupt = ' {broken original bytes'
  const adapter = storage({ [LIBRARY_STORAGE_KEY]: corrupt, [STORAGE_KEY]: 'legacy untouched' })
  const loaded = loadQuotationLibrary(adapter)
  assert.equal(loaded.raw, corrupt)
  assert.ok(loaded.error)
  assert.deepEqual(adapter.writes, [])
  const library = saveQuotationToLibrary(createQuotationLibrary(), quotation(), 'Recovered')
  const refused = saveQuotationLibrary(adapter, library, { expectedRaw: corrupt })
  assert.equal(refused.ok, false)
  assert.equal(adapter.values.get(LIBRARY_STORAGE_KEY), corrupt)
  assert.equal(adapter.values.get(STORAGE_KEY), 'legacy untouched')
  const replacement = saveQuotationLibrary(adapter, library, { expectedRaw: corrupt, overwriteInvalid: true })
  assert.equal(replacement.ok, true)
  assert.deepEqual(loadQuotationLibrary(adapter).library, library)
  assert.deepEqual(adapter.writes, [LIBRARY_STORAGE_KEY])
})

test('a newer value from another tab pauses saving without overwriting either library', () => {
  const adapter = storage()
  const initial = saveQuotationToLibrary(createQuotationLibrary(), quotation(), 'First')
  const saved = saveQuotationLibrary(adapter, initial, { expectedRaw: null })
  assert.equal(saved.ok, true)
  const local = saveQuotationToLibrary(initial, quotation(), 'Local unsaved work')
  const remote = saveQuotationToLibrary(initial, quotation(), 'Other tab work')
  const remoteRaw = serializeQuotationLibrary(remote)
  adapter.values.set(LIBRARY_STORAGE_KEY, remoteRaw)
  const result = saveQuotationLibrary(adapter, local, { expectedRaw: saved.raw })
  assert.equal(result.ok, false)
  assert.equal(result.conflict, true)
  assert.equal(adapter.values.get(LIBRARY_STORAGE_KEY), remoteRaw)
  assert.equal(local.entries[0]!.name, 'Local unsaved work')
  assert.equal(parseQuotationLibrary(serializeQuotationLibrary(local)).entries.length, 2)
})

test('storage read and quota failures preserve the prior bytes and in-memory library', () => {
  const library = saveQuotationToLibrary(createQuotationLibrary(), quotation(), 'Local')
  const old = serializeQuotationLibrary(createQuotationLibrary())
  const before = serializeQuotationLibrary(library)
  const quota: StorageAdapter = { getItem: () => old, setItem: () => { throw new Error('quota') } }
  assert.equal(saveQuotationLibrary(quota, library, { expectedRaw: old }).ok, false)
  assert.equal(serializeQuotationLibrary(library), before)
  let writes = 0
  const unreadable: StorageAdapter = { getItem: () => { throw new Error('denied') }, setItem: () => { writes++ } }
  assert.ok(loadQuotationLibrary(unreadable).error)
  assert.equal(saveQuotationLibrary(unreadable, library, { expectedRaw: null, overwriteInvalid: true }).ok, false)
  assert.equal(writes, 0)
})

test('failed validation never overwrites library, catalogue, recovery or legacy keys', () => {
  const original = serializeQuotationLibrary(saveQuotationToLibrary(createQuotationLibrary(), quotation(), 'Original'))
  const adapter = storage({ [LIBRARY_STORAGE_KEY]: original, [CATALOG_STORAGE_KEY]: 'catalogue', [CURRENT_QUOTATION_STORAGE_KEY]: 'current', [STORAGE_KEY]: 'legacy' })
  const invalid = { ...createQuotationLibrary(), entries: [{ id: 'invalid' }] } as unknown as ReturnType<typeof createQuotationLibrary>
  assert.equal(saveQuotationLibrary(adapter, invalid, { expectedRaw: original, overwriteInvalid: true }).ok, false)
  assert.deepEqual(adapter.writes, [])
  assert.equal(adapter.values.get(LIBRARY_STORAGE_KEY), original)
  assert.equal(adapter.values.get(CATALOG_STORAGE_KEY), 'catalogue')
  assert.equal(adapter.values.get(CURRENT_QUOTATION_STORAGE_KEY), 'current')
  assert.equal(adapter.values.get(STORAGE_KEY), 'legacy')
})

test('legacy backup import extracts only meaningful quotations with unique names and frozen copies', () => {
  const first = quotation()
  const second = quotation()
  second.title = first.title
  const workspace: Workspace = {
    version: 1, activeQuotationId: first.id, quotations: [first, second, createQuotation()],
    catalog: [{ id: 'private-catalogue', concept: 'Private catalogue fixture', detail: '', section: 'extras', currency: 'ARS', unitPrice: '999' }],
  }
  const source = serializeWorkspace(workspace)
  const result = previewQuotationLibraryBackup(source)
  assert.equal(result.fromLegacy, true)
  assert.equal(result.library.entries.length, 2)
  assert.deepEqual(result.library.entries.map((entry) => entry.name), [first.title, `${first.title} (2)`])
  assert.ok(result.library.entries.every((entry) => entry.quotation.exchangeRateMode === 'frozen'))
  assert.equal(result.library.entries[0]!.savedAt, first.updatedAt)
  assert.notEqual(result.library.entries[0]!.quotation.id, first.id)
  assert.equal(serializeQuotationLibrary(result.library).includes('Private catalogue fixture'), false)
  assert.equal(serializeWorkspace(workspace), source)
})

test('legacy import rejects an oversized quotation collection without silently dropping entries', () => {
  const quotations = Array.from({ length: 101 }, quotation)
  const source = serializeWorkspace({ version: 1, activeQuotationId: quotations[0]!.id, quotations, catalog: [] })
  assert.throws(() => parseQuotationLibraryBackup(source), /más de 100/)
})
