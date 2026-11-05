import type { D1BoardDatabase, D1BoardResult } from './cloudflare-board-store.ts'

export interface PinAuthOptions {
  secret?: string
  database?: D1BoardDatabase
  now?: () => number
  crypto?: Crypto
}

export type PinSessionResult = { ok: true } | { ok: false; status: 401 | 503 }
export type PinLoginResult = { ok: true; cookie: string } | { ok: false; status: 401 | 429 | 503; retryAfter?: number }

export interface PasswordLoginParameters {
  salt: string
  iterations: 600000
}

export interface PinAuth {
  verifySession(request: Request): Promise<PinSessionResult>
  login(credential: unknown, trustedClientIp: string): Promise<PinLoginResult>
  loginParameters(): PasswordLoginParameters | undefined
  logoutCookie(): string
}

export const PIN_AUTH_COOKIE_NAME = '__Host-luquisound-session'
export const PIN_AUTH_SESSION_SECONDS = 30 * 24 * 60 * 60
export const PIN_AUTH_WINDOW_SECONDS = 15 * 60
export const PIN_AUTH_MAX_SECRET_BYTES = 2048
export const PIN_AUTH_MAX_COOKIE_BYTES = 8192

const encoder = new TextEncoder()
const algorithm = { name: 'HMAC', hash: 'SHA-256' } as const
const cookieAttributes = 'Path=/; HttpOnly; Secure; SameSite=Strict'
const maximumSeconds = 253402300799

interface Configuration {
  key: Uint8Array<ArrayBuffer>
  signature: Uint8Array<ArrayBuffer>
  salt: string
}

interface LimitStatus {
  allowed: number
  global_window: number
  global_attempts: number
  client_window: number
  client_attempts: number
}

const globalAttemptSql = `UPDATE quotation_pin_limits
SET window_start = ?, attempts = CASE WHEN window_start = ? THEN attempts + 1 ELSE 1 END, permit_token = ?
WHERE slot = 0 AND window_start <= ? AND (window_start < ? OR attempts < 50)
AND EXISTS (SELECT 1 FROM quotation_pin_limits WHERE slot = ? AND window_start <= ? AND (window_start < ? OR attempts < 5))`
const clientAttemptSql = `UPDATE quotation_pin_limits
SET window_start = ?, attempts = CASE WHEN window_start = ? THEN attempts + 1 ELSE 1 END
WHERE slot = ? AND EXISTS (SELECT 1 FROM quotation_pin_limits WHERE slot = 0 AND window_start = ? AND permit_token = ?)`
const statusSql = `SELECT (g.permit_token = ?) AS allowed, g.window_start AS global_window,
g.attempts AS global_attempts, c.window_start AS client_window, c.attempts AS client_attempts
FROM quotation_pin_limits g JOIN quotation_pin_limits c ON c.slot = ? WHERE g.slot = 0`

function invalid(): never { throw new Error('Invalid authentication data.') }

function base64url(value: Uint8Array<ArrayBuffer>): string {
  return btoa(String.fromCharCode(...value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function decoded(value: unknown, length: number): Uint8Array<ArrayBuffer> {
  if (typeof value !== 'string' || value.length !== Math.ceil(length * 4 / 3) || !/^[A-Za-z0-9_-]+$/.test(value)) invalid()
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4))
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  if (bytes.length !== length || base64url(bytes) !== value) invalid()
  return bytes
}

function configuration(secret: string | undefined): Configuration {
  if (typeof secret !== 'string' || !secret || secret.length > PIN_AUTH_MAX_SECRET_BYTES
    || encoder.encode(secret).byteLength > PIN_AUTH_MAX_SECRET_BYTES) invalid()
  const parsed: unknown = JSON.parse(secret)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) invalid()
  const value = parsed as Record<string, unknown>
  if (Object.keys(value).length !== 4 || !Object.hasOwn(value, 'version') || value.version !== 3
    || !Object.hasOwn(value, 'key') || !Object.hasOwn(value, 'salt') || !Object.hasOwn(value, 'passwordSignature')) invalid()
  return { key: decoded(value.key, 32), signature: decoded(value.passwordSignature, 32), salt: base64url(decoded(value.salt, 16)) }
}

