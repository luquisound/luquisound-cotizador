import type { CatalogItem, Currency, RowSection } from './model.ts'

export interface CatalogSource {
  document: string
  page?: number
  sheet?: string
  row?: number
  date: string | null
}

export interface CatalogReferencePrice {
  amount: string | null
  currency: Currency | null
  role: 'cost' | 'list' | 'sale' | 'unknown'
  date: string | null
  historical: true
  source?: CatalogSource
}

export interface CatalogEntry extends CatalogItem {
  supplier?: string
  sku?: string
  brand?: string
  category?: string
  unit?: string
  presentation?: string
  source?: CatalogSource
  referencePrices?: CatalogReferencePrice[]
}

export interface CatalogImportItem {
  supplier: string
  sku: string
  brand: string
  name: string
  description: string
  category: string
  unit?: string
  presentation?: string
  section: RowSection
  source?: CatalogSource
  referencePrices: CatalogReferencePrice[]
}

export interface CatalogImportDocument {
  format: 'luquisound.catalog'
  version: 1
  items: CatalogImportItem[]
}

export interface CatalogImportUpdate {
  id: string
  before: CatalogEntry
  after: CatalogEntry
}

export interface CatalogImportConflict {
  reason: 'duplicate-import-key' | 'duplicate-existing-key' | 'reference-limit'
  itemIndexes: number[]
  existingIds: string[]
  message: string
}

export interface CatalogImportPreview {
  additions: CatalogEntry[]
  updates: CatalogImportUpdate[]
  unchanged: CatalogEntry[]
  conflicts: CatalogImportConflict[]
  summary: {
    received: number
    additions: number
    updates: number
    unchanged: number
    conflicts: number
    duplicateRows: number
    withoutKey: number
  }
  catalogSnapshot: string
}

export const CATALOG_IMPORT_MAX_BYTES = 5 * 1024 * 1024
export const CATALOG_IMPORT_MAX_ITEMS = 2000
export const CATALOG_REFERENCE_MAX_PRICES = 50

const INVALID_IMPORT_MESSAGE = 'El catálogo no tiene un formato válido de Luquisound.'

function invalidImport(): never {
  throw new Error(INVALID_IMPORT_MESSAGE)
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalidImport()
  return value as Record<string, unknown>
}

function text(value: unknown, limit: number, optional = false): string {
  if (optional && value === undefined) return ''
  if (typeof value !== 'string' || value.length > limit) invalidImport()
  return value.trim()
}

function date(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}(?:-\d{2})?$/.test(value)) invalidImport()
  const fullDate = value.length === 7 ? `${value}-01` : value
  const parsed = new Date(`${fullDate}T00:00:00.000Z`)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== fullDate) invalidImport()
  return value
}

function section(value: unknown): RowSection {
  if (value !== 'equipment' && value !== 'extras') invalidImport()
  return value
}

function source(value: unknown): CatalogSource {
  const input = record(value)
  const document = text(input.document, 500)
  if (!document) invalidImport()
  for (const value of [input.page, input.row]) {
    if (value !== undefined && (
      typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 1000000
    )) invalidImport()
  }
  return {
    document,
    ...(input.page === undefined ? {} : { page: input.page as number }),
    ...(input.sheet === undefined ? {} : { sheet: text(input.sheet, 128) }),
    ...(input.row === undefined ? {} : { row: input.row as number }),
    date: date(input.date),
  }
}

function referencePrice(value: unknown): CatalogReferencePrice {
  const input = record(value)
  if (input.amount !== null && (
    typeof input.amount !== 'string' || !/^(?:0|[1-9]\d{0,17})(?:\.\d{1,6})?$/.test(input.amount)
  )) invalidImport()
  if (input.currency !== null && input.currency !== 'ARS' && input.currency !== 'USD') invalidImport()
  if (input.role !== 'cost' && input.role !== 'list' && input.role !== 'sale' && input.role !== 'unknown') invalidImport()
  if (input.historical !== true) invalidImport()
  return {
    amount: input.amount as string | null,
    currency: input.currency as Currency | null,
    role: input.role,
    date: date(input.date),
    historical: true,
    ...(input.source === undefined ? {} : { source: source(input.source) }),
  }
}

function importItem(value: unknown): CatalogImportItem {
  const input = record(value)
  const name = text(input.name, 500)
  if (!name) invalidImport()
  if (input.referencePrices !== undefined && (
    !Array.isArray(input.referencePrices) || input.referencePrices.length > CATALOG_REFERENCE_MAX_PRICES
  )) invalidImport()
  const itemSource = input.source === undefined ? undefined : source(input.source)
  const referencePrices = (input.referencePrices as unknown[] | undefined)?.map(referencePrice) ?? []
  return {
    supplier: text(input.supplier, 200, true),
    sku: text(input.sku, 128, true),
    brand: text(input.brand, 200, true),
    name,
    description: text(input.description, 2000, true),
    category: text(input.category, 200, true),
    ...(input.unit === undefined ? {} : { unit: text(input.unit, 200) }),
    ...(input.presentation === undefined ? {} : { presentation: text(input.presentation, 200) }),
    section: section(input.section),
    ...(itemSource === undefined ? {} : { source: itemSource }),
    referencePrices: referencePrices.map((price) => {
      const priceSource = price.source ?? itemSource
      return { ...price, ...(priceSource === undefined ? {} : { source: { ...priceSource } }) }
    }),
  }
}

