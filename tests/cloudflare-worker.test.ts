import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { createHmac, pbkdf2Sync } from 'node:crypto'
import test from 'node:test'
import { createCloudflareWorker, type CloudflareWorkerEnv } from '../cloudflare/worker.ts'
import { PIN_AUTH_COOKIE_NAME, PIN_AUTH_SESSION_SECONDS } from '../src/server/pin-auth.ts'
import type { D1BoardDatabase, D1BoardStatement, D1BoardResult } from '../src/server/cloudflare-board-store.ts'
import { createBoardClient, BoardClientError } from '../src/features/quotation-board/board-client.ts'
import type { BoardSaveCommand } from '../src/features/quotation-board/shared-board-types.ts'
import { createQuotation } from '../src/features/quotation/model.ts'

const ORIGIN = 'https://synthetic-worker.example'
const now = Math.floor(Date.now() / 1000)
const syntheticPassword = 'Example9Ab2'
const syntheticKey = Buffer.alloc(32, 42)
const syntheticSalt = Buffer.alloc(16, 23)
const syntheticCredential = pbkdf2Sync(syntheticPassword, syntheticSalt, 600000, 32, 'sha256').toString('base64url')
const syntheticSecret = JSON.stringify({ version: 3, key: syntheticKey.toString('base64url'), salt: syntheticSalt.toString('base64url'), passwordSignature: createHmac('sha256', syntheticKey).update(`password:${syntheticCredential}`).digest('base64url') })
const cookies = [1, 2].map((profile) => {
  const content = `v1.${now + PIN_AUTH_SESSION_SECONDS}.${Buffer.alloc(24, profile).toString('base64url')}`
  return `${PIN_AUTH_COOKIE_NAME}=${content}.${createHmac('sha256', syntheticKey).update(`session:${content}`).digest('base64url')}`
})

function fixtureDatabase() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec('PRAGMA foreign_keys = ON')
  for (const name of ['0001_quotation_board.sql', '0002_exchange_rate_cache.sql', '0003_pin_auth.sql']) {
    sqlite.exec(readFileSync(new URL(`../cloudflare/migrations/${name}`, import.meta.url), 'utf8'))
  }
  class Statement implements D1BoardStatement {
    readonly sql: string
    readonly values: (string | number | null)[]
    constructor(sql: string, values: (string | number | null)[] = []) { this.sql = sql; this.values = values }
    bind(...values: (string | number | null)[]): D1BoardStatement { return new Statement(this.sql, values) }
    async all<T>(): Promise<D1BoardResult<T>> {
      const results = sqlite.prepare(this.sql).all(...this.values) as unknown as T[]
      const meta = sqlite.prepare('SELECT changes() AS changes').get() as { changes: number }
      return { success: true, results, meta }
    }
  }
  const binding: D1BoardDatabase = {
    prepare(sql) { return new Statement(sql) },
    async batch<T>(statements: D1BoardStatement[]): Promise<D1BoardResult<T>[]> {
      sqlite.exec('BEGIN IMMEDIATE')
      try {
        const results: D1BoardResult<T>[] = []
        for (const statement of statements) results.push(await statement.all<T>())
        sqlite.exec('COMMIT')
        return results
      } catch (error) { sqlite.exec('ROLLBACK'); throw error }
    },
  }
  return { binding, sqlite }
}

function setup(database?: D1BoardDatabase) {
  let assetReads = 0
  let rateReads = 0
  let catalogueReads = 0
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input)
    if (url === 'https://dolarapi.com/v1/dolares/blue') {
      rateReads++
      return Response.json({ moneda: 'USD', casa: 'blue', nombre: 'Blue', compra: 1400, venta: 1500, fechaActualizacion: new Date().toISOString() })
    }
    assert.match(url, /^https:\/\/synthetic-store\.private\.blob\.vercel-storage\.com\/catalog\/latest\.json\?cache=0$/)
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer synthetic_private_token')
    catalogueReads++
    return Response.json({ format: 'luquisound.catalog', version: 1, items: [] })
  }
  const worker = createCloudflareWorker({
    now: () => now * 1000,
    fetcher,
  })
  const env: CloudflareWorkerEnv = {
    ASSETS: { async fetch() { assetReads++; return new Response('<!doctype html><title>Synthetic quotation</title>', { headers: { 'Content-Type': 'text/html' } }) } },
    QUOTATION_BOARD_DB: database,
    QUOTATION_BOARD_MODE: 'shared', QUOTATION_BOARD_ACCESS_REVIEWED: 'true',
    COTIZADOR_PIN_AUTH_SECRET: syntheticSecret,
    CATALOG_BLOB_URL: 'https://synthetic-store.private.blob.vercel-storage.com/catalog/latest.json', BLOB_READ_WRITE_TOKEN: 'synthetic_private_token',
  }
  function request(path: string, profile = 0, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers)
    headers.set('Cookie', cookies[profile]!)
    if (init.method === 'POST') headers.set('Origin', ORIGIN)
    return worker.fetch(new Request(`${ORIGIN}${path}`, { ...init, headers }), env)
  }
  return { worker, env, request, get assetReads() { return assetReads }, get rateReads() { return rateReads }, get catalogueReads() { return catalogueReads } }
}

