import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import {
  BlobError, BlobPreconditionFailedError, get, put, type GetBlobResult, type PutBlobResult,
} from '@vercel/blob'
import {
  createInstalerCatalogStore, INSTALER_CATALOG_LAST_VALID_PATH, INSTALER_CATALOG_POLICY_PATH,
  InstalerCatalogStoreError, MAX_INSTALER_POLICY_BYTES,
} from '../src/server/instaler-catalog-store.ts'
import { SHARED_CATALOG_MAX_BYTES } from '../src/features/quotation/shared-catalog.ts'

const TOKEN = 'synthetic-catalogue-token'
const ORIGIN = 'https://synthetic.private.blob.vercel-storage.com'
const PATH = 'catalog/current.json'
const URL = `${ORIGIN}/${PATH}`
const TEXT = catalogue('Synthetic caf\u00e9')

function catalogue(name: string): string {
  return JSON.stringify({
    format: 'luquisound.catalog', version: 1,
    items: [{ supplier: 'Synthetic supplier', sku: 'SYN-001', name, section: 'equipment' }],
  })
}

function putResult(path = PATH, etag = 'etag-next'): PutBlobResult {
  return {
    url: `${ORIGIN}/${path}`, downloadUrl: `${ORIGIN}/${path}?download=1`, pathname: path,
    contentType: 'application/json; charset=utf-8', contentDisposition: 'attachment', etag,
  }
}

function readResult(text = TEXT, path = PATH, etag = 'etag-current'): GetBlobResult & { statusCode: 200 } {
  const bytes = new TextEncoder().encode(text)
  return {
    statusCode: 200,
    stream: new ReadableStream<Uint8Array>({
      start(controller) {
        for (let offset = 0; offset < bytes.byteLength; offset += 7) controller.enqueue(bytes.slice(offset, offset + 7))
        controller.close()
      },
    }),
    headers: new Headers({
      'Content-Type': 'application/json; charset=utf-8', 'Content-Length': String(bytes.byteLength), ETag: etag,
    }),
    blob: {
      ...putResult(path, etag), uploadedAt: new Date('2026-01-01T00:00:00.000Z'),
      cacheControl: 'private, max-age=60', size: bytes.byteLength,
    },
  }
}

function stub(read: GetBlobResult | null = readResult(), written = putResult()) {
  const gets: Parameters<typeof get>[] = []
  const puts: Parameters<typeof put>[] = []
  return {
    gets, puts,
    sdk: {
      get: async (...args: Parameters<typeof get>) => { gets.push(args); return read },
      put: async (...args: Parameters<typeof put>) => { puts.push(args); return written },
    },
  }
}

function memory() {
  const objects = new Map<string, { text: string; etag: string }>([[PATH, { text: TEXT, etag: 'etag-current' }]])
  const gets: Parameters<typeof get>[] = []
  const puts: Parameters<typeof put>[] = []
  let sequence = 0
  const sdk = {
    get: async (...args: Parameters<typeof get>) => {
      gets.push(args)
      const path = new globalThis.URL(args[0]).pathname.slice(1)
      const stored = objects.get(path)
      return stored ? readResult(stored.text, path, stored.etag) : null
    },
    put: async (...args: Parameters<typeof put>) => {
      puts.push(args)
      const [path, body, options] = args
      const stored = objects.get(path)
      if (options.ifMatch !== undefined && options.ifMatch !== stored?.etag) throw new BlobPreconditionFailedError()
      if (stored && !options.allowOverwrite) throw new BlobError('Blob already exists.')
      assert.equal(typeof body, 'string')
      const value = { text: String(body), etag: `etag-${++sequence}` }
      objects.set(path, value)
      return putResult(path, value.etag)
    },
  }
  return { objects, gets, puts, sdk }
}

function errorCode(code: 'conflict' | 'storage'): (error: unknown) => boolean {
  return (error) => {
    assert.ok(error instanceof InstalerCatalogStoreError)
    assert.equal(error.code, code)
    for (const secret of [TOKEN, 'upstream-secret', URL]) {
      assert.ok(!`${String(error)} ${JSON.stringify(error)}`.includes(secret))
    }
    return true
  }
}

