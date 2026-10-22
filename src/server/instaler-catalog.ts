import {
  parseCatalogImport, parseCatalogStockSnapshot,
  type CatalogImportDocument, type CatalogImportItem, type CatalogSource,
} from '../features/quotation/catalog.ts'
import { parseMoney } from '../features/quotation/calculation.ts'
import {
  SHARED_CATALOG_MAX_BYTES, validateSharedCatalogDocument,
} from '../features/quotation/shared-catalog.ts'
import type { ObservationSnapshot, ObservationTable } from './instaler-observation.ts'
import { prepareInstalerSnapshot, type InstalerSnapshotIssue } from './instaler-snapshot.ts'

export interface InstalerCatalogNameMapping {
  sku: string
  sourceText: string
  name: string
  unit?: string
  presentation?: string
}

export interface InstalerCatalogDuplicateResolution {
  sku: string
  sourceTexts: string[]
  name: string
  category?: string
  unit?: string
  presentation?: string
}

export interface InstalerCatalogPolicy {
  format: 'luquisound.instaler-catalog-policy'
  version: 1
  names: InstalerCatalogNameMapping[]
  exclusions: { sku: string; sourceText: string }[]
  allowIdenticalDuplicates: boolean
  ignoredRows?: { values: unknown[] }[]
  duplicates?: InstalerCatalogDuplicateResolution[]
}

export interface InstalerCatalogCandidate {
  document: CatalogImportDocument
  changed: boolean
  summary: {
    items: number
    blocked: number
    absent: number
    excluded: number
    duplicateGroups: number
    resolvedDuplicateGroups: number
    unresolvedNames: number
  }
  evidence: {
    duplicates: { sku: string; rows: number[]; resolution: 'identical' | 'reviewed' | 'blocked' }[]
    unresolvedNames: { sku: string; rows: number[]; sourceText: string }[]
    excludedRows: number[]
    ignoredRows: number[]
  }
}

const REVIEW_BLOCK = 'Revisar los datos del proveedor antes de seleccionar.'
const NAME_BLOCK = 'El nombre del proveedor necesita una correspondencia revisada.'
const DUPLICATE_BLOCK = 'El proveedor repite este código con datos que necesitan revisión.'
const ABSENT_BLOCK = 'Producto ausente de la última lectura de Precios; revisar con el proveedor.'
const EXCLUDED_BLOCK = 'Registro excluido de productos por una revisión explícita.'
const POLICY_MAX_BYTES = 1024 * 1024
const EMPTY_POLICY: InstalerCatalogPolicy = {
  format: 'luquisound.instaler-catalog-policy', version: 1,
  names: [], exclusions: [], allowIdenticalDuplicates: false,
}

function invalid(): never {
  throw new Error('Invalid supplier catalogue candidate; retain the previous catalogue.')
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid()
  return value as Record<string, unknown>
}

