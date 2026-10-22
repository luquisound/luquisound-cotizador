import { createHash } from 'node:crypto'
import { BlobError, BlobPreconditionFailedError, get, put } from '@vercel/blob'
import { parseCatalogImport } from '../features/quotation/catalog.ts'
import {
  SHARED_CATALOG_MAX_BYTES, validateSharedCatalogDocument,
} from '../features/quotation/shared-catalog.ts'

export const INSTALER_CATALOG_POLICY_PATH = 'instaler-catalog/policy.json'
export const INSTALER_CATALOG_LAST_VALID_PATH = 'instaler-catalog/last-valid.json'
export const MAX_INSTALER_POLICY_BYTES = 1024 * 1024

export interface InstalerCatalogStore {
  read(): Promise<{ text: string; etag: string }>
  readForRecovery?(): Promise<{ text: string; etag: string }>
  readPolicy(): Promise<string | null>
  archive(text: string): Promise<void>
  quarantine?(text: string): Promise<void>
  write(text: string, etag: string): Promise<string>
}

export class InstalerCatalogStoreError extends Error {
  readonly code: 'conflict' | 'storage'

  constructor(code: 'conflict' | 'storage') {
    super(`Instaler catalogue storage failed (${code}).`)
    this.name = 'InstalerCatalogStoreError'
    this.code = code
  }
}

const PRIVATE_BLOB_HOST = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.private\.blob\.vercel-storage\.com$/i

function fail(code: 'conflict' | 'storage' = 'storage'): never {
  throw new InstalerCatalogStoreError(code)
}

function validEtag(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 256
    && /^(?:"[\x21\x23-\x7e]+"|[A-Za-z0-9._:-]+)$/.test(value) && !value.includes(',')
}

function jsonType(value: string | null): boolean {
  return value?.split(';')[0].trim().toLowerCase() === 'application/json'
}

function validateConfiguration(token: string, catalogUrl: string): { path: string; origin: string } {
  try {
    if (typeof token !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(token)) fail()
    const match = /^https:\/\/([^/?#]+)\/([A-Za-z0-9._/-]+)$/.exec(catalogUrl)
    if (!match || !PRIVATE_BLOB_HOST.test(match[1])) fail()
    const url = new URL(catalogUrl)
    const path = match[2]
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash
      || !PRIVATE_BLOB_HOST.test(url.hostname) || !path.endsWith('.json')
      || path.split('/').some((part) => !part || part === '.' || part === '..')
      || path.startsWith('instaler-observation/') || path.startsWith('instaler-catalog/')) fail()
    return { path, origin: url.origin }
  } catch { return fail() }
}

function validateText(text: string, maxBytes: number, catalog: boolean, allowInvalidJson = false): void {
  if (typeof text !== 'string') fail()
  const bytes = new TextEncoder().encode(text)
  if (bytes.byteLength < 1 || bytes.byteLength > maxBytes
    || new TextDecoder('utf-8', { fatal: true }).decode(bytes) !== text) fail()
  if (allowInvalidJson) return
  if (catalog) validateSharedCatalogDocument(parseCatalogImport(text))
  else JSON.parse(text)
}

async function readText(
  stream: ReadableStream<Uint8Array>, expectedSize: number, maxBytes: number, signal: AbortSignal,
): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let bytes = 0
  let text = ''
  let onAbort: (() => void) | undefined
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new InstalerCatalogStoreError('storage'))
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    while (true) {
      const chunk = await Promise.race([reader.read(), aborted])
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > maxBytes || bytes > expectedSize) fail()
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

function preserveError(error: unknown): never {
  if (error instanceof InstalerCatalogStoreError) throw error
  if (error instanceof BlobPreconditionFailedError) fail('conflict')
  return fail()
}

