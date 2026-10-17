import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate } from 'node:timers/promises'
import {
  createExchangeRateHandler, type ExchangeRateCache,
} from '../api/exchange-rate.ts'
import {
  EXCHANGE_QUOTE_CACHE_TTL_MS, EXCHANGE_QUOTE_MAX_BYTES, type BlueDollarQuote,
} from '../src/features/quotation/exchange-quote.ts'

const NOW = Date.parse('2026-10-16T15:00:00.000Z')
const QUOTE: BlueDollarQuote = {
  rate: '1.600,25', source: 'DolarAPI', market: 'blue', side: 'sell',
  updatedAt: '2026-10-16T14:59:00.000Z', fetchedAt: new Date(NOW).toISOString(),
}

function source(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    moneda: 'USD', casa: 'blue', nombre: 'Blue', compra: 1599.5,
    venta: 1600.25, fechaActualizacion: QUOTE.updatedAt, ...overrides,
  }
}

function sourceResponse(value: unknown = source()): Response {
  return new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })
}

function request(method = 'GET', suffix = ''): Request {
  return new Request(`https://quotation.example/api/exchange-rate${suffix}`, { method })
}

function memoryCache(initial: unknown = undefined): ExchangeRateCache & {
  value: unknown
  reads: string[]
  writes: { key: string; value: BlueDollarQuote; ttl: number }[]
} {
  return {
    value: initial,
    reads: [],
    writes: [],
    async get(key) { this.reads.push(key); return this.value },
    async set(key, value, options) {
      this.value = value
      this.writes.push({ key, value, ttl: options.ttl })
    },
  }
}

function assertPrivate(response: Response): void {
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  assert.equal(response.headers.get('cdn-cache-control'), 'no-store')
  assert.equal(response.headers.get('vercel-cdn-cache-control'), 'no-store')
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8')
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(response.headers.get('access-control-allow-origin'), null)
}

test('a cache miss reads only the fixed blue URL and stores the validated sale rate for one hour', async () => {
  const cache = memoryCache()
  const handler = createExchangeRateHandler({
    cache, now: () => NOW,
    fetcher: async (input, options) => {
      assert.equal(input, 'https://dolarapi.com/v1/dolares/blue')
      assert.equal(options?.method, 'GET')
      assert.deepEqual(options?.headers, { Accept: 'application/json' })
      assert.equal(options?.redirect, 'error')
      assert.equal(options?.cache, 'no-store')
      assert.ok(options?.signal instanceof AbortSignal)
      assert.equal(options.signal.aborted, false)
      return sourceResponse({ ...source(), privateUpstreamProperty: 'DO-NOT-ECHO' })
    },
  })
  const response = await handler(request('GET', '?url=https://attacker.example&force=true'))
  assert.equal(response.status, 200)
  assertPrivate(response)
  assert.deepEqual(await response.json(), QUOTE)
  assert.deepEqual(cache.reads, ['blue-venta', 'blue-venta'])
  assert.deepEqual(cache.writes, [{ key: 'blue-venta', value: QUOTE, ttl: 3600 }])
})

test('cache reuse has no force-refresh bypass and expires at the one-hour boundary', async () => {
  const cache = memoryCache(QUOTE)
  let time = NOW + EXCHANGE_QUOTE_CACHE_TTL_MS - 1
  let fetches = 0
  const handler = createExchangeRateHandler({
    cache, now: () => time,
    fetcher: async () => { fetches++; return sourceResponse() },
  })
  const cached = await handler(request('GET', '?force=true'))
  assert.equal(cached.status, 200)
  assert.deepEqual(await cached.json(), QUOTE)
  assert.equal(fetches, 0)
  time++
  const refreshed = await handler(request())
  assert.equal(refreshed.status, 200)
  assert.equal(fetches, 1)
  assert.deepEqual(await refreshed.json(), { ...QUOTE, fetchedAt: new Date(time).toISOString() })
})

test('a value cached two hours ago under the previous TTL is refreshed', async () => {
  const previousFetch = NOW - 2 * 60 * 60 * 1000
  const cache = memoryCache({
    ...QUOTE, rate: '1.500,25',
    updatedAt: new Date(previousFetch - 60000).toISOString(),
    fetchedAt: new Date(previousFetch).toISOString(),
  })
  let fetches = 0
  const handler = createExchangeRateHandler({
    cache, now: () => NOW,
    fetcher: async () => { fetches++; return sourceResponse() },
  })
  const response = await handler(request())
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), QUOTE)
  assert.equal(fetches, 1)
  assert.deepEqual(cache.writes, [{ key: 'blue-venta', value: QUOTE, ttl: 3600 }])
})

test('concurrent requests share one upstream operation and each receives its own response', async () => {
  const cache = memoryCache()
  let complete: (value: Response) => void = () => assert.fail('Missing fetch resolver.')
  let fetches = 0
  const handler = createExchangeRateHandler({
    cache, now: () => NOW,
    fetcher: async () => {
      fetches++
      return new Promise<Response>((resolve) => { complete = resolve })
    },
  })
  const first = handler(request())
  const second = handler(request())
  await setImmediate()
  assert.equal(fetches, 1)
  assert.equal(cache.reads.length, 1)
  complete(sourceResponse())
  const responses = await Promise.all([first, second])
  for (const response of responses) assert.deepEqual(await response.json(), QUOTE)
  assert.equal(cache.writes.length, 1)
})