test('catalogue reads use the configured private object, identity encoding and an exact strong ETag', async () => {
  const { sdk, gets, puts } = stub()
  assert.deepEqual(await createInstalerCatalogStore(TOKEN, URL, sdk).read(), { text: TEXT, etag: 'etag-current' })
  assert.equal(gets.length, 1)
  assert.equal(gets[0][0], URL)
  assert.equal(gets[0][1].access, 'private')
  assert.equal(gets[0][1].token, TOKEN)
  assert.equal(gets[0][1].useCache, false)
  assert.deepEqual(gets[0][1].headers, { 'accept-encoding': 'identity' })
  assert.ok(gets[0][1].abortSignal instanceof AbortSignal)
  assert.equal(puts.length, 0)
})

test('only the fixed policy object is readable and missing policy never bootstraps a catalogue', async () => {
  const state = memory()
  const store = createInstalerCatalogStore(TOKEN, URL, state.sdk)
  assert.equal(await store.readPolicy(), null)
  const policy = JSON.stringify({ mode: 'synthetic', stockGraceDays: 7 })
  state.objects.set(INSTALER_CATALOG_POLICY_PATH, { text: policy, etag: 'policy-etag' })
  assert.equal(await store.readPolicy(), policy)
  assert.equal(state.gets[0][0], `${ORIGIN}/${INSTALER_CATALOG_POLICY_PATH}`)
  state.objects.delete(PATH)
  await assert.rejects(store.read(), errorCode('storage'))
  assert.equal(state.puts.length, 0)
})

test('configuration rejects public hosts, URL tricks and collisions with observation or recovery objects', () => {
  const { sdk, gets, puts } = stub()
  for (const token of ['', 'with\nnewline', ' ']) {
    assert.throws(() => createInstalerCatalogStore(token, URL, sdk), errorCode('storage'))
  }
  for (const url of [
    'not a URL', URL + '?cache=0', URL + '#fragment', ' ' + URL, URL + ' ',
    URL.replace('https:', 'http:'), URL.replace('synthetic.private.', 'synthetic.public.'),
    URL.replace('synthetic.private.', 'synthetic.'), URL.replace('https://', 'https://user:secret@'),
    URL.replace('.com/', '.com:443/'), `${ORIGIN}/catalog/../current.json`, `${ORIGIN}/catalog//current.json`,
    `${ORIGIN}/catalog/%63urrent.json`, `${ORIGIN}/catalog/one\\current.json`, `${ORIGIN}/catalog/current.txt`,
    `${ORIGIN}/instaler-observation/state.json`, `${ORIGIN}/instaler-catalog/policy.json`,
    `${ORIGIN}/instaler-catalog/last-valid.json`, `${ORIGIN}/instaler-catalog/versions/synthetic.json`,
  ]) {
    assert.throws(() => createInstalerCatalogStore(TOKEN, url, sdk), errorCode('storage'))
  }
  assert.equal(gets.length, 0)
  assert.equal(puts.length, 0)
})

test('invalid metadata, encoding, sizes, paths and ETags fail before returning a catalogue', async () => {
  for (const mutate of [
    (value: ReturnType<typeof readResult>) => { value.blob.pathname = 'unrelated.json' },
    (value: ReturnType<typeof readResult>) => { value.blob.url = `https://another.private.blob.vercel-storage.com/${PATH}` },
    (value: ReturnType<typeof readResult>) => { value.blob.contentType = 'text/html' },
    (value: ReturnType<typeof readResult>) => { value.headers.set('content-type', 'text/html') },
    (value: ReturnType<typeof readResult>) => { value.headers.set('content-encoding', 'gzip') },
    (value: ReturnType<typeof readResult>) => { value.headers.set('content-encoding', '') },
    (value: ReturnType<typeof readResult>) => { value.blob.size = SHARED_CATALOG_MAX_BYTES + 1 },
    (value: ReturnType<typeof readResult>) => { value.blob.size = 0 },
    (value: ReturnType<typeof readResult>) => { value.blob.size = 1.5 },
    (value: ReturnType<typeof readResult>) => { value.blob.size = NaN },
    (value: ReturnType<typeof readResult>) => { value.blob.etag = '' },
    (value: ReturnType<typeof readResult>) => { value.blob.etag = '*' },
    (value: ReturnType<typeof readResult>) => { value.blob.etag = 'W/"weak"' },
    (value: ReturnType<typeof readResult>) => { value.headers.delete('etag') },
    (value: ReturnType<typeof readResult>) => { value.headers.set('etag', 'different') },
    (value: ReturnType<typeof readResult>) => { value.headers.set('content-length', '-1') },
    (value: ReturnType<typeof readResult>) => { value.headers.set('content-length', '1') },
  ]) {
    const value = readResult()
    mutate(value)
    const { sdk, puts } = stub(value)
    await assert.rejects(createInstalerCatalogStore(TOKEN, URL, sdk).read(), errorCode('storage'))
    assert.equal(puts.length, 0)
  }
})

