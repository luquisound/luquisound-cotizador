import { createHash } from 'node:crypto'
import {
  INSTALER_SOURCE_ERROR_CODES, INSTALER_SOURCE_MAX_AGE_MS, INSTALER_SOURCE_MAX_BYTES,
  InstalerSourceError, type InstalerSourceBinding, type InstalerSourceErrorCode, type InstalerSourceMetadata,
} from './instaler-source.ts'

export const INSTALER_UPLOAD_MAX_BYTES = 4_300_000
const MAX_BASE64_LENGTH = 4 * Math.ceil(INSTALER_SOURCE_MAX_BYTES / 3)
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

interface UploadBase {
  format: 'luquisound.instaler-observation-upload'
  version: 1
  mode: 'observe'
  fileId: string
  account: string
  readAt: string
}

export type InstalerObservationUpload = UploadBase & {
  result: { status: 'ok'; metadata: unknown; bytesBase64: string }
    | { status: 'failed'; error: InstalerSourceErrorCode }
}

export class InstalerUploadError extends Error {
  readonly code: 'payload' | 'payload-too-large' | 'body-timeout' | 'media-type' | 'binding' | 'read-time'

  constructor(code: InstalerUploadError['code']) {
    super('Cannot accept the supplier observation upload.')
    this.code = code
  }
}

function uploadFail(code: InstalerUploadError['code'] = 'payload'): never {
  throw new InstalerUploadError(code)
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) uploadFail()
  return value as Record<string, unknown>
}

function keys(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) uploadFail()
}

export function parseInstalerObservationUpload(
  value: unknown, binding: InstalerSourceBinding, receivedAt: Date,
): InstalerObservationUpload {
  const input = object(value)
  keys(input, ['format', 'version', 'mode', 'fileId', 'account', 'readAt', 'result'])
  if (input.format !== 'luquisound.instaler-observation-upload' || input.version !== 1 || input.mode !== 'observe') uploadFail()
  if (input.fileId !== binding.fileId || typeof input.account !== 'string'
    || input.account !== input.account.trim().toLowerCase()
    || input.account !== binding.expectedEmail.trim().toLowerCase()) uploadFail('binding')
  if (typeof input.readAt !== 'string' || input.readAt.length > 40) uploadFail('read-time')
  const readTime = Date.parse(input.readAt)
  const receipt = receivedAt.getTime()
  if (!Number.isFinite(readTime) || !Number.isFinite(receipt)
    || new Date(readTime).toISOString() !== input.readAt
    || readTime > receipt || readTime < receipt - INSTALER_SOURCE_MAX_AGE_MS) uploadFail('read-time')
  const result = object(input.result)
  const base: UploadBase = {
    format: 'luquisound.instaler-observation-upload', version: 1, mode: 'observe',
    fileId: binding.fileId, account: input.account, readAt: input.readAt,
  }
  if (result.status === 'failed') {
    keys(result, ['status', 'error'])
    if (!INSTALER_SOURCE_ERROR_CODES.includes(result.error as InstalerSourceErrorCode)) uploadFail()
    return { ...base, result: { status: 'failed', error: result.error as InstalerSourceErrorCode } }
  }
  keys(result, ['status', 'metadata', 'bytesBase64'])
  if (result.status !== 'ok' || typeof result.bytesBase64 !== 'string'
    || !result.bytesBase64 || result.bytesBase64.length > MAX_BASE64_LENGTH) uploadFail()
  object(result.metadata)
  return { ...base, result: { status: 'ok', metadata: result.metadata, bytesBase64: result.bytesBase64 } }
}

/** Bound the incoming request before JSON parsing; never trust Content-Length alone. */
export async function readInstalerObservationUpload(
  request: Request, binding: InstalerSourceBinding, receivedAt: Date, timeoutMs = 10_000,
): Promise<InstalerObservationUpload> {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) uploadFail()
  const media = request.headers.get('content-type')?.trim().toLowerCase()
  if (media !== 'application/json' && media !== 'application/json; charset=utf-8') uploadFail('media-type')
  const declared = request.headers.get('content-length')
  if (declared !== null && (!/^(?:0|[1-9]\d*)$/.test(declared) || Number(declared) > INSTALER_UPLOAD_MAX_BYTES)) {
    uploadFail('payload-too-large')
  }
  if (!request.body) uploadFail()
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new InstalerUploadError('body-timeout'))
      void reader.cancel().catch(() => undefined)
    }, timeoutMs)
  })
  try {
    while (true) {
      const next = await Promise.race([reader.read(), expired])
      if (next.done) break
      length += next.value.byteLength
      if (length > INSTALER_UPLOAD_MAX_BYTES) uploadFail('payload-too-large')
      chunks.push(next.value)
    }
    if (declared !== null && Number(declared) !== length) uploadFail()
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    let value: unknown
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { uploadFail() }
    return parseInstalerObservationUpload(value, binding, receivedAt)
  } catch (error) {
    void reader.cancel().catch(() => undefined)
    if (error instanceof InstalerUploadError) throw error
    uploadFail()
  } finally {
    clearTimeout(timer)
    reader.releaseLock()
  }
}

/** Content validation runs after the observer claims its lease, so failures preserve the baseline. */
export function decodeInstalerObservationSource(upload: InstalerObservationUpload): {
  bytes: Uint8Array; metadata: InstalerSourceMetadata; readAt: string;
} {
  if (upload.result.status === 'failed') throw new InstalerSourceError(upload.result.error)
  const invalid = (): never => { throw new InstalerSourceError('source-invalid') }
  const result = upload.result
  let input: Record<string, unknown>
  let capabilities: Record<string, unknown>
  try { input = object(result.metadata); capabilities = object(input.capabilities) } catch { return invalid() }
  if (input.id !== upload.fileId || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 500
    || input.mimeType !== XLSX_MIME || typeof input.size !== 'string' || !/^[1-9]\d*$/.test(input.size)
    || !Number.isSafeInteger(Number(input.size)) || Number(input.size) > INSTALER_SOURCE_MAX_BYTES
    || typeof input.md5Checksum !== 'string' || !/^[a-f0-9]{32}$/i.test(input.md5Checksum)
    || typeof input.version !== 'string' || !/^\d{1,20}$/.test(input.version)
    || typeof input.modifiedTime !== 'string' || input.modifiedTime.length > 40
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(input.modifiedTime)
    || !Number.isFinite(Date.parse(input.modifiedTime))) invalid()
  if (capabilities.canDownload !== true) throw new InstalerSourceError('access')
  if (result.bytesBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(result.bytesBase64)) invalid()
  const bytes = Buffer.from(result.bytesBase64, 'base64')
  if (bytes.length !== Number(input.size) || bytes.length > INSTALER_SOURCE_MAX_BYTES
    || bytes.toString('base64') !== result.bytesBase64
    || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04
    || createHash('md5').update(bytes).digest('hex') !== (input.md5Checksum as string).toLowerCase()) invalid()
  return {
    bytes, readAt: upload.readAt,
    metadata: {
      id: input.id as string, name: input.name as string, mimeType: XLSX_MIME, size: input.size as string,
      md5Checksum: (input.md5Checksum as string).toLowerCase(), modifiedTime: input.modifiedTime as string,
      version: input.version as string, capabilities: { canDownload: true },
    },
  }
}
