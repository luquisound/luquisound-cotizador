import assert from 'node:assert/strict'
import test from 'node:test'
import catalogApi, { serveCatalog } from '../api/catalog.ts'
import type { CatalogServerConfig } from '../api/catalog.ts'
import { parseCatalogImport } from '../src/features/quotation/catalog.ts'
import type { CatalogImportDocument, CatalogImportItem } from '../src/features/quotation/catalog.ts'
import { loadSharedCatalog, mergeSharedCatalog, SHARED_CATALOG_MAX_BYTES } from '../src/features/quotation/shared-catalog.ts'

const CONFIG: CatalogServerConfig = {
  url: 'https://synthetic-store.private.blob.vercel-storage.com/catalog/latest.json',
  token: 'synthetic_server_token',
}

function request(method = 'GET', url = 'https://quotation.example/api/catalog'): Request {
  return new Request(url, { method })
}

function item(changes: Partial<CatalogImportItem> = {}): CatalogImportItem {
  return {
    supplier: 'Synthetic Supplier', sku: 'TEST-001', brand: 'Example', name: 'Cámara de prueba',
    description: 'Synthetic data only', category: 'Audio', section: 'equipment', referencePrices: [],
    ...changes,
  }
}

function document(items: CatalogImportItem[] = [item()]): CatalogImportDocument {
  return { format: 'luquisound.catalog', version: 1, items }
}

function fetchDocument(value: unknown = document(), headers: HeadersInit = {}): typeof fetch {
  return async () => new Response(JSON.stringify(value), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  })
}

function assertPrivate(response: Response): void {
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  assert.equal(response.headers.get('cdn-cache-control'), 'no-store')
  assert.equal(response.headers.get('vercel-cdn-cache-control'), 'no-store')
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8')
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(response.headers.get('access-control-allow-origin'), null)
}

test('the Node Web handler exports fetch and returns only sanitized catalogue fields', async () => {
  assert.equal(typeof catalogApi.fetch, 'function')
  const source = { ...document(), privateUnknown: 'discard', items: [{
    ...item(), id: 'untrusted-id', unitPrice: '123', currency: 'USD', extra: 'discard',
  }] }
  const response = await serveCatalog(request(), CONFIG, fetchDocument(source))
  assert.equal(response.status, 200)
  assertPrivate(response)
  assert.deepEqual(await response.json(), parseCatalogImport(JSON.stringify(document())))
})

test('source replacement survives the endpoint and client loader before reconciling saved entries', async () => {
  const source = { document: 'synthetic-canonical.xlsx', sheet: 'Products', row: 2, date: null }
  const replacement: CatalogImportDocument = {
    ...document([item({ source })]),
    replaceSourceDocuments: ['synthetic-old.xlsx', 'synthetic-retired.pdf', source.document],
  }
  const response = await serveCatalog(request(), CONFIG, fetchDocument(replacement))
  assert.equal(response.status, 200)
  assertPrivate(response)
  const loaded = await loadSharedCatalog(new AbortController().signal, async () => response)
  assert.ok(loaded)
  assert.deepEqual(loaded.replaceSourceDocuments, replacement.replaceSourceDocuments)
  const retained = {
    id: 'retained', concept: 'Saved product', detail: '', section: 'equipment' as const,
    currency: 'USD' as const, unitPrice: '0', supplier: item().supplier, sku: item().sku,
    source: { ...source, document: 'synthetic-old.xlsx' },
  }
  const manual = {
    id: 'manual', concept: 'Manual labour', detail: '', section: 'extras' as const,
    currency: 'ARS' as const, unitPrice: '',
  }
  const result = mergeSharedCatalog([retained, {
    ...retained, id: 'retired', sku: 'OLD-002',
    source: { document: 'synthetic-retired.pdf', page: 1, date: null },
  }, manual], loaded)
  assert.deepEqual(result.map((entry) => entry.id), ['retained', 'manual'])
  assert.equal(result[0]!.source?.document, source.document)
  assert.equal(result[0]!.unitPrice, '0')
  assert.equal(result[0]!.currency, 'USD')
  assert.deepEqual(result[1], manual)
})

