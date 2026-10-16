import { parseExchangeRate } from './exchange.ts'
import type { Quotation } from './model.ts'

export interface BlueDollarQuote {
  rate: string
  source: 'DolarAPI'
  market: 'blue'
  side: 'sell'
  updatedAt: string
  fetchedAt: string
}

export const EXCHANGE_QUOTE_CACHE_TTL_MS = 3 * 60 * 60 * 1000
export const EXCHANGE_QUOTE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
export const EXCHANGE_QUOTE_MAX_BYTES = 16 * 1024

const CLOCK_TOLERANCE_MS = 5 * 60 * 1000
const INVALID_QUOTE = 'La cotización del dólar blue no tiene un formato válido o está desactualizada.'
const LOAD_ERROR = 'No se pudo consultar el dólar blue venta. La cotización guardada se conserva.'
const dateFormatter = new Intl.DateTimeFormat('es-AR', {
  timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})

function invalidQuote(): never {
  throw new Error(INVALID_QUOTE)
}

function readRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalidQuote()
  return value as Record<string, unknown>
}

function readCanonicalTimestamp(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) invalidQuote()
  const timestamp = new Date(value)
  if (!Number.isFinite(timestamp.getTime()) || timestamp.toISOString() !== value) invalidQuote()
  return value
}

function readSourceTimestamp(value: unknown): string {
  if (typeof value !== 'string') invalidQuote()
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value)
  if (!match) invalidQuote()
  const local = `${match[1]}T${match[2]}${(match[3] ?? '.000').padEnd(4, '0')}Z`
  readCanonicalTimestamp(local)
  const offset = match[4]
  if (offset !== 'Z' && (Number(offset.slice(1, 3)) > 23 || Number(offset.slice(4)) > 59)) invalidQuote()
  const timestamp = new Date(value)
  if (!Number.isFinite(timestamp.getTime())) invalidQuote()
  return readCanonicalTimestamp(timestamp.toISOString())
}

export function readStoredBlueDollarQuote(value: unknown): BlueDollarQuote {
  const quote = readRecord(value)
  if (quote.source !== 'DolarAPI' || quote.market !== 'blue' || quote.side !== 'sell') invalidQuote()
  if (typeof quote.rate !== 'string') invalidQuote()
  const rate = parseExchangeRate(quote.rate)
  if (!rate.ok || rate.normalized !== quote.rate) invalidQuote()
  const updatedAt = readCanonicalTimestamp(quote.updatedAt)
  const fetchedAt = readCanonicalTimestamp(quote.fetchedAt)
  if (Date.parse(updatedAt) > Date.parse(fetchedAt) + CLOCK_TOLERANCE_MS) invalidQuote()
  return { rate: quote.rate, source: 'DolarAPI', market: 'blue', side: 'sell', updatedAt, fetchedAt }
}

export function parseBlueDollarQuote(value: unknown, now = Date.now()): BlueDollarQuote {
  const quote = readStoredBlueDollarQuote(value)
  if (!Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) invalidQuote()
  const updatedAt = Date.parse(quote.updatedAt)
  const fetchedAt = Date.parse(quote.fetchedAt)
  if (updatedAt > now + CLOCK_TOLERANCE_MS || fetchedAt > now + CLOCK_TOLERANCE_MS
    || updatedAt < now - EXCHANGE_QUOTE_MAX_AGE_MS) invalidQuote()
  return quote
}

export function parseDolarApiQuote(value: unknown, now = Date.now()): BlueDollarQuote {
  const quote = readRecord(value)
  if (quote.moneda !== 'USD' || quote.casa !== 'blue'
    || typeof quote.venta !== 'number' || !Number.isFinite(quote.venta) || quote.venta <= 0) invalidQuote()
  // Use the number's exact decimal representation instead of multiplying or rounding it.
  const decimal = String(quote.venta)
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(decimal)) invalidQuote()
  const rate = parseExchangeRate(decimal.replace('.', ','))
  if (!rate.ok || !Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) invalidQuote()
  return parseBlueDollarQuote({
    rate: rate.normalized, source: 'DolarAPI', market: 'blue', side: 'sell',
    updatedAt: readSourceTimestamp(quote.fechaActualizacion), fetchedAt: new Date(now).toISOString(),
  }, now)
}

async function readQuoteResponse(response: Response, signal: AbortSignal): Promise<unknown> {
  const length = response.headers.get('content-length')
  if (length !== null && /^\d+$/.test(length) && Number(length) > EXCHANGE_QUOTE_MAX_BYTES) throw new Error(LOAD_ERROR)
  if (!response.body) throw new Error(LOAD_ERROR)
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let byteLength = 0
  const cancel = () => { void reader.cancel().catch(() => undefined) }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    while (true) {
      signal.throwIfAborted()
      const { done, value } = await reader.read()
      signal.throwIfAborted()
      if (done) break
      byteLength += value.byteLength
      if (byteLength > EXCHANGE_QUOTE_MAX_BYTES) {
        cancel()
        throw new Error(LOAD_ERROR)
      }
      chunks.push(value)
    }
  } finally {
    signal.removeEventListener('abort', cancel)
    reader.releaseLock()
  }
  const bytes = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
}

export async function loadBlueDollarQuote(signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<BlueDollarQuote> {
  let response: Response | undefined
  try {
    signal.throwIfAborted()
    response = await fetcher('/api/exchange-rate', {
      method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal,
    })
    signal.throwIfAborted()
    if (!response.ok || response.redirected) throw new Error(LOAD_ERROR)
    const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()
    if (contentType !== 'application/json' && !/^application\/[a-z0-9.+-]+\+json$/.test(contentType ?? '')) throw new Error(LOAD_ERROR)
    return parseBlueDollarQuote(await readQuoteResponse(response, signal))
  } catch {
    if (response?.body && !response.body.locked) void response.body.cancel().catch(() => undefined)
    if (signal.aborted) throw new DOMException('La consulta del dólar fue cancelada.', 'AbortError')
    throw new Error(LOAD_ERROR)
  }
}

export function exchangeRateDescription(quotation: Pick<Quotation, 'exchangeRate' | 'exchangeRateQuote'>): string {
  const rate = parseExchangeRate(quotation.exchangeRate ?? '')
  if (!rate.ok) return 'Cotización pendiente'
  const metadata = quotation.exchangeRateQuote
  if (metadata) {
    const sourceRate = parseExchangeRate(metadata.rate)
    if (sourceRate.ok && rate.numerator * sourceRate.denominator === sourceRate.numerator * rate.denominator) {
      return `Dólar blue · Venta · DolarAPI · ${dateFormatter.format(new Date(metadata.updatedAt))} (Buenos Aires)`
    }
  }
  return 'Cotización manual · Fecha no registrada'
}