test('Cloudflare rejects anonymous requests before any assets, catalogue, rate or database work', async () => {
  const state = setup({ prepare() { throw new Error('Anonymous database read') }, batch() { throw new Error('Anonymous database batch') } })
  for (const path of ['/', '/assets/app.js', '/brand/logo.png', '/api/quotation-board', '/api/exchange-rate', '/api/catalog', '/api/unknown']) {
    const response = await state.worker.fetch(new Request(`${ORIGIN}${path}`), state.env)
    assert.equal(response.status, path === '/' ? 303 : 401)
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
  }
  assert.equal(state.assetReads + state.rateReads + state.catalogueReads, 0)
})

test('Cloudflare sets host-only HSTS on HTTPS login, protected assets/APIs, redirects and errors', async (context) => {
  const database = fixtureDatabase()
  context.after(() => database.sqlite.close())
  const state = setup(database.binding)
  const cases: { path: string; status: number; init?: RequestInit }[] = [
    { path: '/login', status: 200 },
    { path: '/login', status: 200, init: { method: 'HEAD' } },
    { path: '/', status: 303 },
    { path: '/api/catalog', status: 401 },
    { path: '/logout', status: 405 },
    { path: '/login', status: 403, init: { method: 'POST', headers: { Origin: 'https://other.example' } } },
    { path: '/login', status: 303, init: { headers: { Cookie: cookies[0]! } } },
    ...['/assets/app.js', '/api/quotation-board', '/api/catalog', '/api/exchange-rate'].map((path) => ({
      path, status: 200, init: { headers: { Cookie: cookies[0]! } },
    })),
    { path: '/api/unknown', status: 404, init: { headers: { Cookie: cookies[0]! } } },
    { path: '/logout', status: 303, init: { method: 'POST', headers: { Origin: ORIGIN, Cookie: cookies[0]! } } },
  ]
  for (const { path, status, init } of cases) {
    const response = await state.worker.fetch(new Request(`${ORIGIN}${path}`, init), state.env)
    assert.equal(response.status, status)
    assert.equal(response.headers.get('Strict-Transport-Security'), 'max-age=604800')
  }
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await state.worker.fetch(new Request(`${ORIGIN}/login`, {
      method: 'POST', headers: { Origin: ORIGIN, 'CF-Connecting-IP': '192.0.2.1', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ credential: attempt === 0 ? syntheticCredential : 'invalid' }),
    }), state.env)
    assert.equal(response.status, attempt === 0 ? 303 : attempt === 5 ? 429 : 401)
    assert.equal(response.headers.get('Strict-Transport-Security'), 'max-age=604800')
  }
  const unconfigured = setup()
  delete unconfigured.env.COTIZADOR_PIN_AUTH_SECRET
  const unavailable = await unconfigured.request('/login')
  assert.equal(unavailable.status, 503)
  assert.equal(unavailable.headers.get('Strict-Transport-Security'), 'max-age=604800')
  state.env.ASSETS = { async fetch() { throw new Error('Synthetic asset failure') } }
  const failure = await state.request('/assets/app.js')
  assert.equal(failure.status, 503)
  assert.equal(failure.headers.get('Strict-Transport-Security'), 'max-age=604800')
})

test('Cloudflare production defaults fail closed and static/API routing cannot bypass the password session', async () => {
  const unconfigured = setup()
  delete unconfigured.env.COTIZADOR_PIN_AUTH_SECRET
  assert.equal((await unconfigured.request('/')).status, 503)
  const state = setup()
  assert.equal((await state.request('/')).status, 200)
  assert.equal((await state.request('/fonts/example.woff2', 1, { method: 'HEAD' })).status, 200)
  assert.equal((await state.request('/api/instaler-observation')).status, 404)
  assert.equal((await state.request('/api/unknown')).status, 404)
  assert.equal((await state.request('/', 0, { method: 'POST', body: 'test' })).status, 405)
  assert.equal(state.assetReads, 2)
  const denied = await state.worker.fetch(new Request(`${ORIGIN}/api/quotation-board`, { headers: { Cookie: cookies[0]!.slice(0, -1) + '!' } }), state.env)
  assert.equal(denied.status, 401)
  const plaintext = await state.worker.fetch(new Request('http://remote.example/', { headers: { Cookie: cookies[0]! } }), state.env)
  assert.equal(plaintext.status, 308)
  assert.equal(plaintext.headers.get('Location'), 'https://remote.example/')
  assert.equal(state.assetReads, 2)
})