function checkSize(value: string): void {
  if (value.length > CATALOG_IMPORT_MAX_BYTES || new TextEncoder().encode(value).byteLength > CATALOG_IMPORT_MAX_BYTES) {
    throw new Error('El catálogo supera el límite de 5 MB.')
  }
}

export function parseCatalogImport(value: string): CatalogImportDocument {
  checkSize(value)
  let input: unknown
  try {
    input = JSON.parse(value.charCodeAt(0) === 0xfeff ? value.slice(1) : value)
  } catch {
    invalidImport()
  }
  const document = record(input)
  if (document.format !== 'luquisound.catalog' || document.version !== 1 ||
    !Array.isArray(document.items) || document.items.length > CATALOG_IMPORT_MAX_ITEMS) invalidImport()
  return { format: 'luquisound.catalog', version: 1, items: document.items.map(importItem) }
}

function normalizedKeyPart(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

function itemKey(item: { supplier?: string; sku?: string }): string | null {
  const supplier = normalizedKeyPart(item.supplier ?? '')
  const sku = normalizedKeyPart(item.sku ?? '')
  return supplier && sku ? JSON.stringify([supplier, sku]) : null
}

function itemSignature(item: CatalogImportItem): string {
  return JSON.stringify({
    supplier: normalizedKeyPart(item.supplier), sku: normalizedKeyPart(item.sku),
    brand: item.brand, name: item.name, description: item.description, category: item.category,
    section: item.section, unit: item.unit ?? '', presentation: item.presentation ?? '',
    source: sourceSignature(item.source),
    referencePrices: item.referencePrices.map(referenceSignature),
  })
}

function referenceSignature(price: CatalogReferencePrice): string {
  return JSON.stringify([
    price.amount, price.currency, price.role, price.date, price.historical, sourceSignature(price.source),
  ])
}

function sourceSignature(value: CatalogSource | undefined): (string | number | null)[] | null {
  return value ? [value.document, value.page ?? null, value.sheet ?? null, value.row ?? null, value.date] : null
}

function cloneReference(price: CatalogReferencePrice): CatalogReferencePrice {
  return { ...price, ...(price.source === undefined ? {} : { source: { ...price.source } }) }
}

function asImportItem(item: CatalogEntry): CatalogImportItem {
  return {
    supplier: item.supplier ?? '', sku: item.sku ?? '', brand: item.brand ?? '',
    name: item.concept, description: item.detail, category: item.category ?? '', section: item.section,
    ...(item.unit === undefined ? {} : { unit: item.unit }),
    ...(item.presentation === undefined ? {} : { presentation: item.presentation }),
    ...(item.source === undefined ? {} : { source: { ...item.source } }),
    referencePrices: item.referencePrices?.map(cloneReference) ?? [],
  }
}

function cloneEntry(item: CatalogEntry): CatalogEntry {
  return {
    ...item,
    ...(item.source === undefined ? {} : { source: { ...item.source } }),
    ...(item.referencePrices === undefined ? {} : {
      referencePrices: item.referencePrices.map(cloneReference),
    }),
  }
}

function entryFromItem(item: CatalogImportItem, id: string): CatalogEntry {
  return {
    id, concept: item.name, detail: item.description, section: item.section,
    currency: 'ARS', unitPrice: '', supplier: item.supplier, sku: item.sku,
    brand: item.brand, category: item.category,
    ...(item.unit === undefined ? {} : { unit: item.unit }),
    ...(item.presentation === undefined ? {} : { presentation: item.presentation }),
    ...(item.source === undefined ? {} : { source: { ...item.source } }),
    referencePrices: mergeReferences([], item.referencePrices),
  }
}

function mergeReferences(existing: CatalogReferencePrice[], incoming: CatalogReferencePrice[]): CatalogReferencePrice[] {
  const signatures = new Set<string>()
  return [...existing, ...incoming].filter((price) => {
    const signature = referenceSignature(price)
    if (signatures.has(signature)) return false
    signatures.add(signature)
    return true
  }).map(cloneReference)
}

export function buildCatalogImportPreview(
  existing: readonly CatalogEntry[], document: CatalogImportDocument,
): CatalogImportPreview {
  // Revalidate callers that construct an import document instead of parsing JSON.
  const validated = parseCatalogImport(JSON.stringify(document))
  const additions: CatalogEntry[] = []
  const updates: CatalogImportUpdate[] = []
  const unchanged: CatalogEntry[] = []
  const conflicts: CatalogImportConflict[] = []
  const existingByKey = new Map<string, CatalogEntry[]>()
  for (const item of existing) {
    const key = itemKey(item)
    if (key) existingByKey.set(key, [...(existingByKey.get(key) ?? []), item])
  }
  const groups = new Map<string, { item: CatalogImportItem; index: number }[]>()
  validated.items.forEach((item, index) => {
    const groupKey = itemKey(item) ?? `unkeyed:${itemSignature(item)}`
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), { item, index }])
  })
  let duplicateRows = 0
  const identifiers = new Set(existing.map((item) => item.id))
  for (const group of groups.values()) {
    const incoming = group[0].item
    const key = itemKey(incoming)
    const matches = key ? existingByKey.get(key) ?? [] : []
    if (new Set(group.map(({ item }) => itemSignature(item))).size > 1) {
      conflicts.push({
        reason: 'duplicate-import-key', itemIndexes: group.map(({ index }) => index),
        existingIds: matches.map((item) => item.id),
        message: 'Hay datos distintos para el mismo proveedor y código. Revisalos antes de importar.',
      })
      continue
    }
    duplicateRows += group.length - 1
    if (matches.length > 1) {
      conflicts.push({
        reason: 'duplicate-existing-key', itemIndexes: group.map(({ index }) => index),
        existingIds: matches.map((item) => item.id),
        message: 'El catálogo actual repite proveedor y código. No se eligió una entrada para reemplazar.',
      })
      continue
    }
    const before = matches[0]
    if (!before) {
      let id = crypto.randomUUID()
      while (identifiers.has(id)) id = crypto.randomUUID()
      identifiers.add(id)
      additions.push(entryFromItem(incoming, id))
      continue
    }
    const referencePrices = mergeReferences(before.referencePrices ?? [], incoming.referencePrices)
    const after: CatalogEntry = {
      ...cloneEntry(before), ...entryFromItem(incoming, before.id),
      currency: before.currency, unitPrice: before.unitPrice,
      detail: incoming.description || before.detail,
      brand: incoming.brand || before.brand || '',
      category: incoming.category || before.category || '',
      ...(!incoming.unit && before.unit !== undefined ? { unit: before.unit } : {}),
      ...(!incoming.presentation && before.presentation !== undefined ? { presentation: before.presentation } : {}),
      ...(!incoming.source && before.source ? { source: { ...before.source } } : {}),
      referencePrices,
    }
    if (referencePrices.length > CATALOG_REFERENCE_MAX_PRICES) {
      conflicts.push({
        reason: 'reference-limit', itemIndexes: group.map(({ index }) => index), existingIds: [before.id],
        message: 'La actualización supera el límite de referencias históricas. Revisá esta entrada.',
      })
    } else if (itemSignature(asImportItem(before)) === itemSignature(asImportItem(after))) {
      unchanged.push(cloneEntry(before))
    } else {
      updates.push({ id: before.id, before: cloneEntry(before), after })
    }
  }
  return {
    additions, updates, unchanged, conflicts, catalogSnapshot: JSON.stringify(existing),
    summary: {
      received: validated.items.length, additions: additions.length, updates: updates.length,
      unchanged: unchanged.length, conflicts: conflicts.length, duplicateRows,
      withoutKey: validated.items.filter((item) => itemKey(item) === null).length,
    },
  }
}