function validCredential(value: unknown): value is string {
  try { decoded(value, 32); return true }
  catch { return false }
}

function currentTime(now: () => number): number {
  const value = now()
  if (!Number.isSafeInteger(value) || value < 0 || value / 1000 > maximumSeconds - PIN_AUTH_SESSION_SECONDS) invalid()
  return value
}

function clientIp(value: string): string {
  if (typeof value !== 'string' || !value || value.length > 64 || value !== value.trim()) invalid()
  if (/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(value)
    && value.split('.').every((part) => Number(part) <= 255)) return value
  if (!value.includes(':') || !/^[A-Fa-f\d:.]+$/.test(value)) invalid()
  const normalized = new URL(`http://[${value}]/`).hostname
  if (!normalized.startsWith('[') || !normalized.endsWith(']')) invalid()
  return normalized.slice(1, -1)
}

function cookie(request: Request): { signature: Uint8Array<ArrayBuffer>; content: string; expires: number } {
  const header = request.headers.get('Cookie')
  if (header === null || header.length > PIN_AUTH_MAX_COOKIE_BYTES || encoder.encode(header).byteLength > PIN_AUTH_MAX_COOKIE_BYTES) invalid()
  let selected: string | undefined
  for (const part of header.split(';')) {
    const item = part.trim()
    const separator = item.indexOf('=')
    if (separator < 0) {
      if (item === PIN_AUTH_COOKIE_NAME) invalid()
      continue
    }
    if (item.slice(0, separator).trim() !== PIN_AUTH_COOKIE_NAME) continue
    if (selected !== undefined || item.slice(0, separator) !== PIN_AUTH_COOKIE_NAME) invalid()
    selected = item.slice(separator + 1)
  }
  if (selected === undefined || selected.length > 160) invalid()
  const parts = selected.split('.')
  if (parts.length !== 4 || parts[0] !== 'v1' || !/^[1-9]\d{0,11}$/.test(parts[1]!)) invalid()
  const expires = Number(parts[1])
  if (!Number.isSafeInteger(expires) || expires > maximumSeconds) invalid()
  decoded(parts[2], 24)
  return { expires, content: parts.slice(0, 3).join('.'), signature: decoded(parts[3], 32) }
}

function rows<T>(result: D1BoardResult<T> | undefined): T[] {
  if (!result?.success || !Array.isArray(result.results)) invalid()
  return result.results
}

function limitStatus(value: LimitStatus | undefined, window: number): LimitStatus {
  if (!value || ![0, 1].includes(value.allowed)
    || ![value.global_window, value.client_window].every((stamp) => Number.isSafeInteger(stamp) && stamp >= 0 && stamp <= window && stamp % PIN_AUTH_WINDOW_SECONDS === 0)
    || !Number.isInteger(value.global_attempts) || value.global_attempts < 0 || value.global_attempts > 50
    || !Number.isInteger(value.client_attempts) || value.client_attempts < 0 || value.client_attempts > 5) invalid()
  return value
}

