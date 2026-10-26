import { calculateRow, formatMoneyAmount, parseMoney, parseQuantity } from './calculation.ts'
import type { FixedServiceOrigin, Quotation, QuotationRow } from './model.ts'

export function isFixedServiceRow(row: Pick<QuotationRow, 'section' | 'audioCategory'>): boolean {
  return row.section === 'extras' && (row.audioCategory === 'cables' || row.audioCategory === 'labor')
}

export function parseFixedServiceOrigin(value: unknown): FixedServiceOrigin {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid fixed-service origin.')
  }
  const origin = value as Record<string, unknown>
  if (origin.version !== 1 || typeof origin.quantity !== 'string' || origin.quantity.length > 64
    || typeof origin.unitPrice !== 'string' || origin.unitPrice.length > 64
    || (origin.priceState !== 'pending' && origin.priceState !== 'priced' && origin.priceState !== 'included')
    || (origin.currency !== 'ARS' && origin.currency !== 'USD') || typeof origin.requiresPriceReview !== 'boolean') {
    throw new Error('Invalid fixed-service origin.')
  }
  return {
    version: 1, quantity: origin.quantity, unitPrice: origin.unitPrice,
    priceState: origin.priceState, currency: origin.currency, requiresPriceReview: origin.requiresPriceReview,
  }
}

function originalFields(row: QuotationRow, requiresPriceReview: boolean): FixedServiceOrigin {
  if (row.fixedServiceOrigin) {
    return { ...row.fixedServiceOrigin, requiresPriceReview: requiresPriceReview || row.fixedServiceOrigin.requiresPriceReview }
  }
  return {
    version: 1, quantity: row.quantity, unitPrice: row.unitPrice,
    priceState: row.priceState, currency: row.currency, requiresPriceReview,
  }
}

function pendingService(row: QuotationRow): QuotationRow {
  return {
    ...row, quantity: '1', unitPrice: '', priceState: 'pending',
    fixedServiceOrigin: originalFields(row, true),
  }
}

export function prepareFixedServiceRow(row: QuotationRow): QuotationRow {
  if (!isFixedServiceRow(row) || row.quantity === '1') return row
  const { currencyConversionOrigin: _origin, ...fields } = row
  row = fields
  if (!parseQuantity(row.quantity).ok || row.priceState === 'pending') return pendingService(row)
  if (row.priceState === 'included' && !parseMoney(row.unitPrice).ok) {
    return {
      ...row, quantity: '1', unitPrice: '', fixedServiceOrigin: originalFields(row, false),
    }
  }
  // Only the representation changes; a missing concept still remains missing in the result.
  const calculated = calculateRow({ ...row, concept: row.concept.trim() || 'Fixed service', priceState: 'priced' })
  if (calculated.lineTotalCents === null) {
    return row.priceState === 'included'
      ? { ...row, quantity: '1', unitPrice: '', fixedServiceOrigin: originalFields(row, false) }
      : pendingService(row)
  }
  const amount = formatMoneyAmount(calculated.lineTotalCents)
  return {
    ...row, quantity: '1', unitPrice: amount, fixedServiceOrigin: originalFields(row, false),
  }
}

export function prepareFixedServiceQuotation(quotation: Quotation): Quotation {
  const rows = quotation.rows.map(prepareFixedServiceRow)
  return rows.every((row, index) => row === quotation.rows[index]) ? quotation : { ...quotation, rows }
}

export function resolveFixedServicePrice(row: QuotationRow): QuotationRow {
  if (!isFixedServiceRow(row) || row.quantity !== '1' || !row.fixedServiceOrigin?.requiresPriceReview
    || (row.priceState !== 'included' && (row.priceState !== 'priced' || !parseMoney(row.unitPrice).ok))) return row
  return { ...row, fixedServiceOrigin: { ...row.fixedServiceOrigin, requiresPriceReview: false } }
}
