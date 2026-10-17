import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate } from 'node:timers/promises'
import { EXCHANGE_QUOTE_CACHE_TTL_MS, type BlueDollarQuote } from '../src/features/quotation/exchange-quote.ts'
import { startExchangeRateRefresh, type ExchangeRefreshState } from '../src/features/quotation/exchange-refresh.ts'

const NOW = Date.parse('2026-10-16T15:00:00.000Z')
const HOUR = EXCHANGE_QUOTE_CACHE_TTL_MS

function quote(rate = '1.234,56', fetchedAt = NOW): BlueDollarQuote {
  return {
    rate, source: 'DolarAPI', market: 'blue', side: 'sell',
    updatedAt: new Date(fetchedAt).toISOString(), fetchedAt: new Date(fetchedAt).toISOString(),
  }
}

test('a missing rate loads automatically and overlapping checks share the pending request', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: NOW })
  let requests = 0
  let resolve: (value: BlueDollarQuote) => void = () => assert.fail('Missing resolver.')
  const applied: BlueDollarQuote[] = []
  const states: ExchangeRefreshState[] = []
  const refresh = startExchangeRateRefresh({
    isActive: () => true,
    loadQuote: async () => { requests++; return new Promise((complete) => { resolve = complete }) },
    onQuote: (value) => { applied.push(value); return true },
    onState: (state) => states.push(state),
  })
  context.after(() => refresh.stop())
  refresh.check()
  refresh.check()
  assert.equal(requests, 1)
  assert.deepEqual(states, [{ loading: true, error: null }])
  resolve(quote())
  await setImmediate()
  assert.deepEqual(applied, [quote()])
  assert.deepEqual(states.at(-1), { loading: false, error: null })
})

test('a saved rate refreshes at its fetch-hour boundary and continues every hour', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: NOW + HOUR / 2 })
  let requests = 0
  const applied: BlueDollarQuote[] = []
  const refresh = startExchangeRateRefresh({
    initialQuote: quote(), isActive: () => true,
    loadQuote: async () => { requests++; return quote('2.000', Date.now()) },
    onQuote: (value) => { applied.push(value); return true }, onState: () => {},
  })
  context.after(() => refresh.stop())
  refresh.check()
  assert.equal(requests, 0)
  context.mock.timers.tick(HOUR / 2 - 1)
  assert.equal(requests, 0)
  context.mock.timers.tick(1)
  await setImmediate()
  assert.equal(requests, 1)
  assert.equal(applied[0]?.rate, '2.000')
  context.mock.timers.tick(HOUR)
  await setImmediate()
  assert.equal(requests, 2)
})

test('reopening an expired rate or a future-dated snapshot consults automatically', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: NOW })
  for (const initialQuote of [quote('1.000', NOW - 2 * HOUR), quote('1.000', NOW + HOUR)]) {
    let applied: BlueDollarQuote | undefined
    const refresh = startExchangeRateRefresh({
      initialQuote, isActive: () => true, loadQuote: async () => quote(),
      onQuote: (value) => { applied = value; return true }, onState: () => {},
    })
    await setImmediate()
    assert.equal(applied?.rate, '1.234,56')
    refresh.stop()
  }
})

test('hidden or offline apps wait until active and resume overdue refresh without duplicates', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: NOW })
  let active = false
  let requests = 0
  const refresh = startExchangeRateRefresh({
    initialQuote: quote(), isActive: () => active,
    loadQuote: async () => { requests++; return quote('2.000', Date.now()) },
    onQuote: () => true, onState: () => {},
  })
  context.after(() => refresh.stop())
  context.mock.timers.tick(2 * HOUR)
  refresh.check()
  assert.equal(requests, 0)
  active = true
  refresh.check()
  refresh.check()
  await setImmediate()
  assert.equal(requests, 1)
  refresh.check()
  assert.equal(requests, 1)
  active = false
  refresh.check()
  context.mock.timers.tick(HOUR)
  assert.equal(requests, 1)
  active = true
  refresh.check()
  await setImmediate()
  assert.equal(requests, 2)
})

test('failures preserve the saved rate and retry automatically on the next hour', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: NOW })
  let requests = 0
  let current = quote('1.000', NOW - HOUR)
  const states: ExchangeRefreshState[] = []
  const refresh = startExchangeRateRefresh({
    initialQuote: current, isActive: () => true,
    loadQuote: async () => { if (++requests === 1) throw new Error('Private failure'); return quote('2.000', Date.now()) },
    onQuote: (value) => { current = value; return true }, onState: (state) => states.push(state),
  })
  context.after(() => refresh.stop())
  await setImmediate()
  assert.equal(current.rate, '1.000')
  assert.match(states.at(-1)?.error ?? '', /reintentará automáticamente/)
  assert.doesNotMatch(states.at(-1)?.error ?? '', /Private failure/)
  refresh.check()
  context.mock.timers.tick(HOUR - 1)
  assert.equal(requests, 1)
  context.mock.timers.tick(1)
  await setImmediate()
  assert.equal(requests, 2)
  assert.equal(current.rate, '2.000')
  assert.deepEqual(states.at(-1), { loading: false, error: null })
})

test('stopping an old quotation aborts and ignores a response that arrives after switching', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: NOW })
  let signal: AbortSignal | undefined
  let resolve: (value: BlueDollarQuote) => void = () => assert.fail('Missing resolver.')
  let applied = false
  const states: ExchangeRefreshState[] = []
  const refresh = startExchangeRateRefresh({
    isActive: () => true,
    loadQuote: async (requestSignal) => { signal = requestSignal; return new Promise((complete) => { resolve = complete }) },
    onQuote: () => { applied = true; return true }, onState: (state) => states.push(state),
  })
  refresh.stop()
  assert.equal(signal?.aborted, true)
  resolve(quote())
  await setImmediate()
  context.mock.timers.tick(2 * HOUR)
  assert.equal(applied, false)
  assert.deepEqual(states, [{ loading: true, error: null }])
})

test('an unresponsive lookup times out visibly and a rejected local update cannot report success', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: NOW })
  let signal: AbortSignal | undefined
  const states: ExchangeRefreshState[] = []
  const refresh = startExchangeRateRefresh({
    isActive: () => true,
    loadQuote: async (requestSignal) => { signal = requestSignal; return new Promise(() => {}) },
    onQuote: () => assert.fail('Timed out response must not apply.'), onState: (state) => states.push(state),
  })
  context.mock.timers.tick(12000)
  await setImmediate()
  assert.equal(signal?.aborted, true)
  assert.equal(states.at(-1)?.loading, false)
  assert.ok(states.at(-1)?.error)
  refresh.stop()
  const rejected = startExchangeRateRefresh({
    isActive: () => true, loadQuote: async () => quote(), onQuote: () => false,
    onState: (state) => states.push(state),
  })
  await setImmediate()
  assert.equal(states.at(-1)?.loading, false)
  assert.ok(states.at(-1)?.error)
  rejected.stop()
})

test('an unexpectedly expired server response cannot trigger a tight request loop', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: NOW })
  let requests = 0
  const refresh = startExchangeRateRefresh({
    isActive: () => true, loadQuote: async () => { requests++; return quote('1.000', NOW - HOUR) },
    onQuote: () => true, onState: () => {},
  })
  context.after(() => refresh.stop())
  await setImmediate()
  refresh.check()
  context.mock.timers.tick(59999)
  assert.equal(requests, 1)
  context.mock.timers.tick(1)
  await setImmediate()
  assert.equal(requests, 2)
})
