import { getCache } from '@vercel/functions'
import {
  EXCHANGE_QUOTE_CACHE_TTL_MS, EXCHANGE_QUOTE_MAX_BYTES,
  parseBlueDollarQuote, parseDolarApiQuote, type BlueDollarQuote,
} from '../src/features/quotation/exchange-quote.ts'

export interface ExchangeRateCache {
  get(key: string): Promise<unknown>
  set(key: string, value: BlueDollarQuote, options: { ttl: number }): Promise<unknown>
}

export interface ExchangeRateDependencies {
  cache: ExchangeRateCache
  fetcher?: typeof fetch
  now?: () => number
}

type ExchangeRateResult = { status: 200; quote: BlueDollarQuote } | { status: 502 | 503 }

const CACHE_KEY = 'blue-venta'
const CACHE_FAILURE_RETRY_MS = 60000
const SOURCE_URL = 'https://dolarapi.com/v1/dolares/blue'
const UNAVAILABLE_MESSAGE = JSON.stringify({ error: 'No se pudo consultar el dólar blue venta. Conservá la cotización guardada e intentá nuevamente.' })

function jsonResponse(body: string, status: number, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'CDN-Cache-Control': 'no-store',
      'Vercel-CDN-Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    },
  })
}

async function readQuote(response: Response): Promise<unknown> {
  const declaredLength = response.headers.get('content-length')
  if (declaredLength !== null && Number(declaredLength) > EXCHANGE_QUOTE_MAX_BYTES) {
    await response.body?.cancel()
    throw new Error('Exchange response limit exceeded.')
  }
  if (!response.body) throw new Error('Missing exchange response body.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let size = 0
  let value = ''
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > EXCHANGE_QUOTE_MAX_BYTES) throw new Error('Exchange response limit exceeded.')
      value += decoder.decode(chunk.value, { stream: true })
    }
    return JSON.parse(value + decoder.decode()) as unknown
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    throw error
  } finally {
    reader.releaseLock()
  }
}

export function createExchangeRateHandler(dependencies: ExchangeRateDependencies): (request: Request) => Promise<Response> {
  const { cache, fetcher = fetch, now = Date.now } = dependencies
  let inFlight: Promise<ExchangeRateResult> | null = null
  let cacheRetryAt = 0

  async function loadQuote(): Promise<ExchangeRateResult> {
    if (now() < cacheRetryAt) return { status: 503 }
    let cached: unknown
    try {
      cached = await cache.get(CACHE_KEY)
    } catch {
      cacheRetryAt = now() + CACHE_FAILURE_RETRY_MS
      return { status: 503 }
    }
    try {
      const quote = parseBlueDollarQuote(cached, now())
      const age = now() - Date.parse(quote.fetchedAt)
      if (age >= 0 && age < EXCHANGE_QUOTE_CACHE_TTL_MS) return { status: 200, quote }
    } catch {
      // Invalid or expired cache data must be replaced by a validated source response.
    }

    let quote: BlueDollarQuote
    try {
      const upstream = await fetcher(SOURCE_URL, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        redirect: 'error',
        cache: 'no-store',
        signal: AbortSignal.timeout(8000),
      })
      if (upstream.status !== 200 || upstream.redirected
        || upstream.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
        await upstream.body?.cancel()
        return { status: 502 }
      }
      quote = parseDolarApiQuote(await readQuote(upstream), now())
    } catch {
      return { status: 502 }
    }
    try {
      await cache.set(CACHE_KEY, quote, { ttl: EXCHANGE_QUOTE_CACHE_TTL_MS / 1000 })
      // Some SDK cache implementations suppress write errors; confirm persistence.
      const stored = parseBlueDollarQuote(await cache.get(CACHE_KEY), now())
      if (stored.rate !== quote.rate || stored.updatedAt !== quote.updatedAt || stored.fetchedAt !== quote.fetchedAt) {
        throw new Error('Exchange cache write was not confirmed.')
      }
    } catch {
      // Avoid an uncached source request on every click during a cache outage.
      cacheRetryAt = now() + CACHE_FAILURE_RETRY_MS
      return { status: 503 }
    }
    return { status: 200, quote }
  }

  return async (request: Request): Promise<Response> => {
    if (request.method !== 'GET') return jsonResponse(UNAVAILABLE_MESSAGE, 405, { Allow: 'GET' })
    inFlight ??= loadQuote().finally(() => { inFlight = null })
    const result = await inFlight
    return result.status === 200
      ? jsonResponse(JSON.stringify(result.quote), 200)
      : jsonResponse(UNAVAILABLE_MESSAGE, result.status)
  }
}

const handler = createExchangeRateHandler({
  cache: getCache({ namespace: 'luquisound-cotizador-fx-v1' }),
})

export default { fetch: handler }
