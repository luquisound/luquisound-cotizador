import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pbkdf2Sync } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import {
  createPinAuth, PIN_AUTH_COOKIE_NAME, PIN_AUTH_MAX_COOKIE_BYTES, PIN_AUTH_MAX_SECRET_BYTES,
  PIN_AUTH_SESSION_SECONDS, PIN_AUTH_WINDOW_SECONDS,
} from '../src/server/pin-auth.ts'
import type { PinAuthOptions, PinLoginResult } from '../src/server/pin-auth.ts'
import type { D1BoardDatabase, D1BoardResult, D1BoardStatement } from '../src/server/cloudflare-board-store.ts'

const chosenPassword = 'Example9Ab2'
const salt = Buffer.alloc(16, 7)
const password = pbkdf2Sync(chosenPassword, salt, 600000, 32, 'sha256').toString('base64url')
const wrongPassword = Buffer.alloc(32).toString('base64url')
const timestamp = Date.parse('2026-11-04T16:07:12.345Z')
const unauthorized = { ok: false, status: 401 }
const unavailable = { ok: false, status: 503 }
const migration = readFileSync(new URL('../cloudflare/migrations/0003_pin_auth.sql', import.meta.url), 'utf8')

class Statement implements D1BoardStatement {
  readonly sql: string
  readonly values: (string | number | null)[]
  readonly database: SqliteDatabase
  constructor(database: SqliteDatabase, sql: string, values: (string | number | null)[] = []) {
    this.database = database; this.sql = sql; this.values = values
  }
  bind(...values: (string | number | null)[]): D1BoardStatement { return new Statement(this.database, this.sql, values) }
  async all<T>(): Promise<D1BoardResult<T>> { return this.database.execute<T>(this) }
}

class SqliteDatabase implements D1BoardDatabase {
  readonly sqlite = new DatabaseSync(':memory:')
  readonly boundValues: (string | number | null)[] = []
  batches = 0
  ambiguousCommit = false

  constructor() { this.sqlite.exec(migration) }
  prepare(sql: string): D1BoardStatement { return new Statement(this, sql) }
  execute<T>(statement: Statement): D1BoardResult<T> {
    this.boundValues.push(...statement.values)
    const results = this.sqlite.prepare(statement.sql).all(...statement.values) as unknown as T[]
    const meta = this.sqlite.prepare('SELECT changes() AS changes').get() as { changes: number }
    return { success: true, results, meta }
  }
  async batch<T>(statements: D1BoardStatement[]): Promise<D1BoardResult<T>[]> {
    this.batches += 1
    this.sqlite.exec('BEGIN IMMEDIATE')
    let result: D1BoardResult<T>[]
    try {
      result = statements.map((statement) => this.execute<T>(statement as Statement))
      this.sqlite.exec('COMMIT')
    } catch (error) { this.sqlite.exec('ROLLBACK'); throw error }
    if (this.ambiguousCommit) { this.ambiguousCommit = false; throw new Error('Synthetic committed response lost') }
    return result
  }
  limits() {
    return this.sqlite.prepare('SELECT slot, window_start, attempts, permit_token FROM quotation_pin_limits ORDER BY slot').all() as unknown as { slot: number; window_start: number; attempts: number; permit_token: string | null }[]
  }
}

async function configuration(publicSalt = salt) {
  const raw = crypto.getRandomValues(new Uint8Array(32))
  const key = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const credential = publicSalt.equals(salt) ? password : pbkdf2Sync(chosenPassword, publicSalt, 600000, 32, 'sha256').toString('base64url')
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`password:${credential}`))
  const data = { version: 3, key: Buffer.from(raw).toString('base64url'), salt: publicSalt.toString('base64url'), passwordSignature: Buffer.from(signature).toString('base64url') }
  return {
    data, credential, secret: JSON.stringify(data),
    async signedCookie(content: string) {
      const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`session:${content}`))
      return `${PIN_AUTH_COOKIE_NAME}=${content}.${Buffer.from(signature).toString('base64url')}`
    },
    async distinctIps(count: number): Promise<string[]> {
      const selected = new Map<number, string>()
      for (let index = 1; index < 65536 && selected.size < count; index++) {
        const ip = `192.0.${Math.floor(index / 256)}.${index % 256}`
        const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`ip:${ip}`)))
        selected.set(signature[0]! & 127, ip)
      }
      assert.equal(selected.size, count)
      return [...selected.values()]
    },
  }
}