export function applyCatalogImport(
  existing: readonly CatalogEntry[], preview: CatalogImportPreview, options: { allowUpdates: boolean },
): CatalogEntry[] {
  if (JSON.stringify(existing) !== preview.catalogSnapshot) {
    throw new Error('El catálogo cambió desde la vista previa. Revisá la importación nuevamente.')
  }
  if (existing.length + preview.additions.length > CATALOG_IMPORT_MAX_ITEMS) {
    throw new Error('La importación supera el límite de 2000 productos. El catálogo no se modificó.')
  }
  const updates = new Map(options.allowUpdates ? preview.updates.map((update) => [update.id, update.after]) : [])
  const result = [
    ...existing.map((item) => cloneEntry(updates.get(item.id) ?? item)),
    ...preview.additions.map(cloneEntry),
  ]
  checkSize(JSON.stringify(result))
  return result
}

function searchText(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

export function queryCatalog(items: readonly CatalogEntry[], query: string): CatalogEntry[] {
  const terms = searchText(query).trim().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return [...items]
  return items.filter((item) => {
    const searchable = searchText([
      item.supplier, item.sku, item.brand, item.concept, item.detail, item.category,
    ].filter((part) => typeof part === 'string').join(' '))
    return terms.every((term) => searchable.includes(term))
  })
}
