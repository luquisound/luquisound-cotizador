import assert from 'node:assert/strict'
import test from 'node:test'
import {
  EXCHANGE_QUOTE_MAX_AGE_MS, EXCHANGE_QUOTE_MAX_BYTES, exchangeRateDescription,
  loadBlueDollarQuote, parseBlueDollarQuote, parseDolarApiQuote, readStoredBlueDollarQuote,
} from '../src/features/quotation/exchange-quote.ts'
import type { BlueDollarQuote } from '../src/features/quotation/exchange-quote.ts'

const NOW = Date.parse('2026-10-16T15:00:00.000Z')

function quoteFixture(now = NOW): BlueDollarQuote {
  return {
    rate: '1.234,56', source: 'DolarAPI', market: 'blue', side: 'sell',
    updatedAt: new Date(now - 60_000).toISOString(), fetchedAt: new Date(now).toISOString(),
  }
}

function sourceFixture(changes: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    moneda: 'USD', casa: 'blue', nombre: 'Blue', compra: 1200, venta: 1234.56,
    fechaActualizacion: '2026-10-16T14:59:00.000Z', ...changes,
  }
}

test('DolarAPI maps only USD blue venta and retains exact decimal precision', () => {
  for (const [venta, rate] of [
    [1234, '1.234'], [1234.56, '1.234,56'], [1234.123456, '1.234,123456'],
    [0.000001, '0,000001'], [Number.MAX_SAFE_INTEGER, '9.007.199.254.740.991'],
  ] as const) {
    assert.deepEqual(parseDolarApiQuote(sourceFixture({ venta, compra: -50, promedio: 'ignore' }), NOW), {
      ...quoteFixture(), rate,
    })
  }
})

test('DolarAPI rejects wrong markets, currencies and nonnumeric or unsafe sale rates', () => {
  const invalids = [
    null, [], {}, sourceFixture({ moneda: 'ARS' }), sourceFixture({ casa: 'oficial' }),
    ...[undefined, null, '1234.56', 0, -1, NaN, Infinity, -Infinity, 0.0000001,
      1234.1234567, Number.MAX_SAFE_INTEGER + 1, 1e30].map((venta) => sourceFixture({ venta })),
  ]
  for (const value of invalids) assert.throws(() => parseDolarApiQuote(value, NOW), /formato válido/)
})

test('source timestamps normalize explicit UTC offsets without accepting invented calendar dates', () => {
  for (const fechaActualizacion of ['2026-10-16T11:59:00-03:00', '2026-10-16T14:59:00Z', '2026-10-16T14:59:00.0Z']) {
    assert.equal(parseDolarApiQuote(sourceFixture({ fechaActualizacion }), NOW).updatedAt, quoteFixture().updatedAt)
  }
  for (const fechaActualizacion of [
    null, 0, '', '2026-10-16', '2026-02-30T12:00:00Z', '2026-10-16T14:59:00',
    '2026-10-16T24:00:00Z', '2026-10-16T14:59:00.0000Z', '2026-10-16T14:59:00+24:00',
  ]) assert.throws(() => parseDolarApiQuote(sourceFixture({ fechaActualizacion }), NOW), /formato válido/)
})

test('network validation rejects stale and future quotes while allowing a bounded clock skew', () => {
  const quote = quoteFixture()
  assert.deepEqual(parseBlueDollarQuote(quote, NOW), quote)
  assert.equal(parseBlueDollarQuote({ ...quote, updatedAt: new Date(NOW - EXCHANGE_QUOTE_MAX_AGE_MS).toISOString() }, NOW).rate, quote.rate)
  assert.equal(parseBlueDollarQuote({ ...quote, updatedAt: new Date(NOW + 300_000).toISOString() }, NOW).rate, quote.rate)
  for (const value of [
    { ...quote, updatedAt: new Date(NOW - EXCHANGE_QUOTE_MAX_AGE_MS - 1).toISOString() },
    { ...quote, updatedAt: new Date(NOW + 300_001).toISOString() },
    { ...quote, fetchedAt: new Date(NOW + 300_001).toISOString() },
  ]) assert.throws(() => parseBlueDollarQuote(value, NOW), /desactualizada/)
  assert.throws(() => parseBlueDollarQuote(quote, NaN), /formato válido/)
})

test('stored quote validation accepts historical snapshots and strips unknown properties', () => {
  const historical = quoteFixture(Date.parse('2023-01-10T15:00:00.000Z'))
  assert.deepEqual(readStoredBlueDollarQuote({ ...historical, secret: 'discard' }), historical)
  assert.throws(() => parseBlueDollarQuote(historical, NOW), /desactualizada/)
  assert.notEqual(readStoredBlueDollarQuote(historical), historical)
})