function request(cookie?: string, headers: HeadersInit = {}): Request {
  const combined = new Headers(headers)
  if (cookie !== undefined) combined.set('Cookie', cookie)
  return new Request('https://quotation.example/api/quotation-board', { headers: combined })
}

function sessionCookie(result: PinLoginResult): string {
  assert.equal(result.ok, true)
  if (!result.ok) throw new Error('Expected synthetic login success')
  return result.cookie.split(';')[0]!
}

test('real HMAC derived-credential login creates a secure remembered cookie with no database work during verification', async (context) => {
  const database = new SqliteDatabase()
  context.after(() => database.sqlite.close())
  const config = await configuration()
  const auth = createPinAuth({ secret: config.secret, database, now: () => timestamp })
  const result = await auth.login(password, '192.0.2.1')
  const cookie = sessionCookie(result)
  if (!result.ok) throw new Error('Expected synthetic cookie')
  assert.match(result.cookie, /; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000$/)
  const parts = cookie.slice(PIN_AUTH_COOKIE_NAME.length + 1).split('.')
  assert.equal(parts[0], 'v1')
  assert.equal(Number(parts[1]), Math.floor(timestamp / 1000) + PIN_AUTH_SESSION_SECONDS)
  assert.equal(Buffer.from(parts[2]!, 'base64url').length, 24)
  assert.equal(Buffer.from(parts[3]!, 'base64url').length, 32)
  assert.equal(database.batches, 1)
  assert.deepEqual(await auth.verifySession(request(cookie)), { ok: true })
  assert.deepEqual(await auth.verifySession(request(`unrelated=synthetic; ${cookie}`)), { ok: true })
  assert.equal(database.batches, 1)
  const withoutDatabase = createPinAuth({ secret: config.secret, now: () => timestamp })
  assert.deepEqual(await withoutDatabase.verifySession(request(cookie)), { ok: true })
  assert.deepEqual(await withoutDatabase.login(password, '192.0.2.1'), unavailable)
  for (const credential of [chosenPassword, password, config.data.key, config.data.passwordSignature]) {
    assert.equal(database.boundValues.includes(credential), false)
    assert.equal(JSON.stringify(database.limits()).includes(credential), false)
  }
})

test('both users share equal access, independent nonce cookies and client-only logout', async (context) => {
  const database = new SqliteDatabase()
  context.after(() => database.sqlite.close())
  const { secret } = await configuration()
  const auth = createPinAuth({ secret, database, now: () => timestamp })
  const first = sessionCookie(await auth.login(password, '192.0.2.1'))
  const second = sessionCookie(await auth.login(password, '192.0.2.2'))
  assert.notEqual(first, second)
  assert.deepEqual(await auth.verifySession(request(first)), { ok: true })
  assert.deepEqual(await auth.verifySession(request(second)), { ok: true })
  assert.equal(auth.logoutCookie(), `${PIN_AUTH_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`)
  assert.deepEqual(await auth.verifySession(request(`${PIN_AUTH_COOKIE_NAME}=`)), unauthorized)
  // A copied stateless bearer cookie remains usable until expiry or key rotation.
  assert.deepEqual(await auth.verifySession(request(first)), { ok: true })
})

