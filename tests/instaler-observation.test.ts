import assert from 'node:assert/strict'
import { test } from 'node:test'
import { InstalerSourceError, INSTALER_SOURCE_MAX_AGE_MS } from '../src/server/instaler-source.ts'
import {
  compareObservations, InstalerObservationError, parseObservationState, runInstalerObservation,
  type InstalerObservationState, type ObservationSnapshot,
} from '../src/server/instaler-observation.ts'
import {
  InstalerObservationStoreError, type InstalerObservationStore,
} from '../src/server/instaler-observation-store.ts'

const binding = { fileId: 'synthetic-drive-file', expectedEmail: 'workshop@example.invalid' }
const day = (value: number) => `2026-10-${String(value).padStart(2, '0')}T10:00:00.000Z`

function snapshot(date: string, rows: unknown[][] = [['SYN-A', 'Synthetic product', '100', '1.25', 'Synthetic']]): ObservationSnapshot {
  return {
    readAt: date, modifiedTime: '2026-10-01T00:00:00.000Z',
    table: {
      source: { document: 'Synthetic.xlsx', checksum: 'a'.repeat(64), version: '1' },
      headerRow: 1, headers: ['SKU', 'DESCRIPCION', 'PRECIO', 'STOCK', 'CATEGORIA'],
      rows: rows.map((values, index) => ({ row: index + 2, values })),
    },
  }
}

class MemoryStore implements InstalerObservationStore {
  text: string | null = null
  etag = 0
  writes = 0
  async read() { return this.text === null ? null : { text: this.text, etag: String(this.etag) } }
  async write(text: string, expected: string | null) {
    if (expected !== (this.text === null ? null : String(this.etag))) throw new InstalerObservationStoreError('conflict')
    this.text = text
    this.writes++
    return String(++this.etag)
  }
  state(): InstalerObservationState { return parseObservationState(this.text!, binding) }
}

function run(store: MemoryStore, value: ObservationSnapshot, read = async () => value) {
  return runInstalerObservation(binding, store, read, () => new Date(value.readAt))
}

test('baseline is private observation evidence, preserving unknowns and decimal stock without publishing', async () => {
  const store = new MemoryStore()
  const value = snapshot(day(1), [
    ['SYN-A', 'Synthetic product', '100', '1.25', 'Synthetic'],
    ['SYN-B', 'Unknown stock', null, null, 'Synthetic'],
    ['SYN-C', 'Zero stock', '0', '0', 'Synthetic'],
  ])
  const before = JSON.stringify(value)
  assert.deepEqual(await run(store, value), {
    mode: 'observe', publicationAllowed: false, supplierFreshnessEstablished: false, status: 'baseline', readAt: day(1),
    summary: { items: 3, issues: 2, duplicateSkus: 0, priceChanges: 0, stockChanges: 0, additions: 0, absent: 0, otherChanged: 0 },
  })
  const state = store.state()
  assert.equal(state.previous, null)
  assert.equal(state.lease, null)
  assert.equal(state.publicationAllowed, false)
  assert.equal(state.supplierFreshnessEstablished, false)
  assert.deepEqual(state.current?.table.rows.map((row) => row.values[3]), ['1.25', null, '0'])
  assert.equal(JSON.stringify(value), before)
  assert.equal(store.writes, 2)
})

test('push preserves the actual source read time before receipt within the maximum age', async () => {
  const store = new MemoryStore()
  const receivedAt = new Date(Date.parse(day(1)) + INSTALER_SOURCE_MAX_AGE_MS)
  const result = await runInstalerObservation(binding, store, async () => snapshot(day(1)), () => receivedAt)
  assert.equal(result.status, 'baseline')
  assert.equal(result.readAt, day(1))
  assert.equal(store.state().current?.readAt, day(1))
  assert.equal(store.state().history[0].startedAt, receivedAt.toISOString())
})

test('old or future source readings fail without replacing the last successful table', async () => {
  for (const offset of [-INSTALER_SOURCE_MAX_AGE_MS - 1, 1]) {
    const store = new MemoryStore()
    await run(store, snapshot(day(1)))
    const before = store.state().current
    const receivedAt = new Date(day(2))
    const readAt = new Date(receivedAt.getTime() + offset).toISOString()
    const result = await runInstalerObservation(binding, store, async () => snapshot(readAt), () => receivedAt)
    assert.equal(result.status, 'failed')
    assert.equal(result.error, 'source-invalid')
    assert.deepEqual(store.state().current, before)
    assert.equal(store.state().lease, null)
  }
})

