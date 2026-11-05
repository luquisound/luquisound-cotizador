import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { BoardClientError, createBoardClient, type BoardClient } from '../src/features/quotation-board/board-client.ts'
import { cloneBoardQuotation, quotationBaseline } from '../src/features/quotation-board/board-contract.ts'
import type { BoardSaveCommand, BoardWorkingContext } from '../src/features/quotation-board/shared-board-types.ts'
import { orderQuotationRows } from '../src/features/quotation/audio-categories.ts'
import { calculateQuotation } from '../src/features/quotation/calculation.ts'
import { prepareFixedServiceQuotation } from '../src/features/quotation/fixed-services.ts'
import { createQuotation, createRow, type Quotation } from '../src/features/quotation/model.ts'
import { STORAGE_KEY, type StorageAdapter } from '../src/features/quotation/persistence.ts'
import { CATALOG_STORAGE_KEY, CURRENT_QUOTATION_STORAGE_KEY, loadCurrentQuotation, saveCurrentQuotation } from '../src/features/quotation/working-storage.ts'
import type { D1BoardDatabase, D1BoardResult, D1BoardStatement } from '../src/server/cloudflare-board-store.ts'
import { serveCloudflareQuotationBoard } from '../src/server/cloudflare-board.ts'

const ORIGIN = 'https://synthetic-board.example'
const LIBRARY_KEY = 'luquisound.quotation-library.v1'
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

  constructor() { this.sqlite.exec('PRAGMA foreign_keys = ON'); this.sqlite.exec(migration) }
  prepare(sql: string): D1BoardStatement { return new SqliteStatement(this, sql) }
  execute<T>(statement: SqliteStatement): D1BoardResult<T> {
    const results = this.sqlite.prepare(statement.sql).all(...statement.values) as unknown as T[]
    const meta = this.sqlite.prepare('SELECT changes() AS changes').get() as { changes: number }
    return { success: true, results, meta }
  }
  async batch<T>(statements: D1BoardStatement[]): Promise<D1BoardResult<T>[]> {
    this.sqlite.exec('BEGIN IMMEDIATE')
    try {
      const result = statements.map((statement) => this.execute<T>(statement as SqliteStatement))
      this.sqlite.exec('COMMIT')
      return result
    } catch (error) { this.sqlite.exec('ROLLBACK'); throw error }
  }
  count(table: 'quotation_board_entries' | 'quotation_board_categories' | 'quotation_board_versions'): number {
    return (this.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count
  }
}

function sharedServer() {
  const database = new SqliteDatabase()
  let clock = 0
  let loseNextSaveResponse = false
  function browserClient(): BoardClient {
    const fetcher: typeof fetch = async (input, init) => {
      const headers = new Headers(init?.headers)
      // Browsers add Origin to the same-origin POST; Node's injected fetch does not.
      if (init?.method === 'POST') { headers.set('Origin', ORIGIN); headers.set('Sec-Fetch-Site', 'same-origin') }
      const result = await serveCloudflareQuotationBoard(new Request(new URL(String(input), ORIGIN), { ...init, headers }),
        database, { accessReviewed: true }, { now: () => new Date(Date.parse('2026-11-04T15:00:00.000Z') + clock++ * 1000) })
      if (init?.method === 'POST' && result.ok && loseNextSaveResponse) {
        loseNextSaveResponse = false
        throw new Error('Synthetic connection lost after commit')
      }
      return result
    }
    return createBoardClient(fetcher)
  }
  return { browserClient, database, loseNextSaveResponse() { loseNextSaveResponse = true } }
}

function browserStorage(label: string) {
  const sentinels = new Map([
    [CATALOG_STORAGE_KEY, `private synthetic catalogue bytes ${label}`],
    [LIBRARY_KEY, `private synthetic library bytes ${label}`],
    [STORAGE_KEY, `private synthetic legacy bytes ${label}`],
  ])
  const values = new Map(sentinels)
  const reads: string[] = []
  const writes: string[] = []
  const storage: StorageAdapter = {
    getItem(key) { reads.push(key); return values.get(key) ?? null },
    setItem(key, value) { writes.push(key); values.set(key, value) },
  }
  return { storage, values, sentinels, reads, writes }
}

