import type { CalculatedRow } from './calculation.ts'
import type { Currency, QuotationDiscount } from './model.ts'

export type DiscountPercentageResult = { ok: true; basisPoints: number; normalized: string }
  | { ok: false; reason: string }

export interface CalculatedQuotationDiscount {
  percentage: string
  eligibleTotals: Record<Currency, number>
  amounts: Record<Currency, number>
  errors: string[]
}

const maximumSafeInteger = BigInt(Number.MAX_SAFE_INTEGER)
const percentageError = 'Ingresá un descuento mayor que 0 y hasta 100 %, con hasta 2 decimales.'
const installationCategories = new Set(['cables', 'harness', 'adapters', 'labor'])
const suggestedCategories = new Set(['amplifier-dsp', 'additional-amplifier', 'subwoofer', 'speakers'])

export function parseDiscountPercentage(input: string): DiscountPercentageResult {
  if (input.length > 16) return { ok: false, reason: percentageError }
  const value = input.trim()
  if (!/^[0-9]{1,3}(?:[,.][0-9]{1,2})?$/.test(value)) return { ok: false, reason: percentageError }
  const [whole, fraction = ''] = value.replace('.', ',').split(',')
  const basisPoints = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  if (basisPoints <= 0 || basisPoints > 10000) return { ok: false, reason: percentageError }
  const decimals = String(basisPoints % 100).padStart(2, '0').replace(/0+$/, '')
  return { ok: true, basisPoints, normalized: `${Math.floor(basisPoints / 100)}${decimals ? `,${decimals}` : ''}` }
}

export function readQuotationDiscount(value: unknown): QuotationDiscount {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid quotation discount.')
  const record = value as Record<string, unknown>
  if (typeof record.percentage !== 'string') throw new Error('Invalid quotation discount percentage.')
  const percentage = parseDiscountPercentage(record.percentage)
  if (!percentage.ok || !Array.isArray(record.rowIds) || record.rowIds.length < 1 || record.rowIds.length > 1000) {
    throw new Error('Invalid quotation discount.')
  }
  const rowIds: string[] = []
  const seen = new Set<string>()
  for (const id of record.rowIds) {
    if (typeof id !== 'string' || id.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(id) || seen.has(id)) {
      throw new Error('Invalid quotation discount row.')
    }
    seen.add(id)
    rowIds.push(id)
  }
  return { percentage: percentage.normalized, rowIds }
}

export function isDiscountEligibleItem(item: CalculatedRow): boolean {
  const row = item.row
  return row.section === 'equipment' && row.priceState === 'priced' && row.factoryEquipment === undefined
    && !installationCategories.has(row.audioCategory ?? '')
    && item.errors.length === 0 && item.lineTotalCents !== null && item.lineTotalCents > 0
}

export function isDiscountSuggestedItem(item: CalculatedRow): boolean {
  return isDiscountEligibleItem(item) && suggestedCategories.has(item.row.audioCategory ?? '')
}

export function calculateQuotationDiscount(
  value: QuotationDiscount | undefined, items: readonly CalculatedRow[],
): CalculatedQuotationDiscount | null {
  if (value === undefined) return null
  const result: CalculatedQuotationDiscount = {
    percentage: value.percentage, eligibleTotals: { ARS: 0, USD: 0 }, amounts: { ARS: 0, USD: 0 }, errors: [],
  }
  let discount: QuotationDiscount
  try { discount = readQuotationDiscount(value) }
  catch { result.errors.push('Revisá el porcentaje y los equipos del descuento.'); return result }
  const percentage = parseDiscountPercentage(discount.percentage)
  if (!percentage.ok) { result.errors.push(percentage.reason); return result }
  result.percentage = percentage.normalized
  const selected = new Set(discount.rowIds)
  const totals = { ARS: 0n, USD: 0n }
  for (const item of items) {
    if (!selected.has(item.row.id)) continue
    if (!isDiscountEligibleItem(item)) {
      result.errors.push(`Revisá el descuento de «${item.row.concept.trim() || 'Concepto pendiente'}»: requiere un equipo con precio válido y mayor que cero.`)
      continue
    }
    totals[item.row.currency] += BigInt(item.lineTotalCents!)
  }
  if (totals.ARS === 0n && totals.USD === 0n) result.errors.push('Elegí al menos un equipo con precio válido para aplicar el descuento.')
  for (const currency of ['ARS', 'USD'] as const) {
    if (totals[currency] > maximumSafeInteger) {
      result.errors.push('La base del descuento supera el límite de cálculo seguro.')
      continue
    }
    result.eligibleTotals[currency] = Number(totals[currency])
    // Apply the percentage once to each already-rounded native subtotal.
    result.amounts[currency] = Number((totals[currency] * BigInt(percentage.basisPoints) + 5000n) / 10000n)
  }
  return result
}