test('a recent but out-of-order upload across midnight cannot replace a newer baseline', async () => {
  const store = new MemoryStore()
  const baselineAt = '2026-10-01T23:59:50.000Z'
  await run(store, snapshot(baselineAt))
  const before = store.state().current
  const result = await runInstalerObservation(binding, store,
    async () => snapshot('2026-10-01T23:59:40.000Z'), () => new Date('2026-10-02T00:00:10.000Z'))
  assert.equal(result.status, 'failed')
  assert.deepEqual(store.state().current, before)
  assert.equal(store.state().previous, null)
})

test('daily comparisons distinguish price, zero/missing/decimal stock and preserve last meaningful differences', async () => {
  const store = new MemoryStore()
  await run(store, snapshot(day(1)))
  const changed = snapshot(day(2), [['SYN-A', 'Synthetic product', '101.25', '0', 'Synthetic']])
  const result = await run(store, changed)
  assert.equal(result.status, 'changed')
  assert.equal(result.summary?.priceChanges, 1)
  assert.equal(result.summary?.stockChanges, 1)
  assert.deepEqual(store.state().lastDifference?.prices, [{ sku: 'SYN-A', before: '100', after: '101.25' }])
  assert.deepEqual(store.state().lastDifference?.stock, [{ sku: 'SYN-A', before: 1.25, after: 0 }])
  const same = snapshot(day(3), [['SYN-A', 'Synthetic product', '101.2500', '0.00', 'Synthetic']])
  same.table.source.version = '99'
  same.table.source.checksum = 'b'.repeat(64)
  assert.equal((await run(store, same)).status, 'unchanged')
  assert.equal(store.state().lastDifference?.readAt, day(2))
  assert.equal(store.state().lastPriceChangeAt, day(2))
  assert.equal(store.state().lastStockChangeAt, day(2))
  assert.equal(store.state().previous?.readAt, day(2))
  const unknown = snapshot(day(4), [['SYN-A', 'Synthetic product', '101.25', null, 'Synthetic']])
  await run(store, unknown)
  assert.deepEqual(store.state().lastDifference?.stock, [{ sku: 'SYN-A', before: 0, after: null }])
})

test('duplicate identities from either reading never choose a row for price/stock or manufacture additions', () => {
  const previous = snapshot(day(1), [
    ['SYN-A', 'Duplicate first', '100', '1', 'Synthetic'],
    ['syn-a', 'Duplicate second', '999', '8', 'Synthetic'],
    ['SYN-B', 'Unique', '200', '2', 'Synthetic'],
  ])
  const current = snapshot(day(2), [
    ['SYN-A', 'Unique today', '300', '4', 'Synthetic'],
    ['SYN-B', 'Unique', '201', '2.5', 'Synthetic'],
  ])
  const compared = compareObservations(current, previous)
  assert.equal(compared.summary.priceChanges, 1)
  assert.equal(compared.summary.stockChanges, 1)
  assert.equal(compared.summary.additions, 0)
  assert.deepEqual(compared.difference?.excludedDuplicateSkus, ['SYN-A'])
  assert.equal(compared.difference?.prices[0].sku, 'SYN-B')
  const reversed = compareObservations(previous, current)
  assert.equal(reversed.summary.duplicateSkus, 1)
  assert.equal(reversed.summary.absent, 0)
  assert.equal(reversed.difference?.prices[0].sku, 'SYN-B')
})

test('additions and absences are review findings and do not mutate or delete the preceding reading', () => {
  const previous = snapshot(day(1))
  const before = JSON.stringify(previous)
  const compared = compareObservations(snapshot(day(2), [['SYN-B', 'New product', '2', '-1.5', 'Synthetic']]), previous)
  assert.deepEqual(compared.difference?.additions, ['SYN-B'])
  assert.deepEqual(compared.difference?.absent, ['SYN-A'])
  assert.equal(JSON.stringify(previous), before)
})

test('read/access failure retains both successful readings and never advances last price or stock changes', async () => {
  const store = new MemoryStore()
  await run(store, snapshot(day(1)))
  await run(store, snapshot(day(2), [['SYN-A', 'Synthetic product', '101', '2', 'Synthetic']]))
  const before = store.state()
  const result = await run(store, snapshot(day(3)), async () => { throw new InstalerSourceError('oauth') })
  const after = store.state()
  assert.equal(result.status, 'failed')
  assert.equal(result.error, 'oauth')
  assert.deepEqual(after.current, before.current)
  assert.deepEqual(after.previous, before.previous)
  assert.deepEqual(after.lastDifference, before.lastDifference)
  assert.equal(after.lastStockChangeAt, before.lastStockChangeAt)
  assert.equal(after.lease, null)
  assert.equal(after.history.at(-1)?.status, 'failed')
})