interface WorkingCopy {
  client: BoardClient
  browser: ReturnType<typeof browserStorage>
  quotation: Quotation
  context: BoardWorkingContext | null
  raw: string | null
}

function persist(copy: WorkingCopy): void {
  const result = saveCurrentQuotation(copy.browser.storage, copy.quotation, { expectedRaw: copy.raw, boardContext: copy.context })
  assert.equal(result.ok, true, result.error ?? undefined)
  copy.raw = result.raw
}

async function save(copy: WorkingCopy, mode: 'new' | 'replace', operationId: string, newEntryId?: string): Promise<void> {
  const list = await copy.client.listBoard()
  const context = copy.context
  assert.ok(mode === 'new' || context)
  const command: BoardSaveCommand = {
    type: 'save', operationId, epoch: mode === 'replace' ? context!.epoch : list.epoch,
    mode, entryId: mode === 'replace' ? context!.entryId : newEntryId!,
    expectedRevision: mode === 'replace' ? context!.revision : null,
    name: mode === 'replace' ? context!.name : 'Synthetic reusable draft', categoryId: context?.categoryId ?? null,
    quotation: copy.quotation,
  }
  const baseline = quotationBaseline(copy.quotation)
  const result = await copy.client.saveBoardEntry(command)
  copy.context = {
    entryId: result.entry.id, revision: result.entry.revision, epoch: result.epoch,
    name: result.entry.name, categoryId: result.entry.categoryId, baseline,
  }
  persist(copy)
}

function partialQuotation(): Quotation {
  const ars = { ...createRow('equipment', 'ARS'), concept: 'Synthetic speakers', audioCategory: 'speakers' as const, unitPrice: '100.000', priceState: 'priced' as const }
  const usd = { ...createRow('equipment', 'USD'), concept: 'Synthetic amplifier', audioCategory: 'amplifier-dsp' as const, unitPrice: '200', priceState: 'priced' as const }
  const pending = { ...createRow(), concept: 'Synthetic pending subwoofer', audioCategory: 'subwoofer' as const }
  return {
    ...createQuotation(), title: 'Synthetic partial quotation', subtitle: 'Synthetic vehicle',
    exchangeRate: '1.000', exchangeRateMode: 'automatic', rows: [ars, usd, pending],
    rowOrder: [usd.id, pending.id, ars.id], blockOrder: [`row:${usd.id}`],
    discount: { percentage: '10,5', rowIds: [ars.id, usd.id] },
  }
}