test('missing cookies, asserted identities and duplicate or ambiguous target cookies never authenticate', async (context) => {
  const database = new SqliteDatabase()
  context.after(() => database.sqlite.close())
  const { secret } = await configuration()
  const auth = createPinAuth({ secret, database, now: () => timestamp })
  const cookie = sessionCookie(await auth.login(password, '192.0.2.1'))
  assert.deepEqual(await auth.verifySession(request(undefined, {
    'Cf-Access-Jwt-Assertion': 'synthetic', 'Cf-Access-Authenticated-User-Email': 'test@example.test',
    Authorization: `Basic ${Buffer.from(`synthetic:${password}`).toString('base64')}`,
  })), unauthorized)
  for (const value of [
    `${cookie}; ${cookie}`, `${cookie}; ${PIN_AUTH_COOKIE_NAME}=`, `${PIN_AUTH_COOKIE_NAME}=; ${cookie}`,
    `${cookie}; ${PIN_AUTH_COOKIE_NAME}`, `${PIN_AUTH_COOKIE_NAME}; ${cookie}`,
    cookie.replace('=', ' ='), cookie.replace('=', '="') + '"', cookie.replace('=', '=%76'),
    `${cookie}; ignored=${'x'.repeat(PIN_AUTH_MAX_COOKIE_BYTES)}`, `${cookie},${cookie}`, 'unrelated=synthetic',
  ]) assert.deepEqual(await auth.verifySession(request(value)), unauthorized)
})

test('forgery, altered expiration/nonce/signature and cross-purpose HMAC signatures are rejected', async (context) => {
  const database = new SqliteDatabase()
  context.after(() => database.sqlite.close())
  const config = await configuration()
  const auth = createPinAuth({ secret: config.secret, database, now: () => timestamp })
  const cookie = sessionCookie(await auth.login(password, '192.0.2.1'))
  const parts = cookie.slice(PIN_AUTH_COOKIE_NAME.length + 1).split('.')
  for (const changed of [
    ['v2', ...parts.slice(1)], [parts[0], String(Number(parts[1]) + 1), ...parts.slice(2)],
    [parts[0], parts[1], Buffer.alloc(24, 1).toString('base64url'), parts[3]],
    [...parts.slice(0, 3), config.data.passwordSignature], [...parts.slice(0, 3), Buffer.alloc(32, 1).toString('base64url')],
    [...parts.slice(0, 3), `${parts[3]}=`], [...parts.slice(0, 3), 'B'.repeat(43)],
    [parts[0], parts[1], `${parts[2]}=`, parts[3]], [parts[0], `0${parts[1]}`, ...parts.slice(2)],
  ]) assert.deepEqual(await auth.verifySession(request(`${PIN_AUTH_COOKIE_NAME}=${changed.join('.')}`)), unauthorized)
  const other = await configuration()
  assert.deepEqual(await createPinAuth({ secret: other.secret, now: () => timestamp }).verifySession(request(cookie)), unauthorized)
})

test('sessions expire exactly at their signed second and reject far-future or malformed timestamps', async (context) => {
  const database = new SqliteDatabase()
  context.after(() => database.sqlite.close())
  const config = await configuration()
  let time = timestamp
  const auth = createPinAuth({ secret: config.secret, database, now: () => time })
  const cookie = sessionCookie(await auth.login(password, '192.0.2.1'))
  const expires = Number(cookie.slice(PIN_AUTH_COOKIE_NAME.length + 1).split('.')[1])
  time = expires * 1000 - 1
  assert.deepEqual(await auth.verifySession(request(cookie)), { ok: true })
  time += 1
  assert.deepEqual(await auth.verifySession(request(cookie)), unauthorized)
  time = timestamp
  const nonce = Buffer.alloc(24, 3).toString('base64url')
  const seconds = Math.floor(time / 1000)
  for (const expiration of [0, seconds, seconds - 1, seconds + PIN_AUTH_SESSION_SECONDS + 61, 253402300800]) {
    const signed = await config.signedCookie(`v1.${expiration}.${nonce}`)
    assert.deepEqual(await auth.verifySession(request(signed)), unauthorized)
  }
  assert.deepEqual(await auth.verifySession(request(await config.signedCookie(`v1.${seconds + PIN_AUTH_SESSION_SECONDS + 60}.${nonce}`))), { ok: true })
  assert.equal(database.batches, 1)
})

