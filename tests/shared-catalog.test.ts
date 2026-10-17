import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate } from 'node:timers/promises'
import {
  CATALOG_IMPORT_MAX_BYTES,
  type CatalogImportDocument, type CatalogImportItem, type CatalogReferencePrice,
} from '../src/features/quotation/catalog.ts'
import { createQuotation, type CatalogItem } from '../src/features/quotation/model.ts'
import type { CatalogStockSnapshot } from '../src/features/quotation/catalog-stock.ts'
import { serializeWorkspace, STORAGE_KEY, type StorageAdapter } from '../src/features/quotation/persistence.ts'
import {
  CATALOG_STORAGE_KEY, CURRENT_QUOTATION_STORAGE_KEY, loadCatalog, loadCurrentQuotation,
  saveCatalog, saveCurrentQuotation,
} from '../src/features/quotation/working-storage.ts'
import {
  loadSharedCatalog, mergeSharedCatalog, SHARED_CATALOG_MAX_BYTES, validateSharedCatalogDocument,
} from '../src/features/quotation/shared-catalog.ts'

function item(overrides: Partial<CatalogImportItem> = {}): CatalogImportItem {
  return {
    supplier: 'Synthetic supplier', sku: 'SYN-001', brand: 'Example brand',
    name: 'Synthetic speaker', description: 'Example detail', category: 'Example audio',
    section: 'equipment', referencePrices: [{
      amount: '123.45', currency: 'USD', role: 'list', date: '2024-01', historical: true,
    }], ...overrides,
  }
}

function document(items: CatalogImportItem[] = [item()]): CatalogImportDocument {
  return { format: 'luquisound.catalog', version: 1, items }
}

function stock(quantity: number | null): CatalogStockSnapshot {
  return {
    quantity, checkedAt: '2026-10-17T15:00:00.000Z', validUntil: '2026-10-17T16:00:00.000Z',
    source: { document: 'synthetic-stock-source', sheet: 'Products', row: 2, date: null },
  }
}

function jsonResponse(value: unknown = document()): Response {
  return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
}

function load(response: Response): Promise<CatalogImportDocument | null> {
  return loadSharedCatalog(new AbortController().signal, async () => response)
}

function genericFailure(error: unknown): boolean {
  assert.ok(error instanceof Error)
  assert.match(error.message, /No se pudo cargar el catálogo compartido/)
  assert.equal(error.message.includes('PRIVATE'), false)
  return true
}

test('central products load automatically through a same-origin uncached request and discard unknown fields', async () => {
  const signal = new AbortController().signal
  let called = false
  const result = await loadSharedCatalog(signal, async (input, options) => {
    called = true
    assert.equal(input, '/api/catalog')
    assert.deepEqual(options, {
      method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal,
    })
    return jsonResponse({ ...document(), privateUnknownField: 'PRIVATE', items: [{ ...item(), arbitrary: 'PRIVATE' }] })
  })
  assert.equal(called, true)
  assert.deepEqual(result, document())
})

test('an explicit missing endpoint is optional, while server and authentication failures are visible', async () => {
  assert.equal(await load(new Response('Missing endpoint', { status: 404 })), null)
  for (const status of [400, 401, 403, 429, 500, 502]) {
    await assert.rejects(load(new Response('PRIVATE server details', { status })), genericFailure)
  }
})

test('successful HTML authentication or SPA fallbacks and followed redirects cannot become a catalogue', async () => {
  for (const contentType of ['text/html', 'text/plain', 'application/octet-stream', '']) {
    await assert.rejects(load(new Response(JSON.stringify(document()), {
      headers: { 'content-type': contentType },
    })), genericFailure)
  }
  const redirected = jsonResponse()
  Object.defineProperty(redirected, 'redirected', { value: true })
  await assert.rejects(load(redirected), genericFailure)
  const redirectedMissing = new Response(null, { status: 404 })
  Object.defineProperty(redirectedMissing, 'redirected', { value: true })
  await assert.rejects(load(redirectedMissing), genericFailure)
})