test('two devices keep D1 shared revisions, preserve stale drafts as new copies and recover the correct replacement source', async (context) => {
  const server = sharedServer()
  context.after(() => server.database.sqlite.close())
  const a: WorkingCopy = { client: server.browserClient(), browser: browserStorage('A'), quotation: partialQuotation(), context: null, raw: null }
  const b: WorkingCopy = { client: server.browserClient(), browser: browserStorage('B'), quotation: createQuotation(), context: null, raw: null }
  const original = structuredClone(a.quotation)
  assert.equal(calculateQuotation(original).canExport, false)

  await save(a, 'new', 'a-create', 'shared-original')
  assert.equal(a.context!.entryId, 'shared-original')
  assert.equal(a.context!.revision, 1)
  assert.equal((await a.client.getBoardEntry('shared-original')).entry.quotation.exchangeRateMode, 'frozen')

  const listB = await b.client.listBoard()
  assert.equal(listB.entries.length, 1)
  assert.equal(listB.entries[0]!.pending, true)
  const detailB = await b.client.getBoardEntry(listB.entries[0]!.id)
  b.quotation = prepareFixedServiceQuotation(cloneBoardQuotation(detailB.entry.quotation))
  b.context = {
    entryId: detailB.entry.id, revision: detailB.entry.revision, epoch: detailB.epoch,
    name: detailB.entry.name, categoryId: detailB.entry.categoryId, baseline: quotationBaseline(b.quotation),
  }
  persist(b)
  assert.notEqual(b.quotation.id, original.id)
  assert.equal(b.quotation.exchangeRateMode, 'frozen')
  assert.equal(b.quotation.exchangeRate, original.exchangeRate)
  assert.equal(b.quotation.title, original.title)
  assert.deepEqual(orderQuotationRows(b.quotation.rows, b.quotation.blockOrder, b.quotation.rowOrder).map((row) => row.concept), ['Synthetic amplifier', 'Synthetic pending subwoofer', 'Synthetic speakers'])
  assert.deepEqual(b.quotation.discount!.rowIds.map((id) => b.quotation.rows.find((row) => row.id === id)!.concept), ['Synthetic speakers', 'Synthetic amplifier'])
  assert.equal(b.quotation.blockOrder![0], `row:${b.quotation.rows[1]!.id}`)
  assert.deepEqual(b.quotation.rows.map((row) => [row.currency, row.unitPrice]), original.rows.map((row) => [row.currency, row.unitPrice]))
  assert.deepEqual(calculateQuotation(b.quotation).discount!.amounts, calculateQuotation(original).discount!.amounts)

  b.quotation = { ...b.quotation, title: 'Synthetic B reviewed quotation', rows: b.quotation.rows.map((row) => row.audioCategory === 'subwoofer' ? { ...row, unitPrice: '350.000', priceState: 'priced' as const } : row) }
  await save(b, 'replace', 'b-replace')
  assert.equal(b.context!.revision, 2)
  const bSaved = await b.client.getBoardEntry('shared-original')
  assert.equal(bSaved.entry.quotation.title, b.quotation.title)

  a.quotation = { ...a.quotation, title: 'Synthetic A preserved partial edit' }
  persist(a)
  const aBeforeConflict = structuredClone({ quotation: a.quotation, context: a.context, raw: a.raw })
  await assert.rejects(save(a, 'replace', 'a-stale-replace'), (error) => error instanceof BoardClientError && error.code === 'conflict')
  assert.deepEqual({ quotation: a.quotation, context: a.context, raw: a.raw }, aBeforeConflict)
  assert.equal(a.browser.values.get(CURRENT_QUOTATION_STORAGE_KEY), aBeforeConflict.raw)
  assert.deepEqual(await a.client.getBoardEntry('shared-original'), bSaved)

  await save(a, 'new', 'a-preserve-copy', 'a-independent-copy')
  assert.equal(a.context!.entryId, 'a-independent-copy')
  assert.equal(a.context!.revision, 1)
  assert.equal(server.database.count('quotation_board_entries'), 2)
  assert.deepEqual(await a.client.getBoardEntry('shared-original'), bSaved)
  assert.equal((await a.client.getBoardEntry('a-independent-copy')).entry.quotation.exchangeRateMode, 'frozen')

  const recovered = loadCurrentQuotation(a.browser.storage)
  assert.equal(recovered.error, null)
  assert.equal(recovered.boardContext!.entryId, 'a-independent-copy')
  assert.equal(recovered.boardContext!.revision, 1)
  assert.equal(recovered.boardContext!.baseline, quotationBaseline(recovered.quotation))
  const reloadedA: WorkingCopy = {
    client: server.browserClient(), browser: a.browser, quotation: recovered.quotation,
    context: recovered.boardContext!, raw: recovered.raw,
  }
  reloadedA.quotation = { ...reloadedA.quotation, subtitle: 'Synthetic change after reload' }
  await save(reloadedA, 'replace', 'a-reloaded-replace')
  assert.equal(reloadedA.context!.entryId, 'a-independent-copy')
  assert.equal(reloadedA.context!.revision, 2)
  assert.equal((await reloadedA.client.getBoardEntry('a-independent-copy')).entry.quotation.subtitle, reloadedA.quotation.subtitle)
  assert.deepEqual(await reloadedA.client.getBoardEntry('shared-original'), bSaved)
  assert.equal(calculateQuotation(reloadedA.quotation).canExport, false)
  assert.equal(loadCurrentQuotation(b.browser.storage).boardContext!.entryId, 'shared-original')
  assert.equal(loadCurrentQuotation(b.browser.storage).boardContext!.revision, 2)
  assert.equal(server.database.count('quotation_board_versions'), 2)

  for (const browser of [a.browser, b.browser]) {
    for (const [key, bytes] of browser.sentinels) {
      assert.equal(browser.values.get(key), bytes)
      assert.equal(browser.reads.includes(key), false)
    }
    assert.ok(browser.writes.every((key) => key === CURRENT_QUOTATION_STORAGE_KEY))
  }
})