test('304, invalid JSON, invalid catalogues and duplicate identities do not become active snapshots', async () => {
  const value = readResult()
  const conditional: GetBlobResult = { ...value, statusCode: 304, stream: null, blob: { ...value.blob, size: null, contentType: null } }
  for (const read of [conditional, readResult('{'), readResult('{}'), readResult(TEXT.replace('"items":[', '"items":[{},'))]) {
    await assert.rejects(createInstalerCatalogStore(TOKEN, URL, stub(read).sdk).read(), errorCode('storage'))
  }
  const item = { supplier: 'Synthetic supplier', sku: 'SYN-001', name: 'Synthetic', section: 'equipment' }
  const duplicate = JSON.stringify({ format: 'luquisound.catalog', version: 1, items: [item, item] })
  await assert.rejects(createInstalerCatalogStore(TOKEN, URL, stub(readResult(duplicate)).sdk).read(), errorCode('storage'))
})

test('stream bytes, UTF-8 and missing content-length remain bounded independently of metadata', async () => {
  for (const bytes of [new Uint8Array([0xff]), new Uint8Array([0x7b]), new Uint8Array(10)]) {
    const value = readResult()
    value.blob.size = bytes[0] === 0xff ? 1 : 5
    value.headers.delete('content-length')
    value.stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close() } })
    await assert.rejects(createInstalerCatalogStore(TOKEN, URL, stub(value).sdk).read(), errorCode('storage'))
  }
  let cancelled = false
  const value = readResult()
  value.blob.size = SHARED_CATALOG_MAX_BYTES
  value.headers.delete('content-length')
  value.stream = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(SHARED_CATALOG_MAX_BYTES + 1)) },
    cancel() { cancelled = true },
  })
  await assert.rejects(createInstalerCatalogStore(TOKEN, URL, stub(value).sdk).read(), errorCode('storage'))
  assert.equal(cancelled, true)
})

test('body timeout and SDK failures are sanitized and never cause a write', async (context) => {
  const controller = new AbortController()
  context.mock.method(AbortSignal, 'timeout', () => controller.signal)
  const value = readResult()
  let cancelled = false
  value.stream = new ReadableStream<Uint8Array>({ cancel() { cancelled = true } })
  const state = stub(value)
  const pending = createInstalerCatalogStore(TOKEN, URL, state.sdk).read()
  controller.abort()
  await assert.rejects(pending, errorCode('storage'))
  assert.equal(cancelled, true)
  state.sdk.get = async () => { throw new Error(`upstream-secret ${TOKEN}`) }
  await assert.rejects(createInstalerCatalogStore(TOKEN, URL, state.sdk).read(), errorCode('storage'))
  assert.equal(state.puts.length, 0)
})

test('policy validates JSON, strict UTF-8 and its independent one-MiB byte limit', async () => {
  for (const text of ['{', '"\ud800"', JSON.stringify({ padding: 'x'.repeat(MAX_INSTALER_POLICY_BYTES) })]) {
    const value = readResult(text, INSTALER_CATALOG_POLICY_PATH)
    if (text.includes('\ud800')) {
      value.blob.size = 1
      value.headers.set('content-length', '1')
      value.stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([0xff])); controller.close() } })
    }
    await assert.rejects(createInstalerCatalogStore(TOKEN, URL, stub(value).sdk).readPolicy(), errorCode('storage'))
  }
})

test('active writes are always one conditional private overwrite with a required strong ETag', async () => {
  const { sdk, puts } = stub()
  assert.equal(await createInstalerCatalogStore(TOKEN, URL, sdk).write(TEXT, 'etag-current'), 'etag-next')
  assert.equal(puts.length, 1)
  const [path, body, options] = puts[0]
  assert.equal(path, PATH)
  assert.equal(body, TEXT)
  assert.equal(options.access, 'private')
  assert.equal(options.token, TOKEN)
  assert.equal(options.addRandomSuffix, false)
  assert.equal(options.allowOverwrite, true)
  assert.equal(options.ifMatch, 'etag-current')
  assert.equal(options.contentType, 'application/json; charset=utf-8')
  assert.equal(options.cacheControlMaxAge, 60)
  assert.ok(options.abortSignal instanceof AbortSignal)
})