test('login requires a canonical 32-byte derived credential and never accepts raw passwords or normalized values', async (context) => {
  const config = await configuration()
  for (const supplied of [
    password.slice(0, -1), `${password}X`, ` ${password}`, `${password} `,
    password.toLowerCase(), password.toUpperCase(),
    `${password.slice(0, -1)}!`, `${password.slice(0, -1)}\u00e9`,
    `${password.slice(0, -1)}\u0661`, `${password}=`, 'B'.repeat(43),
    chosenPassword, 'Ab9Cd8Ef7Gh6Ij5Kl4Mn3Op2', '58372904', 58372904, null, undefined, wrongPassword,
  ]) {
    const database = new SqliteDatabase()
    context.after(() => database.sqlite.close())
    const auth = createPinAuth({ secret: config.secret, database, now: () => timestamp })
    assert.deepEqual(await auth.login(supplied, '192.0.2.1'), unauthorized)
    assert.equal(database.limits()[0]!.attempts, 1)
    assert.equal((await auth.login(password, '192.0.2.1')).ok, true)
  }
})

test('legacy PIN and generated-password configurations are rejected and fresh keys revoke prior sessions', async (context) => {
  const database = new SqliteDatabase()
  context.after(() => database.sqlite.close())
  const old = await configuration()
  const key = await crypto.subtle.importKey('raw', Buffer.from(old.data.key, 'base64url'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const legacySignature = Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('pin:58372904'))).toString('base64url')
  const legacySecret = JSON.stringify({ version: 1, key: old.data.key, pinSignature: legacySignature })
  const disabled = createPinAuth({ secret: legacySecret, database, now: () => timestamp })
  assert.deepEqual(await disabled.login('58372904', '192.0.2.1'), unavailable)
  const generatedSecret = JSON.stringify({ version: 2, key: old.data.key, passwordSignature: old.data.passwordSignature })
  const generated = createPinAuth({ secret: generatedSecret, database, now: () => timestamp })
  assert.deepEqual(await generated.login('Ab9Cd8Ef7Gh6Ij5Kl4Mn3Op2', '192.0.2.1'), unavailable)
  assert.equal(generated.loginParameters(), undefined)
  assert.equal(database.batches, 0)

  const previousCookie = await old.signedCookie(`v1.${Math.floor(timestamp / 1000) + PIN_AUTH_SESSION_SECONDS}.${Buffer.alloc(24, 4).toString('base64url')}`)
  const current = await configuration()
  const auth = createPinAuth({ secret: current.secret, database, now: () => timestamp })
  assert.deepEqual(await auth.verifySession(request(previousCookie)), unauthorized)
  assert.deepEqual(await auth.login('58372904', '192.0.2.1'), unauthorized)
  const currentCookie = sessionCookie(await auth.login(password, '192.0.2.1'))
  assert.deepEqual(await auth.verifySession(request(currentCookie)), { ok: true })

  const wrongDomainSignature = Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`pin:${password}`))).toString('base64url')
  const wrongDomain = createPinAuth({ secret: JSON.stringify({ ...old.data, passwordSignature: wrongDomainSignature }), database, now: () => timestamp })
  assert.deepEqual(await wrongDomain.login(password, '192.0.2.1'), unauthorized)
})

test('only public KDF parameters are exposed and rotating salt changes the accepted credential', async (context) => {
  const database = new SqliteDatabase()
  context.after(() => database.sqlite.close())
  const config = await configuration(Buffer.alloc(16, 8))
  const auth = createPinAuth({ secret: config.secret, database, now: () => timestamp })
  const parameters = auth.loginParameters()
  assert.deepEqual(parameters, { salt: config.data.salt, iterations: 600000 })
  assert.notEqual(config.credential, password)
  assert.deepEqual(await auth.login(password, '192.0.2.1'), unauthorized)
  assert.equal((await auth.login(config.credential, '192.0.2.1')).ok, true)
  assert.deepEqual(await auth.login(pbkdf2Sync(chosenPassword.toLowerCase(), Buffer.alloc(16, 8), 600000, 32, 'sha256').toString('base64url'), '192.0.2.1'), unauthorized)
  if (!parameters) throw new Error('Expected public parameters')
  parameters.salt = 'changed outside auth'
  assert.equal(auth.loginParameters()?.salt, config.data.salt)
})

