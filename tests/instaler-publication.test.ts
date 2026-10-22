import assert from 'node:assert/strict'
import test from 'node:test'
import { publishInstalerCatalog, restoreInstalerCatalog, InstalerPublicationError } from '../src/server/instaler-publication.ts'
import { InstalerCatalogStoreError, type InstalerCatalogStore } from '../src/server/instaler-catalog-store.ts'
import type { ObservationSnapshot } from '../src/server/instaler-observation.ts'
import type { CatalogImportDocument } from '../src/features/quotation/catalog.ts'

const reading: ObservationSnapshot = {
  readAt: '2026-10-22T11:30:00.000Z', modifiedTime: '2026-10-20T00:00:00.000Z',
  table: {
    source: { document: 'Synthetic.xlsx', checksum: 'a'.repeat(64), version: '1' },
    headerRow: 1, headers: ['SKU', 'DESCRIPCION', 'PRECIO', 'STOCK', 'CATEGORIA'],
    rows: [{ row: 2, values: ['SYN-A', 'Synthetic product', '100', '1.5', 'Audio'] }],
  },
}
const now = new Date('2026-10-22T12:00:00.000Z')
const empty: CatalogImportDocument = { format: 'luquisound.catalog', version: 1, items: [] }

function memory(initial: CatalogImportDocument = empty) {
  let text = JSON.stringify(initial)
  let etag = '1'
  let policy: string | null = null
  const events: string[] = []
  const archives: string[] = []
  const store: InstalerCatalogStore = {
    async read() { events.push('read'); return { text, etag } },
    async readPolicy() { events.push('policy'); return policy },
    async archive(value) { events.push('archive'); archives.push(value) },
    async write(value, expected) {
      events.push('write')
      if (expected !== etag) throw new InstalerCatalogStoreError('conflict')
      text = value
      etag = String(Number(etag) + 1)
      return etag
    },
  }
  return { store, events, archives, text: () => text, etag: () => etag,
    setPolicy(value: string | null) { policy = value },
    replace(value: string) { text = value; etag = String(Number(etag) + 1) } }
}

test('publication archives exact previous bytes before one conditional write and repeated reading is a no-op', async () => {
  const state = memory()
  const original = state.text()
  const result = await publishInstalerCatalog(reading, state.store, now)
  assert.equal(result.status, 'published')
  assert.deepEqual(state.archives, [original])
  assert.ok(state.events.indexOf('archive') < state.events.indexOf('write'))
  const active = state.text()
  const parsed = JSON.parse(active)
  assert.equal(parsed.instalerObservation.readAt, reading.readAt)
  assert.equal(parsed.items[0].stock.checkedAt, null)
  assert.equal(parsed.items[0].source.date, null)
  assert.equal((await publishInstalerCatalog(reading, state.store, now)).status, 'unchanged')
  assert.equal(state.text(), active)
  assert.equal(state.events.filter((event) => event === 'write').length, 1)
})

test('a newly successful reading with unchanged values renews only read evidence', async () => {
  const state = memory()
  await publishInstalerCatalog(reading, state.store, now)
  const next = { ...reading, readAt: '2026-10-23T11:30:00.000Z' }
  assert.equal((await publishInstalerCatalog(next, state.store, new Date('2026-10-23T12:00:00.000Z'))).status, 'published')
  const row = JSON.parse(state.text()).items[0]
  assert.equal(row.listPrice.amount, '100')
  assert.equal(row.stock.quantity, 1.5)
  assert.equal(row.stock.source.readAt, next.readAt)
  assert.equal(row.stock.checkedAt, null)
})

test('invalid source, future reading and invalid policy preserve the current catalogue without an archive', async () => {
  for (const scenario of ['source', 'future', 'policy'] as const) {
    const state = memory()
    if (scenario === 'policy') state.setPolicy('{')
    const input = scenario === 'source' ? { ...reading, table: { ...reading.table, rows: [] } }
      : scenario === 'future' ? { ...reading, readAt: '2027-01-01T00:00:00.000Z' } : reading
    await assert.rejects(publishInstalerCatalog(input, state.store, now), InstalerPublicationError)
    assert.equal(state.text(), JSON.stringify(empty))
    assert.deepEqual(state.archives, [])
  }
})

