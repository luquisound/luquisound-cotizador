import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

export const APPS_SCRIPT_URL = 'https://ls-cotizador.vercel.app/api/instaler-observation'
export const APPS_SCRIPT_FILE_ID = 'synthetic-drive-file'
export const APPS_SCRIPT_EMAIL = 'workshop@example.invalid'
export const APPS_SCRIPT_SECRET = 'synthetic-ingest-secret-at-least-32-characters'
export const APPS_SCRIPT_BYPASS = 'synthetic-vercel-bypass'

export interface AppsScriptFetchOptions {
  method: 'get' | 'post'
  headers: Record<string, string>
  payload?: string
  contentType?: string
  followRedirects: boolean
  muteHttpExceptions: boolean
  validateHttpsCertificates: boolean
}

export interface AppsScriptResponse {
  getResponseCode(): number
  getAllHeaders(): Record<string, string>
  getContentText(): string
  getBlob(): { getBytes(): number[] }
}

export function appsScriptResponse(
  value: unknown, status = 200, contentType = 'application/json',
): AppsScriptResponse {
  const bytes = value instanceof Uint8Array ? Buffer.from(value) : Buffer.from(typeof value === 'string' ? value : JSON.stringify(value))
  return {
    getResponseCode: () => status,
    getAllHeaders: () => ({ 'Content-Type': contentType }),
    getContentText: () => bytes.toString('utf8'),
    getBlob: () => ({ getBytes: () => Array.from(bytes, (byte) => byte > 127 ? byte - 256 : byte) }),
  }
}

interface HarnessOptions {
  properties?: Record<string, string>
  now?: string
  bytes?: Uint8Array
  fetch?: (url: string, options: AppsScriptFetchOptions) => AppsScriptResponse
  lockAvailable?: boolean
  tokenError?: Error
  token?: unknown
  propertyWriteError?: Error
}

interface ScriptExports { observeInstalerDaily(): { status: string } }

export function createAppsScriptHarness(options: HarnessOptions = {}) {
  const properties = new Map(Object.entries({
    INSTALER_OBSERVATION_MODE: 'observe', INSTALER_OBSERVATION_URL: APPS_SCRIPT_URL,
    INSTALER_DRIVE_FILE_ID: APPS_SCRIPT_FILE_ID, INSTALER_GOOGLE_EXPECTED_EMAIL: APPS_SCRIPT_EMAIL,
    INSTALER_OBSERVATION_INGEST_SECRET: APPS_SCRIPT_SECRET, VERCEL_AUTOMATION_BYPASS_SECRET: APPS_SCRIPT_BYPASS,
    ...options.properties,
  }))
  const bytes = options.bytes ?? Buffer.from('synthetic-xlsx-transport-bytes')
  const metadata = {
    id: APPS_SCRIPT_FILE_ID, name: 'Synthetic private supplier.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    size: String(bytes.byteLength), md5Checksum: createHash('md5').update(bytes).digest('hex'),
    modifiedTime: '2026-10-20T00:00:00.000Z', version: '7', capabilities: { canDownload: true },
  }
  const calls: { url: string; options: AppsScriptFetchOptions }[] = []
  const writes: { key: string; value: string }[] = []
  const logs: string[] = []
  let clock = options.now ?? '2026-10-21T10:00:00.000Z'
  let tokenCalls = 0
  let lockAcquisitions = 0
  let lockReleases = 0
  const defaultFetch = (url: string): AppsScriptResponse => {
    if (url.startsWith('https://www.googleapis.com/drive/v3/about?')) {
      return appsScriptResponse({ user: { emailAddress: APPS_SCRIPT_EMAIL } })
    }
    if (url === `https://www.googleapis.com/drive/v3/files/${APPS_SCRIPT_FILE_ID}?alt=media`) {
      return appsScriptResponse(bytes, 200, metadata.mimeType)
    }
    if (url.startsWith(`https://www.googleapis.com/drive/v3/files/${APPS_SCRIPT_FILE_ID}?fields=`)) {
      return appsScriptResponse(metadata)
    }
    if (url === APPS_SCRIPT_URL) {
      const payload = JSON.parse(calls[calls.length - 1]!.options.payload!) as { result: { status: string; error?: string } }
      return appsScriptResponse({
        mode: 'observe', publicationAllowed: false, supplierFreshnessEstablished: false,
        status: payload.result.status === 'failed' ? 'failed' : 'baseline',
        ...(payload.result.status === 'failed' ? { error: payload.result.error } : {}),
      }, payload.result.status === 'failed' ? 502 : 200)
    }
    throw new Error('Unexpected mocked URL')
  }
  class ScriptDate extends Date {
    constructor(value?: string | number) { super(value ?? clock) }
    static override now() { return Date.parse(clock) }
  }
  const globals = {
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key: string) => properties.get(key) ?? null,
        setProperty: (key: string, value: string) => {
          if (options.propertyWriteError) throw options.propertyWriteError
          writes.push({ key, value })
          properties.set(key, value)
        },
      }),
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => { lockAcquisitions++; return options.lockAvailable !== false },
        releaseLock: () => { lockReleases++ },
      }),
    },
    ScriptApp: {
      getOAuthToken: () => {
        tokenCalls++
        if (options.tokenError) throw options.tokenError
        return options.token === undefined ? 'synthetic-google-oauth-token' : options.token
      },
    },
    UrlFetchApp: {
      fetch: (url: string, request: AppsScriptFetchOptions) => {
        calls.push({ url, options: request })
        return (options.fetch ?? defaultFetch)(url, request)
      },
    },
    Utilities: {
      DigestAlgorithm: { MD5: 'md5' },
      computeDigest: (algorithm: string, value: number[]) => Array.from(createHash(algorithm).update(Buffer.from(value)).digest(), (byte) => byte > 127 ? byte - 256 : byte),
      base64Encode: (value: number[]) => Buffer.from(value).toString('base64'),
    },
    console: { log: (line: string) => { logs.push(line) } },
    Date: ScriptDate,
  }
  const context = globals as typeof globals & ScriptExports
  const source = readFileSync(new URL('../../apps-script/instaler-observation/Code.gs', import.meta.url), 'utf8')
  runInNewContext(source, context, { filename: 'Code.gs', timeout: 1000 })
  return {
    run: () => context.observeInstalerDaily(), properties, calls, writes, logs, metadata, bytes, defaultFetch,
    setNow: (value: string) => { clock = value },
    counters: () => ({ tokenCalls, lockAcquisitions, lockReleases }),
  }
}
