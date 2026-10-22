import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BlobError, BlobPreconditionFailedError, get, put, type GetBlobResult, type PutBlobResult,
} from '@vercel/blob'
import {
  createInstalerObservationStore, INSTALER_OBSERVATION_PATH, InstalerObservationStoreError,
  MAX_OBSERVATION_BYTES,
} from '../src/server/instaler-observation-store.ts'

const TOKEN = 'synthetic-observation-token'
const CATALOG_URL = 'https://synthetic.private.blob.vercel-storage.com/catalog/current.json'
const TEXT = JSON.stringify({ observation: 'Synthetic caf\u00e9', publicationAllowed: false })

function putResult(changes: Partial<PutBlobResult> = {}): PutBlobResult {
  return {
    url: `https://synthetic.private.blob.vercel-storage.com/${INSTALER_OBSERVATION_PATH}`,
    downloadUrl: `https://synthetic.private.blob.vercel-storage.com/${INSTALER_OBSERVATION_PATH}?download=1`,
    pathname: INSTALER_OBSERVATION_PATH, contentType: 'application/json; charset=utf-8',
    contentDisposition: 'attachment', etag: 'etag-next', ...changes,
  }
}

function readResult(text = TEXT): GetBlobResult & { statusCode: 200 } {
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
      'Content-Type': 'application/json; charset=utf-8', 'Content-Length': String(bytes.byteLength), ETag: 'etag-current',
    }),
    blob: {
      ...putResult({ etag: 'etag-current' }), uploadedAt: new Date('2026-01-01T00:00:00.000Z'),
      cacheControl: 'private, max-age=60', size: bytes.byteLength,
    },
  }
}

function stub(read: GetBlobResult | null = readResult(), written: PutBlobResult = putResult()) {
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

function errorCode(code: 'conflict' | 'storage'): (error: unknown) => boolean {
  return (error) => {
    assert.ok(error instanceof InstalerObservationStoreError)
    assert.equal(error.code, code)
    for (const secret of [TOKEN, 'upstream-secret', CATALOG_URL]) {
      assert.ok(!`${String(error)} ${JSON.stringify(error)}`.includes(secret))
    }
    return true
  }
}

test('the adapter reads only its fixed private object without cache or default token fallback', async () => {
  const { sdk, gets, puts } = stub()
  const store = createInstalerObservationStore(TOKEN, CATALOG_URL, sdk)
  assert.deepEqual(await store.read(), { text: TEXT, etag: 'etag-current' })
  assert.equal(gets.length, 1)
  assert.equal(gets[0][0], INSTALER_OBSERVATION_PATH)
  assert.equal(gets[0][1].access, 'private')
  assert.equal(gets[0][1].token, TOKEN)
  assert.equal(gets[0][1].useCache, false)
  assert.deepEqual(gets[0][1].headers, { 'accept-encoding': 'identity' })
  assert.ok(gets[0][1].abortSignal instanceof AbortSignal)
  assert.equal(puts.length, 0)
})

test('identity negotiation preserves a readable baseline and its strong ETag', async () => {
  const { sdk, puts } = stub()
  sdk.get = async (_path, options) => {
    const value = readResult()
    if (new Headers(options.headers).get('accept-encoding') === 'identity') {
      value.headers.set('content-encoding', 'identity')
    } else {
      value.headers.set('content-encoding', 'gzip')
      value.headers.delete('content-length')
      value.blob.size = 0
      value.blob.etag = 'W/"etag-current"'
      value.headers.set('etag', value.blob.etag)
    }
    return value
  }
  assert.deepEqual(await createInstalerObservationStore(TOKEN, CATALOG_URL, sdk).read(), {
    text: TEXT, etag: 'etag-current',
  })
  assert.equal(puts.length, 0)
})

test('unexpected content encoding is rejected before consuming or writing a baseline', async () => {
  for (const encoding of ['gzip', 'br', 'gzip, identity', '']) {
    let consumed = false
    let cancelled = false
    const value = readResult()
    value.headers.set('content-encoding', encoding)
    value.stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        consumed = true
        controller.enqueue(new TextEncoder().encode(TEXT))
        controller.close()
      },
      cancel() { cancelled = true },
    }, { highWaterMark: 0 })
    const { sdk, puts } = stub(value)
    await assert.rejects(createInstalerObservationStore(TOKEN, CATALOG_URL, sdk).read(), errorCode('storage'))
    assert.equal(consumed, false)
    assert.equal(cancelled, true)
    assert.equal(puts.length, 0)
  }
})