test('JSON media types support charset parameters and structured suffixes', async () => {
  for (const contentType of ['application/json; charset=UTF-8', 'APPLICATION/JSON', 'application/vnd.luquisound+json']) {
    assert.deepEqual(await load(new Response(JSON.stringify(document()), {
      headers: { 'content-type': contentType },
    })), document())
  }
})

test('malformed JSON, invalid documents and incomplete central keys fail without revealing response content', async () => {
  for (const body of ['PRIVATE invalid JSON', JSON.stringify({ private: 'PRIVATE' }),
    JSON.stringify(document([item({ supplier: '' })])),
    JSON.stringify(document([item(), item()])),
    JSON.stringify(document([item({ referencePrices: [{
      amount: '-PRIVATE', currency: 'USD', role: 'list', date: null, historical: true,
    }] })]))]) {
    await assert.rejects(load(new Response(body, { headers: { 'content-type': 'application/json' } })), genericFailure)
  }
  await assert.rejects(load(new Response(null, { headers: { 'content-type': 'application/json' } })), genericFailure)
  await assert.rejects(load(new Response(new Uint8Array([0xc3, 0x28]), {
    headers: { 'content-type': 'application/json' },
  })), genericFailure)
})

test('network errors and redirect rejection never expose their original error text', async () => {
  await assert.rejects(loadSharedCatalog(new AbortController().signal, async () => {
    throw new Error('PRIVATE network or authentication details')
  }), genericFailure)
})

test('an already cancelled request never fetches and reports only a cancellation', async () => {
  const controller = new AbortController()
  controller.abort(new Error('PRIVATE cancellation reason'))
  let fetched = false
  await assert.rejects(loadSharedCatalog(controller.signal, async () => {
    fetched = true
    return jsonResponse()
  }), (error: unknown) => {
    assert.ok(error instanceof DOMException)
    assert.equal(error.name, 'AbortError')
    assert.equal(error.message.includes('PRIVATE'), false)
    return true
  })
  assert.equal(fetched, false)
})

test('cancellation during a pending response read stops the stream and cannot apply an incomplete document', async () => {
  const controller = new AbortController()
  let cancelled = false
  const stream = new ReadableStream<Uint8Array>({
    pull() { return new Promise<void>(() => undefined) },
    cancel() { cancelled = true },
  })
  const pending = loadSharedCatalog(controller.signal, async () => new Response(stream, {
    headers: { 'content-type': 'application/json' },
  }))
  await setImmediate()
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(cancelled, true)
})

test('declared oversized responses are cancelled before parsing', async () => {
  let cancelled = false
  const stream = new ReadableStream<Uint8Array>({ cancel() { cancelled = true } })
  await assert.rejects(load(new Response(stream, { headers: {
    'content-type': 'application/json', 'content-length': String(SHARED_CATALOG_MAX_BYTES + 1),
  } })), genericFailure)
  assert.equal(cancelled, true)
})

test('streamed byte limits apply with missing or dishonest content lengths', async () => {
  for (const declaredLength of [undefined, '1']) {
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(SHARED_CATALOG_MAX_BYTES))
        controller.enqueue(new Uint8Array(1))
      },
      cancel() { cancelled = true },
    })
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (declaredLength !== undefined) headers['content-length'] = declaredLength
    await assert.rejects(load(new Response(stream, { headers })), genericFailure)
    assert.equal(cancelled, true)
  }
})

test('the transport cap counts UTF-8 bytes and accepts a valid document exactly at the limit', async () => {
  const serialized = JSON.stringify(document())
  const padded = serialized + ' '.repeat(SHARED_CATALOG_MAX_BYTES - new TextEncoder().encode(serialized).byteLength)
  assert.deepEqual(await load(new Response(padded, {
    headers: { 'content-type': 'application/json' },
  })), document())
  const oversized = JSON.stringify({ ...document(), padding: 'é'.repeat(SHARED_CATALOG_MAX_BYTES / 2) })
  assert.ok(oversized.length < SHARED_CATALOG_MAX_BYTES)
  await assert.rejects(load(new Response(oversized, {
    headers: { 'content-type': 'application/json' },
  })), genericFailure)
})