test('D1 saves recover a lost response by exact replay and share optional categories across devices', async (context) => {
  const server = sharedServer()
  context.after(() => server.database.sqlite.close())
  const a = server.browserClient()
  const b = server.browserClient()
  const value: BoardSaveCommand = {
    type: 'save', operationId: 'categorised-create', epoch: (await a.listBoard()).epoch,
    mode: 'new', entryId: 'categorised-entry', expectedRevision: null,
    name: 'Synthetic categorized draft', categoryId: null, newCategoryName: 'Synthetic audio',
    quotation: partialQuotation(),
  }

  server.loseNextSaveResponse()
  await assert.rejects(a.saveBoardEntry(value), (error) => error instanceof BoardClientError && error.mayHaveCommitted)
  assert.equal(server.database.count('quotation_board_entries'), 1)
  const saved = await a.saveBoardEntry(value)
  assert.equal(saved.entry.revision, 1)
  assert.ok(saved.entry.categoryId)
  assert.equal(server.database.count('quotation_board_categories'), 1)
  assert.equal(server.database.count('quotation_board_versions'), 0)
  await assert.rejects(a.saveBoardEntry({ ...value, name: 'Changed replay' }), (error) => error instanceof BoardClientError && error.code === 'conflict')

  const list = await b.listBoard()
  assert.deepEqual(list.categories, [{ id: saved.entry.categoryId, name: 'Synthetic audio' }])
  assert.equal(list.entries[0]!.categoryId, saved.entry.categoryId)
  const opened = await b.getBoardEntry(saved.entry.id)
  const working = cloneBoardQuotation(opened.entry.quotation)
  const edited = {
    ...working,
    rows: working.rows.map((row) => ({ ...row, detail: 'Synthetic reviewed detail', unitPrice: '0', priceState: 'priced' as const })),
  }
  const replaced = await b.saveBoardEntry({
    ...value, operationId: 'categorised-replace', mode: 'replace', expectedRevision: 1,
    categoryId: saved.entry.categoryId, newCategoryName: undefined, quotation: edited,
  })
  assert.equal(replaced.entry.revision, 2)
  assert.equal(replaced.entry.categoryId, saved.entry.categoryId)
  assert.deepEqual(replaced.entry.quotation.rows.map((row) => [row.detail, row.unitPrice, row.currency]), edited.rows.map((row) => [row.detail, row.unitPrice, row.currency]))

  const independent = await b.saveBoardEntry({
    ...value, operationId: 'uncategorised-copy', entryId: 'uncategorised-entry',
    newCategoryName: undefined, categoryId: null, quotation: edited,
  })
  assert.equal(independent.entry.categoryId, null)
  assert.equal(server.database.count('quotation_board_entries'), 2)
  assert.equal(server.database.count('quotation_board_versions'), 1)
  assert.deepEqual((await a.getBoardEntry(saved.entry.id)).entry, replaced.entry)
  assert.equal((await a.getBoardEntry(independent.entry.id)).entry.categoryId, null)
})
