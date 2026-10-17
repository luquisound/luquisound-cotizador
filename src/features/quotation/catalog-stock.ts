import type { CatalogSource } from './catalog.ts'
import type { CatalogItem } from './model.ts'
import { parseMoney } from './calculation.ts'

export interface CatalogStockFields {
  quantity: number | null
  checkedAt: string | null
  validUntil: string | null
  observation?: 'current' | 'historical'
}

export interface CatalogStockSnapshot extends CatalogStockFields {
  source: CatalogSource
}

export type CatalogAvailabilityPolicy = 'fresh-positive' | 'historical-positive'
export type CatalogStockState = 'unknown' | 'stale' | 'out-of-stock' | 'negative' | 'historical' | 'low' | 'available'
export type CatalogStockQuantityState = 'unknown' | 'zero' | 'negative' | 'positive'
export type CatalogStockAge = 'unknown' | 'future' | 'stale' | 'fresh' | 'historical'
export type CatalogSelectionReason = 'pending-price' | 'invalid-price' | 'blocked' | 'manual' | 'available' | 'historical-positive' | 'unknown-stock'
  | 'zero-stock' | 'negative-stock' | 'stale-stock' | 'future-stock' | 'invalid-stock'

export interface CatalogSelectionStatus {
  selectable: boolean
  provisional: boolean
  reason: CatalogSelectionReason
  quantityState: CatalogStockQuantityState
  age: CatalogStockAge
}

export function getCatalogAvailabilityPolicy(
  item: Pick<CatalogItem, 'supplier' | 'availabilityPolicy'>,
): CatalogAvailabilityPolicy | undefined {
  if (item.availabilityPolicy !== undefined) return item.availabilityPolicy
  // Legacy entries from this configured supplier require stock verification too.
  const supplier = (item.supplier ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
  return supplier === 'instaler' ? 'fresh-positive' : undefined
}

function timestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value
}

export function parseCatalogStockFields(
  quantity: unknown, checkedAt: unknown, validUntil: unknown, observation?: unknown,
): CatalogStockFields | null {
  if (quantity !== null && (typeof quantity !== 'number' || !Number.isSafeInteger(quantity))) return null
  if (observation !== undefined && observation !== 'current' && observation !== 'historical') return null
  if (observation === 'historical') {
    // A historical observation may have no exact observation date or validity interval.
    if (checkedAt !== null && !timestamp(checkedAt)) return null
    if (validUntil !== null && !timestamp(validUntil)) return null
    if (validUntil !== null && (checkedAt === null || Date.parse(validUntil) <= Date.parse(checkedAt))) return null
    return { quantity, checkedAt, validUntil, observation }
  }
  if (!timestamp(checkedAt) || !timestamp(validUntil) || Date.parse(validUntil) <= Date.parse(checkedAt)) return null
  return { quantity, checkedAt, validUntil, ...(observation === undefined ? {} : { observation }) }
}

export function getCatalogStockObservation(
  snapshot: CatalogStockSnapshot | undefined, now: number,
): { quantityState: CatalogStockQuantityState; age: CatalogStockAge } {
  if (!snapshot) return { quantityState: 'unknown', age: 'unknown' }
  const fields = parseCatalogStockFields(snapshot.quantity, snapshot.checkedAt, snapshot.validUntil, snapshot.observation)
  if (!fields) return { quantityState: 'unknown', age: 'unknown' }
  const quantityState = fields.quantity === null ? 'unknown'
    : fields.quantity < 0 ? 'negative' : fields.quantity === 0 ? 'zero' : 'positive'
  if (!Number.isFinite(now)) return { quantityState, age: 'unknown' }
  if (fields.checkedAt !== null && now < Date.parse(fields.checkedAt)) return { quantityState, age: 'future' }
  if (fields.observation === 'historical') return { quantityState, age: 'historical' }
  if (fields.validUntil === null) return { quantityState, age: 'unknown' }
  return { quantityState, age: now >= Date.parse(fields.validUntil) ? 'stale' : 'fresh' }
}

export function classifyCatalogStock(
  snapshot: CatalogStockSnapshot | undefined, now: number, lowThreshold?: number,
): CatalogStockState {
  if (lowThreshold !== undefined && (!Number.isSafeInteger(lowThreshold) || lowThreshold <= 0)) {
    throw new RangeError('The low-stock threshold must be a positive safe integer.')
  }
  const { quantityState, age } = getCatalogStockObservation(snapshot, now)
  if (age === 'stale') return 'stale'
  if (age === 'unknown' || age === 'future' || quantityState === 'unknown') return 'unknown'
  if (quantityState === 'negative') return 'negative'
  if (quantityState === 'zero') return 'out-of-stock'
  if (age === 'historical') return 'historical'
  if (lowThreshold !== undefined && snapshot!.quantity! <= lowThreshold) return 'low'
  return 'available'
}

export function getCatalogSelectionStatus(item: CatalogItem, now = Date.now()): CatalogSelectionStatus {
  const observation = getCatalogStockObservation(item.stock, now)
  const policy = getCatalogAvailabilityPolicy(item)
  const status = (selectable: boolean, provisional: boolean, reason: CatalogSelectionReason): CatalogSelectionStatus =>
    ({ selectable, provisional, reason, ...observation })
  const pricedStatus = (provisional: boolean, reason: CatalogSelectionReason): CatalogSelectionStatus => {
    if (item.unitPrice.trim()) {
      return parseMoney(item.unitPrice).ok && (item.currency === 'ARS' || item.currency === 'USD')
        ? status(true, provisional, reason) : status(false, provisional, 'invalid-price')
    }
    const price = item.listPrice
    if (!price) return status(false, provisional, 'pending-price')
    const valid = price.basis === 'retail-list-before-discount'
      && (price.currency === 'ARS' || price.currency === 'USD')
      && typeof price.amount === 'string' && /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(price.amount)
      && parseMoney(price.amount.replace('.', ',')).ok
    return valid ? status(true, provisional, reason) : status(false, provisional, 'invalid-price')
  }
  if (item.selectionBlock !== undefined) return status(false, false, 'blocked')
  if (policy === undefined) return status(true, false, 'manual')
  if (policy !== 'historical-positive' && policy !== 'fresh-positive') {
    return status(false, false, 'invalid-stock')
  }
  if (observation.quantityState === 'negative') return status(false, false, 'negative-stock')
  if (observation.quantityState === 'zero') return status(false, false, 'zero-stock')
  if (observation.quantityState === 'unknown') return status(false, false, 'unknown-stock')
  if (observation.age === 'fresh') return pricedStatus(false, 'available')
  if (observation.age === 'historical' && policy === 'historical-positive') {
    return pricedStatus(true, 'historical-positive')
  }
  if (observation.age === 'future') return status(false, false, 'future-stock')
  return status(false, false, observation.age === 'stale' ? 'stale-stock' : 'unknown-stock')
}

export function canSelectCatalogItem(item: CatalogItem, now = Date.now()): boolean {
  return getCatalogSelectionStatus(item, now).selectable
}
