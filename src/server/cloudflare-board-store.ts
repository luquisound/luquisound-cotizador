import { calculateQuotation } from '../features/quotation/calculation.ts'
import {
  BOARD_MAX_BYTES, BOARD_MAX_ENTRIES, readBoardListResponse, toPublicBoardEntry,
} from '../features/quotation-board/board-contract.ts'
import type { BoardCategory, BoardEntry } from '../features/quotation-board/board-types.ts'
import type {
  BoardDetailResponse, BoardListResponse, BoardSaveCommand, BoardSaveResponse, SharedBoardEntry,
} from '../features/quotation-board/shared-board-types.ts'

export const D1_BOARD_ENTRY_MAX_BYTES = 256 * 1024
export const D1_BOARD_HISTORY_LIMIT = 50

export interface D1BoardResult<T = Record<string, unknown>> {
  success: boolean
  results: T[]
  meta: { changes?: number }
}

export interface D1BoardStatement {
  bind(...values: (string | number | null)[]): D1BoardStatement
  all<T = Record<string, unknown>>(): Promise<D1BoardResult<T>>
}

export interface D1BoardDatabase {
  prepare(sql: string): D1BoardStatement
  batch<T = Record<string, unknown>>(statements: D1BoardStatement[]): Promise<D1BoardResult<T>[]>
}

export class D1BoardError extends Error {
  readonly code: 'conflict' | 'storage' | 'capacity' | 'category-exists' | 'category-missing' | 'not-found'

  constructor(code: D1BoardError['code']) {
    super(`Shared board operation failed (${code}).`)
    this.name = 'D1BoardError'
    this.code = code
  }
}

interface Metadata {
  epoch: string
  revision: number
  entry_count: number
  category_count: number
  entry_bytes: number
  category_bytes: number
}

interface CategoryRecord extends BoardCategory { name_key: string; json_bytes: number }
interface EntryRecord { entry_json: string; json_bytes: number }
interface SummaryRecord {
  id: string; name: string; category_id: string | null; revision: number; updated_at: string
  title: string; subtitle: string; pending: number
}

const metaSql = 'SELECT epoch, revision, entry_count, category_count, entry_bytes, category_bytes FROM quotation_board_meta WHERE id = 1'
const categoriesSql = 'SELECT id, name, name_key, json_bytes FROM quotation_board_categories ORDER BY name_key, id'
const summarySql = 'SELECT id, name, category_id, revision, updated_at, title, subtitle, pending FROM quotation_board_entries ORDER BY updated_at DESC, id'
const entrySql = 'SELECT entry_json, json_bytes FROM quotation_board_entries WHERE id = ?'
const operationSql = 'SELECT entry_json, json_bytes FROM quotation_board_entries WHERE last_operation_id = ?'
const guardSql = 'EXISTS (SELECT 1 FROM quotation_board_meta WHERE id = 1 AND write_token = ?)'
const bytes = (value: string): number => new TextEncoder().encode(value).byteLength
const categoryKey = (value: string): string => value.normalize('NFKC').replace(/\s+/g, ' ').toLocaleLowerCase('es-AR')

function fail(code: D1BoardError['code'] = 'storage'): never { throw new D1BoardError(code) }

function rows<T>(result: D1BoardResult<T> | undefined): T[] {
  if (!result?.success || !Array.isArray(result.results)) return fail()
  return result.results
}

function metadata(value: Metadata | undefined): Metadata {
  if (!value || !Number.isSafeInteger(value.revision) || value.revision < 0
    || ![value.entry_count, value.category_count].every((count) => Number.isSafeInteger(count) && count >= 0 && count <= 100)
    || ![value.entry_bytes, value.category_bytes].every((size) => Number.isSafeInteger(size) && size >= 0)
    || value.entry_bytes + value.category_bytes > BOARD_MAX_BYTES
    || (value.epoch !== 'initial' && !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value.epoch))) return fail()
  return value
}

function readEntry(record: EntryRecord): SharedBoardEntry {
  if (typeof record.entry_json !== 'string' || record.json_bytes !== bytes(record.entry_json)
    || record.json_bytes < 1 || record.json_bytes > D1_BOARD_ENTRY_MAX_BYTES) return fail()
  const value: unknown = JSON.parse(record.entry_json)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail()
  const input = value as Record<string, unknown>
  const entry = toPublicBoardEntry(value as SharedBoardEntry)
  if (typeof input.createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input.createdAt)
    || new Date(input.createdAt).toISOString() !== input.createdAt || input.createdAt > entry.updatedAt
    || typeof input.lastOperationId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(input.lastOperationId)
    || typeof input.lastOperationHash !== 'string' || !/^[a-f\d]{64}$/.test(input.lastOperationHash)) return fail()
  return { ...entry, createdAt: input.createdAt, lastOperationId: input.lastOperationId, lastOperationHash: input.lastOperationHash }
}