test('invalid catalogue writes and ETags are rejected before touching Blob', async () => {
  const { sdk, puts } = stub()
  const store = createInstalerCatalogStore(TOKEN, URL, sdk)
  for (const text of ['', '{', '{}', '\ud800', JSON.stringify({ padding: '\u00e9'.repeat(SHARED_CATALOG_MAX_BYTES / 2) })]) {
    await assert.rejects(store.write(text, 'etag-current'), errorCode('storage'))
    await assert.rejects(store.archive(text), errorCode('storage'))
  }
  for (const etag of ['', '*', 'W/"weak"', 'one,two', 'with\nnewline']) {
    await assert.rejects(store.write(TEXT, etag), errorCode('storage'))
  }
  assert.equal(puts.length, 0)
})

test('put metadata and SDK failures are sanitized while CAS failure remains a conflict', async () => {
  for (const mutate of [
    (value: PutBlobResult) => { value.pathname = 'unrelated.json' },
    (value: PutBlobResult) => { value.url = `https://another.private.blob.vercel-storage.com/${PATH}` },
    (value: PutBlobResult) => { value.contentType = 'text/html' },
    (value: PutBlobResult) => { value.etag = 'W/"weak"' },
  ]) {
    const value = putResult()
    mutate(value)
    await assert.rejects(createInstalerCatalogStore(TOKEN, URL, stub(null, value).sdk).write(TEXT, 'etag-current'), errorCode('storage'))
  }
  for (const [error, code] of [[new BlobPreconditionFailedError(), 'conflict'], [new Error(`upstream-secret ${TOKEN}`), 'storage']] as const) {
    const state = stub()
    state.sdk.put = async () => { throw error }
    await assert.rejects(createInstalerCatalogStore(TOKEN, URL, state.sdk).write(TEXT, 'etag-current'), errorCode(code))
  }
})

test('archives are immutable content-addressed valid catalogues and stable backups precede active CAS', async () => {
  const state = memory()
  const store = createInstalerCatalogStore(TOKEN, URL, state.sdk)
  await store.archive(TEXT)
  const path = `instaler-catalog/versions/${createHash('sha256').update(TEXT).digest('hex')}.json`
  assert.equal(state.objects.get(path)?.text, TEXT)
  assert.equal(state.objects.get(INSTALER_CATALOG_LAST_VALID_PATH)?.text, TEXT)
  assert.equal(state.objects.get(PATH)?.text, TEXT)
  for (const [, , options] of state.puts) {
    assert.equal(options.allowOverwrite, false)
    assert.equal(options.ifMatch, undefined)
  }
  await store.archive(TEXT)
  assert.equal(state.puts.filter(([value]) => value === INSTALER_CATALOG_LAST_VALID_PATH).length, 1)
  const next = catalogue('Next synthetic name')
  await store.write(next, 'etag-current')
  await store.archive(next)
  assert.equal(state.objects.get(INSTALER_CATALOG_LAST_VALID_PATH)?.text, next)
  const backupWrites = state.puts.filter(([value]) => value === INSTALER_CATALOG_LAST_VALID_PATH)
  assert.equal(backupWrites[1][2].allowOverwrite, true)
  assert.ok(backupWrites[1][2].ifMatch)
})

test('an existing immutable archive must match its complete text and hash, without overwriting a collision', async () => {
  const state = memory()
  const path = `instaler-catalog/versions/${createHash('sha256').update(TEXT).digest('hex')}.json`
  state.objects.set(path, { text: catalogue('Different synthetic name'), etag: 'collision-etag' })
  await assert.rejects(createInstalerCatalogStore(TOKEN, URL, state.sdk).archive(TEXT), errorCode('storage'))
  assert.equal(state.objects.get(path)?.text, catalogue('Different synthetic name'))
  assert.equal(state.objects.has(INSTALER_CATALOG_LAST_VALID_PATH), false)
})

test('two active writers cannot overwrite the winner and a stale archive cannot replace its backup', async () => {
  const state = memory()
  const first = createInstalerCatalogStore(TOKEN, URL, state.sdk)
  const second = createInstalerCatalogStore(TOKEN, URL, state.sdk)
  const initial = await first.read()
  const secondInitial = await second.read()
  await first.archive(initial.text)
  const next = catalogue('Next synthetic name')
  await first.write(next, initial.etag)
  await assert.rejects(second.write(catalogue('Losing synthetic name'), secondInitial.etag), errorCode('conflict'))
  await first.archive(next)
  await assert.rejects(second.archive(initial.text), errorCode('conflict'))
  assert.equal(state.objects.get(PATH)?.text, next)
  assert.equal(state.objects.get(INSTALER_CATALOG_LAST_VALID_PATH)?.text, next)
})

