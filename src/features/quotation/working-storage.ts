import { createQuotation, hasQuotationContent } from './model.ts'
import type { CatalogItem, Quotation, Workspace } from './model.ts'
import { parseWorkspace, serializeWorkspace, STORAGE_KEY } from './persistence.ts'
import type { StorageAdapter, WorkspaceSaveResult } from './persistence.ts'

export const CATALOG_STORAGE_KEY = 'luquisound.catalog.v1'
export const CURRENT_QUOTATION_STORAGE_KEY = 'luquisound.current-quotation.v1'

interface CatalogLoadResult {
  catalog: CatalogItem[]
  error: string | null
  stored: boolean
}

interface CurrentQuotationLoadResult {
  quotation: Quotation
  error: string | null
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
  try {
    const text = storage.getItem(CATALOG_STORAGE_KEY)
    if (text !== null) return { catalog: parseStoredCatalog(text), error: null, stored: true }
    const legacy = storage.getItem(STORAGE_KEY)
    return { catalog: legacy === null ? [] : parseWorkspace(legacy).catalog, error: null, stored: false }
  } catch {
    return { catalog: [], error: CATALOG_READ_ERROR, stored: false }
  }
}

export function loadCurrentQuotation(storage: StorageAdapter): CurrentQuotationLoadResult {
  try {
    const text = storage.getItem(CURRENT_QUOTATION_STORAGE_KEY)
    const quotation = text === null ? undefined : parseCurrentWorkspace(text).quotations[0]
    return { quotation: quotation ?? createQuotation(), error: null }
  } catch {
    return { quotation: createQuotation(), error: CURRENT_READ_ERROR }
  }
}

export function saveCatalog(
  storage: StorageAdapter, catalog: CatalogItem[], options: { overwriteInvalid?: boolean } = {},
): WorkspaceSaveResult {
  let text: string
  try {
    text = serializeCatalogBackup(catalog)
  } catch {
    return { ok: false, error: 'El catálogo excede el tamaño o el formato permitido para el guardado.' }
  }
  try {
    const current = storage.getItem(CATALOG_STORAGE_KEY)
    if (current !== null) parseStoredCatalog(current)
  } catch {
    if (!options.overwriteInvalid) return { ok: false, error: CATALOG_READ_ERROR }
  }
  try {
    storage.setItem(CATALOG_STORAGE_KEY, text)
    return { ok: true, error: null }
  } catch {
    return { ok: false, error: 'No se pudo guardar el catálogo en este navegador. Descargá un respaldo del catálogo.' }
  }
}

export function saveCurrentQuotation(
  storage: StorageAdapter, quotation: Quotation, options: { overwriteInvalid?: boolean } = {},
): WorkspaceSaveResult {
  let text: string
  try {
    const workspace: Workspace = {
      version: 1, activeQuotationId: quotation.id, quotations: [quotation], catalog: [],
    }
    // Validate even blank input before replacing a recoverable quotation.
    text = serializeWorkspace(workspace)
    if (!hasQuotationContent(quotation)) text = serializeWorkspace(catalogWorkspace([]))
  } catch {
    return { ok: false, error: 'El presupuesto en curso excede el tamaño o el formato permitido para recuperarlo.' }
  }
  try {
    const current = storage.getItem(CURRENT_QUOTATION_STORAGE_KEY)
    if (current !== null) parseCurrentWorkspace(current)
  } catch {
    if (!options.overwriteInvalid) return { ok: false, error: CURRENT_READ_ERROR }
  }
  try {
    storage.setItem(CURRENT_QUOTATION_STORAGE_KEY, text)
    return { ok: true, error: null }
  } catch {
    return { ok: false, error: 'No se podrá recuperar este presupuesto al recargar. Podés seguir editándolo y compartirlo.' }
  }
}

export function serializeCatalogBackup(catalog: CatalogItem[]): string {
  return serializeWorkspace(catalogWorkspace(catalog))
}

export function parseCatalogBackup(text: string): CatalogItem[] {
  return parseWorkspace(text).catalog
}
