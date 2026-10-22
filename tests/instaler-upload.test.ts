import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import {
  decodeInstalerObservationSource, INSTALER_UPLOAD_MAX_BYTES, InstalerUploadError,
  parseInstalerObservationUpload, readInstalerObservationUpload,
} from '../src/server/instaler-upload.ts'
import { INSTALER_SOURCE_MAX_BYTES, InstalerSourceError } from '../src/server/instaler-source.ts'

const binding = { fileId: 'synthetic-drive-file', expectedEmail: 'workshop@example.invalid' }
const received = new Date('2026-10-21T10:00:00.000Z')
const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3])
function payload() {
  return {
    format: 'luquisound.instaler-observation-upload', version: 1, mode: 'observe',
    fileId: binding.fileId, account: binding.expectedEmail, readAt: '2026-10-21T09:59:30.000Z',
    result: {
      status: 'ok', bytesBase64: bytes.toString('base64'), metadata: {
        id: binding.fileId, name: 'Synthetic.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        size: String(bytes.length), md5Checksum: createHash('md5').update(bytes).digest('hex'),
        modifiedTime: '2026-10-20T12:00:00Z', version: '42', capabilities: { canDownload: true },
      },
    },
  }
}
const parse = (value: unknown) => parseInstalerObservationUpload(value, binding, received)

test('upload binds one source/account and keeps the real source-read time before receipt', () => {
  const upload = parse(payload())
  const source = decodeInstalerObservationSource(upload)
  assert.deepEqual(Buffer.from(source.bytes), bytes)
  assert.equal(source.readAt, '2026-10-21T09:59:30.000Z')
  assert.equal(source.metadata.version, '42')
})

test('malformed envelope, unrelated source, account and unsupported modes cannot reach source processing', () => {
  const original = payload()
  for (const value of [null, [], {}, { ...original, extra: true }, { ...original, version: 2 },
    { ...original, format: 'another-format' }, { ...original, mode: 'publish' },
    { ...original, fileId: 'another-drive-file' }, { ...original, account: 'other@example.invalid' },
    { ...original, account: 'WORKSHOP@example.invalid' },
    { ...original, result: { status: 'failed', error: 'raw private error' } },
    { ...original, result: { status: 'failed', error: 'access', raw: 'private' } },
    { ...original, result: { ...original.result, bytesBase64: '' } },
    { ...original, result: { ...original.result, metadata: [] } },
  ]) assert.throws(() => parse(value), InstalerUploadError)
})

test('read time rejects stale, future, missing and noncanonical dates; ten-minute boundary is accepted', () => {
  for (const readAt of ['2026-10-21T09:49:59.999Z', '2026-10-21T10:00:00.001Z',
    '2026-10-21T10:00:00Z', '2026-10-21T13:00:00.000+03:00', 'invalid', undefined]) {
    assert.throws(() => parse({ ...payload(), readAt }), { code: 'read-time' })
  }
  assert.equal(parse({ ...payload(), readAt: '2026-10-21T09:50:00.000Z' }).readAt, '2026-10-21T09:50:00.000Z')
})

test('authenticated failure reports remain classified source errors without data', () => {
  const upload = parse({ ...payload(), result: { status: 'failed', error: 'account-mismatch' } })
  assert.throws(() => decodeInstalerObservationSource(upload), (error) => error instanceof InstalerSourceError && error.code === 'account-mismatch')
})

test('source content enforces canonical base64, actual byte count, MD5, MIME and source metadata', () => {
  const original = payload()
  const mutations = [
    { ...original.result, bytesBase64: original.result.bytesBase64 + '\n' },
    { ...original.result, bytesBase64: 'UEsDBAECBz==' },
    { ...original.result, bytesBase64: Buffer.from('not a zip').toString('base64') },
    { ...original.result, metadata: { ...original.result.metadata, size: '8' } },
    { ...original.result, metadata: { ...original.result.metadata, md5Checksum: '0'.repeat(32) } },
    { ...original.result, metadata: { ...original.result.metadata, id: 'another-drive-file' } },
    { ...original.result, metadata: { ...original.result.metadata, mimeType: 'application/vnd.google-apps.spreadsheet' } },
    { ...original.result, metadata: { ...original.result.metadata, version: 42 } },
    { ...original.result, metadata: { ...original.result.metadata, modifiedTime: 'invalid' } },
    { ...original.result, metadata: { ...original.result.metadata, size: String(INSTALER_SOURCE_MAX_BYTES + 1) } },
  ]
  for (const result of mutations) {
    assert.throws(() => decodeInstalerObservationSource(parse({ ...original, result })), { code: 'source-invalid' })
  }
  assert.throws(() => decodeInstalerObservationSource(parse({ ...original, result: {
    ...original.result, metadata: { ...original.result.metadata, capabilities: { canDownload: false } },
  } })), { code: 'access' })
})

test('largest permitted XLSX survives canonical base64 validation without exceeding the request budget', () => {
  const full = Buffer.alloc(INSTALER_SOURCE_MAX_BYTES, 1)
  full.set([0x50, 0x4b, 0x03, 0x04])
  const original = payload()
  const value = { ...original, result: {
    ...original.result, bytesBase64: full.toString('base64'), metadata: {
      ...original.result.metadata, size: String(full.length), md5Checksum: createHash('md5').update(full).digest('hex'),
    },
  } }
  assert.ok(Buffer.byteLength(JSON.stringify(value)) < INSTALER_UPLOAD_MAX_BYTES)
  assert.equal(decodeInstalerObservationSource(parse(value)).bytes.length, INSTALER_SOURCE_MAX_BYTES)
})

test('request parsing rejects malformed UTF-8/JSON, unsupported media and dishonest Content-Length', async () => {
  const body = JSON.stringify(payload())
  for (const [content, headers] of [
    [body, { 'Content-Type': 'text/plain' }],
    [body, { 'Content-Type': 'application/json', 'Content-Length': '01' }],
    [body, { 'Content-Type': 'application/json', 'Content-Length': String(body.length + 1) }],
    ['{', { 'Content-Type': 'application/json' }],
    [new Uint8Array([0xff, 0xfe]), { 'Content-Type': 'application/json' }],
  ] as const) {
    const request = new Request('https://example.invalid', { method: 'POST', body: content, headers })
    await assert.rejects(readInstalerObservationUpload(request, binding, received), InstalerUploadError)
  }
  const good = new Request('https://example.invalid', {
    method: 'POST', body, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': String(Buffer.byteLength(body)) },
  })
  assert.equal((await readInstalerObservationUpload(good, binding, received)).fileId, binding.fileId)
})

test('body limit applies to both declared size and streamed bytes', async () => {
  const headerCases: Record<string, string>[] = [{ 'Content-Length': String(INSTALER_UPLOAD_MAX_BYTES + 1) }, {}]
  for (const headers of headerCases) {
    const request = new Request('https://example.invalid', {
      method: 'POST', body: ' '.repeat(INSTALER_UPLOAD_MAX_BYTES + 1), headers: { ...headers, 'Content-Type': 'application/json' },
    })
    await assert.rejects(readInstalerObservationUpload(request, binding, received), { code: 'payload-too-large' })
  }
})

test('stalled input is cancelled within the body deadline', async () => {
  let cancelled = false
  const stream = new ReadableStream<Uint8Array>({ cancel() { cancelled = true } })
  const request = new Request('https://example.invalid', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: stream,
    ...{ duplex: 'half' },
  })
  await assert.rejects(readInstalerObservationUpload(request, binding, received, 5), { code: 'body-timeout' })
  assert.equal(cancelled, true)
})
