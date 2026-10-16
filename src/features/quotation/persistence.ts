import { createWorkspace } from './model.ts'
import type { CatalogItem, Currency, PriceState, Quotation, QuotationRow, RowSection, Workspace } from './model.ts'

export interface StorageAdapter {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface WorkspaceLoadResult {
  workspace: Workspace
  error: string | null
  stored: boolean
}

export interface WorkspaceSaveResult {
  ok: boolean
  error: string | null
}

export const STORAGE_KEY = 'luquisound.workspace.v1'

const MAX_BACKUP_BYTES = 5 * 1024 * 1024
const INVALID_BACKUP_MESSAGE = 'El respaldo no tiene un formato válido de Luquisound.'
const OVERSIZED_BACKUP_MESSAGE = 'El respaldo supera el límite de 5 MB.'

function invalidBackup(): never {
  throw new Error(INVALID_BACKUP_MESSAGE)
}

function readRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalidBackup()
  return value as Record<string, unknown>
}

function readArray(value: unknown, limit: number): unknown[] {
  if (!Array.isArray(value) || value.length > limit) invalidBackup()
  return value
}

function readString(value: unknown, limit: number): string {
  if (typeof value !== 'string' || value.length > limit) invalidBackup()
  return value
}

function readIdentifier(value: unknown, identifiers?: Set<string>): string {
  const identifier = readString(value, 128)
  if (!/^[a-zA-Z0-9_-]+$/.test(identifier) || identifiers?.has(identifier)) invalidBackup()
  identifiers?.add(identifier)
  return identifier
}

function readTimestamp(value: unknown): string {
  const timestamp = readString(value, 24)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(timestamp)) invalidBackup()
  const date = new Date(timestamp)
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== timestamp) invalidBackup()
  return timestamp
}

function readCurrency(value: unknown): Currency {
  if (value !== 'ARS' && value !== 'USD') invalidBackup()
  return value
}

function readSection(value: unknown): RowSection {
  if (value !== 'equipment' && value !== 'extras') invalidBackup()
  return value
}

function readPriceState(value: unknown): PriceState {
  if (value !== 'pending' && value !== 'priced' && value !== 'included') invalidBackup()
  return value
}

function readRow(value: unknown, identifiers: Set<string>): QuotationRow {
  const row = readRecord(value)
  return {
    id: readIdentifier(row.id, identifiers),
    section: readSection(row.section),
    concept: readString(row.concept, 500),
    detail: readString(row.detail, 2000),
    quantity: readString(row.quantity, 64),
    unitPrice: readString(row.unitPrice, 64),
    priceState: readPriceState(row.priceState),
  }
}

function readQuotation(value: unknown, identifiers: Set<string>): Quotation {
  const quotation = readRecord(value)
  return {
    id: readIdentifier(quotation.id, identifiers),
    title: readString(quotation.title, 500),
    subtitle: readString(quotation.subtitle, 1000),
    currency: readCurrency(quotation.currency),
    rows: readArray(quotation.rows, 1000).map((row) => readRow(row, identifiers)),
    notes: readString(quotation.notes, 10000),
    createdAt: readTimestamp(quotation.createdAt),
    updatedAt: readTimestamp(quotation.updatedAt),
  }
}

function readCatalogItem(value: unknown, identifiers: Set<string>): CatalogItem {
  const item = readRecord(value)
  return {
    id: readIdentifier(item.id, identifiers),
    concept: readString(item.concept, 500),
    detail: readString(item.detail, 2000),
    section: readSection(item.section),
    currency: readCurrency(item.currency),
    unitPrice: readString(item.unitPrice, 64),
  }
}

function readWorkspace(value: unknown): Workspace {
  const workspace = readRecord(value)
  if (workspace.version !== 1) invalidBackup()
  const identifiers = new Set<string>()
  const quotations = readArray(workspace.quotations, 500).map((quotation) => readQuotation(quotation, identifiers))
  const activeQuotationId = workspace.activeQuotationId === null ? null : readIdentifier(workspace.activeQuotationId)
  if (quotations.length === 0 && activeQuotationId !== null) invalidBackup()
  if (quotations.length > 0 && !quotations.some((quotation) => quotation.id === activeQuotationId)) invalidBackup()
  return {
    version: 1,
    activeQuotationId,
    quotations,
    catalog: readArray(workspace.catalog, 2000).map((item) => readCatalogItem(item, identifiers)),
  }
}

function checkBackupSize(text: string): void {
  if (text.length > MAX_BACKUP_BYTES || new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES) {
    throw new Error(OVERSIZED_BACKUP_MESSAGE)
  }
}

export function parseWorkspace(text: string): Workspace {
  checkBackupSize(text)
  let value: unknown
  try {
    value = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
  } catch {
    invalidBackup()
  }
  return readWorkspace(value)
}

export function serializeWorkspace(workspace: Workspace): string {
  const text = JSON.stringify(readWorkspace(workspace), null, 2)
  checkBackupSize(text)
  return text
}

export function loadWorkspace(storage: StorageAdapter): WorkspaceLoadResult {
  let text: string | null
  try {
    text = storage.getItem(STORAGE_KEY)
  } catch {
    return {
      workspace: createWorkspace(),
      stored: false,
      error: 'No se pudo acceder al guardado de este navegador. Conservá un respaldo de tus cambios.',
    }
  }
  if (text === null) return { workspace: createWorkspace(), error: null, stored: false }
  try {
    return { workspace: parseWorkspace(text), error: null, stored: true }
  } catch {
    return {
      workspace: createWorkspace(),
      stored: false,
      error: 'No se pudieron leer los datos guardados. No se modificaron. Podés recuperar un respaldo o iniciar un espacio nuevo.',
    }
  }
}

export function saveWorkspace(storage: StorageAdapter, workspace: Workspace): WorkspaceSaveResult {
  let text: string
  try {
    text = serializeWorkspace(workspace)
  } catch {
    return { ok: false, error: 'Los datos exceden el tamaño o el formato permitido para el guardado.' }
  }
  try {
    storage.setItem(STORAGE_KEY, text)
    return { ok: true, error: null }
  } catch {
    return {
      ok: false,
      error: 'No se pudo guardar en este navegador. Revisá el espacio disponible y descargá un respaldo de tus cambios.',
    }
  }
}
