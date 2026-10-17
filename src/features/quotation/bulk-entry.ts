import { parseMoney, parseQuantity } from './calculation.ts'
import {
  normalizeCatalogQuery, resolveCatalogQuery,
  type CatalogQueryResolution, type CatalogSelectionPredicate,
} from './catalog-search.ts'
import { createRow, type CatalogItem, type Currency, type QuotationRow, type RowSection } from './model.ts'
import { rowFromCatalog } from './row-provenance.ts'

export const BULK_ENTRY_MAX_LINES = 50
export const BULK_ENTRY_MAX_LINE_LENGTH = 500
export const BULK_ENTRY_MAX_CHARACTERS = 26000

export interface BulkEntryLine {
  lineNumber: number
  query: string
  resolution: CatalogQueryResolution
  duplicateOfLine: number | null
}

export interface BulkEntryPreview {
  input: string
  catalogSnapshot: string
  lines: BulkEntryLine[]
}

export interface BulkEntryDecision {
  lineNumber: number
  action: 'unresolved' | 'catalog' | 'manual' | 'skip'
  itemId: string | null
  concept: string
  quantity: string
  section: RowSection
  confirmDuplicate: boolean
}

export interface ApplyBulkEntryOptions {
  canSelect: CatalogSelectionPredicate
  defaultCurrency: Currency
  existingRowCount: number
}

function hasControlCharacters(value: string, allowLineBreaks = false): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code === 127 || (code < 32 && !(allowLineBreaks && (code === 10 || code === 13)))) return true
  }
  return false
}

function readInput(input: string): { lineNumber: number; query: string }[] {
  if (input.length > BULK_ENTRY_MAX_CHARACTERS) {
    throw new Error('El texto es demasiado largo. Pegá hasta 50 líneas de 500 caracteres cada una.')
  }
  if (hasControlCharacters(input, true)) {
    throw new Error('Pegá una sola columna: un código o nombre por línea, sin cantidades ni precios en columnas separadas.')
  }
  const lines = input.split(/\r\n|\r|\n/).flatMap((value, index) => {
    const query = value.trim()
    return query ? [{ lineNumber: index + 1, query }] : []
  })
  if (lines.length === 0) throw new Error('Pegá al menos un código o nombre para revisar.')
  if (lines.length > BULK_ENTRY_MAX_LINES) throw new Error('Podés agregar hasta 50 líneas por vez. Dividí la lista en partes.')
  if (lines.some((line) => line.query.length > BULK_ENTRY_MAX_LINE_LENGTH)) {
    throw new Error('Cada línea admite hasta 500 caracteres. Revisá los nombres antes de continuar.')
  }
  return lines
}

export function buildBulkEntryPreview(
  input: string, catalog: readonly CatalogItem[], canSelect: CatalogSelectionPredicate,
): BulkEntryPreview {
  const seen = new Map<string, number>()
  const lines = readInput(input).map(({ lineNumber, query }): BulkEntryLine => {
    const key = normalizeCatalogQuery(query)
    const duplicateOfLine = seen.get(key) ?? null
    if (duplicateOfLine === null) seen.set(key, lineNumber)
    return { lineNumber, query, resolution: resolveCatalogQuery(catalog, query, canSelect), duplicateOfLine }
  })
  return { input, catalogSnapshot: JSON.stringify(catalog), lines }
}

export function createBulkEntryDecisions(
  preview: BulkEntryPreview, defaultSection: RowSection = 'equipment',
): BulkEntryDecision[] {
  return preview.lines.map((line) => {
    const item = line.resolution.status === 'matched' ? line.resolution.candidates[0] : undefined
    return {
      lineNumber: line.lineNumber, action: item ? 'catalog' : 'unresolved', itemId: item?.id ?? null,
      concept: line.query, quantity: '1', section: item?.section ?? defaultSection, confirmDuplicate: false,
    }
  })
}

function productKey(item: CatalogItem): string {
  const supplier = normalizeCatalogQuery(item.supplier ?? '')
  const sku = normalizeCatalogQuery(item.sku ?? '')
  return supplier && sku ? JSON.stringify(['catalog', supplier, sku]) : JSON.stringify(['id', item.id])
}