// The browser derives a 32-byte PBKDF2-SHA256 credential (600,000 iterations).
// The Worker verifies that password-equivalent credential after throttling;
// performing the KDF on the client keeps login within the Free CPU allowance.
export function createPinAuth(options: PinAuthOptions = {}): PinAuth {
  const logoutCookie = (): string => `${PIN_AUTH_COOKIE_NAME}=; ${cookieAttributes}; Max-Age=0`
  let config: Configuration
  let webCrypto: Crypto
  let key: Promise<CryptoKey | null>
  const now = options.now ?? Date.now
  try {
    config = configuration(options.secret)
    webCrypto = options.crypto ?? globalThis.crypto
    key = webCrypto.subtle.importKey('raw', config.key, algorithm, false, ['sign', 'verify']).catch(() => null)
  } catch {
    return { verifySession: async () => ({ ok: false, status: 503 }), login: async () => ({ ok: false, status: 503 }), loginParameters: () => undefined, logoutCookie }
  }

  async function verifySession(request: Request): Promise<PinSessionResult> {
    let time: number
    try { time = Math.floor(currentTime(now) / 1000) }
    catch { return { ok: false, status: 503 } }
    let session: ReturnType<typeof cookie>
    try {
      session = cookie(request)
      if (session.expires <= time || session.expires - time > PIN_AUTH_SESSION_SECONDS + 60) invalid()
    } catch { return { ok: false, status: 401 } }
    const imported = await key
    if (!imported) return { ok: false, status: 503 }
    try {
      const verified = await webCrypto.subtle.verify('HMAC', imported, session.signature, encoder.encode(`session:${session.content}`))
      const checkedAt = Math.floor(currentTime(now) / 1000)
      return verified && session.expires > checkedAt && session.expires - checkedAt <= PIN_AUTH_SESSION_SECONDS + 60
        ? { ok: true } : { ok: false, status: 401 }
    } catch { return { ok: false, status: 503 } }
  }

  async function login(credential: unknown, trustedClientIp: string): Promise<PinLoginResult> {
    try {
      const database = options.database
      const imported = await key
      if (!database || !imported) invalid()
      const time = currentTime(now)
      const window = Math.floor(time / (PIN_AUTH_WINDOW_SECONDS * 1000)) * PIN_AUTH_WINDOW_SECONDS
      const address = clientIp(trustedClientIp)
      const hashed = new Uint8Array(await webCrypto.subtle.sign('HMAC', imported, encoder.encode(`ip:${address}`)))
      const slot = 1 + (hashed[0]! & 127)
      const token = base64url(webCrypto.getRandomValues(new Uint8Array(16)))
      // D1 batch is transactional: a permission is usable only after both
      // counters are committed and this request's token is confirmed.
      const result = await database.batch<LimitStatus>([
        database.prepare(globalAttemptSql).bind(window, window, token, window, window, slot, window, window),
        database.prepare(clientAttemptSql).bind(window, window, slot, window, token),
        database.prepare(statusSql).bind(token, slot),
      ])
      if (result.length !== 3 || rows(result[0]).length !== 0 || rows(result[1]).length !== 0 || rows(result[2]).length !== 1) invalid()
      const status = limitStatus(result[2]!.results[0], window)
      if (result[0]!.meta.changes !== status.allowed || result[1]!.meta.changes !== status.allowed) invalid()
      if (!status.allowed) {
        if (!(status.global_window === window && status.global_attempts === 50)
          && !(status.client_window === window && status.client_attempts === 5)) invalid()
        return { ok: false, status: 429, retryAfter: Math.max(1, Math.ceil(((window + PIN_AUTH_WINDOW_SECONDS) * 1000 - time) / 1000)) }
      }
      if (status.global_window !== window || status.client_window !== window || status.global_attempts < 1 || status.client_attempts < 1) invalid()
      if (!validCredential(credential)
        || !await webCrypto.subtle.verify('HMAC', imported, config.signature, encoder.encode(`password:${credential}`))) return { ok: false, status: 401 }
      const expires = Math.floor(currentTime(now) / 1000) + PIN_AUTH_SESSION_SECONDS
      const nonce = base64url(webCrypto.getRandomValues(new Uint8Array(24)))
      const content = `v1.${expires}.${nonce}`
      const signature = base64url(new Uint8Array(await webCrypto.subtle.sign('HMAC', imported, encoder.encode(`session:${content}`))))
      return { ok: true, cookie: `${PIN_AUTH_COOKIE_NAME}=${content}.${signature}; ${cookieAttributes}; Max-Age=${PIN_AUTH_SESSION_SECONDS}` }
    } catch { return { ok: false, status: 503 } }
  }

  // Clearing this browser's stateless cookie does not revoke copied sessions.
  // Expiry or rotating the secret key invalidates them without per-request D1.
  return { verifySession, login, loginParameters: () => ({ salt: config.salt, iterations: 600000 }), logoutCookie }
}