test('the private endpoint preserves stock observations independently of price and product provenance', async () => {
  for (const quantity of [null, 0]) {
    const stock = {
      quantity, checkedAt: '2026-10-17T10:00:00.000Z', validUntil: '2026-10-17T10:15:00.000Z',
      source: { document: 'Synthetic live source', sheet: 'Products', row: 2, date: null },
    }
    const incoming = document([item({
      source: { document: 'synthetic-reference.pdf', page: 1, date: null }, stock,
    })])
    const response = await serveCatalog(request(), CONFIG, fetchDocument(incoming))
    assert.equal(response.status, 200)
    assertPrivate(response)
    const loaded = await loadSharedCatalog(new AbortController().signal, async () => response)
    assert.ok(loaded)
    assert.deepEqual(loaded.items[0]!.stock, stock)
    assert.equal(loaded.items[0]!.source?.document, 'synthetic-reference.pdf')
    const [entry] = mergeSharedCatalog([], loaded)
    assert.equal(entry!.unitPrice, '')
    assert.deepEqual(entry!.stock, stock)
  }
  const malformed = { ...document(), items: [{ ...item(), stock: { quantity: '0' } }] }
  const response = await serveCatalog(request(), CONFIG, fetchDocument(malformed))
  assert.equal(response.status, 502)
  assertPrivate(response)
})

