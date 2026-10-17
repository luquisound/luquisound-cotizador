import { parseMoney } from './calculation.ts'
import type { QuotationRow } from './model.ts'

export function updateRowUnitPrice(row: QuotationRow, unitPrice: string): QuotationRow {
  const price = unitPrice.trim() ? parseMoney(unitPrice) : null
  if (price && !price.ok) throw new Error(price.reason)
  // Opening and saving an included amount must not silently turn it into a priced zero.
  if (row.priceState === 'included' && price?.ok && price.cents === 0) return row
  const priceState = unitPrice.trim() ? 'priced' : 'pending'
  if (row.unitPrice === unitPrice && row.priceState === priceState) return row
  return { ...row, unitPrice, priceState }
}