test('a stale reading or conflicting checksum cannot replace a newer published observation', async () => {
  const state = memory()
  await publishInstalerCatalog(reading, state.store, now)
  const original = state.text()
  for (const input of [{ ...reading, readAt: '2026-10-21T11:30:00.000Z' },
    { ...reading, table: { ...reading.table, source: { ...reading.table.source, checksum: 'b'.repeat(64) } } }]) {
    await assert.rejects(publishInstalerCatalog(input, state.store, now), (error: unknown) =>
      error instanceof InstalerPublicationError && error.code === 'stale-observation')
    assert.equal(state.text(), original)
  }
})

test('an archive failure cannot write the active catalogue', async () => {
  const state = memory()
  state.store.archive = async () => { throw new InstalerCatalogStoreError('storage') }
  await assert.rejects(publishInstalerCatalog(reading, state.store, now), InstalerPublicationError)
  assert.ok(!state.events.includes('write'))
  assert.equal(state.text(), JSON.stringify(empty))
})

test('a concurrent writer wins without retries or unconditional overwrites', async () => {
  const state = memory()
  const external = JSON.stringify({ ...empty, refreshSuppliers: ['Other'] })
  state.store.archive = async () => { state.replace(external) }
  await assert.rejects(publishInstalerCatalog(reading, state.store, now), (error: unknown) =>
    error instanceof InstalerPublicationError && error.code === 'conflict')
  assert.equal(state.text(), external)
  assert.equal(state.events.filter((event) => event === 'write').length, 1)
})

test('an ambiguous response after a committed write is verified instead of retried', async () => {
  const state = memory()
  const write = state.store.write
  state.store.write = async (text, etag) => {
    await write(text, etag)
    throw new InstalerCatalogStoreError('storage')
  }
  assert.equal((await publishInstalerCatalog(reading, state.store, now)).status, 'published')
  assert.equal(state.events.filter((event) => event === 'write').length, 1)
})

test('policy changes during preparation prevent publication', async () => {
  const state = memory()
  state.store.archive = async () => { state.setPolicy('{"changed":true}') }
  await assert.rejects(publishInstalerCatalog(reading, state.store, now), (error: unknown) =>
    error instanceof InstalerPublicationError && error.code === 'conflict')
  assert.equal(state.text(), JSON.stringify(empty))
  assert.ok(!state.events.includes('write'))
})

test('a restore requires the inspected active ETag and archives before restoring exact bytes', async () => {
  const state = memory()
  const original = state.text()
  await publishInstalerCatalog(reading, state.store, now)
  const published = state.text()
  await assert.rejects(restoreInstalerCatalog(original, '1', state.store), InstalerPublicationError)
  assert.equal(state.text(), published)
  await restoreInstalerCatalog(original, state.etag(), state.store)
  assert.equal(state.text(), original)
  assert.equal(state.archives.at(-1), published)
})

test('a corrupt restore document is rejected before any storage operation', async () => {
  const state = memory()
  await assert.rejects(restoreInstalerCatalog('{', state.etag(), state.store), InstalerPublicationError)
  assert.deepEqual(state.events, [])
})

test('explicit recovery preserves corrupt bytes before CAS and cannot overwrite a later version', async () => {
  for (const conflict of [false, true]) {
    const state = memory()
    const validRead = state.store.read
    const corrupt = '{broken private catalogue'
    let repaired = false
    const preserved: string[] = []
    state.store.read = async () => {
      if (!repaired) throw new InstalerCatalogStoreError('storage')
      return validRead()
    }
    state.store.readForRecovery = async () => ({ text: corrupt, etag: conflict ? 'later-version' : state.etag() })
    state.store.quarantine = async (text) => { preserved.push(text) }
    const write = state.store.write
    state.store.write = async (text, etag) => {
      assert.deepEqual(preserved, [corrupt])
      repaired = true
      return write(text, etag)
    }
    if (conflict) {
      await assert.rejects(restoreInstalerCatalog(JSON.stringify(empty), state.etag(), state.store), (error: unknown) =>
        error instanceof InstalerPublicationError && error.code === 'conflict')
      assert.deepEqual(preserved, [])
      assert.ok(!state.events.includes('write'))
    } else {
      await restoreInstalerCatalog(JSON.stringify(empty), state.etag(), state.store)
      assert.deepEqual(preserved, [corrupt])
      assert.equal(state.text(), JSON.stringify(empty))
    }
  }
})
