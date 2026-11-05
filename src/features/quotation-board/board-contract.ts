import { calculateQuotation } from '../quotation/calculation.ts'
import { duplicateQuotation, type Quotation } from '../quotation/model.ts'
import { parseWorkspace } from '../quotation/persistence.ts'
import type { BoardCategory, BoardEntry } from './board-types.ts'
import type {
  BoardDetailResponse, BoardEntrySummary, BoardListResponse, BoardSaveCommand, BoardSaveResponse,
  BoardWorkingContext, SharedBoardDocument, SharedBoardEntry,
} from './shared-board-types.ts'

export const BOARD_MAX_BYTES = 5 * 1024 * 1024
export const BOARD_REQUEST_MAX_BYTES = 2 * 1024 * 1024
export const BOARD_MAX_ENTRIES = 100

const baselineTimestamp = '2000-01-01T00:00:00.000Z'
const invalidMessage = 'El tablero contiene datos inválidos. Los presupuestos anteriores se conservan.'

function invalid(): never { throw new Error(invalidMessage) }

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid()
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) invalid()
}

function textSize(text: string, maximum: number): void {
  if (text.length > maximum || new TextEncoder().encode(text).byteLength > maximum) {
    throw new Error('Los datos del tablero superan el tamaño permitido. El presupuesto se conserva.')
  }
}

function encoded(value: unknown, maximum: number): string {
  let text: string | undefined
  try { text = JSON.stringify(value) } catch { invalid() }
  if (text === undefined) invalid()
  textSize(text, maximum)
  return text
}

function json(text: string, maximum: number): unknown {
  textSize(text, maximum)
  try { return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as unknown }
  catch { return invalid() }
}

function identifier(value: unknown): string {
  if (typeof value !== 'string' || value.length > 128 || !/^[A-Za-z0-9_-]+$/.test(value)) invalid()
  return value
}

function epoch(value: unknown): string {
  if (value === 'initial') return value
  if (typeof value !== 'string' || !/^[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$/.test(value)) invalid()
  return value
}

function revision(value: unknown, minimum = 1): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) invalid()
  return value
}

function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) invalid()
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) invalid()
  return value
}

function name(value: unknown, maximum: number): string {
  if (typeof value !== 'string') invalid()
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > maximum) {
    throw new Error(`Ingresá un nombre de hasta ${maximum} caracteres.`)
  }
  return trimmed
}

function boundedString(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || value.length > maximum) invalid()
  return value
}

function nullableCategory(value: unknown): string | null {
  return value === null ? null : identifier(value)
}

function categories(value: unknown, strict: boolean): BoardCategory[] {
  if (!Array.isArray(value) || value.length > BOARD_MAX_ENTRIES) invalid()
  const ids = new Set<string>()
  const names = new Set<string>()
  return value.map((input): BoardCategory => {
    const category = record(input)
    if (strict) exactKeys(category, ['id', 'name'])
    const id = identifier(category.id)
    const categoryName = name(category.name, 80)
    const key = categoryName.normalize('NFKC').replace(/\s+/g, ' ').toLocaleLowerCase('es-AR')
    if (ids.has(id) || names.has(key)) invalid()
    ids.add(id)
    names.add(key)
    return { id, name: categoryName }
  })
}

function quotation(value: unknown, frozen = false): Quotation {
  const candidate = record(value)
  encoded(candidate, BOARD_REQUEST_MAX_BYTES)
  const workspace = parseWorkspace(JSON.stringify({
    version: 1, activeQuotationId: candidate.id, quotations: [candidate], catalog: [],
  }))
  const result = workspace.quotations[0]
  if (!result) invalid()
  return frozen ? { ...result, exchangeRateMode: 'frozen' } : result
}

function publicEntry(value: unknown): BoardEntry {
  const entry = record(value)
  return {
    id: identifier(entry.id), name: name(entry.name, 120), categoryId: nullableCategory(entry.categoryId),
    revision: revision(entry.revision), updatedAt: timestamp(entry.updatedAt), quotation: quotation(entry.quotation, true),
  }
}

function storedEntry(value: unknown): SharedBoardEntry {
  const entry = record(value)
  exactKeys(entry, ['id', 'name', 'categoryId', 'revision', 'updatedAt', 'quotation', 'createdAt', 'lastOperationId', 'lastOperationHash'])
  const result = publicEntry(entry)
  const createdAt = timestamp(entry.createdAt)
  if (createdAt > result.updatedAt || typeof entry.lastOperationHash !== 'string'
    || !/^[a-f0-9]{64}$/.test(entry.lastOperationHash)) invalid()
  return {
    ...result, createdAt, lastOperationId: identifier(entry.lastOperationId), lastOperationHash: entry.lastOperationHash,
  }
}

function readDocument(value: unknown): SharedBoardDocument {
  const document = record(value)
  exactKeys(document, ['schema', 'version', 'epoch', 'revision', 'categories', 'entries'])
  if (document.schema !== 'luquisound.quotation-board' || document.version !== 1
    || !Array.isArray(document.entries) || document.entries.length > BOARD_MAX_ENTRIES) invalid()
  const boardEpoch = epoch(document.epoch)
  const boardRevision = revision(document.revision, 0)
  const boardCategories = categories(document.categories, true)
  const categoryIds = new Set(boardCategories.map((category) => category.id))
  const entryIds = new Set<string>()
  const entries = document.entries.map((input): SharedBoardEntry => {
    const entry = storedEntry(input)
    if (entryIds.has(entry.id) || (entry.categoryId !== null && !categoryIds.has(entry.categoryId))) invalid()
    entryIds.add(entry.id)
    return entry
  })
  if (boardRevision === 0 && (entries.length > 0 || boardCategories.length > 0)) invalid()
  return { schema: 'luquisound.quotation-board', version: 1, epoch: boardEpoch, revision: boardRevision, categories: boardCategories, entries }
}

