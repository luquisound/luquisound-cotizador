import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate } from 'node:timers/promises'
import type { CatalogImportDocument } from '../src/features/quotation/catalog.ts'
import {
  getCatalogRefreshCycle, startCatalogRefresh, type CatalogRefreshStatus,
} from '../src/features/quotation/catalog-refresh.ts'
import { createQuotation } from '../src/features/quotation/model.ts'
import { mergeSharedCatalog } from '../src/features/quotation/shared-catalog.ts'

const DAY = 24 * 60 * 60 * 1000
const HOUR = DAY / 24
const NINE = Date.parse('2026-10-22T12:00:00.000Z')

function document(name = 'Synthetic speaker'): CatalogImportDocument {
  return {
    format: 'luquisound.catalog', version: 1,
    items: [{
      supplier: 'Synthetic supplier', sku: 'SYN-001', name, section: 'equipment',
      brand: 'Synthetic brand', category: 'Synthetic audio', description: '', referencePrices: [],
    }],
  }
}

test('daily cycles use 09:00 Buenos Aires across midnight, month and year boundaries', () => {
  for (const date of ['2026-10-22', '2026-01-01', '2026-07-01', '2028-03-01']) {
    const nine = Date.parse(`${date}T12:00:00.000Z`)
    assert.deepEqual(getCatalogRefreshCycle(nine - 1), { startedAt: nine - DAY, nextAt: nine })
    assert.deepEqual(getCatalogRefreshCycle(nine), { startedAt: nine, nextAt: nine + DAY })
    assert.deepEqual(getCatalogRefreshCycle(nine + 15 * HOUR), { startedAt: nine, nextAt: nine + DAY })
  }
})

test('mount loads immediately, overlapping checks share one request and the next load waits for 09:00', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: NINE - HOUR })
  let requests = 0
  let resolve: (value: CatalogImportDocument) => void = () => assert.fail('Missing resolver.')
  const applied: CatalogImportDocument[] = []
  const states: CatalogRefreshStatus[] = []
  const refresh = startCatalogRefresh({
    isActive: () => true,
    loadCatalog: async () => {
      requests++
      return new Promise((complete) => { resolve = complete })
    },
    onCatalog: (value) => { applied.push(value); return true },
    onStatus: (state) => states.push(state),
  })
  context.after(() => refresh.stop())
  refresh.check()
  refresh.check()
  assert.equal(requests, 1)
  resolve(document())
  await setImmediate()
  assert.deepEqual(applied, [document()])
  assert.deepEqual(states, ['loading', 'ready'])
  context.mock.timers.tick(HOUR - 1)
  refresh.check()
  assert.equal(requests, 1)
  context.mock.timers.tick(1)
  assert.equal(requests, 2)
  resolve(document('Updated synthetic speaker'))
  await setImmediate()
  context.mock.timers.tick(HOUR)
  refresh.check()
  assert.equal(requests, 2)
  context.mock.timers.tick(DAY - HOUR)
  assert.equal(requests, 3)
})

test('mount after 09:00 consumes the current cycle without a later hourly refresh', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: NINE + 2 * HOUR })
  let requests = 0
  const refresh = startCatalogRefresh({
    isActive: () => true,
    loadCatalog: async () => { requests++; return document() },
    onCatalog: () => true, onStatus: () => {},
  })
  context.after(() => refresh.stop())
  await setImmediate()
  for (let hour = 0; hour < 21; hour++) {
    context.mock.timers.tick(HOUR)
    refresh.check()
  }
  assert.equal(requests, 1)
  context.mock.timers.tick(HOUR)
  await setImmediate()
  assert.equal(requests, 2)
})

test('hidden or offline mounts wait and resuming after missed days makes one current-cycle request', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: NINE })
  let visible = false
  let online = true
  let requests = 0
  const refresh = startCatalogRefresh({
    isActive: () => visible && online,
    loadCatalog: async () => { requests++; return document() },
    onCatalog: () => true, onStatus: () => {},
  })
  context.after(() => refresh.stop())
  context.mock.timers.tick(2 * DAY)
  visible = true
  online = false
  refresh.check()
  assert.equal(requests, 0)
  online = true
  refresh.check()
  refresh.check()
  await setImmediate()
  assert.equal(requests, 1)
  visible = false
  refresh.check()
  context.mock.timers.tick(3 * DAY)
  assert.equal(requests, 1)
  visible = true
  refresh.check()
  await setImmediate()
  assert.equal(requests, 2)
  refresh.check()
  assert.equal(requests, 2)
})

