import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { BoardClientError, createBoardClient } from '../src/features/quotation-board/board-client.ts'
import { BOARD_MAX_BYTES, readBoardSaveCommand } from '../src/features/quotation-board/board-contract.ts'
import type { BoardSaveCommand } from '../src/features/quotation-board/shared-board-types.ts'
import { createQuotation, createRow } from '../src/features/quotation/model.ts'
import { invalidateD1BoardEpoch } from '../src/server/cloudflare-board-recovery.ts'
import { createD1BoardRepository, D1_BOARD_ENTRY_MAX_BYTES, D1BoardError, type D1BoardDatabase, type D1BoardResult, type D1BoardStatement } from '../src/server/cloudflare-board-store.ts'
import { D1_BOARD_REQUEST_MAX_BYTES, serveCloudflareQuotationBoard } from '../src/server/cloudflare-board.ts'

const ORIGIN = 'https://synthetic-board.example'
const NOW = new Date('2026-11-04T15:00:00.000Z')
const migration = readFileSync(new URL('../cloudflare/migrations/0001_quotation_board.sql', import.meta.url), 'utf8')

class SqliteStatement implements D1BoardStatement {
  readonly database: SqliteDatabase
  readonly sql: string
  readonly values: (string | number | null)[]

  constructor(database: SqliteDatabase, sql: string, values: (string | number | null)[] = []) {
    this.database = database
    this.sql = sql
    this.values = values
  }
  bind(...values: (string | number | null)[]): D1BoardStatement { return new SqliteStatement(this.database, this.sql, values) }
  async all<T>(): Promise<D1BoardResult<T>> { return this.database.execute<T>(this) }
}

class SqliteDatabase implements D1BoardDatabase {
  readonly sqlite = new DatabaseSync(':memory:')
  readonly executed: string[] = []
  interruptAfterCommit = false

