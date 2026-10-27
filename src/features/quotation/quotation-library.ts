import { hasQuotationContent, type Quotation } from './model.ts'
import { prepareFixedServiceQuotation } from './fixed-services.ts'
import { parseWorkspace, type StorageAdapter } from './persistence.ts'

export const LIBRARY_STORAGE_KEY = 'luquisound.quotation-library.v1'
export const QUOTATION_LIBRARY_MAX_ENTRIES = 100
export const QUOTATION_LIBRARY_MAX_BYTES = 5 * 1024 * 1024

export interface QuotationLibraryEntry {
  id: string
  name: string
  savedAt: string
  quotation: Quotation
}

export interface QuotationLibrary {
  schema: 'luquisound.quotation-library'
  version: 1
  entries: QuotationLibraryEntry[]
}

export interface QuotationLibraryLoadResult {
  library: QuotationLibrary
  raw: string | null
  error: string | null
  stored: boolean
}

export interface QuotationLibrarySaveResult {
  ok: boolean
  error: string | null
  raw: string | null
  conflict: boolean
}

const INVALID_MESSAGE = 'El respaldo no tiene un formato válido de historial de Luquisound.'
const READ_MESSAGE = 'No se pudo recuperar el historial. Los datos anteriores no se modificaron.'
const CONFLICT_MESSAGE = 'Otra pestaña cambió el historial. Se pausó el guardado para conservar ambas versiones. Descargá un respaldo antes de continuar.'

function invalidLibrary(): never { throw new Error(INVALID_MESSAGE) }

function checkSize(text: string): void {
  if (text.length > QUOTATION_LIBRARY_MAX_BYTES || new TextEncoder().encode(text).byteLength > QUOTATION_LIBRARY_MAX_BYTES) {
    throw new Error('El historial supera el límite de 5 MiB. Descargá un respaldo antes de reducirlo.')
  }
}

function readRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalidLibrary()
  return value as Record<string, unknown>
}

function readId(value: unknown, ids: Set<string>): string {
  if (typeof value !== 'string' || value.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(value) || ids.has(value)) invalidLibrary()
  ids.add(value)
  return value
}

function readTimestamp(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) invalidLibrary()
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) invalidLibrary()
  return value
}

function readName(value: unknown): string {
  if (typeof value !== 'string') invalidLibrary()
  const name = value.trim()
  if (!name || name.length > 200) invalidLibrary()
  return name
}

export function quotationLibraryNameKey(name: string): string {
  return name.trim().normalize('NFKC').toLocaleLowerCase('es-AR')
}

export function hasArchivableQuotationContent(quotation: Quotation): boolean {
  return quotation.rows.some((row) => row.concept.trim() !== '' || row.detail.trim() !== ''
    || row.unitPrice.trim() !== '' || row.priceState === 'included' || row.fixedServiceOrigin?.requiresPriceReview === true)
}

function validatedQuotation(value: unknown): Quotation {
  const candidate = readRecord(value)
  const workspace = parseWorkspace(JSON.stringify({
    version: 1, activeQuotationId: candidate.id, quotations: [candidate], catalog: [],
  }))
  const quotation = workspace.quotations[0]
  if (!quotation || !hasQuotationContent(quotation)) invalidLibrary()
  return quotation
}

function readLibrary(value: unknown): QuotationLibrary {
  const record = readRecord(value)
  if (record.schema !== 'luquisound.quotation-library' || record.version !== 1
    || !Array.isArray(record.entries) || record.entries.length > QUOTATION_LIBRARY_MAX_ENTRIES) invalidLibrary()
  const ids = new Set<string>()
  const names = new Set<string>()
  const entries = record.entries.map((input): QuotationLibraryEntry => {
    const entry = readRecord(input)
    const id = readId(entry.id, ids)
    const name = readName(entry.name)
    const nameKey = quotationLibraryNameKey(name)
    if (names.has(nameKey)) invalidLibrary()
    names.add(nameKey)
    const quotation = validatedQuotation(entry.quotation)
    readId(quotation.id, ids)
    for (const row of quotation.rows) readId(row.id, ids)
    return { id, name, savedAt: readTimestamp(entry.savedAt), quotation: { ...quotation, exchangeRateMode: 'frozen' } }
  })
  return { schema: 'luquisound.quotation-library', version: 1, entries }
}

function parseJson(text: string): unknown {
  checkSize(text)
  try { return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as unknown }
  catch { return invalidLibrary() }
}

export function createQuotationLibrary(): QuotationLibrary {
  return { schema: 'luquisound.quotation-library', version: 1, entries: [] }
}

export function parseQuotationLibrary(text: string): QuotationLibrary {
  return readLibrary(parseJson(text))
}

export function serializeQuotationLibrary(library: QuotationLibrary): string {
  const text = JSON.stringify(readLibrary(library), null, 2)
  checkSize(text)
  return text
}

function cloneWithNewIds(quotation: Quotation): Quotation {
  const copy = validatedQuotation(quotation)
  const rows = copy.rows.map((row) => ({ ...row, id: crypto.randomUUID() }))
  const rowIds = new Map(copy.rows.map((row, index) => [row.id, rows[index]!.id]))
  return {
    ...copy, id: crypto.randomUUID(), exchangeRateMode: 'frozen',
    rows,
    ...(copy.discount ? { discount: {
      ...copy.discount, rowIds: copy.discount.rowIds.map((id) => rowIds.get(id) ?? id),
    } } : {}),
  }
}