test('wrong and malformed passwords consume the same fixed client allowance before verification', async (context) => {
  const database = new SqliteDatabase()
  context.after(() => database.sqlite.close())
  const { secret } = await configuration()
  const auth = createPinAuth({ secret, database, now: () => timestamp })
  for (const value of [wrongPassword, '1234', null, 58372904, '58372904 ']) {
    assert.deepEqual(await auth.login(value, '192.0.2.1'), unauthorized)
  }
  const before = database.limits()
  const result = await auth.login(password, '192.0.2.1')
  assert.deepEqual(result, { ok: false, status: 429, retryAfter: 468 })
  assert.deepEqual(database.limits(), before)
  assert.equal(before[0]!.attempts, 5)
  assert.equal(before.filter((row) => row.attempts > 0).length, 2)
})

test('concurrent Worker instances cannot pass more than five client attempts in a window', async (context) => {
  const database = new SqliteDatabase()
  context.after(() => database.sqlite.close())
  const { secret } = await configuration()
  const workers = Array.from({ length: 4 }, () => createPinAuth({ secret, database, now: () => timestamp }))
  const results = await Promise.all(Array.from({ length: 32 }, (_, index) => workers[index % workers.length]!.login(password, '192.0.2.1')))
  assert.equal(results.filter((result) => result.ok).length, 5)
  assert.equal(results.filter((result) => !result.ok && result.status === 429).length, 27)
  assert.equal(database.limits()[0]!.attempts, 5)
  assert.equal(database.limits().filter((row) => row.attempts === 5).length, 2)
})

test('global guessing is capped at fifty attempts across distinct IP buckets and Worker instances', async (context) => {
  const database = new SqliteDatabase()
  context.after(() => database.sqlite.close())
  const config = await configuration()
  const ips = await config.distinctIps(12)
  const workers = ips.map(() => createPinAuth({ secret: config.secret, database, now: () => timestamp }))
  const results = await Promise.all(ips.flatMap((ip, index) => Array.from({ length: 5 }, () => workers[index]!.login(wrongPassword, ip))))
  assert.equal(results.filter((result) => !result.ok && result.status === 401).length, 50)
  assert.equal(results.filter((result) => !result.ok && result.status === 429).length, 10)
  const before = database.limits()
  assert.equal(before[0]!.attempts, 50)
  const correct = await workers[0]!.login(password, ips[0]!)
  assert.deepEqual(correct, { ok: false, status: 429, retryAfter: 468 })
  assert.deepEqual(database.limits(), before)
})

test('fixed windows do not slide on failures and reset only at the next boundary', async (context) => {
  const database = new SqliteDatabase()
  context.after(() => database.sqlite.close())
  const { secret } = await configuration()
  let time = timestamp
  const auth = createPinAuth({ secret, database, now: () => time })
  for (let index = 0; index < 5; index++) assert.deepEqual(await auth.login(wrongPassword, '192.0.2.1'), unauthorized)
  const window = Math.floor(timestamp / (PIN_AUTH_WINDOW_SECONDS * 1000)) * PIN_AUTH_WINDOW_SECONDS
  const before = database.limits()
  time = (window + PIN_AUTH_WINDOW_SECONDS) * 1000 - 1
  assert.deepEqual(await auth.login(password, '192.0.2.1'), { ok: false, status: 429, retryAfter: 1 })
  assert.deepEqual(database.limits(), before)
  time += 1
  assert.equal((await auth.login(password, '192.0.2.1')).ok, true)
  const after = database.limits()
  assert.equal(after[0]!.window_start, window + PIN_AUTH_WINDOW_SECONDS)
  assert.equal(after[0]!.attempts, 1)
  assert.equal(after.filter((row) => row.attempts === 1).length, 2)
})

