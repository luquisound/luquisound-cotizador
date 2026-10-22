import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { serveInstalerObservation, type ObservationServerConfig } from '../api/instaler-observation.ts'
import { decodeInstalerObservationSource } from '../src/server/instaler-upload.ts'
import type { InstalerObservationStore } from '../src/server/instaler-observation-store.ts'
import { parseObservationState, type ObservationSnapshot } from '../src/server/instaler-observation.ts'
import type { InstalerCatalogStore } from '../src/server/instaler-catalog-store.ts'

const secret = 'synthetic-ingest-secret-at-least-32-characters'
const config: ObservationServerConfig = {
  environment: 'production', mode: 'observe', ingestSecret: secret, blobToken: 'synthetic-blob-token',
  expectedEmail: 'workshop@example.invalid', fileId: 'synthetic-drive-file',
}
const readAt = '2026-10-21T09:59:30.000Z'
const now = () => new Date('2026-10-21T10:00:00.000Z')
function payload() {
  const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3])
  return {
    format: 'luquisound.instaler-observation-upload', version: 1, mode: 'observe',
    fileId: config.fileId, account: config.expectedEmail, readAt,
    result: { status: 'ok', bytesBase64: bytes.toString('base64'), metadata: {
      id: config.fileId, name: 'Synthetic.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      size: String(bytes.length), md5Checksum: createHash('md5').update(bytes).digest('hex'),
      modifiedTime: '2026-10-20T00:00:00.000Z', version: '7', capabilities: { canDownload: true },
    } },
  }
}
function request(options: { path?: string; method?: string; authorization?: string; body?: unknown; media?: string } = {}) {
  const method = options.method ?? 'POST'
  return new Request(`https://example.invalid/api/instaler-observation${options.path ?? ''}`, {
    method, headers: { Authorization: options.authorization ?? `Bearer ${secret}`, 'Content-Type': options.media ?? 'application/json' },
    ...(method === 'GET' || method === 'HEAD' ? {} : { body: JSON.stringify(options.body ?? payload()) }),
  })
}
const unavailable: InstalerObservationStore = {
  async read() { assert.fail('Must not reach storage') }, async write() { assert.fail('Must not write') },
}
function memoryStore() {
  let stored: string | null = null
  let etag = 0
  const store: InstalerObservationStore = {
    async read() { return stored === null ? null : { text: stored, etag: String(etag) } },
    async write(text, expected) {
      assert.equal(expected, stored === null ? null : String(etag))
      stored = text
      return String(++etag)
    },
  }
  return { store, text: () => stored, writes: () => etag }
}
const value: ObservationSnapshot = {
  readAt, modifiedTime: '2026-10-20T00:00:00.000Z',
  table: {
    source: { document: 'Synthetic private supplier.xlsx', checksum: 'a'.repeat(64), version: '7' },
    headerRow: 1, headers: ['SKU', 'DESCRIPCION', 'PRECIO', 'STOCK', 'CATEGORIA'],
    rows: [{ row: 2, values: ['SYN-PRIVATE', 'Private synthetic name', '123.45', '2.5', 'Synthetic'] }],
  },
}

test('observation upload is disabled by default and outside production', async () => {
  for (const changed of [{ mode: undefined }, { mode: 'disabled' }, { environment: 'preview' }, { environment: 'development' }]) {
    const result = await serveInstalerObservation(request(), { ...config, ...changed }, { store: unavailable })
    assert.equal(result.status, 404)
    assert.equal(result.headers.get('cache-control'), 'private, no-store')
  }
})

test('publication mode, old GET cron, query parameters and invalid authorization cannot access storage', async () => {
  assert.equal((await serveInstalerObservation(request(), { ...config, mode: 'publish' }, { store: unavailable })).status, 503)
  const oldCron = await serveInstalerObservation(request({ method: 'GET' }), config, { store: unavailable })
  assert.equal(oldCron.status, 405)
  assert.equal(oldCron.headers.get('allow'), 'POST')
  assert.equal((await serveInstalerObservation(request({ path: '?publish=1' }), config, { store: unavailable })).status, 400)
  for (const authorization of ['', 'Bearer invalid', secret]) {
    assert.equal((await serveInstalerObservation(request({ authorization }), config, { store: unavailable })).status, 401)
  }
  for (const missing of ['ingestSecret', 'expectedEmail', 'fileId', 'blobToken'] as const) {
    assert.equal((await serveInstalerObservation(request(), { ...config, [missing]: undefined }, { store: unavailable })).status, 503)
  }
  assert.equal((await serveInstalerObservation(request(), { ...config, fileId: '../another-source' }, { store: unavailable })).status, 503)
})

test('platform bypass header does not substitute for receiver authentication', async () => {
  const input = request({ authorization: '' })
  input.headers.set('x-vercel-protection-bypass', 'synthetic-platform-secret')
  assert.equal((await serveInstalerObservation(input, config, { store: unavailable })).status, 401)
})

test('malformed, wrong-source and stale envelopes are rejected before touching observation state', async () => {
  const original = payload()
  for (const body of [{ ...original, fileId: 'another-source-id' }, { ...original, account: 'other@example.invalid' },
    { ...original, readAt: '2026-10-21T09:00:00.000Z' }, { ...original, readAt: '2026-10-21T10:00:01.000Z' },
    { ...original, mode: 'publish' }, { ...original, result: { status: 'failed', error: 'private raw error' } }]) {
    const result = await serveInstalerObservation(request({ body }), config, { store: unavailable, now })
    assert.equal(result.status, 400)
  }
  assert.equal((await serveInstalerObservation(request({ media: 'text/plain' }), config, { store: unavailable, now })).status, 415)
})

