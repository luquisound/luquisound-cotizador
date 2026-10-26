import type { AudioCategory } from './audio-categories.ts'
import { parseMoney } from './calculation.ts'
import {
  getCatalogDefaultCurrency, parseCatalogAvailabilityPolicy, parseCatalogListPrice,
  parseCatalogSelectionBlock, parseCatalogSource, parseCatalogStockSnapshot,
  type CatalogListPrice, type CatalogSource,
} from './catalog.ts'
import { canSelectCatalogItem, getCatalogAvailabilityPolicy, type CatalogAvailabilityPolicy, type CatalogStockSnapshot } from './catalog-stock.ts'
import { getCatalogQuotationTitle } from './catalog-title.ts'
import { createRow, type CatalogItem, type Currency, type QuotationRow, type RowSection } from './model.ts'

export type CatalogPriceBasis = 'manual' | 'list' | 'provisional-list' | 'pending'

export interface QuotationRowProvenance {
  catalogItemId: string
  supplier?: string
  sku?: string
  source?: CatalogSource
  originalUnitPrice: string
  originalCurrency: Currency
  priceBasis: CatalogPriceBasis
  listPrice?: CatalogListPrice
  stock?: CatalogStockSnapshot
  availabilityPolicy?: CatalogAvailabilityPolicy
  selectionBlock?: string
}

export interface CatalogSelectionPrice {
  unitPrice: string
  currency: Currency
  priceBasis: CatalogPriceBasis
}

export function getCatalogSelectionPrice(item: CatalogItem, defaultCurrency: Currency = 'ARS'): CatalogSelectionPrice {
  if (item.unitPrice.trim()) {
    if (!parseMoney(item.unitPrice).ok) throw new Error('El precio manual del producto requiere revisión.')
    return { unitPrice: item.unitPrice.trim(), currency: item.currency, priceBasis: 'manual' }
  }
  if (item.listPrice) {
    // Approval is an explicit private-source field, never a cost or inferred reference.
    const price = parseCatalogListPrice(item.listPrice)
    return {
      unitPrice: price.amount.replace('.', ','), currency: price.currency,
      priceBasis: price.provisional ? 'provisional-list' : 'list',
    }
  }
  return {
    unitPrice: '', currency: item.currency === 'ARS' || item.currency === 'USD' ? getCatalogDefaultCurrency(item) : defaultCurrency,
    priceBasis: 'pending',
  }
}

export function rowFromCatalog(
  item: CatalogItem, section: RowSection, defaultCurrency: Currency = 'ARS', audioCategory?: AudioCategory,
  now = Date.now(),
): QuotationRow {
  if (!canSelectCatalogItem(item, now)) throw new Error('El producto no tiene disponibilidad habilitada para agregarlo.')
  const price = getCatalogSelectionPrice(item, defaultCurrency)
  const availabilityPolicy = getCatalogAvailabilityPolicy(item)
  return {
    ...createRow(section, price.currency), ...(audioCategory === undefined ? {} : { audioCategory }),
    concept: getCatalogQuotationTitle(item), detail: item.sku?.trim() ? '' : item.detail, unitPrice: price.unitPrice,
    priceState: price.unitPrice ? 'priced' : 'pending',
    provenance: {
      catalogItemId: item.id,
      ...(item.supplier === undefined ? {} : { supplier: item.supplier }),
      ...(item.sku === undefined ? {} : { sku: item.sku }),
      ...(item.source === undefined ? {} : { source: structuredClone(item.source) }),
      originalUnitPrice: price.unitPrice, originalCurrency: price.currency, priceBasis: price.priceBasis,
      ...(item.listPrice === undefined ? {} : { listPrice: structuredClone(item.listPrice) }),
      ...(item.stock === undefined ? {} : { stock: structuredClone(item.stock) }),
      ...(availabilityPolicy === undefined ? {} : { availabilityPolicy }),
      ...(item.selectionBlock === undefined ? {} : { selectionBlock: item.selectionBlock }),
    },
  }
}

export function getRowPriceOverride(row: QuotationRow): boolean {
  const original = row.provenance
  if (!original) return false
  if (row.priceState === 'included') return true
  if (row.currency !== original.originalCurrency) return true
  const current = parseMoney(row.unitPrice)
  const previous = parseMoney(original.originalUnitPrice)
  if (current.ok && previous.ok) return current.cents !== previous.cents
  return row.unitPrice.trim() !== original.originalUnitPrice.trim()
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid row provenance.')
  return value as Record<string, unknown>
}

function text(value: unknown, limit: number): string {
  if (typeof value !== 'string' || value.length > limit) throw new Error('Invalid row provenance text.')
  return value
}

export function parseRowProvenance(value: unknown): QuotationRowProvenance {
  const input = record(value)
  const catalogItemId = text(input.catalogItemId, 128)
  if (!/^[a-zA-Z0-9_-]+$/.test(catalogItemId)) throw new Error('Invalid catalogue item identity.')
  if (input.originalCurrency !== 'ARS' && input.originalCurrency !== 'USD') throw new Error('Invalid original currency.')
  if (input.priceBasis !== 'manual' && input.priceBasis !== 'list'
    && input.priceBasis !== 'provisional-list' && input.priceBasis !== 'pending') throw new Error('Invalid price basis.')
  const originalUnitPrice = text(input.originalUnitPrice, 64)
  if (input.priceBasis === 'pending' ? originalUnitPrice.trim() !== '' : !parseMoney(originalUnitPrice).ok) {
    throw new Error('Invalid original price.')
  }
  return {
    catalogItemId, originalUnitPrice, originalCurrency: input.originalCurrency, priceBasis: input.priceBasis,
    ...(input.supplier === undefined ? {} : { supplier: text(input.supplier, 200) }),
    ...(input.sku === undefined ? {} : { sku: text(input.sku, 128) }),
    ...(input.source === undefined ? {} : { source: parseCatalogSource(input.source) }),
    ...(input.listPrice === undefined ? {} : { listPrice: parseCatalogListPrice(input.listPrice) }),
    ...(input.stock === undefined ? {} : { stock: parseCatalogStockSnapshot(input.stock) }),
    ...(input.availabilityPolicy === undefined ? {} : { availabilityPolicy: parseCatalogAvailabilityPolicy(input.availabilityPolicy) }),
    ...(input.selectionBlock === undefined ? {} : { selectionBlock: parseCatalogSelectionBlock(input.selectionBlock) }),
  }
}