export function createEmptyBoard(): SharedBoardDocument {
  return { schema: 'luquisound.quotation-board', version: 1, epoch: 'initial', revision: 0, categories: [], entries: [] }
}

export function parseBoardDocument(text: string): SharedBoardDocument {
  return readDocument(json(text, BOARD_MAX_BYTES))
}

export function serializeBoardDocument(document: SharedBoardDocument): string {
  encoded(document, BOARD_MAX_BYTES)
  return encoded(readDocument(document), BOARD_MAX_BYTES)
}

export function readBoardSaveCommand(value: unknown): BoardSaveCommand {
  encoded(value, BOARD_REQUEST_MAX_BYTES)
  const command = record(value)
  exactKeys(command, ['type', 'operationId', 'epoch', 'mode', 'entryId', 'expectedRevision', 'name', 'categoryId', 'newCategoryName', 'quotation'])
  if (command.type !== 'save' || (command.mode !== 'new' && command.mode !== 'replace')) invalid()
  const expectedRevision = command.mode === 'new'
    ? command.expectedRevision === null ? null : invalid()
    : revision(command.expectedRevision)
  const categoryId = nullableCategory(command.categoryId)
  const newCategoryName = command.newCategoryName === undefined ? undefined : name(command.newCategoryName, 80)
  if (newCategoryName !== undefined && categoryId !== null) invalid()
  return {
    type: 'save', operationId: identifier(command.operationId), epoch: epoch(command.epoch), mode: command.mode,
    entryId: identifier(command.entryId), expectedRevision, name: name(command.name, 120), categoryId,
    ...(newCategoryName === undefined ? {} : { newCategoryName }), quotation: quotation(command.quotation),
  }
}

export function toPublicBoardEntry(entry: SharedBoardEntry): BoardEntry {
  return publicEntry(entry)
}

export function summarizeBoardEntry(entry: SharedBoardEntry): BoardEntrySummary {
  const current = toPublicBoardEntry(entry)
  return {
    id: current.id, name: current.name, categoryId: current.categoryId, revision: current.revision,
    updatedAt: current.updatedAt, title: current.quotation.title, subtitle: current.quotation.subtitle,
    pending: !calculateQuotation(current.quotation).canExport,
  }
}

export function readBoardListResponse(value: unknown): BoardListResponse {
  encoded(value, BOARD_MAX_BYTES)
  const response = record(value)
  if (!Array.isArray(response.entries) || response.entries.length > BOARD_MAX_ENTRIES) invalid()
  const boardCategories = categories(response.categories, false)
  const categoryIds = new Set(boardCategories.map((category) => category.id))
  const entryIds = new Set<string>()
  const entries = response.entries.map((input): BoardEntrySummary => {
    const entry = record(input)
    const id = identifier(entry.id)
    const categoryId = nullableCategory(entry.categoryId)
    if (entryIds.has(id) || (categoryId !== null && !categoryIds.has(categoryId)) || typeof entry.pending !== 'boolean') invalid()
    entryIds.add(id)
    return {
      id, name: name(entry.name, 120), categoryId, revision: revision(entry.revision),
      updatedAt: timestamp(entry.updatedAt), title: boundedString(entry.title, 500), subtitle: boundedString(entry.subtitle, 1000),
      pending: entry.pending,
    }
  })
  const boardEpoch = epoch(response.epoch)
  const boardRevision = revision(response.revision, 0)
  if (boardRevision === 0 && (entries.length > 0 || boardCategories.length > 0)) invalid()
  return { epoch: boardEpoch, revision: boardRevision, categories: boardCategories, entries }
}

export function readBoardDetailResponse(value: unknown): BoardDetailResponse {
  encoded(value, BOARD_MAX_BYTES)
  const response = record(value)
  const boardEpoch = epoch(response.epoch)
  return { epoch: boardEpoch, entry: publicEntry(response.entry) }
}

export function readBoardSaveResponse(value: unknown): BoardSaveResponse {
  const response = record(value)
  return { ...readBoardDetailResponse(response), operationId: identifier(response.operationId) }
}

export function cloneBoardQuotation(value: Quotation): Quotation {
  const original = quotation(value)
  const copy = duplicateQuotation(structuredClone(original))
  return quotation({ ...copy, title: original.title, exchangeRateMode: 'frozen' }, true)
}

export function quotationBaseline(value: Quotation): string {
  const { createdAt: _createdAt, updatedAt: _updatedAt, exchangeRateMode: _exchangeRateMode, ...content } = quotation(value)
  return encoded(content, BOARD_REQUEST_MAX_BYTES)
}

export function readBoardWorkingContext(value: unknown): BoardWorkingContext {
  encoded(value, BOARD_MAX_BYTES)
  const context = record(value)
  exactKeys(context, ['entryId', 'revision', 'epoch', 'name', 'categoryId', 'baseline'])
  if (typeof context.baseline !== 'string') invalid()
  const baseline = record(json(context.baseline, BOARD_REQUEST_MAX_BYTES))
  const baselineQuotation = quotation({ ...baseline, createdAt: baselineTimestamp, updatedAt: baselineTimestamp })
  return {
    entryId: identifier(context.entryId), revision: revision(context.revision), epoch: epoch(context.epoch),
    name: name(context.name, 120), categoryId: nullableCategory(context.categoryId), baseline: quotationBaseline(baselineQuotation),
  }
}