function normalized(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

function identity(item: Pick<CatalogImportItem, 'supplier' | 'sku'>): string {
  return JSON.stringify([normalized(item.supplier), normalized(item.sku)])
}

function policyText(value: unknown, limit: number, exact = false): string {
  if (typeof value !== 'string' || value.length > limit || !value.trim()) invalid()
  const result = exact ? value : value.trim()
  if (!exact && (result.startsWith('=') || result.startsWith('#'))) invalid()
  return result
}

function sourceText(value: unknown): string {
  if (typeof value !== 'string' || value.length > 32767) invalid()
  return value
}

/** Parse private configuration only. No product names or commercial rules are bundled. */
export function parseInstalerCatalogPolicy(value: unknown): InstalerCatalogPolicy {
  const input = record(value)
  if (Buffer.byteLength(JSON.stringify(input)) > POLICY_MAX_BYTES
    || input.format !== 'luquisound.instaler-catalog-policy' || input.version !== 1
    || !Array.isArray(input.names) || input.names.length > 2000
    || !Array.isArray(input.exclusions) || input.exclusions.length > 2000
    || typeof input.allowIdenticalDuplicates !== 'boolean') invalid()
  const keys = new Set<string>()
  const names: InstalerCatalogNameMapping[] = input.names.map((raw) => {
    const item = record(raw)
    const sku = policyText(item.sku, 128)
    const key = normalized(sku)
    if (keys.has(key)) invalid()
    keys.add(key)
    return {
      sku, sourceText: policyText(item.sourceText, 32767, true), name: policyText(item.name, 500),
      ...(item.unit === undefined ? {} : { unit: policyText(item.unit, 200) }),
      ...(item.presentation === undefined ? {} : { presentation: policyText(item.presentation, 200) }),
    }
  })
  const excluded = new Set<string>()
  const exclusions = input.exclusions.map((raw) => {
    const item = record(raw)
    const sku = policyText(item.sku, 128)
    const observedText = sourceText(item.sourceText)
    const key = JSON.stringify([normalized(sku), observedText])
    if (excluded.has(key) || names.some((name) => normalized(name.sku) === normalized(sku)
      && name.sourceText === observedText)) invalid()
    excluded.add(key)
    return { sku, sourceText: observedText }
  })
  if (input.ignoredRows !== undefined && (!Array.isArray(input.ignoredRows) || input.ignoredRows.length > 2000)) invalid()
  const ignored = new Set<string>()
  const ignoredRows = (input.ignoredRows as unknown[] | undefined)?.map((raw) => {
    const row = record(raw)
    if (!Array.isArray(row.values) || row.values.length !== 5
      || row.values.some((value) => value !== null && typeof value !== 'string' && typeof value !== 'boolean'
        && (typeof value !== 'number' || !Number.isFinite(value)))
      || row.values.some((value) => typeof value === 'string' && value.length > 32767)
      || (row.values[0] !== null && (typeof row.values[0] !== 'string' || row.values[0].trim() !== ''))
      || (typeof row.values[1] === 'string' && normalized(row.values[1]) === 'discontinuados')) invalid()
    const key = JSON.stringify(row.values)
    if (ignored.has(key)) invalid()
    ignored.add(key)
    return { values: [...row.values] }
  })
  if (input.duplicates !== undefined && (!Array.isArray(input.duplicates) || input.duplicates.length > 2000)) invalid()
  const duplicateKeys = new Set<string>()
  const duplicates = (input.duplicates as unknown[] | undefined)?.map((raw) => {
    const item = record(raw)
    const sku = policyText(item.sku, 128)
    if (duplicateKeys.has(normalized(sku)) || !Array.isArray(item.sourceTexts)
      || item.sourceTexts.length < 2 || item.sourceTexts.length > 10000) invalid()
    duplicateKeys.add(normalized(sku))
    return {
      sku, sourceTexts: item.sourceTexts.map(sourceText), name: policyText(item.name, 500),
      ...(item.category === undefined ? {} : { category: policyText(item.category, 200) }),
      ...(item.unit === undefined ? {} : { unit: policyText(item.unit, 200) }),
      ...(item.presentation === undefined ? {} : { presentation: policyText(item.presentation, 200) }),
    }
  })
  return {
    format: 'luquisound.instaler-catalog-policy', version: 1,
    names, exclusions, allowIdenticalDuplicates: input.allowIdenticalDuplicates,
    ...(ignoredRows === undefined ? {} : { ignoredRows }),
    ...(duplicates === undefined ? {} : { duplicates }),
  }
}

function checkedDocument(document: CatalogImportDocument): CatalogImportDocument {
  if (!document || !Array.isArray(document.items)) invalid()
  for (const item of document.items) {
    // Do not let JSON serialization silently turn nonfinite observations into null.
    if (item.stock !== undefined) parseCatalogStockSnapshot(item.stock)
  }
  const text = JSON.stringify(document)
  if (Buffer.byteLength(text) > SHARED_CATALOG_MAX_BYTES) invalid()
  const parsed = parseCatalogImport(text)
  validateSharedCatalogDocument(parsed)
  return parsed
}

function sourceSignature(source: CatalogSource | undefined): unknown {
  // Read time limits tolerated transport age; it never establishes supplier freshness.
  return source ? [source.document, source.sheet ?? null, source.page ?? null, source.date,
    source.kind ?? null, source.readAt ?? null] : null
}

function signature(item: CatalogImportItem): string {
  const amount = item.listPrice ? parseMoney(item.listPrice.amount.replace('.', ',')) : null
  if (amount && !amount.ok) invalid()
  return JSON.stringify({
    supplier: normalized(item.supplier), sku: normalized(item.sku),
    name: item.name, description: item.description, brand: item.brand, category: item.category,
    section: item.section, unit: item.unit ?? null, presentation: item.presentation ?? null,
    source: sourceSignature(item.source),
    listPrice: item.listPrice ? [amount?.ok ? amount.cents : null, item.listPrice.currency,
      item.listPrice.basis, item.listPrice.provisional, sourceSignature(item.listPrice.source)] : null,
    referencePrices: item.referencePrices.map((price) => JSON.stringify([
      price.amount, price.currency, price.role, price.date, price.historical, sourceSignature(price.source),
    ])).sort(),
    stock: item.stock ? [item.stock.quantity, item.stock.checkedAt, item.stock.validUntil,
      item.stock.observation ?? null, sourceSignature(item.stock.source)] : null,
    availabilityPolicy: item.availabilityPolicy ?? null, selectionBlock: item.selectionBlock ?? null,
  })
}

function semanticDocument(document: CatalogImportDocument): string {
  return JSON.stringify(document.items.map((item) => [identity(item), signature(item)])
    .sort((first, second) => first[0].localeCompare(second[0])))
}

function rawText(row: ObservationTable['rows'][number]): string {
  return typeof row.values[1] === 'string' ? row.values[1] : ''
}

function duplicateSignature(row: ObservationTable['rows'][number]): string {
  return JSON.stringify([row.values.slice(0, 5), row.unit ?? null, row.presentation ?? null])
}

function duplicateCommercialSignature(row: ObservationTable['rows'][number]): string {
  return JSON.stringify([row.values.slice(2, 4), row.unit ?? null, row.presentation ?? null])
}

function reviewedDuplicate(
  group: ObservationTable['rows'], resolution: InstalerCatalogDuplicateResolution | undefined,
): InstalerCatalogDuplicateResolution | undefined {
  if (!resolution || group.length < 2
    || !group.every((row) => duplicateCommercialSignature(row) === duplicateCommercialSignature(group[0]))
    || JSON.stringify(group.map(rawText).sort()) !== JSON.stringify([...resolution.sourceTexts].sort())) return undefined
  const categories = new Set(group.map((row) => typeof row.values[4] === 'string' ? row.values[4].trim() : ''))
  if (categories.size > 1 && resolution.category === undefined) return undefined
  for (const field of ['unit', 'presentation'] as const) {
    if (group[0][field] && resolution[field] !== undefined && resolution[field] !== group[0][field]) return undefined
  }
  return resolution
}

function emptyCell(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '')
}

