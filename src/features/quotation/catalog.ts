import type { CatalogItem, Currency, RowSection } from './model.ts'
import { parseCatalogStockFields, type CatalogAvailabilityPolicy, type CatalogStockSnapshot } from './catalog-stock.ts'
import { parseMoney } from './calculation.ts'

export interface CatalogSource {
  document: string
  page?: number
  sheet?: string
  row?: number
  date: string | null
  kind?: 'snapshot' | 'sheets'
  version?: string
  checksum?: string
}

export interface CatalogListPrice {
  amount: string
  currency: Currency
  basis: 'retail-list-before-discount'
  provisional: boolean
  source: CatalogSource
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
  stock?: CatalogStockSnapshot
  listPrice?: CatalogListPrice
  availabilityPolicy?: CatalogAvailabilityPolicy
  selectionBlock?: string
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
  stock?: CatalogStockSnapshot
  listPrice?: CatalogListPrice
  availabilityPolicy?: CatalogAvailabilityPolicy
  selectionBlock?: string
}

export interface CatalogImportDocument {
  format: 'luquisound.catalog'
  version: 1
  items: CatalogImportItem[]
  replaceSourceDocuments?: string[]
}

export interface CatalogImportUpdate {
  id: string
  before: CatalogEntry
  after: CatalogEntry
}

export interface CatalogImportConflict {
  reason: 'duplicate-import-key' | 'duplicate-existing-key' | 'missing-existing-key' | 'reference-limit'
  itemIndexes: number[]
  existingIds: string[]
  message: string
}

export interface CatalogImportPreview {
  additions: CatalogEntry[]
  updates: CatalogImportUpdate[]
  removals: CatalogEntry[]
  unchanged: CatalogEntry[]
  conflicts: CatalogImportConflict[]
  replacesSources: boolean
  summary: {
    received: number
    additions: number
    updates: number
    removals: number
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
export const CATALOG_REPLACEMENT_MAX_DOCUMENTS = 50

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

export function parseCatalogSource(value: unknown): CatalogSource {
  const input = record(value)
  const document = text(input.document, 500)
  if (!document) invalidImport()
  for (const value of [input.page, input.row]) {
    if (value !== undefined && (
      typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 1000000
    )) invalidImport()
  }
  if (input.kind !== undefined && input.kind !== 'snapshot' && input.kind !== 'sheets') invalidImport()
  const version = input.version === undefined ? undefined : text(input.version, 200)
  if (version !== undefined && !version) invalidImport()
  if (input.checksum !== undefined && (typeof input.checksum !== 'string' || !/^[a-f0-9]{64}$/.test(input.checksum))) invalidImport()
  return {
    document,
    ...(input.page === undefined ? {} : { page: input.page as number }),
    ...(input.sheet === undefined ? {} : { sheet: text(input.sheet, 128) }),
    ...(input.row === undefined ? {} : { row: input.row as number }),
    date: date(input.date),
    ...(input.kind === undefined ? {} : { kind: input.kind }),
    ...(version === undefined ? {} : { version }),
    ...(input.checksum === undefined ? {} : { checksum: input.checksum as string }),
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
    ...(input.source === undefined ? {} : { source: parseCatalogSource(input.source) }),
  }
}

export function parseCatalogStockSnapshot(value: unknown): CatalogStockSnapshot {
  const input = record(value)
  const fields = parseCatalogStockFields(input.quantity, input.checkedAt, input.validUntil, input.observation)
  if (!fields) invalidImport()
  return { ...fields, source: parseCatalogSource(input.source) }
}

export function parseCatalogListPrice(value: unknown): CatalogListPrice {
  const input = record(value)
  if (typeof input.amount !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(input.amount)
    || !parseMoney(input.amount.replace('.', ',')).ok) invalidImport()
  if (input.currency !== 'ARS' && input.currency !== 'USD') invalidImport()
  if (input.basis !== 'retail-list-before-discount' || typeof input.provisional !== 'boolean') invalidImport()
  return {
    amount: input.amount, currency: input.currency, basis: input.basis,
    provisional: input.provisional, source: parseCatalogSource(input.source),
  }
}

export function parseCatalogAvailabilityPolicy(value: unknown): CatalogAvailabilityPolicy {
  if (value !== 'historical-positive' && value !== 'fresh-positive') invalidImport()
  return value
}

export function parseCatalogSelectionBlock(value: unknown): string {
  const reason = text(value, 500)
  if (!reason) invalidImport()
  return reason
}

function importItem(value: unknown): CatalogImportItem {
  const input = record(value)
  const name = text(input.name, 500)
  if (!name) invalidImport()
  if (input.referencePrices !== undefined && (
    !Array.isArray(input.referencePrices) || input.referencePrices.length > CATALOG_REFERENCE_MAX_PRICES
  )) invalidImport()
  const itemSource = input.source === undefined ? undefined : parseCatalogSource(input.source)
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
    ...(input.stock === undefined ? {} : { stock: parseCatalogStockSnapshot(input.stock) }),
    ...(input.listPrice === undefined ? {} : { listPrice: parseCatalogListPrice(input.listPrice) }),
    ...(input.availabilityPolicy === undefined ? {} : { availabilityPolicy: parseCatalogAvailabilityPolicy(input.availabilityPolicy) }),
    ...(input.selectionBlock === undefined ? {} : { selectionBlock: parseCatalogSelectionBlock(input.selectionBlock) }),
  }
}

function checkSize(value: string): void {
  if (value.length > CATALOG_IMPORT_MAX_BYTES || new TextEncoder().encode(value).byteLength > CATALOG_IMPORT_MAX_BYTES) {
    throw new Error('El catálogo supera el límite de 5 MB.')
  }
}

function replacementDocuments(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > CATALOG_REPLACEMENT_MAX_DOCUMENTS) invalidImport()
  const documents = value.map((document) => text(document, 500))
  if (documents.some((document) => !document) || new Set(documents).size !== documents.length) invalidImport()
  return documents
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
  const replaceSourceDocuments = document.replaceSourceDocuments === undefined
    ? undefined : replacementDocuments(document.replaceSourceDocuments)
  const items = document.items.map(importItem)
  if (replaceSourceDocuments && items.some((item) => !item.source || !itemKey(item))) invalidImport()
  return {
    format: 'luquisound.catalog', version: 1, items,
    ...(replaceSourceDocuments === undefined ? {} : { replaceSourceDocuments }),
  }
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
    stock: item.stock ? [item.stock.quantity, item.stock.checkedAt, item.stock.validUntil, item.stock.observation ?? null, sourceSignature(item.stock.source)] : null,
    listPrice: item.listPrice ? [item.listPrice.amount, item.listPrice.currency, item.listPrice.basis,
      item.listPrice.provisional, sourceSignature(item.listPrice.source)] : null,
    availabilityPolicy: item.availabilityPolicy ?? null, selectionBlock: item.selectionBlock ?? null,
  })
}