test('non-GET methods are rejected before accessing cache or upstream', async () => {
  const handler = createExchangeRateHandler({
    cache: {
      get: async () => assert.fail('Wrong method must not access cache.'),
      set: async () => assert.fail('Wrong method must not write cache.'),
    },
    fetcher: async () => assert.fail('Wrong method must not fetch.'),
  })
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
    const response = await handler(request(method))
    assert.equal(response.status, 405)
    assert.equal(response.headers.get('allow'), 'GET')
    assertPrivate(response)
  }
})

test('cache failures fail closed without exposing a rate or upstream details', async () => {
  let fetches = 0
  const handler = createExchangeRateHandler({
    cache: {
      get: async () => { throw new Error('PRIVATE cache outage') },
      set: async () => assert.fail('Failed cache read must not write.'),
    },
    now: () => NOW,
    fetcher: async () => { fetches++; return sourceResponse() },
  })
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await handler(request())
    assert.equal(response.status, 503)
    assertPrivate(response)
    assert.doesNotMatch(await response.text(), /PRIVATE|cache outage|1600/)
  }
  assert.equal(fetches, 0)
  const writeFailure = createExchangeRateHandler({
    cache: { get: async () => undefined, set: async () => { throw new Error('PRIVATE write failure') } },
    now: () => NOW, fetcher: async () => sourceResponse(),
  })
  const response = await writeFailure(request())
  assert.equal(response.status, 503)
  assertPrivate(response)
  assert.doesNotMatch(await response.text(), /PRIVATE|write failure|1600/)
})

test('a cache write outage pauses uncached requests for one minute and can recover', async () => {
  let time = NOW
  let fetches = 0
  let writes = 0
  let reads = 0
  let saved: unknown
  const handler = createExchangeRateHandler({
    cache: {
      get: async () => { reads++; return saved },
      set: async (_key, value) => {
        if (writes++ === 0) throw new Error('PRIVATE cache outage')
        saved = value
      },
    },
    now: () => time,
    fetcher: async () => { fetches++; return sourceResponse() },
  })
  assert.equal((await handler(request())).status, 503)
  time += 59999
  assert.equal((await handler(request())).status, 503)
  assert.equal(fetches, 1)
  assert.equal(reads, 1)
  time++
  const recovered = await handler(request())
  assert.equal(recovered.status, 200)
  assert.deepEqual(await recovered.json(), { ...QUOTE, fetchedAt: new Date(time).toISOString() })
  assert.equal(fetches, 2)
  assert.equal(reads, 3)
})

test('silently failed cache writes are detected and cannot cause an uncached fetch loop', async () => {
  let fetches = 0
  const handler = createExchangeRateHandler({
    cache: { get: async () => null, set: async () => undefined },
    now: () => NOW,
    fetcher: async () => { fetches++; return sourceResponse() },
  })
  assert.equal((await handler(request())).status, 503)
  assert.equal((await handler(request())).status, 503)
  assert.equal(fetches, 1)
})

test('invalid, stale and future cached values are replaced without returning their values', async () => {
  const invalids: unknown[] = [
    null, {}, 'PRIVATE cache data', { ...QUOTE, source: 'Other' },
    { ...QUOTE, market: 'official' }, { ...QUOTE, side: 'buy' },
    { ...QUOTE, rate: '0' }, { ...QUOTE, rate: '-1' }, { ...QUOTE, rate: 'NaN' },
    { ...QUOTE, fetchedAt: new Date(NOW - EXCHANGE_QUOTE_CACHE_TTL_MS).toISOString() },
    { ...QUOTE, fetchedAt: new Date(NOW + 1).toISOString() },
    { ...QUOTE, updatedAt: new Date(NOW - 8 * 24 * 60 * 60 * 1000).toISOString() },
    { ...QUOTE, updatedAt: new Date(NOW + 6 * 60 * 1000).toISOString() },
  ]
  for (const invalid of invalids) {
    const cache = memoryCache(invalid)
    let fetches = 0
    const handler = createExchangeRateHandler({
      cache, now: () => NOW,
      fetcher: async () => { fetches++; return sourceResponse() },
    })
    const response = await handler(request())
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), QUOTE)
    assert.equal(fetches, 1)
    assert.equal(cache.writes.length, 1)
  }
})

test('only USD blue venta is accepted, never compra or another market', async () => {
  const invalids = [
    source({ moneda: 'EUR' }), source({ casa: 'oficial' }), source({ casa: 'Blue' }),
    source({ venta: undefined }), source({ venta: '1600.25' }), source({ venta: 0 }),
    source({ venta: -1 }), source({ venta: null }), source({ venta: 1600.1234567 }),
    source({ fechaActualizacion: 'not a date' }),
    source({ fechaActualizacion: new Date(NOW - 8 * 24 * 60 * 60 * 1000).toISOString() }),
    source({ fechaActualizacion: new Date(NOW + 6 * 60 * 1000).toISOString() }),
  ]
  for (const invalid of invalids) {
    const cache = memoryCache()
    const handler = createExchangeRateHandler({ cache, now: () => NOW, fetcher: async () => sourceResponse(invalid) })
    const response = await handler(request())
    assert.equal(response.status, 502)
    assertPrivate(response)
    assert.equal(cache.writes.length, 0)
    assert.doesNotMatch(await response.text(), /1600|1599|not a date/)
  }
})