/** Private catalogue CAS and recovery objects, independent from the observation state. */
export function createInstalerCatalogStore(
  token: string, catalogUrl: string, sdk: { get: typeof get; put: typeof put } = { get, put },
): InstalerCatalogStore {
  const config = validateConfiguration(token, catalogUrl)

  async function readObject(path: string, maxBytes: number, catalog: boolean, allowInvalidJson = false) {
    const signal = AbortSignal.timeout(10000)
    const result = await sdk.get(`${config.origin}/${path}`, {
      access: 'private', token, useCache: false, abortSignal: signal,
      headers: { 'accept-encoding': 'identity' },
    })
    if (result === null) return null
    const length = result.headers.get('content-length')
    const encoding = result.headers.get('content-encoding')
    if (result.statusCode !== 200 || result.blob.pathname !== path
      || result.blob.url !== `${config.origin}/${path}`
      || !jsonType(result.blob.contentType) || !jsonType(result.headers.get('content-type'))
      || (encoding !== null && encoding.trim().toLowerCase() !== 'identity')
      || !Number.isSafeInteger(result.blob.size) || result.blob.size < 1 || result.blob.size > maxBytes
      || !validEtag(result.blob.etag) || result.headers.get('etag') !== result.blob.etag
      || (length !== null && (!/^\d+$/.test(length) || Number(length) !== result.blob.size))) {
      void result.stream?.cancel().catch(() => undefined)
      fail()
    }
    const text = await readText(result.stream, result.blob.size, maxBytes, signal)
    validateText(text, maxBytes, catalog, allowInvalidJson)
    return { text, etag: result.blob.etag }
  }

  async function writeObject(path: string, text: string, etag: string | null): Promise<string> {
    const result = await sdk.put(path, text, {
      access: 'private', token, contentType: 'application/json; charset=utf-8', addRandomSuffix: false,
      allowOverwrite: etag !== null, ...(etag === null ? {} : { ifMatch: etag }),
      cacheControlMaxAge: 60, abortSignal: AbortSignal.timeout(10000),
    })
    if (result.pathname !== path || result.url !== `${config.origin}/${path}`
      || !jsonType(result.contentType) || !validEtag(result.etag)) fail()
    return result.etag
  }

  async function readCurrent() {
    const current = await readObject(config.path, SHARED_CATALOG_MAX_BYTES, true)
    if (current === null) fail()
    return current
  }

  return {
    async read() {
      try { return await readCurrent() } catch (error) { return preserveError(error) }
    },
    async readForRecovery() {
      try {
        const current = await readObject(config.path, SHARED_CATALOG_MAX_BYTES, false, true)
        if (current === null) fail()
        return current
      } catch (error) { return preserveError(error) }
    },
    async readPolicy() {
      try { return (await readObject(INSTALER_CATALOG_POLICY_PATH, MAX_INSTALER_POLICY_BYTES, false))?.text ?? null }
      catch (error) { return preserveError(error) }
    },
    async archive(text) {
      try {
        validateText(text, SHARED_CATALOG_MAX_BYTES, true)
        const digest = createHash('sha256').update(text, 'utf8').digest('hex')
        const path = `instaler-catalog/versions/${digest}.json`
        try {
          await writeObject(path, text, null)
        } catch (error) {
          if (!(error instanceof BlobPreconditionFailedError)
            && !(error instanceof BlobError && /already exists/i.test(error.message))) throw error
          const existing = await readObject(path, SHARED_CATALOG_MAX_BYTES, true)
          if (existing === null || existing.text !== text
            || createHash('sha256').update(existing.text, 'utf8').digest('hex') !== digest) fail()
        }
        // Read backup first: a later backup update invalidates this writer's CAS.
        const backup = await readObject(INSTALER_CATALOG_LAST_VALID_PATH, SHARED_CATALOG_MAX_BYTES, true)
        const current = await readCurrent()
        if (current.text !== text) fail('conflict')
        if (backup?.text !== text) {
          try {
            await writeObject(INSTALER_CATALOG_LAST_VALID_PATH, text, backup?.etag ?? null)
          } catch (error) {
            if (error instanceof BlobError && /already exists/i.test(error.message)) fail('conflict')
            throw error
          }
        }
      } catch (error) { preserveError(error) }
    },
    async quarantine(text) {
      try {
        validateText(text, SHARED_CATALOG_MAX_BYTES, false, true)
        const digest = createHash('sha256').update(text, 'utf8').digest('hex')
        const path = `instaler-catalog/invalid/${digest}.json`
        // Base64 preserves invalid source JSON without making the evidence invalid JSON.
        const evidence = JSON.stringify({
          format: 'luquisound.instaler-invalid-catalog', version: 1, sha256: digest,
          encoding: 'base64', content: Buffer.from(text, 'utf8').toString('base64'),
        })
        const maxEvidenceBytes = Math.ceil(SHARED_CATALOG_MAX_BYTES / 3) * 4 + 256
        validateText(evidence, maxEvidenceBytes, false)
        try {
          await writeObject(path, evidence, null)
        } catch (error) {
          if (!(error instanceof BlobPreconditionFailedError)
            && !(error instanceof BlobError && /already exists/i.test(error.message))) throw error
          const existing = await readObject(path, maxEvidenceBytes, false)
          if (existing === null || existing.text !== evidence) fail()
        }
      } catch (error) { preserveError(error) }
    },
    async write(text, etag) {
      try {
        validateText(text, SHARED_CATALOG_MAX_BYTES, true)
        if (!validEtag(etag)) fail()
        return await writeObject(config.path, text, etag)
      } catch (error) { return preserveError(error) }
    },
  }
}