test('failure keeps the preceding catalogue and does not retry on focus or reconnection until the next cycle', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: NINE + HOUR })
  let requests = 0
  let active = true
  let current = document('Saved synthetic speaker')
  const original = structuredClone(current)
  const states: CatalogRefreshStatus[] = []
  const refresh = startCatalogRefresh({
    isActive: () => active,
    loadCatalog: async () => {
      if (++requests === 1) throw new Error('Private failure')
      return document('Updated synthetic speaker')
    },
    onCatalog: (value) => { current = value; return true },
    onStatus: (state) => states.push(state),
  })
  context.after(() => refresh.stop())
  await setImmediate()
  assert.deepEqual(current, original)
  assert.deepEqual(states, ['loading', 'error'])
  for (let attempt = 0; attempt < 3; attempt++) {
    active = false
    refresh.check()
    active = true
    refresh.check()
  }
  context.mock.timers.tick(DAY - HOUR - 1)
  assert.equal(requests, 1)
  context.mock.timers.tick(1)
  await setImmediate()
  assert.equal(requests, 2)
  assert.equal(current.items[0].name, 'Updated synthetic speaker')
  assert.equal(states.at(-1), 'ready')
})

test('a missing endpoint or rejected local merge waits for the next daily cycle too', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: NINE })
  for (const incoming of [null, document()]) {
    let requests = 0
    let applied = 0
    const states: CatalogRefreshStatus[] = []
    const refresh = startCatalogRefresh({
      isActive: () => true,
      loadCatalog: async () => { requests++; return incoming },
      onCatalog: () => { applied++; return false },
      onStatus: (state) => states.push(state),
    })
    await setImmediate()
    assert.equal(states.at(-1), incoming === null ? 'unavailable' : 'error')
    assert.equal(applied, incoming === null ? 0 : 1)
    refresh.check()
    context.mock.timers.tick(HOUR)
    assert.equal(requests, 1)
    refresh.stop()
  }
})

test('a timeout aborts once, consumes the daily attempt and ignores a late response', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: NINE })
  let signal: AbortSignal | undefined
  let resolve: (value: CatalogImportDocument) => void = () => assert.fail('Missing resolver.')
  let requests = 0
  const applied: CatalogImportDocument[] = []
  const states: CatalogRefreshStatus[] = []
  const refresh = startCatalogRefresh({
    isActive: () => true,
    loadCatalog: async (requestSignal) => {
      requests++
      signal = requestSignal
      return new Promise((complete) => { resolve = complete })
    },
    onCatalog: (value) => { applied.push(value); return true },
    onStatus: (state) => states.push(state),
  })
  context.after(() => refresh.stop())
  context.mock.timers.tick(15000)
  await setImmediate()
  assert.equal(signal?.aborted, true)
  assert.deepEqual(states, ['loading', 'error'])
  resolve(document('Late synthetic speaker'))
  await setImmediate()
  assert.deepEqual(applied, [])
  refresh.check()
  assert.equal(requests, 1)
  context.mock.timers.tick(DAY - 15000)
  assert.equal(requests, 2)
  resolve(document('Current synthetic speaker'))
  await setImmediate()
  assert.deepEqual(applied, [document('Current synthetic speaker')])
})

test('stopping aborts pending work, clears timers and ignores old completion or later checks', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: NINE })
  let signal: AbortSignal | undefined
  let resolve: (value: CatalogImportDocument) => void = () => assert.fail('Missing resolver.')
  const states: CatalogRefreshStatus[] = []
  const refresh = startCatalogRefresh({
    isActive: () => true,
    loadCatalog: async (requestSignal) => {
      signal = requestSignal
      return new Promise((complete) => { resolve = complete })
    },
    onCatalog: () => assert.fail('Stopped catalogue must not apply.'),
    onStatus: (state) => states.push(state),
  })
  refresh.stop()
  assert.equal(signal?.aborted, true)
  resolve(document())
  await setImmediate()
  context.mock.timers.tick(2 * DAY)
  refresh.check()
  assert.deepEqual(states, ['loading'])
})

test('the latest local catalogue is merged after a pending read without changing quotations or manual amounts', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: NINE })
  let current = mergeSharedCatalog([], document())
  let resolve: (value: CatalogImportDocument) => void = () => assert.fail('Missing resolver.')
  const quotation = { ...createQuotation(), exchangeRate: '1.400', exchangeRateMode: 'frozen' as const }
  const library = [structuredClone(quotation)]
  const originalQuotation = structuredClone(quotation)
  const originalLibrary = structuredClone(library)
  const refresh = startCatalogRefresh({
    isActive: () => true,
    loadCatalog: async () => new Promise((complete) => { resolve = complete }),
    onCatalog: (value) => { current = mergeSharedCatalog(current, value); return true },
    onStatus: () => {},
  })
  context.after(() => refresh.stop())
  const id = current[0].id
  current = current.map((item) => ({ ...item, unitPrice: '12.345,67', currency: 'USD' }))
  resolve(document('Updated synthetic speaker'))
  await setImmediate()
  assert.equal(current[0].id, id)
  assert.equal(current[0].unitPrice, '12.345,67')
  assert.equal(current[0].currency, 'USD')
  assert.equal(current[0].concept, 'Updated synthetic speaker')
  assert.deepEqual(quotation, originalQuotation)
  assert.deepEqual(library, originalLibrary)
})