/** Identify repeated queries and two different queries resolving to the same product. */
export function findBulkEntryDuplicates(
  preview: BulkEntryPreview, decisions: readonly BulkEntryDecision[], catalog: readonly CatalogItem[],
): Map<number, number> {
  const byLine = new Map(decisions.map((decision) => [decision.lineNumber, decision]))
  const byId = new Map(catalog.map((item) => [item.id, item]))
  const seenQueries = new Map<string, number>()
  const seenProducts = new Map<string, number>()
  const duplicates = new Map<number, number>()
  for (const line of preview.lines) {
    const decision = byLine.get(line.lineNumber)
    if (!decision || decision.action === 'skip' || decision.action === 'unresolved') continue
    const queryKey = normalizeCatalogQuery(line.query)
    const item = decision.itemId ? byId.get(decision.itemId) : undefined
    const key = decision.action === 'catalog' && item ? productKey(item)
      : JSON.stringify(['manual', normalizeCatalogQuery(decision.concept)])
    const previous = seenProducts.get(key) ?? seenQueries.get(queryKey)
    if (previous !== undefined) duplicates.set(line.lineNumber, previous)
    if (!seenProducts.has(key)) seenProducts.set(key, line.lineNumber)
    if (!seenQueries.has(queryKey)) seenQueries.set(queryKey, line.lineNumber)
  }
  return duplicates
}

export function applyBulkEntry(
  preview: BulkEntryPreview, decisions: readonly BulkEntryDecision[], catalog: readonly CatalogItem[],
  options: ApplyBulkEntryOptions,
): QuotationRow[] {
  if (JSON.stringify(catalog) !== preview.catalogSnapshot) {
    throw new Error('El catálogo cambió desde la revisión. Volvé a revisar la lista antes de agregarla.')
  }
  if (options.defaultCurrency !== 'ARS' && options.defaultCurrency !== 'USD') throw new Error('Seleccioná una moneda válida.')
  if (!Number.isSafeInteger(options.existingRowCount) || options.existingRowCount < 0 || options.existingRowCount > 1000) {
    throw new Error('No se pudo verificar la cantidad actual de conceptos.')
  }
  const current = buildBulkEntryPreview(preview.input, catalog, options.canSelect)
  const byLine = new Map(decisions.map((decision) => [decision.lineNumber, decision]))
  if (byLine.size !== decisions.length || decisions.length !== current.lines.length
    || decisions.some((decision) => !current.lines.some((line) => line.lineNumber === decision.lineNumber))) {
    throw new Error('La selección no coincide con las líneas revisadas. Volvé a revisar la lista.')
  }
  const count = decisions.filter((decision) => decision.action !== 'skip').length
  if (count === 0) throw new Error('Elegí al menos una línea para agregar.')
  if (options.existingRowCount + count > 1000) throw new Error('El presupuesto admite hasta 1000 conceptos. Omití algunas líneas para continuar.')
  const duplicates = findBulkEntryDuplicates(current, decisions, catalog)
  const rows: QuotationRow[] = []
  for (const line of current.lines) {
    const decision = byLine.get(line.lineNumber)
    if (!decision || decision.action === 'unresolved') throw new Error(`Línea ${line.lineNumber}: elegí una opción, creá un concepto manual u omitila.`)
    if (decision.action === 'skip') continue
    if (decision.section !== 'equipment' && decision.section !== 'extras') throw new Error(`Línea ${line.lineNumber}: seleccioná una sección válida.`)
    const quantity = parseQuantity(decision.quantity)
    if (decision.quantity.length > 30 || !quantity.ok) throw new Error(`Línea ${line.lineNumber}: ingresá una cantidad positiva con hasta tres decimales.`)
    if (duplicates.has(line.lineNumber) && !decision.confirmDuplicate) {
      throw new Error(`Línea ${line.lineNumber}: confirmá el concepto repetido u omití esta línea.`)
    }
    if (decision.action === 'catalog') {
      const item = line.resolution.candidates.find((candidate) => candidate.id === decision.itemId)
      if (!item || !options.canSelect(item)) throw new Error(`Línea ${line.lineNumber}: el producto no está disponible para seleccionar. Revisá la lista.`)
      const row = rowFromCatalog(item, decision.section, options.defaultCurrency)
      if (row.unitPrice.trim() && !parseMoney(row.unitPrice).ok) throw new Error(`Línea ${line.lineNumber}: el precio del catálogo requiere revisión.`)
      rows.push({ ...row, quantity: decision.quantity.trim() })
    } else if (decision.action === 'manual') {
      const concept = decision.concept.trim()
      if (!line.resolution.manualAllowed || !resolveCatalogQuery(catalog, concept, options.canSelect).manualAllowed) {
        throw new Error(`Línea ${line.lineNumber}: no se puede cargar como manual un producto bloqueado. Omitilo o usá otra línea para un trabajo independiente.`)
      }
      if (!concept || concept.length > 500 || hasControlCharacters(concept)) {
        throw new Error(`Línea ${line.lineNumber}: escribí un concepto manual de hasta 500 caracteres.`)
      }
      rows.push({ ...createRow(decision.section, options.defaultCurrency), concept, quantity: decision.quantity.trim() })
    } else throw new Error(`Línea ${line.lineNumber}: seleccioná una acción válida.`)
  }
  return rows
}