export function saveQuotationToLibrary(
  library: QuotationLibrary, quotation: Quotation, nameInput: string,
  options: { replaceEntryId?: string } = {},
): QuotationLibrary {
  const current = readLibrary(library)
  if (!hasArchivableQuotationContent(quotation)) throw new Error('El presupuesto está vacío. Agregá un concepto, un detalle o un precio antes de guardarlo en el historial.')
  const name = readName(nameInput)
  const sameName = current.entries.find((entry) => quotationLibraryNameKey(entry.name) === quotationLibraryNameKey(name))
  const replacing = options.replaceEntryId === undefined ? undefined : current.entries.find((entry) => entry.id === options.replaceEntryId)
  if (options.replaceEntryId !== undefined && !replacing) throw new Error('El presupuesto que querías reemplazar ya no está en el historial.')
  if (sameName && sameName.id !== replacing?.id) throw new Error('Ya existe un presupuesto con ese nombre. Confirmá su reemplazo o elegí otro nombre.')
  if (!replacing && current.entries.length >= QUOTATION_LIBRARY_MAX_ENTRIES) throw new Error('Llegaste al límite de 100 presupuestos guardados. Conservá un respaldo antes de reemplazar el historial.')
  const entry: QuotationLibraryEntry = {
    id: replacing?.id ?? crypto.randomUUID(), name, savedAt: new Date().toISOString(),
    quotation: cloneWithNewIds(quotation),
  }
  const next: QuotationLibrary = { ...current, entries: [entry, ...current.entries.filter((item) => item.id !== replacing?.id)] }
  return parseQuotationLibrary(serializeQuotationLibrary(next))
}

export function openLibraryQuotation(entry: QuotationLibraryEntry, options: { duplicate?: boolean } = {}): Quotation {
  const quotation = prepareFixedServiceQuotation(cloneWithNewIds(entry.quotation))
  if (!options.duplicate) return quotation
  const now = new Date().toISOString()
  return {
    ...quotation, title: `${(quotation.title || 'PRESUPUESTO').slice(0, 492)} (copia)`,
    createdAt: now, updatedAt: now,
  }
}

export function previewQuotationLibraryBackup(text: string): { library: QuotationLibrary; fromLegacy: boolean } {
  const value = readRecord(parseJson(text))
  if (value.schema !== undefined) {
    const library = readLibrary(value)
    serializeQuotationLibrary(library)
    return { library, fromLegacy: false }
  }
  const workspace = parseWorkspace(text)
  const meaningful = workspace.quotations.filter(hasQuotationContent)
  if (meaningful.length > QUOTATION_LIBRARY_MAX_ENTRIES) throw new Error('El respaldo anterior contiene más de 100 presupuestos. No se importó ninguno.')
  const names = new Set<string>()
  const entries = meaningful.map((quotation): QuotationLibraryEntry => {
    const base = quotation.title.trim().slice(0, 190) || 'Presupuesto'
    let name = base
    let suffix = 2
    while (names.has(quotationLibraryNameKey(name))) name = `${base} (${suffix++})`
    names.add(quotationLibraryNameKey(name))
    return { id: crypto.randomUUID(), name, savedAt: quotation.updatedAt, quotation: cloneWithNewIds(quotation) }
  })
  const library = readLibrary({ ...createQuotationLibrary(), entries })
  serializeQuotationLibrary(library)
  return { library, fromLegacy: true }
}

export function parseQuotationLibraryBackup(text: string): QuotationLibrary {
  return previewQuotationLibraryBackup(text).library
}

export function loadQuotationLibrary(storage: StorageAdapter): QuotationLibraryLoadResult {
  let raw: string | null = null
  try {
    raw = storage.getItem(LIBRARY_STORAGE_KEY)
    return { library: raw === null ? createQuotationLibrary() : parseQuotationLibrary(raw), raw, error: null, stored: raw !== null }
  } catch {
    return { library: createQuotationLibrary(), raw, error: READ_MESSAGE, stored: false }
  }
}

export function saveQuotationLibrary(
  storage: StorageAdapter, library: QuotationLibrary,
  options: { expectedRaw: string | null; overwriteInvalid?: boolean },
): QuotationLibrarySaveResult {
  let raw: string
  try { raw = serializeQuotationLibrary(library) }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : INVALID_MESSAGE, raw: options.expectedRaw, conflict: false } }
  try {
    const actual = storage.getItem(LIBRARY_STORAGE_KEY)
    if (actual !== options.expectedRaw) return { ok: false, error: CONFLICT_MESSAGE, raw: options.expectedRaw, conflict: true }
    if (actual !== null && !options.overwriteInvalid) {
      try { parseQuotationLibrary(actual) }
      catch { return { ok: false, error: READ_MESSAGE, raw: options.expectedRaw, conflict: false } }
    }
    storage.setItem(LIBRARY_STORAGE_KEY, raw)
    return { ok: true, error: null, raw, conflict: false }
  } catch {
    return { ok: false, error: 'No se pudo guardar el historial. Descargá un respaldo de los presupuestos que ves en esta pestaña.', raw: options.expectedRaw, conflict: false }
  }
}
