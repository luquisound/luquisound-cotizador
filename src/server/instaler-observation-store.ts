import { BlobError, BlobPreconditionFailedError, get, put } from '@vercel/blob'

export const INSTALER_OBSERVATION_PATH = 'instaler-observation/state.json'
export const MAX_OBSERVATION_BYTES = 16 * 1024 * 1024

export interface InstalerObservationStore {
  read(): Promise<{ text: string; etag: string } | null>
  write(text: string, etag: string | null): Promise<string>
}

export class InstalerObservationStoreError extends Error {
  readonly code: 'conflict' | 'storage'

  constructor(code: 'conflict' | 'storage') {
    super(`Instaler observation storage failed (${code}).`)
    this.name = 'InstalerObservationStoreError'
    this.code = code
  }
}

function fail(): never {
  throw new InstalerObservationStoreError('storage')
}

function validEtag(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 256
    && /^(?:"[\x21\x23-\x7e]+"|[A-Za-z0-9._:-]+)$/.test(value) && !value.includes(',')
}

function jsonType(value: string | null): boolean {
  return value?.split(';')[0].trim().toLowerCase() === 'application/json'
}

function validateConfiguration(token: string, currentCatalogUrl: string | undefined): void {
  if (typeof token !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(token)) fail()
  if (currentCatalogUrl !== undefined) {
    try {
      const current = new URL(currentCatalogUrl)
      if (decodeURIComponent(current.pathname).replace(/^\/+/, '') === INSTALER_OBSERVATION_PATH) fail()
    } catch { fail() }
  }
}

async function readText(
  stream: ReadableStream<Uint8Array>, expectedSize: number, signal: AbortSignal,
): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let bytes = 0
  let text = ''
  let onAbort: (() => void) | undefined
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new InstalerObservationStoreError('storage'))
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    while (true) {
      const chunk = await Promise.race([reader.read(), aborted])
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > MAX_OBSERVATION_BYTES || bytes > expectedSize) fail()
      text += decoder.decode(chunk.value, { stream: true })
    }
    if (bytes !== expectedSize) fail()
    return text + decoder.decode()
  } catch {
    void reader.cancel().catch(() => undefined)
    return fail()
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort)
    reader.releaseLock()
  }
}

/** A fixed private observation object; this adapter has no catalogue publication path. */
export function createInstalerObservationStore(
  token: string, currentCatalogUrl?: string, sdk: { get: typeof get; put: typeof put } = { get, put },
): InstalerObservationStore {
  validateConfiguration(token, currentCatalogUrl)
  return {
    async read() {
      try {
        const signal = AbortSignal.timeout(10000)
        const result = await sdk.get(INSTALER_OBSERVATION_PATH, {
          access: 'private', token, useCache: false, abortSignal: signal,
          // Keep byte lengths and the strong ETag stable for conditional writes.
          headers: { 'accept-encoding': 'identity' },
        })
        if (result === null) return null
        const length = result.headers.get('content-length')
        const encoding = result.headers.get('content-encoding')
        if (result.statusCode !== 200 || result.blob.pathname !== INSTALER_OBSERVATION_PATH
          || !jsonType(result.blob.contentType) || !jsonType(result.headers.get('content-type'))
          || (encoding !== null && encoding.trim().toLowerCase() !== 'identity')
          || !Number.isSafeInteger(result.blob.size) || result.blob.size < 1 || result.blob.size > MAX_OBSERVATION_BYTES
          || !validEtag(result.blob.etag) || result.headers.get('etag') !== result.blob.etag
          || (length !== null && (!/^\d+$/.test(length) || Number(length) !== result.blob.size))) {
          void result.stream?.cancel().catch(() => undefined)
          fail()
        }
        const text = await readText(result.stream, result.blob.size, signal)
        return { text, etag: result.blob.etag }
      } catch { fail() }
    },
    async write(text, etag) {
      try {
        if (typeof text !== 'string' || (etag !== null && !validEtag(etag))) fail()
        const bytes = new TextEncoder().encode(text)
        if (bytes.byteLength < 1 || bytes.byteLength > MAX_OBSERVATION_BYTES
          || new TextDecoder('utf-8', { fatal: true }).decode(bytes) !== text) fail()
        JSON.parse(text)
        const result = await sdk.put(INSTALER_OBSERVATION_PATH, text, {
          access: 'private', token, contentType: 'application/json; charset=utf-8', addRandomSuffix: false,
          allowOverwrite: etag !== null, ...(etag === null ? {} : { ifMatch: etag }),
          cacheControlMaxAge: 60, abortSignal: AbortSignal.timeout(10000),
        })
        if (result.pathname !== INSTALER_OBSERVATION_PATH || !jsonType(result.contentType) || !validEtag(result.etag)) fail()
        return result.etag
      } catch (error) {
        if (error instanceof BlobPreconditionFailedError
          || (etag === null && error instanceof BlobError && /already exists/i.test(error.message))) {
          throw new InstalerObservationStoreError('conflict')
        }
        fail()
      }
    },
  }
}