function referenceSignature(price: CatalogReferencePrice): string {
  return JSON.stringify([
    price.amount, price.currency, price.role, price.date, price.historical, sourceSignature(price.source),
  ])
}

function sourceSignature(value: CatalogSource | undefined): (string | number | null)[] | null {
  return value ? [value.document, value.page ?? null, value.sheet ?? null, value.row ?? null, value.date,
    value.kind ?? null, value.version ?? null, value.checksum ?? null] : null
}

function cloneReference(price: CatalogReferencePrice): CatalogReferencePrice {
  return { ...price, ...(price.source === undefined ? {} : { source: { ...price.source } }) }
}

function cloneStock(stock: CatalogStockSnapshot): CatalogStockSnapshot {
  return { ...stock, source: { ...stock.source } }
}

function cloneListPrice(price: CatalogListPrice): CatalogListPrice {
  return { ...price, source: { ...price.source } }
}

function asImportItem(item: CatalogEntry): CatalogImportItem {
  return {
    supplier: item.supplier ?? '', sku: item.sku ?? '', brand: item.brand ?? '',
    name: item.concept, description: item.detail, category: item.category ?? '', section: item.section,
    ...(item.unit === undefined ? {} : { unit: item.unit }),
    ...(item.presentation === undefined ? {} : { presentation: item.presentation }),
    ...(item.source === undefined ? {} : { source: { ...item.source } }),
    referencePrices: item.referencePrices?.map(cloneReference) ?? [],
    ...(item.stock === undefined ? {} : { stock: cloneStock(item.stock) }),
    ...(item.listPrice === undefined ? {} : { listPrice: cloneListPrice(item.listPrice) }),
    ...(item.availabilityPolicy === undefined ? {} : { availabilityPolicy: item.availabilityPolicy }),
    ...(item.selectionBlock === undefined ? {} : { selectionBlock: item.selectionBlock }),
  }
}