test('authorized upload returns aggregates and preserves source-read time without exposing private values', async () => {
  const memory = memoryStore()
  const logs: unknown[] = []
  let decoded = 0
  const result = await serveInstalerObservation(request(), config, {
    store: memory.store, read: async (upload) => {
      assert.equal(decodeInstalerObservationSource(upload).metadata.version, '7')
      decoded++
      return value
    }, now, log: (event) => logs.push(event),
  })
  assert.equal(result.status, 200)
  const publicText = await result.text() + JSON.stringify(logs)
  for (const privateValue of ['SYN-PRIVATE', 'Private synthetic', '123.45', secret, 'synthetic-blob-token']) {
    assert.ok(!publicText.includes(privateValue))
  }
  assert.ok(memory.text()!.includes('SYN-PRIVATE'))
  const again = await serveInstalerObservation(request(), config, { store: memory.store, now, read: async () => { assert.fail('Must not process again') } })
  assert.equal((await again.json()).status, 'already-attempted')
  assert.equal(decoded, 1)
  assert.equal(memory.writes(), 2)
})

test('received Google failure is recorded without overwriting the last successful snapshots', async () => {
  const memory = memoryStore()
  await serveInstalerObservation(request(), config, { store: memory.store, now, read: async () => value })
  const before = parseObservationState(memory.text()!, { fileId: config.fileId!, expectedEmail: config.expectedEmail! })
  const failed = { ...payload(), readAt: '2026-10-22T09:59:30.000Z', result: { status: 'failed', error: 'account-mismatch' } }
  const result = await serveInstalerObservation(request({ body: failed }), config, {
    store: memory.store, now: () => new Date('2026-10-22T10:00:00.000Z'),
  })
  assert.equal(result.status, 502)
  const body = await result.json()
  assert.equal(body.error, 'account-mismatch')
  assert.equal(body.publicationAllowed, false)
  const after = parseObservationState(memory.text()!, before.binding)
  assert.deepEqual(after.current, before.current)
  assert.deepEqual(after.previous, before.previous)
  assert.deepEqual(after.lastDifference, before.lastDifference)
  assert.equal(after.history.at(-1)?.error, 'account-mismatch')
})

test('invalid uploaded bytes are classified and recorded without returning supplier data', async () => {
  const memory = memoryStore()
  const original = payload()
  original.result.metadata.md5Checksum = '0'.repeat(32)
  const result = await serveInstalerObservation(request({ body: original }), config, { store: memory.store, now })
  assert.equal(result.status, 502)
  const body = await result.json()
  assert.equal(body.error, 'source-invalid')
  assert.equal(body.publicationAllowed, false)
  assert.equal(memory.writes(), 2)
})

test('publication is separately enabled and consumes a committed observation without another source read', async () => {
  const memory = memoryStore()
  let active = JSON.stringify({ format: 'luquisound.catalog', version: 1, items: [] })
  const archives: string[] = []
  let publications = 0
  const publicationStore: InstalerCatalogStore = {
    async read() { assert.equal(memory.writes(), 2); return { text: active, etag: 'catalog-1' } },
    async readPolicy() { return null },
    async archive(text) { archives.push(text) },
    async write(text, etag) {
      assert.equal(etag, 'catalog-1')
      assert.equal(archives.length, 1)
      publications++
      active = text
      return 'catalog-2'
    },
  }
  let reads = 0
  const enabled = { ...config, publicationMode: 'publish', catalogToken: 'synthetic-catalog-token',
    catalogUrl: 'https://synthetic.private.blob.vercel-storage.com/catalog.json' }
  const result = await serveInstalerObservation(request(), enabled, {
    store: memory.store, read: async () => { reads++; return value }, now, publicationStore,
  })
  assert.equal(result.status, 200)
  const body = await result.json()
  assert.equal(body.status, 'baseline')
  assert.equal(body.publicationAllowed, false)
  assert.equal(body.catalogPublication.status, 'published')
  assert.equal(JSON.parse(active).items.length, 1)
  assert.equal(reads, 1)
  assert.equal(publications, 1)
  const repeat = await serveInstalerObservation(request(), enabled, {
    store: memory.store, now, publicationStore, read: async () => { assert.fail('No repeat source read') },
  })
  assert.equal((await repeat.json()).status, 'already-attempted')
  assert.equal(publications, 1)
})

test('publication failure preserves the successful observation and notifies the existing sender with non-200', async () => {
  const memory = memoryStore()
  const events: unknown[] = []
  const publicationStore: InstalerCatalogStore = {
    async read() { throw new Error('private storage detail') },
    async readPolicy() { assert.fail('No policy after failed active read') },
    async archive() { assert.fail('No archive') }, async write() { assert.fail('No write') },
  }
  const result = await serveInstalerObservation(request(), {
    ...config, publicationMode: 'publish', catalogToken: 'synthetic',
    catalogUrl: 'https://synthetic.private.blob.vercel-storage.com/catalog.json',
  }, { store: memory.store, now, read: async () => value, publicationStore, log: (event) => events.push(event) })
  assert.equal(result.status, 503)
  const body = await result.json()
  assert.equal(body.status, 'baseline')
  assert.equal(body.catalogPublication.status, 'failed')
  assert.equal(body.catalogPublication.error, 'storage')
  const observed = parseObservationState(memory.text()!, { fileId: config.fileId!, expectedEmail: config.expectedEmail! })
  assert.deepEqual(observed.current, value)
  assert.equal(observed.history.at(-1)?.status, 'baseline')
  assert.ok(!JSON.stringify(events).includes('private storage detail'))
})