test('Cloudflare redirects HTTP navigation to HTTPS before any assets, APIs or database work', async () => {
  const state = setup({ prepare() { throw new Error('HTTP database read') }, batch() { throw new Error('HTTP database batch') } })
  for (const method of ['GET', 'HEAD']) {
    for (const path of ['/', '/login?next=%2F', '/assets/app.js?version=1', '/api/catalog?source=example']) {
      const response = await state.worker.fetch(new Request(`http://synthetic-worker.example${path}`, { method }), state.env)
      assert.equal(response.status, 308)
      assert.equal(response.headers.get('Location'), `${ORIGIN}${path}`)
      assert.equal(response.headers.get('Set-Cookie'), null)
      assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
      assert.equal(response.headers.get('Strict-Transport-Security'), null)
      assert.equal(await response.text(), '')
    }
  }
  assert.equal(state.assetReads + state.rateReads + state.catalogueReads, 0)
})

test('Cloudflare rejects plaintext mutations without replaying them and preserves local HTTP development', async () => {
  const state = setup()
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const response = await state.worker.fetch(new Request('http://synthetic-worker.example/login', {
      method, body: 'synthetic request',
    }), state.env)
    assert.equal(response.status, 403)
    assert.equal(response.headers.get('Location'), null)
    assert.equal(response.headers.get('Set-Cookie'), null)
    assert.equal(response.headers.get('Strict-Transport-Security'), null)
  }
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    for (const protocol of ['http', 'https']) {
      const response = await state.worker.fetch(new Request(`${protocol}://${host}:8787/login`), state.env)
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('Location'), null)
      assert.equal(response.headers.get('Strict-Transport-Security'), null)
    }
  }
  assert.equal(state.assetReads + state.rateReads + state.catalogueReads, 0)
})

test('two signed password sessions share D1 saves, replacement conflicts, copies and exact retries through the existing client', async (context) => {
  const database = fixtureDatabase()
  context.after(() => database.sqlite.close())
  const state = setup(database.binding)
  const clients = [0, 1].map((profile) => createBoardClient(async (input, init) => state.request(String(input), profile, init)))
  const quotation = createQuotation()
  quotation.title = 'Synthetic shared quotation'
  const first: BoardSaveCommand = { type: 'save', operationId: 'synthetic-new', epoch: 'initial', mode: 'new', entryId: 'synthetic-entry', expectedRevision: null, name: 'Synthetic template', categoryId: null, newCategoryName: 'Synthetic category', quotation }
  const saved = await clients[0]!.saveBoardEntry(first)
  const opened = await clients[1]!.getBoardEntry(saved.entry.id)
  assert.equal(opened.entry.revision, 1)
  assert.equal(opened.entry.quotation.exchangeRateMode, 'frozen')
  const replacement: BoardSaveCommand = { ...first, operationId: 'synthetic-replace', mode: 'replace', expectedRevision: 1, categoryId: saved.entry.categoryId, quotation: { ...quotation, title: 'Synthetic edited title' } }
  delete replacement.newCategoryName
  const replaced = await clients[1]!.saveBoardEntry(replacement)
  assert.equal(replaced.entry.revision, 2)
  assert.deepEqual(await clients[1]!.saveBoardEntry(replacement), replaced)
  await assert.rejects(clients[0]!.saveBoardEntry({ ...replacement, operationId: 'synthetic-stale' }), (error: unknown) => error instanceof BoardClientError && error.code === 'conflict')
  const copy = await clients[0]!.saveBoardEntry({ ...replacement, operationId: 'synthetic-copy', entryId: 'synthetic-copy-entry', mode: 'new', expectedRevision: null })
  assert.notEqual(copy.entry.id, saved.entry.id)
  const listing = await clients[1]!.listBoard()
  assert.equal(listing.entries.length, 2)
  assert.equal(listing.categories.length, 1)
  assert.equal((database.sqlite.prepare('SELECT COUNT(*) AS count FROM quotation_board_versions').get() as { count: number }).count, 1)
})