test('redirects, unsuccessful statuses, HTML and missing JSON content types return generic failures', async () => {
  const responses = [
    ...[206, 301, 302, 307, 308, 400, 401, 403, 404, 429, 500].map((status) => new Response('PRIVATE upstream error', {
      status, headers: { 'Content-Type': 'application/json', Location: 'https://attacker.example/private' },
    })),
    ...['text/html', 'text/plain', 'application/octet-stream', ''].map((type) => new Response(JSON.stringify(source()), {
      headers: type ? { 'Content-Type': type } : {},
    })),
  ]
  const redirected = sourceResponse()
  Object.defineProperty(redirected, 'redirected', { value: true })
  responses.push(redirected)
  for (const upstream of responses) {
    const handler = createExchangeRateHandler({ cache: memoryCache(), now: () => NOW, fetcher: async () => upstream })
    const response = await handler(request())
    assert.equal(response.status, 502)
    assertPrivate(response)
    assert.equal(response.headers.get('location'), null)
    assert.doesNotMatch(await response.text(), /PRIVATE|upstream error|attacker|1600/)
  }
})

test('declared and streamed byte limits cancel excessive upstream responses', async () => {
  for (const declaredLength of [String(EXCHANGE_QUOTE_MAX_BYTES + 1), '1', undefined]) {
    let cancelled = false
    let chunk = 0
    const handler = createExchangeRateHandler({
      cache: memoryCache(), now: () => NOW,
      fetcher: async () => new Response(new ReadableStream({
        pull(controller) { controller.enqueue(new Uint8Array(chunk++ === 0 ? EXCHANGE_QUOTE_MAX_BYTES : 1)) },
        cancel() { cancelled = true },
      }), {
        headers: { 'Content-Type': 'application/json', ...(declaredLength ? { 'Content-Length': declaredLength } : {}) },
      }),
    })
    assert.equal((await handler(request())).status, 502)
    assert.equal(cancelled, true)
  }
})

test('an exact-limit JSON response and split multibyte UTF-8 are accepted', async () => {
  const value = JSON.stringify(source({ nombre: 'Cotización sintética' }))
  const bytes = new TextEncoder().encode(value + ' '.repeat(EXCHANGE_QUOTE_MAX_BYTES - new TextEncoder().encode(value).byteLength))
  const split = bytes.indexOf(0xc3) + 1
  assert.ok(split > 0)
  const handler = createExchangeRateHandler({
    cache: memoryCache(), now: () => NOW,
    fetcher: async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(bytes.slice(0, split))
        controller.enqueue(bytes.slice(split))
        controller.close()
      },
    }), { headers: { 'Content-Type': 'APPLICATION/JSON; charset=UTF-8' } }),
  })
  assert.deepEqual(await (await handler(request())).json(), QUOTE)
})

test('malformed JSON, invalid UTF-8, stream failures and timeouts are redacted and never cached', async () => {
  const fetchers: (typeof fetch)[] = [
    async () => { throw new Error('PRIVATE source exception') },
    async (_input, options) => {
      assert.ok(options?.signal instanceof AbortSignal)
      throw new DOMException('PRIVATE upstream timeout', 'TimeoutError')
    },
    async () => new Response('{"private":"DO-NOT-ECHO"', { headers: { 'Content-Type': 'application/json' } }),
    async () => new Response(new Uint8Array([0xc3, 0x28]), { headers: { 'Content-Type': 'application/json' } }),
    async () => new Response(new ReadableStream({
      start(controller) { controller.error(new Error('PRIVATE body error')) },
    }), { headers: { 'Content-Type': 'application/json' } }),
    async () => new Response(null, { headers: { 'Content-Type': 'application/json' } }),
  ]
  for (const fetcher of fetchers) {
    const cache = memoryCache()
    const handler = createExchangeRateHandler({ cache, now: () => NOW, fetcher })
    const response = await handler(request())
    assert.equal(response.status, 502)
    assertPrivate(response)
    assert.equal(cache.writes.length, 0)
    assert.doesNotMatch(await response.text(), /PRIVATE|DO-NOT-ECHO|body error|exception|timeout/)
  }
})

test('a failed upstream request releases the in-process single-flight operation for a later retry', async () => {
  let fetches = 0
  const handler = createExchangeRateHandler({
    cache: memoryCache(), now: () => NOW,
    fetcher: async () => {
      if (fetches++ === 0) throw new Error('PRIVATE initial failure')
      return sourceResponse()
    },
  })
  assert.equal((await handler(request())).status, 502)
  assert.deepEqual(await (await handler(request())).json(), QUOTE)
  assert.equal(fetches, 2)
})