test('normalized metadata requires fixed provenance, canonical rates and real UTC timestamps', () => {
  const quote = quoteFixture()
  for (const value of [
    null, [], {}, { ...quote, source: 'Other' }, { ...quote, market: 'oficial' }, { ...quote, side: 'buy' },
    ...['', '0', '1234,56', ' 1.234,56 ', '1.234,1234567'].map((rate) => ({ ...quote, rate })),
    ...[undefined, '', '2026-02-30T14:00:00.000Z', '2026-10-16T14:59:00Z', '2026-10-16T14:59:00.000+00:00']
      .flatMap((date) => [{ ...quote, updatedAt: date }, { ...quote, fetchedAt: date }]),
    { ...quote, updatedAt: '2026-10-17T15:00:00.000Z' },
  ]) assert.throws(() => readStoredBlueDollarQuote(value), /formato válido/)
})

test('descriptions identify the source date in Buenos Aires and never invent provenance for manual rates', () => {
  const metadata = {
    ...quoteFixture(), updatedAt: '2026-10-16T20:58:00.000Z', fetchedAt: '2026-10-16T21:00:00.000Z',
  }
  const description = exchangeRateDescription({ exchangeRate: '1234,560000', exchangeRateQuote: metadata })
  assert.equal(description, 'Dólar blue · DolarAPI · 16/10/2026, 17:58 (Buenos Aires)')
  assert.equal(exchangeRateDescription({
    exchangeRate: '1.234,56', exchangeRateQuote: { ...metadata, updatedAt: '2026-10-16T02:30:00.000Z' },
  }), 'Dólar blue · DolarAPI · 15/10/2026, 23:30 (Buenos Aires)')
  assert.equal(exchangeRateDescription({ exchangeRate: '1.200', exchangeRateQuote: metadata }), 'Cotización manual · Fecha no registrada')
  assert.equal(exchangeRateDescription({ exchangeRate: '1.234,56' }), 'Cotización manual · Fecha no registrada')
  for (const exchangeRate of [undefined, '', '0', 'invalid']) {
    assert.equal(exchangeRateDescription({ exchangeRate }), 'Cotización pendiente')
  }
})

test('client fetches only the same-origin endpoint without caching or redirects', async () => {
  const controller = new AbortController()
  const quote = quoteFixture(Date.now())
  const fetcher: typeof fetch = async (input, init) => {
    assert.equal(input, '/api/exchange-rate')
    assert.deepEqual(init, {
      method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal,
    })
    return new Response(JSON.stringify({ ...quote, unknown: 'discard' }), { headers: { 'content-type': 'application/json; charset=utf-8' } })
  }
  assert.deepEqual(await loadBlueDollarQuote(controller.signal, fetcher), quote)
})

test('client rejects status, MIME, JSON and schema failures with a safe generic message', async () => {
  const responses = [
    new Response('private diagnostic', { status: 503 }),
    new Response('<html>private diagnostic</html>', { headers: { 'content-type': 'text/html' } }),
    new Response('{"private":"diagnostic"', { headers: { 'content-type': 'application/json' } }),
    new Response(JSON.stringify({ ...quoteFixture(Date.now()), side: 'buy', private: 'diagnostic' }), { headers: { 'content-type': 'application/json' } }),
    new Response(new Uint8Array([0xff]), { headers: { 'content-type': 'application/json' } }),
  ]
  for (const response of responses) {
    await assert.rejects(loadBlueDollarQuote(new AbortController().signal, async () => response), (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.match(error.message, /No se pudo consultar/)
      assert.doesNotMatch(error.message, /private|diagnostic/)
      return true
    })
  }
  await assert.rejects(loadBlueDollarQuote(new AbortController().signal, async () => { throw new Error('private diagnostic') }), /No se pudo consultar/)
})

test('client bounds response bytes even when content-length is absent or misleading', async () => {
  let cancelled = false
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(EXCHANGE_QUOTE_MAX_BYTES + 1)) },
    cancel() { cancelled = true },
  })
  await assert.rejects(loadBlueDollarQuote(new AbortController().signal, async () => new Response(body, {
    headers: { 'content-type': 'application/json', 'content-length': '1' },
  })), /No se pudo consultar/)
  assert.equal(cancelled, true)
  await assert.rejects(loadBlueDollarQuote(new AbortController().signal, async () => new Response('{}', {
    headers: { 'content-type': 'application/json', 'content-length': String(EXCHANGE_QUOTE_MAX_BYTES + 1) },
  })), /No se pudo consultar/)
})

test('cancelled clients avoid fetch and abort a blocked response reader', async () => {
  const aborted = new AbortController()
  aborted.abort()
  await assert.rejects(loadBlueDollarQuote(aborted.signal, async () => {
    assert.fail('an aborted request must not fetch')
  }), { name: 'AbortError' })

  const controller = new AbortController()
  const response = new Response(new ReadableStream<Uint8Array>(), { headers: { 'content-type': 'application/json' } })
  const pending = loadBlueDollarQuote(controller.signal, async () => response)
  await Promise.resolve()
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
})