test('the adapter distinguishes absent observation storage from failed or corrupt reads', async () => {
  const { sdk, gets, puts } = stub(null)
  assert.equal(await createInstalerObservationStore(TOKEN, CATALOG_URL, sdk).read(), null)
  assert.equal(gets.length, 1)
  assert.equal(puts.length, 0)
  const failing = {
    ...sdk,
    get: async () => { throw new Error(`upstream-secret ${TOKEN}`) },
  }
  await assert.rejects(createInstalerObservationStore(TOKEN, CATALOG_URL, failing).read(), errorCode('storage'))
  assert.equal(puts.length, 0)
})

test('initial creation is exclusive and subsequent writes require the last read ETag', async () => {
  const { sdk, puts } = stub()
  const store = createInstalerObservationStore(TOKEN, CATALOG_URL, sdk)
  assert.equal(await store.write(TEXT, null), 'etag-next')
  assert.equal(await store.write(TEXT, 'etag-current'), 'etag-next')
  assert.equal(puts.length, 2)
  for (const [path, body, options] of puts) {
    assert.equal(path, INSTALER_OBSERVATION_PATH)
    assert.equal(body, TEXT)
    assert.equal(options.access, 'private')
    assert.equal(options.token, TOKEN)
    assert.equal(options.addRandomSuffix, false)
    assert.equal(options.contentType, 'application/json; charset=utf-8')
    assert.equal(options.cacheControlMaxAge, 60)
    assert.ok(options.abortSignal instanceof AbortSignal)
  }
  assert.equal(puts[0][2].allowOverwrite, false)
  assert.ok(!Object.hasOwn(puts[0][2], 'ifMatch'))
  assert.equal(puts[1][2].allowOverwrite, true)
  assert.equal(puts[1][2].ifMatch, 'etag-current')
})

test('configuration refuses missing tokens and any current catalogue using the observation pathname', () => {
  const { sdk, gets, puts } = stub()
  for (const token of ['', 'with\nnewline', ' ']) {
    assert.throws(() => createInstalerObservationStore(token, CATALOG_URL, sdk), errorCode('storage'))
  }
  for (const url of [
    `https://synthetic.private.blob.vercel-storage.com/${INSTALER_OBSERVATION_PATH}`,
    'https://synthetic.private.blob.vercel-storage.com/instaler-observation%2Fstate.json',
    'https://synthetic.private.blob.vercel-storage.com/instaler-observation/%73tate.json',
    'https://synthetic.private.blob.vercel-storage.com/unused/../instaler-observation/state.json',
    'https://synthetic.private.blob.vercel-storage.com/%invalid', 'not a URL',
  ]) {
    assert.throws(() => createInstalerObservationStore(TOKEN, url, sdk), errorCode('storage'))
  }
  assert.equal(gets.length, 0)
  assert.equal(puts.length, 0)
})

test('invalid MIME, path, lengths and ETags never return a baseline or cause a write', async () => {
  for (const mutate of [
    (value: ReturnType<typeof readResult>) => { value.blob.pathname = 'catalog/current.json' },
    (value: ReturnType<typeof readResult>) => { value.blob.contentType = 'text/html' },
    (value: ReturnType<typeof readResult>) => { value.headers.set('content-type', 'text/html') },
    (value: ReturnType<typeof readResult>) => { value.blob.size = MAX_OBSERVATION_BYTES + 1 },
    (value: ReturnType<typeof readResult>) => { value.blob.size = 0 },
    (value: ReturnType<typeof readResult>) => { value.blob.size = 1.5 },
    (value: ReturnType<typeof readResult>) => { value.blob.size = NaN },
    (value: ReturnType<typeof readResult>) => { value.blob.etag = '' },
    (value: ReturnType<typeof readResult>) => { value.blob.etag = '*' },
    (value: ReturnType<typeof readResult>) => { value.blob.etag = 'W/"weak"' },
    (value: ReturnType<typeof readResult>) => { value.headers.delete('etag') },
    (value: ReturnType<typeof readResult>) => { value.headers.set('etag', 'different') },
    (value: ReturnType<typeof readResult>) => { value.headers.set('content-length', '-1') },
    (value: ReturnType<typeof readResult>) => { value.headers.set('content-length', String(MAX_OBSERVATION_BYTES + 1)) },
    (value: ReturnType<typeof readResult>) => { value.headers.set('content-length', '1') },
  ]) {
    const value = readResult()
    mutate(value)
    const { sdk, puts } = stub(value)
    await assert.rejects(createInstalerObservationStore(TOKEN, CATALOG_URL, sdk).read(), errorCode('storage'))
    assert.equal(puts.length, 0)
  }
})

