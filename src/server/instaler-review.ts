import {
  parseCatalogImport,
  parseCatalogSource,
  parseCatalogStockSnapshot,
  type CatalogImportDocument,
  type CatalogImportItem,
} from '../features/quotation/catalog.ts'
import { parseMoney } from '../features/quotation/calculation.ts'
import type { InstalerSnapshotReview } from './instaler-snapshot.ts'

export interface InstalerComparisonIdentity {
  supplier: string
  sku: string
}

export type InstalerComparisonField = 'name' | 'brand' | 'category'
  | 'unit' | 'presentation' | 'section' | 'listPrice.amount' | 'listPrice.currency'
  | 'listPrice.basis' | 'listPrice.provisional' | 'stock.quantity' | 'stock.observation'
  | 'stock.checkedAt' | 'stock.validUntil' | 'availabilityPolicy' | 'selectionBlock'

export interface InstalerComparisonChange {
  field: InstalerComparisonField
  before: string | number | boolean | null
  after: string | number | boolean | null
}

export interface InstalerComparisonMatch extends InstalerComparisonIdentity {
  currentIndex: number
  incomingIndex: number
  changes: InstalerComparisonChange[]
  provenanceChanged: boolean
}

export interface InstalerComparisonConflict extends InstalerComparisonIdentity {
  side: 'current' | 'incoming'
  reason: 'duplicate-key' | 'missing-key'
  indexes: number[]
}

export interface InstalerSnapshotComparison {
  mode: 'snapshot-comparison'
  scope: 'precios-only'
  reviewRequired: true
  publicationAllowed: false
  coverage: { complete: false; kits: 'pending'; units: 'pending' }
  summary: {
    currentItems: number
    incomingItems: number
    additions: number
    matched: number
    changed: number
    unchanged: number
    provenanceOnly: number
    absentExisting: number
    ignoredExisting: number
    duplicatesExisting: number
    duplicatesIncoming: number
    missingKeysExisting: number
    missingKeysIncoming: number
    conflicts: number
  }
  additions: (InstalerComparisonIdentity & { incomingIndex: number })[]
  matches: InstalerComparisonMatch[]
  absentExisting: (InstalerComparisonIdentity & { currentIndex: number })[]
  conflicts: InstalerComparisonConflict[]
}

type ItemGroup = { item: CatalogImportItem; indexes: number[] }