test('a backup changed after its read rejects a stale CAS even when the active read raced publication', async () => {
  const state = memory()
  state.objects.set(INSTALER_CATALOG_LAST_VALID_PATH, { text: catalogue('Earlier synthetic name'), etag: 'backup-old' })
  const originalGet = state.sdk.get
  let activeRead = false
  const next = catalogue('Concurrent synthetic publication')
  state.sdk.get = async (...args: Parameters<typeof get>) => {
    const result = await originalGet(...args)
    if (args[0] === URL && !activeRead) {
      activeRead = true
      // Another complete publication wins after this writer captured the old active body.
      state.objects.set(PATH, { text: next, etag: 'active-new' })
      state.objects.set(INSTALER_CATALOG_LAST_VALID_PATH, { text: next, etag: 'backup-new' })
    }
    return result
  }
  await assert.rejects(createInstalerCatalogStore(TOKEN, URL, state.sdk).archive(TEXT), errorCode('conflict'))
  assert.equal(state.objects.get(INSTALER_CATALOG_LAST_VALID_PATH)?.text, next)
})

test('explicit recovery can inspect invalid JSON while retaining private transport and strong ETag checks', async () => {
  const invalid = '{"synthetic":"unfinished'
  const state = memory()
  state.objects.set(PATH, { text: invalid, etag: 'invalid-etag' })
  const store = createInstalerCatalogStore(TOKEN, URL, state.sdk)
  await assert.rejects(store.read(), errorCode('storage'))
  assert.deepEqual(await store.readForRecovery?.(), { text: invalid, etag: 'invalid-etag' })
  assert.equal(state.gets[1][0], URL)
  assert.deepEqual(state.gets[1][1].headers, { 'accept-encoding': 'identity' })
  assert.equal(state.puts.length, 0)
  for (const mutate of [
    (value: ReturnType<typeof readResult>) => { value.blob.etag = 'W/"weak"'; value.headers.set('etag', value.blob.etag) },
    (value: ReturnType<typeof readResult>) => { value.headers.set('content-encoding', 'gzip') },
    (value: ReturnType<typeof readResult>) => { value.blob.size = SHARED_CATALOG_MAX_BYTES + 1 },
    (value: ReturnType<typeof readResult>) => {
      value.blob.size = 1
      value.headers.set('content-length', '1')
      value.stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([0xff])); controller.close() } })
    },
  ]) {
    const value = readResult(invalid)
    mutate(value)
    await assert.rejects(createInstalerCatalogStore(TOKEN, URL, stub(value).sdk).readForRecovery!(), errorCode('storage'))
  }
  state.objects.delete(PATH)
  await assert.rejects(store.readForRecovery!(), errorCode('storage'))
})

test('explicit quarantine stores exact corrupt bytes in private immutable content-addressed JSON evidence', async () => {
  const invalid = '{"synthetic":"unfinished caf\u00e9'
  const digest = createHash('sha256').update(invalid, 'utf8').digest('hex')
  const path = `instaler-catalog/invalid/${digest}.json`
  const state = memory()
  const store = createInstalerCatalogStore(TOKEN, URL, state.sdk)
  await store.quarantine?.(invalid)
  const evidence = JSON.parse(state.objects.get(path)!.text) as {
    format: string; version: number; sha256: string; encoding: string; content: string
  }
  assert.equal(evidence.format, 'luquisound.instaler-invalid-catalog')
  assert.equal(evidence.version, 1)
  assert.equal(evidence.sha256, digest)
  assert.equal(evidence.encoding, 'base64')
  assert.equal(Buffer.from(evidence.content, 'base64').toString('utf8'), invalid)
  assert.equal(state.objects.get(PATH)?.text, TEXT)
  assert.equal(state.objects.has(INSTALER_CATALOG_LAST_VALID_PATH), false)
  for (const [target, , options] of state.puts) {
    assert.equal(target, path)
    assert.equal(options.access, 'private')
    assert.equal(options.token, TOKEN)
    assert.equal(options.allowOverwrite, false)
    assert.equal(options.ifMatch, undefined)
  }
  const firstEvidence = state.objects.get(path)
  await store.quarantine?.(invalid)
  assert.equal(state.objects.get(path), firstEvidence)
  state.objects.set(path, { text: '{}', etag: 'collision-etag' })
  await assert.rejects(store.quarantine!(invalid), errorCode('storage'))
  assert.equal(state.objects.get(path)?.text, '{}')
  assert.equal(state.puts.every(([, , options]) => options.allowOverwrite === false), true)
})