test('arbitrary IP diversity cannot grow the fixed storage or preserve raw IP addresses', async (context) => {
  const database = new SqliteDatabase()
  context.after(() => database.sqlite.close())
  const { secret } = await configuration()
  const auth = createPinAuth({ secret, database, now: () => timestamp })
  for (let index = 1; index <= 256; index++) await auth.login(wrongPassword, `198.51.${Math.floor(index / 256)}.${index % 256}`)
  const limits = database.limits()
  assert.equal(limits.length, 129)
  assert.equal(limits[0]!.slot, 0)
  assert.equal(limits[128]!.slot, 128)
  assert.ok(limits.every((row) => row.slot === 0 || row.permit_token === null))
  assert.ok(database.boundValues.every((value) => typeof value !== 'string' || /^[A-Za-z0-9_-]{22}$/.test(value)))
  assert.throws(() => database.sqlite.prepare('INSERT INTO quotation_pin_limits VALUES (129, 0, 0, NULL)').run())
})

test('canonical IPv6 representations share a bucket while invalid or absent trusted IPs fail closed', async (context) => {
  const database = new SqliteDatabase()
  context.after(() => database.sqlite.close())
  const { secret } = await configuration()
  const auth = createPinAuth({ secret, database, now: () => timestamp })
  for (let index = 0; index < 5; index++) assert.deepEqual(await auth.login(wrongPassword, '2001:0DB8:0000:0000:0000:0000:0000:0001'), unauthorized)
  assert.deepEqual(await auth.login(password, '2001:db8::1'), { ok: false, status: 429, retryAfter: 468 })
  const batches = database.batches
  for (const address of ['', 'unknown', '192.0.2.1,192.0.2.2', ' 192.0.2.1', '256.0.0.1', '001.0.0.1', ':::', '[::1]', '::1%eth0', 'a'.repeat(65)]) {
    assert.deepEqual(await auth.login(password, address), unavailable)
  }
  assert.equal(database.batches, batches)
})

test('database outages, missing migration, rollback and ambiguous commits never issue a session', async (context) => {
  const database = new SqliteDatabase()
  context.after(() => database.sqlite.close())
  const { secret } = await configuration()
  const options = { secret, database, now: () => timestamp }
  database.sqlite.exec("CREATE TRIGGER fail_client BEFORE UPDATE ON quotation_pin_limits WHEN NEW.slot <> 0 BEGIN SELECT RAISE(ABORT, 'Synthetic private database detail'); END")
  assert.deepEqual(await createPinAuth(options).login(password, '192.0.2.1'), unavailable)
  assert.ok(database.limits().every((row) => row.attempts === 0 && row.permit_token === null))
  database.sqlite.exec('DROP TRIGGER fail_client')
  database.ambiguousCommit = true
  assert.deepEqual(await createPinAuth(options).login(password, '192.0.2.1'), unavailable)
  assert.equal(database.limits()[0]!.attempts, 1)
  database.sqlite.exec('DROP TABLE quotation_pin_limits')
  assert.deepEqual(await createPinAuth(options).login(password, '192.0.2.1'), unavailable)
  const failed: D1BoardDatabase = { prepare() { throw new Error('Synthetic quota outage') }, async batch() { throw new Error('Synthetic quota outage') } }
  assert.deepEqual(await createPinAuth({ ...options, database: failed }).login(password, '192.0.2.1'), unavailable)
})