test('conditional 304 responses are rejected because an unconditional baseline was requested', async () => {
  const original = readResult()
  const { sdk, puts } = stub({
    ...original, statusCode: 304, stream: null, blob: { ...original.blob, size: null, contentType: null },
  })
  await assert.rejects(createInstalerObservationStore(TOKEN, CATALOG_URL, sdk).read(), errorCode('storage'))
  assert.equal(puts.length, 0)
})

test('stream decoding rejects invalid UTF-8, partial data and bytes beyond the declared size', async () => {
  for (const bytes of [new Uint8Array([0xff]), new Uint8Array([0x7b]), new Uint8Array(10)]) {
    const value = readResult()
    value.blob.size = bytes[0] === 0xff ? 1 : 5
    value.headers.set('content-length', String(value.blob.size))
    value.stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(bytes); controller.close() },
    })
    const { sdk, puts } = stub(value)
    await assert.rejects(createInstalerObservationStore(TOKEN, CATALOG_URL, sdk).read(), errorCode('storage'))
    assert.equal(puts.length, 0)
  }
})

test('streamed size is bounded even without a content-length header', async () => {
  let cancelled = false
  const value = readResult()
  value.blob.size = MAX_OBSERVATION_BYTES
  value.headers.delete('content-length')
  value.stream = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(MAX_OBSERVATION_BYTES + 1)) },
    cancel() { cancelled = true },
  })
  const { sdk, puts } = stub(value)
  await assert.rejects(createInstalerObservationStore(TOKEN, CATALOG_URL, sdk).read(), errorCode('storage'))
  assert.equal(cancelled, true)
  assert.equal(puts.length, 0)
})

test('failed streams are sanitized without writing or treating them as an absent baseline', async () => {
  const value = readResult()
  value.stream = new ReadableStream<Uint8Array>({
    pull(controller) { controller.error(new Error(`upstream-secret ${TOKEN}`)) },
  })
  const { sdk, puts } = stub(value)
  await assert.rejects(createInstalerObservationStore(TOKEN, CATALOG_URL, sdk).read(), errorCode('storage'))
  assert.equal(puts.length, 0)
})

test('writes validate UTF-8 bytes, JSON and ETags before calling storage', async () => {
  const { sdk, puts } = stub()
  const store = createInstalerObservationStore(TOKEN, CATALOG_URL, sdk)
  for (const text of ['', '{', '\ud800', JSON.stringify({ value: '\u00e9'.repeat(MAX_OBSERVATION_BYTES / 2) })]) {
    await assert.rejects(store.write(text, null), errorCode('storage'))
  }
  for (const etag of ['', '*', 'W/"weak"', 'one,two', 'with\nnewline']) {
    await assert.rejects(store.write(TEXT, etag), errorCode('storage'))
  }
  assert.equal(puts.length, 0)
})

test('CAS mismatch and an initial creation race report conflicts without overwriting', async () => {
  for (const [etag, error] of [
    ['etag-current', new BlobPreconditionFailedError()],
    [null, new BlobPreconditionFailedError()],
    [null, new BlobError(`Blob already exists. upstream-secret ${TOKEN}`)],
  ] as const) {
    let calls = 0
    const { sdk } = stub()
    sdk.put = async (_path, _body, options) => {
      calls += 1
      assert.equal(options.allowOverwrite, etag !== null)
      assert.equal(options.ifMatch, etag ?? undefined)
      throw error
    }
    await assert.rejects(createInstalerObservationStore(TOKEN, CATALOG_URL, sdk).write(TEXT, etag), errorCode('conflict'))
    assert.equal(calls, 1)
  }
})

test('other SDK write errors and unexpected put metadata remain sanitized storage errors', async () => {
  const { sdk } = stub()
  sdk.put = async () => { throw new Error(`upstream-secret ${TOKEN}`) }
  await assert.rejects(createInstalerObservationStore(TOKEN, CATALOG_URL, sdk).write(TEXT, null), errorCode('storage'))
  for (const result of [putResult({ pathname: 'catalog/current.json' }), putResult({ etag: '' }), putResult({ contentType: 'text/html' })]) {
    await assert.rejects(createInstalerObservationStore(TOKEN, CATALOG_URL, stub(null, result).sdk).write(TEXT, null), errorCode('storage'))
  }
})