  constructor() { this.sqlite.exec('PRAGMA foreign_keys = ON'); this.sqlite.exec(migration) }
  prepare(sql: string): D1BoardStatement { return new SqliteStatement(this, sql) }
  execute<T>(statement: SqliteStatement): D1BoardResult<T> {
    this.executed.push(statement.sql)
    const results = this.sqlite.prepare(statement.sql).all(...statement.values) as unknown as T[]
    const meta = this.sqlite.prepare('SELECT changes() AS changes').get() as { changes: number }
    return { success: true, results, meta }
  }
  async batch<T>(statements: D1BoardStatement[]): Promise<D1BoardResult<T>[]> {
    this.sqlite.exec('BEGIN IMMEDIATE')
    let results: D1BoardResult<T>[]
    try { results = statements.map((statement) => this.execute<T>(statement as SqliteStatement)); this.sqlite.exec('COMMIT') }
    catch (error) { this.sqlite.exec('ROLLBACK'); throw error }
    if (this.interruptAfterCommit && statements.some((statement) => (statement as SqliteStatement).sql.startsWith('UPDATE quotation_board_meta SET revision'))) {
      this.interruptAfterCommit = false
      throw new Error('Synthetic interrupted committed response')
    }
    return results
  }
  count(table: 'quotation_board_entries' | 'quotation_board_categories' | 'quotation_board_versions'): number {
    return (this.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count
  }
}

function command(id = 'entry-a', operationId = `operation-${id}`): BoardSaveCommand {
  return {
    type: 'save', operationId, epoch: 'initial', mode: 'new', entryId: id, expectedRevision: null,
    name: 'Synthetic partial', categoryId: null,
    quotation: { ...createQuotation(), title: 'Synthetic title', exchangeRate: '1000', exchangeRateMode: 'automatic', rows: [{ ...createRow(), concept: 'Synthetic pending concept' }] },
  }
}

function request(value: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}/api/quotation-board`, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(value) })
}

function save(database: D1BoardDatabase, value: BoardSaveCommand): Promise<Response> {
  return serveCloudflareQuotationBoard(request(value), database, { accessReviewed: true }, { now: () => NOW })
}

test('D1 list reads summaries only, detail selects one entry, and the existing client accepts frozen partial saves', async (context) => {
  const database = new SqliteDatabase()
  context.after(() => database.sqlite.close())
  const client = createBoardClient(async (input, init) => {
    const headers = new Headers(init?.headers)
    if (init?.method === 'POST') headers.set('Origin', ORIGIN)
    return serveCloudflareQuotationBoard(new Request(new URL(String(input), ORIGIN), { ...init, headers }), database, { accessReviewed: true }, { now: () => NOW })
  })
  assert.deepEqual(await client.listBoard(), { epoch: 'initial', revision: 0, categories: [], entries: [] })
  const value = { ...command(), newCategoryName: 'Synthetic audio' }
  const result = await client.saveBoardEntry(value)
  assert.equal(result.entry.quotation.exchangeRateMode, 'frozen')
  assert.equal(result.entry.quotation.id, value.quotation.id)
  database.executed.length = 0
  const list = await client.listBoard()
  assert.equal(list.entries[0]!.pending, true)
  assert.equal(list.categories.length, 1)
  assert.ok(database.executed.every((sql) => !sql.includes('entry_json')))
  database.executed.length = 0
  assert.deepEqual((await client.getBoardEntry(value.entryId)).entry, result.entry)
  assert.equal(database.executed.filter((sql) => sql.includes('entry_json')).length, 1)
  assert.ok(database.executed.find((sql) => sql.includes('entry_json'))!.endsWith('WHERE id = ?'))
  await assert.rejects(client.getBoardEntry('missing'), (error) => error instanceof BoardClientError && error.code === 'not-found')
})

test('real SQLite transactions merge unrelated saves and reject simultaneous replacement of one revision', async (context) => {
  const database = new SqliteDatabase()
  context.after(() => database.sqlite.close())
  const repository = createD1BoardRepository(database)
  const first = command('entry-a')
  const second = command('entry-b')
  const both = await Promise.all([repository.save(first, NOW), repository.save(second, NOW)])
  assert.equal(both.length, 2)
  assert.equal(database.count('quotation_board_entries'), 2)
  const replace = { ...first, mode: 'replace' as const, expectedRevision: 1 }
  const competing = await Promise.allSettled([
    repository.save({ ...replace, operationId: 'replace-a', name: 'Winner A' }, NOW),
    repository.save({ ...replace, operationId: 'replace-b', name: 'Winner B' }, NOW),
  ])
  assert.equal(competing.filter((item) => item.status === 'fulfilled').length, 1)
  const rejected = competing.find((item) => item.status === 'rejected') as PromiseRejectedResult
  assert.ok(rejected.reason instanceof D1BoardError && rejected.reason.code === 'conflict')
  assert.equal((await repository.detail(first.entryId)).entry.revision, 2)
  assert.equal(database.count('quotation_board_versions'), 1)
})

test('operation replays, altered requests, old revisions and ambiguous commits cannot duplicate a ficha', async (context) => {
  const database = new SqliteDatabase()
  context.after(() => database.sqlite.close())
  const value = command()
  database.interruptAfterCommit = true
  assert.equal((await save(database, value)).status, 200)
  assert.equal((await save(database, value)).status, 200)
  assert.equal(database.count('quotation_board_entries'), 1)
  assert.equal(database.count('quotation_board_versions'), 0)
  assert.equal((await save(database, { ...value, name: 'Altered retry' })).status, 409)
  const replace = { ...value, mode: 'replace' as const, expectedRevision: 1, operationId: 'replace' }
  assert.equal((await save(database, replace)).status, 200)
  assert.equal((await save(database, value)).status, 409)
  assert.equal((await save(database, { ...replace, operationId: 'stale' })).status, 409)
  assert.equal((await save(database, { ...command('entry-b'), operationId: 'replace' })).status, 409)
  assert.equal(database.count('quotation_board_entries'), 1)
})

test('normalized category creation is atomic and an SQL failure rolls back metadata, category and backup together', async (context) => {
  const database = new SqliteDatabase()
  context.after(() => database.sqlite.close())
  assert.equal((await save(database, { ...command(), newCategoryName: 'Synthetic Audio' })).status, 200)
  assert.equal((await save(database, { ...command('entry-b'), newCategoryName: ' synthetic   AUDIO ' })).status, 400)
  assert.equal(database.count('quotation_board_categories'), 1)
  const before = await createD1BoardRepository(database).list()
  database.sqlite.exec("CREATE TRIGGER fail_entry BEFORE INSERT ON quotation_board_entries BEGIN SELECT RAISE(ABORT, 'Synthetic failure'); END")
  const result = await save(database, { ...command(), mode: 'replace', expectedRevision: 1, operationId: 'failed-replace', newCategoryName: 'Another category' })
  assert.equal(result.status, 503)
  assert.deepEqual(await createD1BoardRepository(database).list(), before)
  assert.equal(database.count('quotation_board_categories'), 1)
  assert.equal(database.count('quotation_board_versions'), 0)
  assert.ok(!(await result.text()).includes('Synthetic failure'))
})

test('entry backups retain at most 50 versions globally with metadata sufficient to identify a prior snapshot', async (context) => {
  const database = new SqliteDatabase()
  context.after(() => database.sqlite.close())
  const repository = createD1BoardRepository(database)
  for (const id of ['entry-a', 'entry-b']) await repository.save(command(id), NOW)
  const revisions = new Map([['entry-a', 1], ['entry-b', 1]])
  for (let index = 0; index < 55; index++) {
    const id = index % 2 === 0 ? 'entry-a' : 'entry-b'
    const revision = revisions.get(id)!
    await repository.save({ ...command(id, `replace-${index}`), mode: 'replace', expectedRevision: revision, name: `Synthetic version ${index}` }, NOW)
    revisions.set(id, revision + 1)
  }
  assert.equal(database.count('quotation_board_versions'), 50)
  const backup = database.sqlite.prepare('SELECT board_epoch, entry_id, entry_revision, snapshot_json FROM quotation_board_versions ORDER BY version_id DESC LIMIT 1').get() as { board_epoch: string; entry_id: string; entry_revision: number; snapshot_json: string }
  assert.equal(backup.board_epoch, 'initial')
  assert.equal(JSON.parse(backup.snapshot_json).id, backup.entry_id)
  assert.equal(JSON.parse(backup.snapshot_json).revision, backup.entry_revision)
  assert.ok(new TextEncoder().encode(backup.snapshot_json).byteLength <= D1_BOARD_ENTRY_MAX_BYTES)
})

test('D1 capacity rejects oversized entries before a transaction and caps the aggregate active board', async (context) => {
  const database = new SqliteDatabase()
  context.after(() => database.sqlite.close())
  const large = command()
  large.quotation.rows = Array.from({ length: 110 }, () => ({ ...createRow(), concept: 'Synthetic large concept', detail: 'x'.repeat(2000) }))
  large.quotation.notes = 'x'.repeat(8000)
  while (new TextEncoder().encode(JSON.stringify(large)).byteLength < D1_BOARD_ENTRY_MAX_BYTES + 1024) {
    large.quotation.rows.push({ ...createRow(), concept: 'Synthetic large concept', detail: 'x'.repeat(2000) })
  }
  assert.ok(new TextEncoder().encode(JSON.stringify(large)).byteLength <= D1_BOARD_REQUEST_MAX_BYTES)
  assert.equal((await save(database, large)).status, 413)
  assert.equal(database.count('quotation_board_entries'), 0)
  const medium = command()
  medium.quotation.rows = Array.from({ length: 95 }, () => ({ ...createRow(), concept: 'Synthetic bounded concept', detail: 'x'.repeat(1800) }))
  let capacityReached = false
  for (let index = 0; index < 40; index++) {
    const result = await save(database, { ...medium, entryId: `entry-${index}`, operationId: `operation-${index}` })
    if (result.status === 413) { capacityReached = true; break }
    assert.equal(result.status, 200)
  }
  assert.equal(capacityReached, true)
  const meta = database.sqlite.prepare('SELECT entry_count, entry_bytes, category_bytes FROM quotation_board_meta').get() as { entry_count: number; entry_bytes: number; category_bytes: number }
  assert.equal(meta.entry_count, database.count('quotation_board_entries'))
  assert.ok(meta.entry_bytes + meta.category_bytes <= BOARD_MAX_BYTES)
})

test('D1 preserves the 100-entry and 100-category limits without partial creation', async (context) => {
  const database = new SqliteDatabase()
  context.after(() => database.sqlite.close())
  const repository = createD1BoardRepository(database)
  for (let index = 0; index < 100; index++) {
    await repository.save({ ...command(`entry-${index}`), newCategoryName: `Category ${index}` }, NOW)
  }
  assert.equal((await save(database, command('entry-over-limit'))).status, 413)
  assert.equal((await save(database, { ...command('entry-0', 'category-over-limit'), mode: 'replace', expectedRevision: 1, newCategoryName: 'Extra category' })).status, 413)
  assert.equal(database.count('quotation_board_entries'), 100)
  assert.equal(database.count('quotation_board_categories'), 100)
  assert.equal(database.count('quotation_board_versions'), 0)
})

test('private operator epoch invalidation rejects stale commands after restore without exposing a restore HTTP endpoint', async (context) => {
  const database = new SqliteDatabase()
  context.after(() => database.sqlite.close())
  await save(database, command())
  const epoch = crypto.randomUUID()
  assert.deepEqual(await invalidateD1BoardEpoch(database, 'initial', 1, epoch), { epoch, revision: 2 })
  assert.equal((await save(database, command('stale'))).status, 409)
  assert.equal((await save(database, { ...command('fresh'), epoch })).status, 200)
  await assert.rejects(invalidateD1BoardEpoch(database, 'initial', 1, crypto.randomUUID()), (error) => error instanceof D1BoardError && error.code === 'conflict')
})

test('internal handler still fails closed, requires same-origin JSON, bounds input and never repairs corrupt stored quotation data', async (context) => {
  const database = new SqliteDatabase()
  context.after(() => database.sqlite.close())
  const url = `${ORIGIN}/api/quotation-board`
  assert.equal((await serveCloudflareQuotationBoard(new Request(url), database, { accessReviewed: false })).status, 404)
  assert.equal((await serveCloudflareQuotationBoard(new Request(url, { method: 'DELETE' }), database, { accessReviewed: true })).status, 405)
  assert.equal((await serveCloudflareQuotationBoard(request(command(), { Origin: 'https://other.example' }), database, { accessReviewed: true })).status, 403)
  assert.equal((await serveCloudflareQuotationBoard(request(command(), { 'Sec-Fetch-Site': 'cross-site' }), database, { accessReviewed: true })).status, 403)
  assert.equal((await serveCloudflareQuotationBoard(request(command(), { 'Content-Type': 'text/plain' }), database, { accessReviewed: true })).status, 415)
  assert.equal((await serveCloudflareQuotationBoard(request({}, { 'Content-Length': String(D1_BOARD_REQUEST_MAX_BYTES + 1) }), database, { accessReviewed: true })).status, 413)
  assert.equal((await serveCloudflareQuotationBoard(new Request(`${url}?entryId=a&entryId=b`), database, { accessReviewed: true })).status, 400)
  const value = readBoardSaveCommand(command())
  await save(database, value)
  database.sqlite.exec("UPDATE quotation_board_entries SET entry_json = '{}' , json_bytes = 2 WHERE id = 'entry-a'")
  assert.equal((await serveCloudflareQuotationBoard(new Request(`${url}?entryId=entry-a`), database, { accessReviewed: true })).status, 503)
  assert.equal((await save(database, { ...value, mode: 'replace', expectedRevision: 1, operationId: 'repair-attempt' })).status, 503)
  assert.equal(database.sqlite.prepare('SELECT entry_json FROM quotation_board_entries').get()!.entry_json, '{}')
})