test('Cloudflare keeps board activation separate and supplies the existing private catalogue and persistent hourly FX cache', async (context) => {
  const database = fixtureDatabase()
  context.after(() => database.sqlite.close())
  const state = setup(database.binding)
  state.env.QUOTATION_BOARD_MODE = 'disabled'
  assert.equal((await state.request('/api/quotation-board')).status, 404)
  const catalog = await state.request('/api/catalog')
  assert.equal(catalog.status, 200)
  assert.equal(state.catalogueReads, 1)
  assert.equal(JSON.stringify(await catalog.json()).includes('synthetic_private_token'), false)
  const first = await state.request('/api/exchange-rate')
  assert.equal(first.status, 200)
  const quote = await first.json() as { rate: string }
  assert.equal(quote.rate, '1.500')
  assert.equal((await state.request('/api/exchange-rate', 1)).status, 200)
  assert.equal(state.rateReads, 1)
  const secondInstance = setup(database.binding)
  assert.equal((await secondInstance.request('/api/exchange-rate')).status, 200)
  assert.equal(secondInstance.rateReads, 0)
  const noStorage = setup()
  assert.equal((await noStorage.request('/api/exchange-rate')).status, 503)
  assert.equal(noStorage.rateReads, 0)
})

test('same-origin password login issues a secure session, protects assets and clears only this browser on logout', async (context) => {
  const database = fixtureDatabase()
  context.after(() => database.sqlite.close())
  const state = setup(database.binding)
  const page = await state.worker.fetch(new Request(`${ORIGIN}/login`), state.env)
  assert.equal(page.status, 200)
  assert.match(page.headers.get('Content-Security-Policy')!, /form-action 'self'/)
  assert.equal(page.headers.get('Referrer-Policy'), 'same-origin')
  const html = await page.text()
  assert.ok(html.includes(syntheticSalt.toString('base64url')))
  for (const credential of [syntheticPassword, syntheticCredential, syntheticKey.toString('base64url'), JSON.parse(syntheticSecret).passwordSignature as string]) {
    assert.equal(html.includes(credential), false)
  }
  const login = await state.worker.fetch(new Request(`${ORIGIN}/login`, {
    method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': '192.0.2.1' },
    body: new URLSearchParams({ credential: syntheticCredential }),
  }), state.env)
  assert.equal(login.status, 303)
  const session = login.headers.get('Set-Cookie')!
  assert.match(session, /HttpOnly; Secure; SameSite=Strict/)
  const authenticated = await state.worker.fetch(new Request(`${ORIGIN}/`, { headers: { Cookie: session.split(';')[0]! } }), state.env)
  assert.equal(authenticated.status, 200)
  const logout = await state.worker.fetch(new Request(`${ORIGIN}/logout`, { method: 'POST', headers: { Origin: ORIGIN, Cookie: session.split(';')[0]! } }), state.env)
  assert.equal(logout.status, 303)
  assert.equal(logout.headers.get('Location'), '/login')
  assert.match(logout.headers.get('Set-Cookie')!, /Max-Age=0/)
  assert.equal((await state.worker.fetch(new Request(`${ORIGIN}/logout`), state.env)).status, 405)
})

test('login/logout reject cross-origin requests and malformed attempts never receive a session', async (context) => {
  const database = fixtureDatabase()
  context.after(() => database.sqlite.close())
  const state = setup(database.binding)
  for (const path of ['/login', '/logout']) {
    const response = await state.worker.fetch(new Request(`${ORIGIN}${path}`, { method: 'POST', headers: { Origin: 'https://other.example' }, body: 'credential=' + syntheticCredential }), state.env)
    assert.equal(response.status, 403)
    assert.equal(response.headers.get('Set-Cookie'), null)
  }
  assert.equal((database.sqlite.prepare('SELECT SUM(attempts) AS total FROM quotation_pin_limits').get() as { total: number }).total, 0)
  const malformed = await state.worker.fetch(new Request(`${ORIGIN}/login`, {
    method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': '192.0.2.1' },
    body: `credential=${syntheticCredential}&credential=${syntheticCredential}`,
  }), state.env)
  assert.equal(malformed.status, 401)
  assert.equal(malformed.headers.get('Set-Cookie'), null)
  const forwarded = await state.worker.fetch(new Request(`${ORIGIN}/login`, {
    method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/x-www-form-urlencoded', 'X-Forwarded-For': '192.0.2.1' },
    body: `credential=${syntheticCredential}`,
  }), state.env)
  assert.equal(forwarded.status, 503)
  assert.equal(forwarded.headers.get('Set-Cookie'), null)
  for (const body of [
    new URLSearchParams({ password: syntheticPassword }),
    new URLSearchParams({ credential: syntheticPassword }),
    new URLSearchParams({ credential: syntheticCredential, password: syntheticPassword }),
  ]) {
    const raw = await state.worker.fetch(new Request(`${ORIGIN}/login`, {
      method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': '192.0.2.1' }, body,
    }), state.env)
    assert.equal(raw.status, 401)
    assert.equal(raw.headers.get('Set-Cookie'), null)
  }
})