test('failed, missing or inconsistent D1 results fail closed before checking the password', async (context) => {
  const database = new SqliteDatabase()
  context.after(() => database.sqlite.close())
  const { secret } = await configuration()
  const invalidResults = [
    [], [{ success: false, results: [], meta: {} }],
    [{ success: true, results: [], meta: { changes: 1 } }, { success: true, results: [], meta: { changes: 0 } }, {
      success: true, results: [{ allowed: 1, global_window: 0, global_attempts: 1, client_window: 0, client_attempts: 1 }], meta: {},
    }],
  ]
  for (const result of invalidResults) {
    const malformed: D1BoardDatabase = {
      prepare: database.prepare.bind(database),
      async batch<T>() { return result as unknown as D1BoardResult<T>[] },
    }
    assert.deepEqual(await createPinAuth({ secret, database: malformed, now: () => timestamp }).login(password, '192.0.2.1'), unavailable)
  }
})

test('invalid clocks and clock rollback cannot reopen a previous guessing window', async (context) => {
  const database = new SqliteDatabase()
  context.after(() => database.sqlite.close())
  const { secret } = await configuration()
  let time = timestamp
  const auth = createPinAuth({ secret, database, now: () => time })
  const cookie = sessionCookie(await auth.login(password, '192.0.2.1'))
  const before = database.limits()
  time = before[0]!.window_start * 1000 - 1
  assert.deepEqual(await auth.login(password, '192.0.2.1'), unavailable)
  assert.deepEqual(database.limits(), before)
  for (const invalid of [NaN, Infinity, -1, timestamp + .5, Number.MAX_SAFE_INTEGER]) {
    time = invalid
    assert.deepEqual(await auth.login(password, '192.0.2.1'), unavailable)
    assert.deepEqual(await auth.verifySession(request(cookie)), unavailable)
  }
  const throws = createPinAuth({ secret, database, now: () => { throw new Error('Synthetic private clock detail') } })
  assert.deepEqual(await throws.verifySession(request(cookie)), unavailable)
})

test('missing and malformed configuration is cached as unavailable with strict secret bounds', async () => {
  const config = await configuration()
  const malformed = [
    undefined, '', '{', 'null', '[]', JSON.stringify({}),
    JSON.stringify({ ...config.data, extra: true }), JSON.stringify({ ...config.data, version: 1 }),
    JSON.stringify({ ...config.data, version: 2 }),
    JSON.stringify({ version: 3, key: config.data.key, salt: config.data.salt, pinSignature: config.data.passwordSignature }),
    JSON.stringify({ ...config.data, version: '3' }), JSON.stringify({ ...config.data, passwordSignature: undefined }),
    JSON.stringify({ ...config.data, key: Buffer.alloc(31).toString('base64url') }),
    JSON.stringify({ ...config.data, key: Buffer.alloc(33).toString('base64url') }),
    JSON.stringify({ ...config.data, key: `${config.data.key}=` }),
    JSON.stringify({ ...config.data, key: 'B'.repeat(43) }),
    JSON.stringify({ ...config.data, passwordSignature: 'B'.repeat(43) }),
    JSON.stringify({ ...config.data, salt: undefined }), JSON.stringify({ ...config.data, salt: 'B'.repeat(22) }),
    JSON.stringify({ ...config.data, salt: `${config.data.salt}=` }),
    JSON.stringify({ ...config.data, salt: Buffer.alloc(15).toString('base64url') }),
    JSON.stringify({ ...config.data, salt: Buffer.alloc(17).toString('base64url') }),
    config.secret.padEnd(PIN_AUTH_MAX_SECRET_BYTES + 1, ' '),
  ]
  for (const secret of malformed) {
    const auth = createPinAuth({ secret, now: () => timestamp })
    assert.deepEqual(await auth.verifySession(request()), unavailable)
    assert.deepEqual(await auth.login(password, '192.0.2.1'), unavailable)
    assert.equal(auth.loginParameters(), undefined)
  }
  const exact = createPinAuth({ secret: config.secret.padEnd(PIN_AUTH_MAX_SECRET_BYTES, ' '), now: () => timestamp })
  assert.deepEqual(await exact.verifySession(request()), unauthorized)
})