test('central documents require strictly validated fields and complete unique normalized supplier/SKU keys', () => {
  for (const incomplete of [{ supplier: '' }, { sku: '  ' }, { supplier: undefined }, { sku: undefined }]) {
    assert.throws(() => validateSharedCatalogDocument(document([item(incomplete)])), /proveedor y código/)
  }
  for (const duplicate of [item(), item({ supplier: ' SYNTHETIC   SUPPLIER ', sku: ' syn-001 ' }), item({ name: 'Changed' })]) {
    assert.throws(() => validateSharedCatalogDocument(document([item(), duplicate])), /repite proveedor y código/)
  }
  assert.throws(() => validateSharedCatalogDocument({
    ...document(), version: 2,
  } as unknown as CatalogImportDocument), /formato válido/)
  assert.doesNotThrow(() => validateSharedCatalogDocument(document([
    item({ sku: '001' }), item({ sku: '1' }), item({ supplier: 'Other synthetic supplier', sku: '001' }),
  ])))
})

test('a fresh central import has pending sale prices and repeated imports preserve object identity', () => {
  const incoming = document()
  const snapshot = structuredClone(incoming)
  const result = mergeSharedCatalog([], incoming)
  assert.equal(result.length, 1)
  assert.equal(result[0].unitPrice, '')
  assert.equal(result[0].currency, 'ARS')
  assert.deepEqual(result[0].referencePrices, incoming.items[0].referencePrices)
  assert.equal(mergeSharedCatalog(result, incoming), result)
  assert.deepEqual(incoming, snapshot)
  assert.notEqual(result[0].referencePrices, incoming.items[0].referencePrices)
})

test('automatic metadata updates preserve manual prices, explicit zero, currencies and existing identities', () => {
  const incoming = document(['A', 'B', 'C'].map((sku) => item({ sku })))
  const existing = mergeSharedCatalog([], incoming)
  existing[0].unitPrice = '12.345,67'
  existing[0].currency = 'USD'
  existing[1].unitPrice = '0'
  existing[2].unitPrice = ''
  const original = structuredClone(existing)
  const updated = document(incoming.items.map((entry) => ({
    ...entry, name: `Updated ${entry.sku}`, category: 'Updated category', section: 'extras',
  })))
  const result = mergeSharedCatalog(existing, updated)
  for (let index = 0; index < result.length; index++) {
    assert.equal(result[index].id, original[index].id)
    assert.equal(result[index].unitPrice, original[index].unitPrice)
    assert.equal(result[index].currency, original[index].currency)
    assert.equal(result[index].concept, `Updated ${incoming.items[index].sku}`)
    assert.equal(result[index].category, 'Updated category')
    assert.equal(result[index].section, 'extras')
  }
  assert.deepEqual(existing, original)
  assert.equal(mergeSharedCatalog(result, updated), result)
})

test('central updates keep local custom products and do not delete items absent from the current central list', () => {
  const existing = mergeSharedCatalog([], document())
  const custom: CatalogItem = {
    id: 'local-custom', concept: 'Synthetic manual work', detail: '', section: 'extras', currency: 'ARS', unitPrice: '0',
  }
  existing.push(custom)
  const original = structuredClone(existing)
  const result = mergeSharedCatalog(existing, document([item({ sku: 'SYN-002' })]))
  assert.equal(result.length, 3)
  assert.deepEqual(result.slice(0, 2), original)
  assert.deepEqual(existing, original)
  assert.equal(mergeSharedCatalog(existing, document([])), existing)
})

test('shared transport preserves a validated explicit source replacement manifest', async () => {
  const incoming: CatalogImportDocument = {
    ...document([item({ source: { document: 'synthetic-canonical.xlsx', date: null } })]),
    replaceSourceDocuments: ['synthetic-previous.pdf', 'synthetic-canonical.xlsx'],
  }
  const loaded = await load(jsonResponse(incoming))
  assert.deepEqual(loaded?.replaceSourceDocuments, incoming.replaceSourceDocuments)
  await assert.rejects(load(jsonResponse({ ...incoming, replaceSourceDocuments: [] })), genericFailure)
  await assert.rejects(load(jsonResponse({ ...incoming, items: [item()] })), genericFailure)
})

