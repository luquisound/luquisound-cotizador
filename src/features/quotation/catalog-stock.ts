import type { CatalogSource } from './catalog.ts'

export interface CatalogStockFields {
  quantity: number | null
  checkedAt: string
  validUntil: string
}

export interface CatalogStockSnapshot extends CatalogStockFields {
  source: CatalogSource
}

export type CatalogStockState = 'unknown' | 'stale' | 'out-of-stock' | 'low' | 'available'

function timestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value
}

export function parseCatalogStockFields(
  quantity: unknown, checkedAt: unknown, validUntil: unknown,
): CatalogStockFields | null {
  if (quantity !== null && (typeof quantity !== 'number' || !Number.isSafeInteger(quantity) || quantity < 0)) return null
  if (!timestamp(checkedAt) || !timestamp(validUntil) || Date.parse(validUntil) <= Date.parse(checkedAt)) return null
  return { quantity, checkedAt, validUntil }
}

export function classifyCatalogStock(
  snapshot: CatalogStockSnapshot | undefined, now: number, lowThreshold?: number,
): CatalogStockState {
  if (lowThreshold !== undefined && (!Number.isSafeInteger(lowThreshold) || lowThreshold <= 0)) {
    throw new RangeError('The low-stock threshold must be a positive safe integer.')
  }
  if (!snapshot || !Number.isFinite(now)) return 'unknown'
  const fields = parseCatalogStockFields(snapshot.quantity, snapshot.checkedAt, snapshot.validUntil)
  if (!fields || now < Date.parse(fields.checkedAt)) return 'unknown'
  if (now >= Date.parse(fields.validUntil)) return 'stale'
  if (fields.quantity === null) return 'unknown'
  if (fields.quantity === 0) return 'out-of-stock'
  if (lowThreshold !== undefined && fields.quantity <= lowThreshold) return 'low'
  return 'available'
}