function publicEntry(entry: SharedBoardEntry): BoardEntry {
  const { createdAt: _createdAt, lastOperationId: _lastOperationId, lastOperationHash: _lastOperationHash, ...result } = entry
  return result
}

function canonicalBoardBytes(meta: Metadata, revision: number, entryCount: number, categoryCount: number, entryBytes: number, categoryBytes: number): number {
  return bytes(JSON.stringify({ schema: 'luquisound.quotation-board', version: 1, epoch: meta.epoch, revision, categories: [], entries: [] }))
    + entryBytes + categoryBytes + Math.max(0, entryCount - 1) + Math.max(0, categoryCount - 1)
}

export function createD1BoardRepository(database: D1BoardDatabase) {
  async function list(): Promise<BoardListResponse> {
    const result = await database.batch([
      database.prepare(metaSql), database.prepare(categoriesSql), database.prepare(summarySql),
    ])
    const meta = metadata(rows(result[0])[0] as unknown as Metadata | undefined)
    const categories = rows(result[1]) as unknown as CategoryRecord[]
    const summaries = rows(result[2]) as unknown as SummaryRecord[]
    if (summaries.length !== meta.entry_count || categories.length !== meta.category_count) return fail()
    return readBoardListResponse({
      epoch: meta.epoch, revision: meta.revision, categories: categories.map(({ id, name }) => ({ id, name })),
      entries: summaries.map((entry) => ({
        id: entry.id, name: entry.name, categoryId: entry.category_id, revision: entry.revision,
        updatedAt: entry.updated_at, title: entry.title, subtitle: entry.subtitle, pending: entry.pending === 1,
      })),
    })
  }

  async function detail(entryId: string): Promise<BoardDetailResponse> {
    const result = await database.batch([database.prepare(metaSql), database.prepare(entrySql).bind(entryId)])
    const meta = metadata(rows(result[0])[0] as unknown as Metadata | undefined)
    const record = (rows(result[1]) as unknown as EntryRecord[])[0]
    if (!record) return fail('not-found')
    const entry = readEntry(record)
    if (entry.id !== entryId) return fail()
    return { epoch: meta.epoch, entry: publicEntry(entry) }
  }

  async function save(command: BoardSaveCommand, now: Date, createId: () => string = () => crypto.randomUUID()): Promise<BoardSaveResponse> {
    const hashBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(command)))
    const hash = Array.from(new Uint8Array(hashBytes), (value) => value.toString(16).padStart(2, '0')).join('')
    const timestamp = now.toISOString()
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = await database.batch([
        database.prepare(metaSql), database.prepare(categoriesSql), database.prepare(entrySql).bind(command.entryId),
        database.prepare(operationSql).bind(command.operationId),
      ])
      const meta = metadata(rows(result[0])[0] as unknown as Metadata | undefined)
      if (meta.epoch !== command.epoch) return fail('conflict')
      const categories = rows(result[1]) as unknown as CategoryRecord[]
      const record = (rows(result[2]) as unknown as EntryRecord[])[0]
      const existing = record ? readEntry(record) : undefined
      const operation = (rows(result[3]) as unknown as EntryRecord[])[0]
      if (operation) {
        const previous = readEntry(operation)
        if (previous.id !== command.entryId || previous.lastOperationHash !== hash) return fail('conflict')
        return { epoch: meta.epoch, entry: publicEntry(previous), operationId: command.operationId }
      }
      if (command.mode === 'new' ? existing !== undefined : existing === undefined || existing.revision !== command.expectedRevision) return fail('conflict')
      const name = command.newCategoryName
      if (name !== undefined && categories.some((category) => category.name_key === categoryKey(name))) return fail('category-exists')
      if (name === undefined && command.categoryId !== null && !categories.some((category) => category.id === command.categoryId)) return fail('category-missing')
      const category = name === undefined ? undefined : { id: createId(), name }
      const categoryJson = category ? JSON.stringify(category) : null
      const categoryBytes = categoryJson ? bytes(categoryJson) : 0
      const entry: SharedBoardEntry = {
        id: command.entryId, name: command.name, categoryId: category?.id ?? command.categoryId,
        revision: (existing?.revision ?? 0) + 1, updatedAt: timestamp, createdAt: existing?.createdAt ?? timestamp,
        quotation: { ...command.quotation, exchangeRateMode: 'frozen' }, lastOperationId: command.operationId, lastOperationHash: hash,
      }
      const entryJson = JSON.stringify(entry)
      const entryBytes = bytes(entryJson)
      const nextEntries = meta.entry_count + (existing ? 0 : 1)
      const nextCategories = meta.category_count + (category ? 1 : 0)
      const nextEntryBytes = meta.entry_bytes - (record?.json_bytes ?? 0) + entryBytes
      const nextCategoryBytes = meta.category_bytes + categoryBytes
      if (entryBytes > D1_BOARD_ENTRY_MAX_BYTES || nextEntries > BOARD_MAX_ENTRIES || nextCategories > BOARD_MAX_ENTRIES
        || !Number.isSafeInteger(meta.revision + 1) || !Number.isSafeInteger(entry.revision)
        || canonicalBoardBytes(meta, meta.revision + 1, nextEntries, nextCategories, nextEntryBytes, nextCategoryBytes) > BOARD_MAX_BYTES) return fail('capacity')
      const pending = !calculateQuotation(entry.quotation).canExport
      const token = crypto.randomUUID()
      const statements = [database.prepare(`UPDATE quotation_board_meta SET revision = revision + 1, entry_count = ?, category_count = ?, entry_bytes = ?, category_bytes = ?, write_token = ? WHERE id = 1 AND epoch = ? AND revision = ?`)
        .bind(nextEntries, nextCategories, nextEntryBytes, nextCategoryBytes, token, meta.epoch, meta.revision)]
      if (category) statements.push(database.prepare(`INSERT INTO quotation_board_categories (id, name, name_key, json_bytes) SELECT ?, ?, ?, ? WHERE ${guardSql}`)
        .bind(category.id, category.name, categoryKey(category.name), categoryBytes, token))
      if (existing) statements.push(database.prepare(`INSERT INTO quotation_board_versions (board_epoch, board_revision, entry_id, entry_revision, snapshot_json, category_json, archived_at) SELECT ?, ?, e.id, e.revision, e.entry_json, CASE WHEN c.id IS NULL THEN NULL ELSE json_object('id', c.id, 'name', c.name) END, ? FROM quotation_board_entries e LEFT JOIN quotation_board_categories c ON c.id = e.category_id WHERE e.id = ? AND ${guardSql}`)
        .bind(meta.epoch, meta.revision, timestamp, command.entryId, token))
      statements.push(database.prepare(`INSERT INTO quotation_board_entries (id, name, category_id, revision, updated_at, title, subtitle, pending, last_operation_id, last_operation_hash, entry_json, json_bytes) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guardSql} ON CONFLICT(id) DO UPDATE SET name = excluded.name, category_id = excluded.category_id, revision = excluded.revision, updated_at = excluded.updated_at, title = excluded.title, subtitle = excluded.subtitle, pending = excluded.pending, last_operation_id = excluded.last_operation_id, last_operation_hash = excluded.last_operation_hash, entry_json = excluded.entry_json, json_bytes = excluded.json_bytes`)
        .bind(entry.id, entry.name, entry.categoryId, entry.revision, timestamp, entry.quotation.title, entry.quotation.subtitle, pending ? 1 : 0, entry.lastOperationId, hash, entryJson, entryBytes, token))
      try {
        const written = await database.batch(statements)
        if (!written.every((item) => item.success)) return fail()
        if (written[0]?.meta.changes === 1) return { epoch: meta.epoch, entry: publicEntry(entry), operationId: command.operationId }
      } catch {
        // Confirm an ambiguous commit without blindly repeating a failed SQL transaction.
        const confirmed = await database.batch([database.prepare(metaSql), database.prepare(operationSql).bind(command.operationId)])
        const actualMeta = metadata(rows(confirmed[0])[0] as unknown as Metadata | undefined)
        if (actualMeta.epoch !== command.epoch) return fail('conflict')
        const actual = (rows(confirmed[1]) as unknown as EntryRecord[])[0]
        if (actual) {
          const applied = readEntry(actual)
          if (applied.id !== command.entryId || applied.lastOperationHash !== hash) return fail('conflict')
          return { epoch: actualMeta.epoch, entry: publicEntry(applied), operationId: command.operationId }
        }
        return fail()
      }
    }
    return fail('conflict')
  }

  return { list, detail, save }
}