test('shared snapshots preserve unknown and zero through loading and stock-only merges without inventing freshness', async () => {
  const existing = mergeSharedCatalog([], document([item({ stock: stock(3) })]))
  existing[0].unitPrice = '0'
  existing[0].currency = 'USD'
  const original = structuredClone(existing)
  for (const quantity of [0, null]) {
    const incoming = document([item({ stock: stock(quantity) })])
    const loaded = await load(jsonResponse(incoming))
    assert.ok(loaded)
    const result = mergeSharedCatalog(existing, loaded)
    assert.notEqual(result, existing)
    assert.equal(result[0].id, existing[0].id)
    assert.equal(result[0].unitPrice, '0')
    assert.equal(result[0].currency, 'USD')
    assert.deepEqual(result[0].stock, incoming.items[0].stock)
    assert.equal(mergeSharedCatalog(result, loaded), result)
    const withoutStock = mergeSharedCatalog(result, document([item({ name: 'Updated synthetic name' })]))
    assert.deepEqual(withoutStock[0].stock, incoming.items[0].stock)
    result[0].stock!.source.row = 99
    assert.equal(loaded.items[0].stock?.source.row, 2)
    assert.deepEqual(existing, original)
  }
  await assert.rejects(load(jsonResponse(document([item({ stock: { ...stock(0), quantity: -1 } })]))), genericFailure)
})

test('shared removal-only updates apply once and an explicitly empty scoped catalogue preserves manual entries', () => {
  const source = { document: 'synthetic-previous.pdf', date: null }
  const existing = mergeSharedCatalog([], document([item({ source })]))
  const custom: CatalogItem = {
    id: 'local-custom', concept: 'Synthetic cable', detail: '', section: 'extras', currency: 'ARS', unitPrice: '0',
  }
  existing.push(custom)
  const incoming: CatalogImportDocument = { ...document([]), replaceSourceDocuments: [source.document] }
  const result = mergeSharedCatalog(existing, incoming)
  assert.notEqual(result, existing)
  assert.deepEqual(result, [custom])
  assert.equal(mergeSharedCatalog(result, incoming), result)
  assert.equal(existing.length, 2)
})

test('a scoped shared replacement reconciles 451 previous products without changing manual entries, current work or legacy bytes', () => {
  const previousSource = { document: 'synthetic-previous.pdf', date: null }
  const canonicalSource = { document: 'synthetic-canonical.xlsx', sheet: 'Example', row: 2, date: null }
  const previous = mergeSharedCatalog([], document([
    ...Array.from({ length: 451 }, (_, index) => item({ sku: `PREVIOUS-${index}`, source: previousSource })),
    item({ sku: 'RETAINED', source: previousSource }),
  ]))
  const retained = previous[previous.length - 1]
  retained.unitPrice = '0'
  retained.currency = 'USD'
  const manual: CatalogItem[] = ['product', 'labor', 'cable', 'extra'].map((kind) => ({
    id: `manual-${kind}`, concept: `Synthetic manual ${kind}`, detail: '',
    section: kind === 'product' ? 'equipment' : 'extras', currency: 'ARS', unitPrice: '12,34',
  }))
  const legacy = serializeWorkspace({ version: 1, activeQuotationId: null, quotations: [], catalog: [...previous, ...manual] })
  const values = new Map([[STORAGE_KEY, legacy]])
  const writes: string[] = []
  const storage: StorageAdapter = {
    getItem(key) { return values.get(key) ?? null },
    setItem(key, value) { values.set(key, value); writes.push(key) },
  }
  const quotation = createQuotation()
  quotation.rows[0] = { ...quotation.rows[0], concept: 'Synthetic current product', unitPrice: '456,78', priceState: 'priced' }
  assert.equal(saveCurrentQuotation(storage, quotation).ok, true)
  const savedCurrent = values.get(CURRENT_QUOTATION_STORAGE_KEY)
  const loaded = loadCatalog(storage).catalog
  const incoming: CatalogImportDocument = {
    ...document([item({ sku: 'RETAINED', name: 'Canonical product', source: canonicalSource })]),
    replaceSourceDocuments: [previousSource.document, canonicalSource.document],
  }
  const result = mergeSharedCatalog(loaded, incoming)
  assert.equal(result.length, 5)
  assert.equal(result[0].id, retained.id)
  assert.equal(result[0].unitPrice, '0')
  assert.equal(result[0].currency, 'USD')
  assert.deepEqual(result[0].source, canonicalSource)
  assert.equal(result[0].referencePrices?.length, 1)
  assert.deepEqual(result[0].referencePrices?.[0].source, canonicalSource)
  assert.deepEqual(result.slice(1), manual)
  assert.equal(saveCatalog(storage, result).ok, true)
  assert.deepEqual(loadCatalog(storage).catalog, result)
  assert.deepEqual(loadCurrentQuotation(storage).quotation, quotation)
  assert.equal(values.get(CURRENT_QUOTATION_STORAGE_KEY), savedCurrent)
  assert.equal(values.get(STORAGE_KEY), legacy)
  assert.deepEqual(writes, [CURRENT_QUOTATION_STORAGE_KEY, CATALOG_STORAGE_KEY])
  assert.equal(mergeSharedCatalog(result, incoming), result)
})