function normalized(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

function identity(item: CatalogImportItem): InstalerComparisonIdentity {
  return { supplier: item.supplier, sku: item.sku }
}

function checkedDocument(document: CatalogImportDocument): CatalogImportDocument {
  // Validate observations before JSON serialization can hide NaN/Infinity as null.
  if (!document || !Array.isArray(document.items)) throw new Error('Invalid comparison catalogue.')
  for (const item of document.items) {
    if (item.stock !== undefined) parseCatalogStockSnapshot(item.stock)
  }
  return parseCatalogImport(JSON.stringify(document))
}

function grouped(
  items: CatalogImportItem[], side: InstalerComparisonConflict['side'], conflicts: InstalerComparisonConflict[],
): Map<string, ItemGroup> {
  const groups = new Map<string, ItemGroup>()
  items.forEach((item, index) => {
    const supplier = normalized(item.supplier)
    const sku = normalized(item.sku)
    if (!supplier || !sku) {
      conflicts.push({ ...identity(item), side, reason: 'missing-key', indexes: [index] })
      return
    }
    const key = JSON.stringify([supplier, sku])
    const group = groups.get(key)
    if (group) group.indexes.push(index)
    else groups.set(key, { item, indexes: [index] })
  })
  for (const { item, indexes } of groups.values()) {
    if (indexes.length > 1) conflicts.push({ ...identity(item), side, reason: 'duplicate-key', indexes: [...indexes] })
  }
  return groups
}

function priceAmount(item: CatalogImportItem): number | null {
  if (!item.listPrice) return null
  const parsed = parseMoney(item.listPrice.amount.replace('.', ','))
  if (!parsed.ok) throw new Error('Invalid comparison price.')
  return parsed.cents
}

function provenance(item: CatalogImportItem): string {
  return JSON.stringify({
    source: item.source ?? null,
    listPrice: item.listPrice?.source ?? null,
    stock: item.stock?.source ?? null,
    referencePrices: item.referencePrices,
  })
}

function compareItems(before: CatalogImportItem, after: CatalogImportItem): InstalerComparisonChange[] {
  const changes: InstalerComparisonChange[] = []
  const change = (
    field: InstalerComparisonField,
    previous: InstalerComparisonChange['before'], next: InstalerComparisonChange['after'],
  ) => {
    if (previous !== next) changes.push({ field, before: previous, after: next })
  }
  // The source supplies names only; an empty source description never clears manual details.
  for (const field of ['name', 'brand', 'category', 'section'] as const) {
    change(field, before[field], after[field])
  }
  for (const field of ['unit', 'presentation', 'availabilityPolicy', 'selectionBlock'] as const) {
    change(field, before[field] ?? null, after[field] ?? null)
  }
  if (priceAmount(before) !== priceAmount(after)) {
    changes.push({ field: 'listPrice.amount', before: before.listPrice?.amount ?? null, after: after.listPrice?.amount ?? null })
  }
  for (const field of ['currency', 'basis', 'provisional'] as const) {
    change(`listPrice.${field}`, before.listPrice?.[field] ?? null, after.listPrice?.[field] ?? null)
  }
  change('stock.quantity', before.stock?.quantity ?? null, after.stock?.quantity ?? null)
  change('stock.observation', before.stock?.observation ?? null, after.stock?.observation ?? null)
  change('stock.checkedAt', before.stock?.checkedAt ?? null, after.stock?.checkedAt ?? null)
  change('stock.validUntil', before.stock?.validUntil ?? null, after.stock?.validUntil ?? null)
  return changes
}

/** Compare partial snapshot evidence without generating a replacement or changing catalogue data. */
export function compareInstalerSnapshot(
  review: InstalerSnapshotReview, current: CatalogImportDocument,
): InstalerSnapshotComparison {
  if (!review || review.mode !== 'snapshot-review' || review.scope !== 'precios-only'
    || review.reviewRequired !== true) throw new Error('Invalid snapshot review.')
  parseCatalogSource(review.source)
  const incoming = checkedDocument({ format: 'luquisound.catalog', version: 1, items: review.items })
  const baseline = checkedDocument(current)
  if (incoming.items.some((item) => item.supplier && normalized(item.supplier) !== 'instaler')) {
    throw new Error('Unexpected supplier in snapshot review.')
  }
  const conflicts: InstalerComparisonConflict[] = []
  const currentGroups = grouped(baseline.items, 'current', conflicts)
  const incomingGroups = grouped(incoming.items, 'incoming', conflicts)
  const additions: InstalerSnapshotComparison['additions'] = []
  const matches: InstalerComparisonMatch[] = []
  const absentExisting: InstalerSnapshotComparison['absentExisting'] = []

  for (const [key, { item, indexes }] of incomingGroups) {
    if (indexes.length > 1) continue
    const previous = currentGroups.get(key)
    if (!previous) additions.push({ ...identity(item), incomingIndex: indexes[0] })
    else if (previous.indexes.length === 1) {
      matches.push({
        ...identity(item), currentIndex: previous.indexes[0], incomingIndex: indexes[0],
        changes: compareItems(previous.item, item), provenanceChanged: provenance(previous.item) !== provenance(item),
      })
    }
  }
  for (const [key, { item, indexes }] of currentGroups) {
    if (normalized(item.supplier) === 'instaler' && indexes.length === 1 && !incomingGroups.has(key)) {
      absentExisting.push({ ...identity(item), currentIndex: indexes[0] })
    }
  }
  return {
    mode: 'snapshot-comparison', scope: 'precios-only', reviewRequired: true, publicationAllowed: false,
    coverage: { complete: false, kits: 'pending', units: 'pending' },
    summary: {
      currentItems: baseline.items.length, incomingItems: incoming.items.length,
      additions: additions.length, matched: matches.length,
      changed: matches.filter((match) => match.changes.length > 0).length,
      unchanged: matches.filter((match) => match.changes.length === 0).length,
      provenanceOnly: matches.filter((match) => match.changes.length === 0 && match.provenanceChanged).length,
      absentExisting: absentExisting.length,
      ignoredExisting: baseline.items.filter((item) => item.supplier && normalized(item.supplier) !== 'instaler').length,
      duplicatesExisting: conflicts.filter((conflict) => conflict.side === 'current' && conflict.reason === 'duplicate-key').length,
      duplicatesIncoming: conflicts.filter((conflict) => conflict.side === 'incoming' && conflict.reason === 'duplicate-key').length,
      missingKeysExisting: conflicts.filter((conflict) => conflict.side === 'current' && conflict.reason === 'missing-key').length,
      missingKeysIncoming: conflicts.filter((conflict) => conflict.side === 'incoming' && conflict.reason === 'missing-key').length,
      conflicts: conflicts.length,
    },
    additions, matches, absentExisting, conflicts,
  }
}