test('only the configured private Blob receives the server credential and cache bypass', async () => {
  let calls = 0
  const fetcher: typeof fetch = async (input, init) => {
    calls++
    assert.equal(String(input), `${CONFIG.url}?cache=0`)
    assert.equal(init?.method, 'GET')
    assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${CONFIG.token}`)
    assert.equal(new Headers(init?.headers).get('cookie'), null)
    assert.equal(new Headers(init?.headers).get('accept'), 'application/json')
    assert.equal(init?.redirect, 'error')
    assert.equal(init?.cache, 'no-store')
    assert.ok(init?.signal instanceof AbortSignal)
    assert.equal(init.signal.aborted, false)
    return new Response(JSON.stringify(document()), { headers: { 'Content-Type': 'application/json' } })
  }
  const input = new Request('https://quotation.example/api/catalog?url=https://attacker.example/other.json', {
    headers: { authorization: 'Bearer untrusted-client-token', cookie: 'untrusted=value' },
  })
  const response = await serveCatalog(input, CONFIG, fetcher)
  assert.equal(response.status, 200)
  assert.equal(calls, 1)
  assert.doesNotMatch(await response.text(), /synthetic_server_token|private\.blob|untrusted-client-token/)
})

test('non-GET methods return 405 and never read the Blob', async () => {
  for (const method of ['HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    const response = await serveCatalog(request(method), CONFIG, async () => {
      assert.fail('Unsupported methods must not fetch.')
    })
    assert.equal(response.status, 405)
    assert.equal(response.headers.get('allow'), 'GET')
    assertPrivate(response)
  }
})

test('an unconfigured shared catalogue returns 404 without contacting a server', async () => {
  const response = await serveCatalog(request(), {}, async () => assert.fail('Disabled endpoint must not fetch.'))
  assert.equal(response.status, 404)
  assertPrivate(response)
  assert.equal(typeof (await response.json() as { error: unknown }).error, 'string')
})

test('partial and invalid server settings fail closed with 503 before fetching', async () => {
  const invalids: CatalogServerConfig[] = [
    { url: CONFIG.url }, { token: CONFIG.token }, { url: '', token: '' },
    { ...CONFIG, token: ' ' }, { ...CONFIG, token: 'bad\r\nheader' },
    { ...CONFIG, token: 'é' }, { ...CONFIG, url: 'not-a-url' },
  ]
  for (const config of invalids) {
    const response = await serveCatalog(request(), config, async () => assert.fail('Invalid config must not fetch.'))
    assert.equal(response.status, 503)
    assertPrivate(response)
    assert.doesNotMatch(await response.text(), /synthetic_server_token|private\.blob|bad|header/)
  }
})

test('public Blob URLs, credentials, ports, non-JSON paths and other destinations are rejected', async () => {
  const invalidUrls = [
    'http://synthetic-store.private.blob.vercel-storage.com/catalog.json',
    'https://synthetic-store.public.blob.vercel-storage.com/catalog.json',
    'https://blob.vercel-storage.com/catalog.json',
    'https://private.blob.vercel-storage.com/catalog.json',
    'https://extra.synthetic-store.private.blob.vercel-storage.com/catalog.json',
    'https://synthetic-store.private.blob.vercel-storage.com.attacker.example/catalog.json',
    'https://user:password@synthetic-store.private.blob.vercel-storage.com/catalog.json',
    'https://synthetic-store.private.blob.vercel-storage.com:443/catalog.json',
    'https://synthetic-store.private.blob.vercel-storage.com:8443/catalog.json',
    'https://synthetic-store.private.blob.vercel-storage.com/',
    'https://synthetic-store.private.blob.vercel-storage.com/catalog.html',
    'https://synthetic-store.private.blob.vercel-storage.com/catalog.json#fragment',
    'https://synthetic-store.private.blob.vercel-storage.com/catalog.json#',
    'https://synthetic-store.private.blob.vercel-storage.com/catalog.json?token=untrusted',
    'https://synthetic-store.private.blob.vercel-storage.com/catalog.json?',
    ' https://synthetic-store.private.blob.vercel-storage.com/catalog.json',
    'https://127.0.0.1/catalog.json',
  ]
  for (const url of invalidUrls) {
    const response = await serveCatalog(request(), { ...CONFIG, url }, async () => assert.fail('Unsafe URL must not fetch.'))
    assert.equal(response.status, 503, url)
    assertPrivate(response)
  }
})

test('redirects and unsuccessful upstream statuses return only a generic 502', async () => {
  for (const status of [301, 302, 307, 308, 401, 403, 404, 429, 500, 206]) {
    const response = await serveCatalog(request(), CONFIG, async () => new Response('private upstream error', {
      status, headers: { Location: 'https://attacker.example/private', 'Content-Type': 'application/json' },
    }))
    assert.equal(response.status, 502)
    assertPrivate(response)
    assert.doesNotMatch(await response.text(), /upstream|attacker|synthetic_server_token/)
    assert.equal(response.headers.get('location'), null)
  }
  const response = await serveCatalog(request(), CONFIG, async () => {
    const upstream = new Response(JSON.stringify(document()), { headers: { 'Content-Type': 'application/json' } })
    Object.defineProperty(upstream, 'redirected', { value: true })
    return upstream
  })
  assert.equal(response.status, 502)
})

test('HTML, missing content types and non-JSON responses never reach the client', async () => {
  for (const type of [undefined, 'text/html', 'text/plain', 'application/octet-stream']) {
    const response = await serveCatalog(request(), CONFIG, async () => new Response(JSON.stringify(document()), {
      headers: type ? { 'Content-Type': type } : {},
    }))
    assert.equal(response.status, 502)
    assertPrivate(response)
  }
})

test('streamed UTF-8 split across chunks is decoded without losing product text', async () => {
  const bytes = new TextEncoder().encode(JSON.stringify(document()))
  const split = bytes.indexOf(0xc3) + 1
  assert.ok(split > 0)
  const response = await serveCatalog(request(), CONFIG, async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.slice(0, split))
      controller.enqueue(bytes.slice(split))
      controller.close()
    },
  }), { headers: { 'Content-Type': 'application/json' } }))
  assert.equal(response.status, 200)
  assert.equal((await response.json() as CatalogImportDocument).items[0].name, 'Cámara de prueba')
})

test('declared oversized responses are cancelled before parsing', async () => {
  let cancelled = false
  const response = await serveCatalog(request(), CONFIG, async () => new Response(new ReadableStream({
    cancel() { cancelled = true },
  }), {
    headers: {
      'Content-Type': 'application/json', 'Content-Length': String(SHARED_CATALOG_MAX_BYTES + 1),
    },
  }))
  assert.equal(response.status, 502)
  assert.equal(cancelled, true)
  assertPrivate(response)
})

test('actual streamed byte limits apply even when content length is missing or understated', async () => {
  for (const declaredLength of [undefined, '1']) {
    let cancelled = false
    let chunkIndex = 0
    const response = await serveCatalog(request(), CONFIG, async () => new Response(new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(chunkIndex++ === 0 ? SHARED_CATALOG_MAX_BYTES : 1))
      },
      cancel() { cancelled = true },
    }), {
      headers: {
        'Content-Type': 'application/json', ...(declaredLength ? { 'Content-Length': declaredLength } : {}),
      },
    }))
    assert.equal(response.status, 502)
    assert.equal(cancelled, true)
    assertPrivate(response)
  }
})

test('a valid document at the exact byte limit is accepted and returned compactly', async () => {
  const value = JSON.stringify(document())
  const padded = value + ' '.repeat(SHARED_CATALOG_MAX_BYTES - new TextEncoder().encode(value).byteLength)
  const response = await serveCatalog(request(), CONFIG, async () => new Response(padded, {
    headers: { 'Content-Type': 'application/json' },
  }))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), document())
})

test('sanitized output must also fit the shared transport limit', async () => {
  const prices = Array.from({ length: 50 }, () => ({
    amount: '1', currency: 'USD' as const, role: 'list' as const, date: null, historical: true as const,
  }))
  const value = document(Array.from({ length: 180 }, (_, index) => item({
    sku: `TEST-${index}`, source: { document: 'X'.repeat(500), date: null }, referencePrices: prices,
  })))
  assert.ok(new TextEncoder().encode(JSON.stringify(value)).byteLength < SHARED_CATALOG_MAX_BYTES)
  assert.ok(new TextEncoder().encode(JSON.stringify(parseCatalogImport(JSON.stringify(value)))).byteLength > SHARED_CATALOG_MAX_BYTES)
  const response = await serveCatalog(request(), CONFIG, fetchDocument(value))
  assert.equal(response.status, 502)
  assertPrivate(response)
})

test('malformed JSON, invalid schemas, incomplete keys and duplicate identities return 502', async () => {
  const invalids = [
    '{"private":"do-not-echo"', '{}', 'null',
    JSON.stringify({ ...document(), version: 2 }),
    JSON.stringify(document([item({ supplier: ' ' })])),
    JSON.stringify(document([item({ sku: '' })])),
    JSON.stringify(document([item(), item({ supplier: ' synthetic   supplier ', sku: 'test-001' })])),
  ]
  for (const value of invalids) {
    const response = await serveCatalog(request(), CONFIG, async () => new Response(value, {
      headers: { 'Content-Type': 'application/json' },
    }))
    assert.equal(response.status, 502)
    assertPrivate(response)
    assert.doesNotMatch(await response.text(), /do-not-echo|Synthetic Supplier|TEST-001/)
  }
})

test('invalid UTF-8, failed body streams and fetch exceptions are redacted', async () => {
  const fetchers: (typeof fetch)[] = [
    async () => { throw new Error(`${CONFIG.token} ${CONFIG.url} private error`) },
    async () => { throw new DOMException('private timeout', 'TimeoutError') },
    async () => new Response(new Uint8Array([0xc3, 0x28]), { headers: { 'Content-Type': 'application/json' } }),
    async () => new Response(new ReadableStream({
      start(controller) { controller.error(new Error('private body error')) },
    }), { headers: { 'Content-Type': 'application/json' } }),
    async () => new Response(null, { headers: { 'Content-Type': 'application/json' } }),
  ]
  for (const fetcher of fetchers) {
    const response = await serveCatalog(request(), CONFIG, fetcher)
    assert.equal(response.status, 502)
    assertPrivate(response)
    assert.doesNotMatch(await response.text(), /synthetic_server_token|private\.blob|private error|private timeout|private body/)
  }
})