function discontinuedMarker(row: ObservationTable['rows'][number] | undefined): boolean {
  return row !== undefined && emptyCell(row.values[0]) && typeof row.values[1] === 'string'
    && normalized(row.values[1]) === 'discontinuados' && emptyCell(row.values[2]) && emptyCell(row.values[3])
}

function absentItem(item: CatalogImportItem, source: CatalogSource, excluded: boolean): CatalogImportItem {
  const references = [...item.referencePrices]
  if (item.listPrice) {
    const price = item.listPrice
    const historical = {
      amount: price.amount, currency: price.currency, role: 'list' as const,
      date: price.source.date, historical: true as const, source: price.source,
    }
    if (!references.some((reference) => JSON.stringify(reference) === JSON.stringify(historical))) references.push(historical)
  }
  const { listPrice: _listPrice, ...retained } = item
  return {
    ...retained, referencePrices: references,
    stock: { quantity: null, observation: 'historical', checkedAt: null, validUntil: null,
      source: item.stock?.source ?? item.source ?? source },
    availabilityPolicy: 'historical-positive', selectionBlock: excluded ? EXCLUDED_BLOCK : ABSENT_BLOCK,
  }
}

/** Build and compare a complete candidate from an existing observation, without I/O or price edits. */
export function buildInstalerCatalogCandidate(
  snapshot: ObservationSnapshot,
  current: CatalogImportDocument,
  privatePolicy: InstalerCatalogPolicy = EMPTY_POLICY,
): InstalerCatalogCandidate {
  const baseline = checkedDocument(current)
  const policy = parseInstalerCatalogPolicy(privatePolicy)
  // Validate the complete table before applying reviewed exclusions or making absence decisions.
  const original = prepareInstalerSnapshot(snapshot.table)
  const readSource = { ...original.source, readAt: snapshot.readAt }
  const ignoredRows = snapshot.table.rows.filter((row) => policy.ignoredRows?.some((rule) => JSON.stringify(rule.values) === JSON.stringify(row.values)))
  const ignoredRowNumbers = new Set(ignoredRows.map(({ row }) => row))
  const excludedRows = snapshot.table.rows.filter((row) => typeof row.values[0] === 'string'
    && policy.exclusions.some((rule) => normalized(rule.sku) === normalized(row.values[0] as string)
      && rule.sourceText === rawText(row)))
  const excludedRowNumbers = new Set(excludedRows.map(({ row }) => row))
  const excludedSkus = new Set(excludedRows.map((row) => normalized(row.values[0] as string)))
  const rows = snapshot.table.rows.filter((row) => !excludedRowNumbers.has(row.row) && !ignoredRowNumbers.has(row.row))
  const review = excludedRows.length || ignoredRows.length ? prepareInstalerSnapshot({ ...snapshot.table, rows }) : original
  // Skipped malformed identities could otherwise turn a partial read into apparent removals.
  if (review.issues.some(({ row, code }) => code === 'invalid-sku' || code === 'missing-sku'
    || (code === 'unclassified-row' && !discontinuedMarker(rows.find((candidate) => candidate.row === row))))) invalid()
  const currentByKey = new Map(baseline.items.map((item) => [identity(item), item]))
  const groups = new Map<string, ObservationTable['rows']>()
  for (const row of rows) {
    if (typeof row.values[0] !== 'string' || !row.values[0].trim()) continue
    const key = normalized(row.values[0])
    const group = groups.get(key)
    if (group) group.push(row)
    else groups.set(key, [row])
  }
  const evidence: InstalerCatalogCandidate['evidence'] = {
    duplicates: [], unresolvedNames: [], excludedRows: [...excludedRowNumbers], ignoredRows: [...ignoredRowNumbers],
  }
  const incoming = new Map<string, CatalogImportItem>()
  let resolvedDuplicateGroups = 0
  for (const prepared of review.items) {
    const key = identity(prepared)
    const previous = currentByKey.get(key)
    const group = groups.get(normalized(prepared.sku))!
    const rowNumbers = new Set(group.map(({ row }) => row))
    const duplicateRule = policy.duplicates?.find((rule) => normalized(rule.sku) === normalized(prepared.sku))
    const identical = duplicateRule === undefined && group.length > 1 && policy.allowIdenticalDuplicates
      && group.every((row) => duplicateSignature(row) === duplicateSignature(group[0]))
    const duplicateResolution = reviewedDuplicate(group, duplicateRule)
    const resolvedDuplicate = identical || duplicateResolution !== undefined
    if (group.length > 1) {
      evidence.duplicates.push({ sku: prepared.sku, rows: [...rowNumbers],
        resolution: duplicateResolution ? 'reviewed' : identical ? 'identical' : 'blocked' })
      if (resolvedDuplicate) resolvedDuplicateGroups++
    }
    const mapping = policy.names.find((rule) => normalized(rule.sku) === normalized(prepared.sku))
    const matchedMapping = mapping && group.every((row) => mapping.sourceText === rawText(row)) ? mapping : undefined
    const nameReview = review.nameReviews.some(({ row }) => rowNumbers.has(row))
    const needsNameReview = duplicateResolution === undefined
      && ((nameReview && !matchedMapping) || (mapping !== undefined && matchedMapping === undefined)
        || duplicateRule !== undefined)
    if (needsNameReview) {
      for (const sourceText of new Set(group.map(rawText))) {
        evidence.unresolvedNames.push({ sku: prepared.sku, rows: group.filter((row) => rawText(row) === sourceText).map(({ row }) => row), sourceText })
      }
    }
    const unresolvedIssues = review.issues.filter((issue: InstalerSnapshotIssue) => rowNumbers.has(issue.row)
      && !(issue.code === 'name-review' && (matchedMapping || duplicateResolution))
      && !(issue.code === 'duplicate-sku' && resolvedDuplicate))
    let item: CatalogImportItem = {
      ...prepared, description: previous?.description ?? '', brand: previous?.brand ?? prepared.brand,
      referencePrices: previous?.referencePrices ?? prepared.referencePrices,
      source: { ...prepared.source!, readAt: snapshot.readAt },
      ...(prepared.listPrice === undefined ? {} : { listPrice: { ...prepared.listPrice,
        source: { ...prepared.listPrice.source, readAt: snapshot.readAt } } }),
      ...(prepared.stock === undefined ? {} : { stock: { ...prepared.stock,
        source: { ...prepared.stock.source, readAt: snapshot.readAt } } }),
      ...(prepared.unit === undefined && previous?.unit !== undefined ? { unit: previous.unit } : {}),
      ...(prepared.presentation === undefined && previous?.presentation !== undefined ? { presentation: previous.presentation } : {}),
      ...(matchedMapping ? { name: matchedMapping.name,
        ...(matchedMapping.unit === undefined ? {} : { unit: matchedMapping.unit }),
        ...(matchedMapping.presentation === undefined ? {} : { presentation: matchedMapping.presentation }),
      } : {}),
      ...(duplicateResolution ? {
        name: duplicateResolution.name,
        ...(duplicateResolution.category === undefined ? {} : { category: duplicateResolution.category }),
        ...(duplicateResolution.unit === undefined ? {} : { unit: duplicateResolution.unit }),
        ...(duplicateResolution.presentation === undefined ? {} : { presentation: duplicateResolution.presentation }),
      } : {}),
    }
    delete item.selectionBlock
    if (unresolvedIssues.length) item.selectionBlock = REVIEW_BLOCK
    if (needsNameReview) item.selectionBlock = NAME_BLOCK
    if (group.length > 1 && !resolvedDuplicate) {
      // Ambiguous duplicate observations have no winning amount, stock, name or variant.
      const source = { ...readSource }
      item = {
        supplier: 'Instaler', sku: previous?.sku ?? prepared.sku,
        name: previous?.name ?? prepared.sku, brand: previous?.brand ?? '',
        description: previous?.description ?? '', category: previous?.category ?? '',
        section: previous?.section ?? 'equipment', source, referencePrices: previous?.referencePrices ?? [],
        ...(previous?.unit === undefined ? {} : { unit: previous.unit }),
        ...(previous?.presentation === undefined ? {} : { presentation: previous.presentation }),
        stock: { quantity: null, observation: 'historical', checkedAt: null, validUntil: null, source },
        availabilityPolicy: 'historical-positive', selectionBlock: DUPLICATE_BLOCK,
      }
    }
    incoming.set(key, item)
  }
  let absent = 0
  const items = baseline.items.map((item) => {
    if (normalized(item.supplier) !== 'instaler') return item
    const replacement = incoming.get(identity(item))
    if (replacement) { incoming.delete(identity(item)); return replacement }
    absent++
    return absentItem(item, review.source, excludedSkus.has(normalized(item.sku)))
  })
  items.push(...[...incoming.values()].sort((first, second) => identity(first).localeCompare(identity(second))))
  const candidate = checkedDocument({
    format: 'luquisound.catalog', version: 1, items, refreshSuppliers: ['Instaler'],
    instalerObservation: {
      readAt: snapshot.readAt, checksum: snapshot.table.source.checksum, supplierFreshnessEstablished: false,
    },
  })
  const changed = !baseline.refreshSuppliers?.some((supplier) => normalized(supplier) === 'instaler')
    || semanticDocument(baseline) !== semanticDocument(candidate)
  return {
    document: changed ? candidate : current, changed,
    summary: {
      items: candidate.items.length, blocked: candidate.items.filter((item) => item.selectionBlock !== undefined).length,
      absent, excluded: excludedRows.length, duplicateGroups: evidence.duplicates.length,
      resolvedDuplicateGroups, unresolvedNames: new Set(evidence.unresolvedNames.map(({ sku }) => normalized(sku))).size,
    },
    evidence,
  }
}