function cloneEntry(item: CatalogEntry): CatalogEntry {
  return {
    ...item,
    ...(item.source === undefined ? {} : { source: { ...item.source } }),
    ...(item.referencePrices === undefined ? {} : {
      referencePrices: item.referencePrices.map(cloneReference),
    }),
    ...(item.stock === undefined ? {} : { stock: cloneStock(item.stock) }),
    ...(item.listPrice === undefined ? {} : { listPrice: cloneListPrice(item.listPrice) }),
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
    ...(item.stock === undefined ? {} : { stock: cloneStock(item.stock) }),
    ...(item.listPrice === undefined ? {} : { listPrice: cloneListPrice(item.listPrice) }),
    ...(item.availabilityPolicy === undefined ? {} : { availabilityPolicy: item.availabilityPolicy }),
    ...(item.selectionBlock === undefined ? {} : { selectionBlock: item.selectionBlock }),
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
  const replacementSources = new Set(validated.replaceSourceDocuments ?? [])
  const replacesSources = validated.replaceSourceDocuments !== undefined
  const additions: CatalogEntry[] = []
  const updates: CatalogImportUpdate[] = []
  const removals: CatalogEntry[] = []
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
  const ambiguousRemovalKeys = new Set<string>()
  for (const item of existing) {
    if (!item.source || !replacementSources.has(item.source.document)) continue
    const key = itemKey(item)
    if (!key) {
      conflicts.push({
        reason: 'missing-existing-key', itemIndexes: [], existingIds: [item.id],
        message: 'Una entrada de las fuentes a reemplazar no tiene proveedor y código completos. Revisala antes de reemplazar.',
      })
    } else if (!groups.has(key)) {
      const matches = existingByKey.get(key)!
      if (matches.length > 1) {
        if (!ambiguousRemovalKeys.has(key)) {
          ambiguousRemovalKeys.add(key)
          conflicts.push({
            reason: 'duplicate-existing-key', itemIndexes: [], existingIds: matches.map((entry) => entry.id),
            message: 'El catálogo actual repite proveedor y código en una fuente a reemplazar. Revisalo antes de retirar entradas.',
          })
        }
      } else removals.push(cloneEntry(item))
    }
  }
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
    const replacesSource = before.source !== undefined && replacementSources.has(before.source.document)
    const referencePrices = mergeReferences(replacesSource ? [] : before.referencePrices ?? [], incoming.referencePrices)
    const after: CatalogEntry = replacesSource ? {
      ...entryFromItem(incoming, before.id), currency: before.currency, unitPrice: before.unitPrice,
    } : {
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
    additions, updates, removals, unchanged, conflicts, replacesSources, catalogSnapshot: JSON.stringify(existing),
    summary: {
      received: validated.items.length, additions: additions.length, updates: updates.length,
      removals: removals.length,
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
  if (preview.replacesSources && (!options.allowUpdates || preview.conflicts.length > 0)) {
    throw new Error('El reemplazo de fuentes requiere aprobar todos los cambios y resolver los conflictos. El catálogo no se modificó.')
  }
  const removalIds = new Set(options.allowUpdates ? preview.removals.map((item) => item.id) : [])
  const retained = existing.filter((item) => !removalIds.has(item.id))
  if (retained.length + preview.additions.length > CATALOG_IMPORT_MAX_ITEMS) {
    throw new Error('La importación supera el límite de 2000 productos. El catálogo no se modificó.')
  }
  const updates = new Map(options.allowUpdates ? preview.updates.map((update) => [update.id, update.after]) : [])
  const result = [
    ...retained.map((item) => cloneEntry(updates.get(item.id) ?? item)),
    ...preview.additions.map(cloneEntry),
  ]
  checkSize(JSON.stringify(result))
  return result
}

function searchText(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

export interface CatalogCategoryOption {
  key: string
  label: string
}

export function getCatalogDefaultCurrency(item: CatalogEntry): Currency {
  if (item.unitPrice.trim()) return item.currency
  const currencies = new Set((item.referencePrices ?? []).flatMap((price) =>
    price.currency === 'ARS' || price.currency === 'USD' ? [price.currency] : []))
  return currencies.size === 1 ? [...currencies][0] : item.currency
}

export function getCatalogChoices(
  items: readonly CatalogEntry[], preferredSection: RowSection,
): CatalogEntry[] {
  return [...items]
    .sort((first, second) => (first.section === preferredSection ? 0 : 1) - (second.section === preferredSection ? 0 : 1))
}

const categoryCollator = new Intl.Collator('es', { sensitivity: 'base', numeric: true })

function categoryLabel(value: string | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ')
}

function categoryKey(value: string | undefined): string {
  const label = categoryLabel(value)
  return label ? `category:${label.toLowerCase()}` : 'uncategorized'
}

export function getCatalogCategories(items: readonly CatalogEntry[]): CatalogCategoryOption[] {
  const options = new Map<string, CatalogCategoryOption>()
  for (const item of items) {
    const key = categoryKey(item.category)
    if (!options.has(key)) options.set(key, { key, label: categoryLabel(item.category) })
  }
  return [...options.values()].sort((first, second) => {
    if (first.key === second.key) return 0
    if (first.key === 'uncategorized') return 1
    if (second.key === 'uncategorized') return -1
    return categoryCollator.compare(first.label, second.label)
  })
}

export function queryCatalog(items: readonly CatalogEntry[], query: string, selectedCategory?: string): CatalogEntry[] {
  const terms = searchText(query).trim().split(/\s+/).filter(Boolean)
  if (terms.length === 0 && !selectedCategory) return [...items]
  return items.filter((item) => {
    if (selectedCategory && categoryKey(item.category) !== selectedCategory) return false
    if (terms.length === 0) return true
    const searchable = searchText([
      item.supplier, item.sku, item.brand, item.concept, item.detail, item.category,
    ].filter((part) => typeof part === 'string').join(' '))
    return terms.every((term) => searchable.includes(term))
  })
}