test('cryptographic failures are unavailable and password verification only starts after confirmed D1 commit', async (context) => {
  const database = new SqliteDatabase()
  context.after(() => database.sqlite.close())
  const { secret } = await configuration()
  let imports = 0
  let passwordVerifications = 0
  const observed = {
    getRandomValues: crypto.getRandomValues.bind(crypto),
    subtle: {
      importKey(format: 'raw', data: BufferSource, algorithm: HmacImportParams, extractable: boolean, usages: KeyUsage[]) {
        imports += 1
        assert.equal(extractable, false)
        assert.deepEqual(usages, ['sign', 'verify'])
        return crypto.subtle.importKey(format, data, algorithm, extractable, usages)
      },
      sign: crypto.subtle.sign.bind(crypto.subtle),
      verify(algorithm: AlgorithmIdentifier, key: CryptoKey, signature: BufferSource, data: BufferSource) {
        passwordVerifications += 1
        assert.ok(database.batches >= 1)
        assert.ok(database.limits()[0]!.attempts >= 1)
        return crypto.subtle.verify(algorithm, key, signature, data)
      },
    },
  } as unknown as Crypto
  const auth = createPinAuth({ secret, database, now: () => timestamp, crypto: observed })
  for (let index = 0; index < 6; index++) await auth.login(wrongPassword, '192.0.2.1')
  assert.equal(imports, 1)
  assert.equal(passwordVerifications, 5)
  const failure = new Error('Synthetic private cryptographic detail')
  const failingImport = { subtle: { importKey: async () => { throw failure } } } as unknown as Crypto
  const broken = createPinAuth({ secret, database, now: () => timestamp, crypto: failingImport })
  assert.deepEqual(await broken.login(password, '192.0.2.1'), unavailable)
  const cookie = await (await configuration()).signedCookie(`v1.${Math.floor(timestamp / 1000) + 60}.${Buffer.alloc(24).toString('base64url')}`)
  assert.deepEqual(await broken.verifySession(request(cookie)), unavailable)
  const failingVerify = {
    getRandomValues: crypto.getRandomValues.bind(crypto),
    subtle: {
      importKey: crypto.subtle.importKey.bind(crypto.subtle), sign: crypto.subtle.sign.bind(crypto.subtle),
      verify: async () => { throw failure },
    },
  } as unknown as Crypto
  const failing = createPinAuth({ secret, database, now: () => timestamp, crypto: failingVerify })
  assert.deepEqual(await failing.verifySession(request(cookie)), unavailable)
  const options: PinAuthOptions = { secret, crypto: { subtle: { importKey() { throw failure } } } as unknown as Crypto }
  assert.deepEqual(await createPinAuth(options).login(password, '192.0.2.1'), unavailable)
})

test('session signing and entropy failures after a committed attempt cannot produce a cookie', async (context) => {
  const database = new SqliteDatabase()
  context.after(() => database.sqlite.close())
  const { secret } = await configuration()
  const failure = new Error('Synthetic private entropy detail')
  const brokenEntropy = {
    getRandomValues(value: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
      if (value.byteLength === 24) throw failure
      return crypto.getRandomValues(value)
    },
    subtle: crypto.subtle,
  } as unknown as Crypto
  assert.deepEqual(await createPinAuth({ secret, database, now: () => timestamp, crypto: brokenEntropy }).login(password, '192.0.2.1'), unavailable)
  assert.equal(database.limits()[0]!.attempts, 1)
  const brokenSigning = {
    getRandomValues: crypto.getRandomValues.bind(crypto),
    subtle: {
      importKey: crypto.subtle.importKey.bind(crypto.subtle),
      verify: crypto.subtle.verify.bind(crypto.subtle),
      sign(algorithm: AlgorithmIdentifier, key: CryptoKey, data: BufferSource) {
        if (new TextDecoder().decode(data).startsWith('session:')) throw failure
        return crypto.subtle.sign(algorithm, key, data)
      },
    },
  } as unknown as Crypto
  assert.deepEqual(await createPinAuth({ secret, database, now: () => timestamp, crypto: brokenSigning }).login(password, '192.0.2.1'), unavailable)
  assert.equal(database.limits()[0]!.attempts, 2)
})
