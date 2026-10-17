import { createQuotation, hasQuotationContent } from './model.ts'
import type { CatalogItem, Quotation, Workspace } from './model.ts'
import { parseWorkspace, serializeWorkspace, STORAGE_KEY } from './persistence.ts'
import type { StorageAdapter, WorkspaceSaveResult } from './persistence.ts'

export const CATALOG_STORAGE_KEY = 'luquisound.catalog.v1'
export const CURRENT_QUOTATION_STORAGE_KEY = 'luquisound.current-quotation.v1'

export interface CatalogLoadResult {
  catalog: CatalogItem[]
  error: string | null
  stored: boolean
  raw: string | null
}

export interface CurrentQuotationLoadResult {
  quotation: Quotation
  error: string | null
  raw: string | null
}

export interface WorkingSaveOptions {
  overwriteInvalid?: boolean
  expectedRaw?: string | null
}

export interface WorkingSaveResult extends WorkspaceSaveResult {
  raw: string | null
  conflict: boolean
}

const CATALOG_READ_ERROR = 'No se pudo recuperar el catálogo de este navegador. Los datos anteriores no se modificaron.'
const CURRENT_READ_ERROR = 'No se pudo recuperar el presupuesto en curso. Los datos anteriores no se modificaron.'

function catalogWorkspace(catalog: CatalogItem[]): Workspace {
  return { version: 1, activeQuotationId: null, quotations: [], catalog }
}

function parseStoredCatalog(text: string): CatalogItem[] {
  const workspace = parseWorkspace(text)
  if (workspace.quotations.length !== 0 || workspace.activeQuotationId !== null) {
    throw new Error(CATALOG_READ_ERROR)
  }
  return workspace.catalog
}

function parseCurrentWorkspace(text: string): Workspace {
  const workspace = parseWorkspace(text)
  if (workspace.quotations.length > 1 || workspace.catalog.length !== 0) {
    throw new Error(CURRENT_READ_ERROR)
  }
  return workspace
}

export function loadCatalog(storage: StorageAdapter): CatalogLoadResult {
  let raw: string | null = null
  try {
    raw = storage.getItem(CATALOG_STORAGE_KEY)
    if (raw !== null) return { catalog: parseStoredCatalog(raw), error: null, stored: true, raw }
    const legacy = storage.getItem(STORAGE_KEY)
    return { catalog: legacy === null ? [] : parseWorkspace(legacy).catalog, error: null, stored: false, raw }
  } catch {
    return { catalog: [], error: CATALOG_READ_ERROR, stored: false, raw }
  }
}

export function loadCurrentQuotation(storage: StorageAdapter): CurrentQuotationLoadResult {
  let raw: string | null = null
  try {
    raw = storage.getItem(CURRENT_QUOTATION_STORAGE_KEY)
    const quotation = raw === null ? undefined : parseCurrentWorkspace(raw).quotations[0]
    return { quotation: quotation ?? createQuotation(), error: null, raw }
  } catch {
    return { quotation: createQuotation(), error: CURRENT_READ_ERROR, raw }
  }
}

function saveWorkingValue(
  storage: StorageAdapter, key: string, text: string, options: WorkingSaveOptions,
  validate: (raw: string) => unknown, readError: string, writeError: string, conflictError: string,
): WorkingSaveResult {
  let raw: string | null
  try { raw = storage.getItem(key) }
  catch { return { ok: false, error: readError, raw: null, conflict: false } }
  const conflict = (): WorkingSaveResult => ({ ok: false, error: conflictError, raw, conflict: true })
  if (options.expectedRaw !== undefined && raw !== options.expectedRaw) return conflict()
  try { if (raw !== null) validate(raw) }
  catch {
    if (!options.overwriteInvalid) return { ok: false, error: readError, raw, conflict: false }
  }
  if (options.expectedRaw !== undefined) {
    // Parsing can take time. Check again immediately before writing, even if storage events are delayed.
    try { raw = storage.getItem(key) }
    catch { return { ok: false, error: readError, raw: null, conflict: false } }
    if (raw !== options.expectedRaw) return conflict()
  }
  try {
    storage.setItem(key, text)
    return { ok: true, error: null, raw: text, conflict: false }
  } catch { return { ok: false, error: writeError, raw, conflict: false } }
}

export function saveCatalog(
  storage: StorageAdapter, catalog: CatalogItem[], options: WorkingSaveOptions = {},
): WorkingSaveResult {
  let text: string
  try {
    text = serializeCatalogBackup(catalog)
  } catch {
    return { ok: false, error: 'El catálogo excede el tamaño o el formato permitido para el guardado.', raw: null, conflict: false }
  }
  return saveWorkingValue(storage, CATALOG_STORAGE_KEY, text, options, parseStoredCatalog, CATALOG_READ_ERROR,
    'No se pudo guardar el catálogo en este navegador. Descargá un respaldo del catálogo.',
    'Otra pestaña cambió el catálogo. Su guardado se pausó para evitar sobrescribirlo. Conservá un respaldo antes de habilitarlo.')
}

export function saveCurrentQuotation(
  storage: StorageAdapter, quotation: Quotation, options: WorkingSaveOptions = {},
): WorkingSaveResult {
  let text: string
  try {
    const workspace: Workspace = {
      version: 1, activeQuotationId: quotation.id, quotations: [quotation], catalog: [],
    }
    // Validate even blank input before replacing a recoverable quotation.
    text = serializeWorkspace(workspace)
    if (!hasQuotationContent(quotation)) text = serializeWorkspace(catalogWorkspace([]))
  } catch {
    return { ok: false, error: 'El presupuesto en curso excede el tamaño o el formato permitido para recuperarlo.', raw: null, conflict: false }
  }
  return saveWorkingValue(storage, CURRENT_QUOTATION_STORAGE_KEY, text, options, parseCurrentWorkspace, CURRENT_READ_ERROR,
    'No se podrá recuperar este presupuesto al recargar. Podés seguir editándolo y compartirlo.',
    'Otra pestaña cambió el presupuesto en curso. Su guardado se pausó para evitar sobrescribirlo. Conservá el presupuesto antes de reemplazar los datos de recuperación.')
}

export function serializeCatalogBackup(catalog: CatalogItem[]): string {
  return serializeWorkspace(catalogWorkspace(catalog))
}

export function parseCatalogBackup(text: string): CatalogItem[] {
  return parseWorkspace(text).catalog
}