test('header drift and malformed cached data cannot replace the last successful snapshot', async () => {
  const store = new MemoryStore()
  await run(store, snapshot(day(1)))
  const value = snapshot(day(2))
  value.table.headers[2] = 'COST'
  const result = await run(store, value)
  assert.equal(result.status, 'failed')
  assert.equal(result.error, 'source-invalid')
  assert.equal(store.state().current?.readAt, day(1))
})

test('same UTC day is processed once, including failure, without another callback or state write', async () => {
  const store = new MemoryStore()
  await run(store, snapshot(day(1)), async () => { throw new InstalerSourceError('access') })
  const writes = store.writes
  const result = await run(store, snapshot(day(1)), async () => { assert.fail('Must not process another upload') })
  assert.equal(result.status, 'already-attempted')
  assert.equal(store.writes, writes)
})

test('concurrent execution acquires one lease before processing and rejects a stale final write', async () => {
  const store = new MemoryStore()
  let resume!: () => void
  const pending = new Promise<void>((resolve) => { resume = resolve })
  const first = run(store, snapshot(day(1)), async () => {
    await pending
    return snapshot(day(1))
  })
  await new Promise((resolve) => setImmediate(resolve))
  const second = await run(store, snapshot(day(1)), async () => { assert.fail('Lease must prevent a second read') })
  assert.equal(second.status, 'busy')
  store.etag++
  const before = store.text
  resume()
  await assert.rejects(first, (error) => error instanceof InstalerObservationError && error.code === 'conflict')
  assert.equal(store.text, before)
})

test('expired lease recovers the last good baseline on the next day', async () => {
  const store = new MemoryStore()
  await run(store, snapshot(day(1)))
  const state = store.state()
  state.lease = { id: 'abandoned', expiresAt: '2026-10-01T10:03:00.000Z' }
  store.text = JSON.stringify(state)
  assert.equal((await run(store, snapshot(day(2)))).status, 'unchanged')
  assert.equal(store.state().lease, null)
})

test('state is bound to one file/account and malformed bytes are preserved without source calls or writes', async () => {
  const store = new MemoryStore()
  await run(store, snapshot(day(1)))
  const before = store.text
  await assert.rejects(runInstalerObservation({ ...binding, fileId: 'different-source' }, store,
    async () => { assert.fail('Must not process another source') }, () => new Date(day(2))))
  assert.equal(store.text, before)
  store.text = '{not-json'
  const writes = store.writes
  await assert.rejects(run(store, snapshot(day(2)), async () => { assert.fail('Invalid state must fail closed') }))
  assert.equal(store.text, '{not-json')
  assert.equal(store.writes, writes)
})

test('history stays bounded at fourteen attempts without changing the last two reading policy', async () => {
  const store = new MemoryStore()
  for (let index = 1; index <= 20; index++) await run(store, snapshot(day(index)))
  const state = store.state()
  assert.equal(state.history.length, 14)
  assert.equal(state.history[0].startedAt, day(7))
  assert.equal(state.current?.readAt, day(20))
  assert.equal(state.previous?.readAt, day(19))
})

test('disjoint duplicate groups across two maximum-sized readings remain readable on following runs', async () => {
  const store = new MemoryStore()
  const rows = (prefix: string, price: string): unknown[][] => [
    ...Array.from({ length: 1999 }, (_, index) => [
      [`${prefix}-${index}`, 'Synthetic first', '10', '1', 'Synthetic'],
      [`${prefix}-${index}`, 'Synthetic second', '99', '9', 'Synthetic'],
    ]).flat(),
    ['UNIQUE', 'Synthetic unique', price, '1', 'Synthetic'],
  ]
  await run(store, snapshot(day(1), rows('OLD', '100')))
  const result = await run(store, snapshot(day(2), rows('NEW', '101')))
  assert.equal(result.status, 'changed')
  assert.equal(result.summary?.priceChanges, 1)
  assert.equal(store.state().lastDifference?.excludedDuplicateSkus.length, 3998)
  assert.equal((await run(store, snapshot(day(3), rows('NEW', '101')))).status, 'unchanged')
})