test('ambiguous scoped existing keys reject shared replacement before removing unrelated previous products', () => {
  const source = { document: 'synthetic-previous.pdf', date: null }
  const existing = mergeSharedCatalog([], document([item({ source }), item({ sku: 'OTHER-PREVIOUS', source })]))
  existing.push({ ...existing[0], id: 'duplicate-local', unitPrice: '9' })
  const snapshot = structuredClone(existing)
  assert.throws(() => mergeSharedCatalog(existing, {
    ...document([]), replaceSourceDocuments: [source.document],
  }), /conflicto/)
  assert.deepEqual(existing, snapshot)
})

test('an ambiguous local key rejects the entire update without adding other products or touching manual data', () => {
  const existing = mergeSharedCatalog([], document())
  existing.push({ ...existing[0], id: 'second-local-identity', unitPrice: '10' })
  const original = structuredClone(existing)
  assert.throws(() => mergeSharedCatalog(existing, document([
    item({ name: 'Updated product' }), item({ sku: 'SYN-002' }),
  ])), /conflicto/)
  assert.deepEqual(existing, original)
})

test('an accumulated reference conflict blocks other additions atomically', () => {
  const references = Array.from({ length: 50 }, (_, index): CatalogReferencePrice => ({
    amount: String(index), currency: 'ARS', role: 'list', date: null, historical: true,
  }))
  const existing = mergeSharedCatalog([], document([item({ referencePrices: references })]))
  const original = structuredClone(existing)
  assert.throws(() => mergeSharedCatalog(existing, document([item(), item({ sku: 'SYN-002' })])), /conflicto/)
  assert.deepEqual(existing, original)
})

test('combined catalogue limits reject atomically without removing local products', () => {
  const existing: CatalogItem[] = Array.from({ length: 2000 }, (_, index) => ({
    id: `local-${index}`, concept: `Synthetic work ${index}`, detail: '',
    section: 'extras', currency: 'ARS', unitPrice: '',
  }))
  const original = structuredClone(existing)
  assert.throws(() => mergeSharedCatalog(existing, document()), /2000 productos/)
  assert.deepEqual(existing, original)
})

test('individually valid catalogues cannot merge past the combined byte limit', () => {
  const existing: CatalogItem[] = Array.from({ length: 1800 }, (_, index) => ({
    id: `local-${index}`, concept: 'X'.repeat(500), detail: 'X'.repeat(2000),
    supplier: 'X'.repeat(200), section: 'extras', currency: 'ARS', unitPrice: '',
  }))
  const incoming = document(Array.from({ length: 200 }, (_, index) => item({
    sku: `NEW-${index}`, name: 'Y'.repeat(500), description: 'Y'.repeat(2000),
  })))
  assert.ok(new TextEncoder().encode(JSON.stringify(existing)).byteLength < CATALOG_IMPORT_MAX_BYTES)
  assert.doesNotThrow(() => validateSharedCatalogDocument(incoming))
  const original = structuredClone(existing)
  assert.throws(() => mergeSharedCatalog(existing, incoming), /límite de 5 MB/)
  assert.deepEqual(existing, original)
})
