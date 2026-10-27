import type { Currency, Quotation, QuotationRow } from './model.ts'
import { convertMixedTotals, type ConvertedTotalsResult } from './exchange.ts'
import { orderQuotationRows } from './audio-categories.ts'
import { isInactiveHarnessRow } from './harness-preset.ts'
import { getCurrencyLabel } from './currency-display.ts'
import { calculateQuotationDiscount, type CalculatedQuotationDiscount } from './discounts.ts'

type ParseFailure = { ok: false; reason: string }
export type MoneyResult = { ok: true; cents: number } | ParseFailure
export type QuantityResult = { ok: true; thousandths: number } | ParseFailure

export interface CalculatedRow {
  row: QuotationRow
  lineTotalCents: number | null
  errors: string[]
}

export interface QuotationCalculation {
  nativeTotals: Record<Currency, number>
  discountedNativeTotals: Record<Currency, number>
  discount: CalculatedQuotationDiscount | null
  totals: Record<Currency, number | null>
  rows: CalculatedRow[]
  itemsComplete: boolean
  conversion: ConvertedTotalsResult
  canExport: boolean
  issues: string[]
}

const maximumSafeInteger = BigInt(Number.MAX_SAFE_INTEGER)
const integerFormatter = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })

export function parseMoney(input: string): MoneyResult {
  const value = input.trim()
  if (!value) return { ok: false, reason: 'Ingresá un precio o marcá el concepto como incluido.' }
  // Money uses Argentine separators: dots group thousands and commas mark cents.
  if (!/^(?:[0-9]+|[1-9][0-9]{0,2}(?:\.[0-9]{3})+)(?:,[0-9]{1,2})?$/.test(value)) {
    return { ok: false, reason: 'Usá un precio positivo o cero, como 1234,56 o 1.234,56 (hasta 2 decimales).' }
  }
  const [whole, fraction = ''] = value.replaceAll('.', '').split(',')
  const cents = Number(`${whole}${fraction.padEnd(2, '0')}`)
  if (!Number.isSafeInteger(cents)) {
    return { ok: false, reason: 'El precio supera el límite de cálculo seguro.' }
  }
  return { ok: true, cents }
}

export function parseQuantity(input: string): QuantityResult {
  const value = input.trim()
  if (!value) return { ok: false, reason: 'Ingresá una cantidad.' }
  // Quantities are ungrouped; both decimal keyboard separators are accepted.
  if (!/^[0-9]+(?:[,.][0-9]{1,3})?$/.test(value)) {
    return { ok: false, reason: 'Usá una cantidad mayor que cero, sin separador de miles y con hasta 3 decimales.' }
  }
  const [whole, fraction = ''] = value.replace(',', '.').split('.')
  const thousandths = Number(`${whole}${fraction.padEnd(3, '0')}`)
  if (!Number.isSafeInteger(thousandths)) {
    return { ok: false, reason: 'La cantidad supera el límite de cálculo seguro.' }
  }
  if (thousandths === 0) return { ok: false, reason: 'La cantidad debe ser mayor que cero.' }
  return { ok: true, thousandths }
}

export function formatMoneyAmount(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new RangeError('Money must be a nonnegative safe integer in cents.')
  }
  const amount = BigInt(cents)
  const whole = integerFormatter.format(amount / 100n)
  const fraction = String(amount % 100n).padStart(2, '0')
  return `${whole},${fraction}`
}

export function formatMoney(cents: number, currency: Currency): string {
  return `${getCurrencyLabel(currency)} ${formatMoneyAmount(cents)}`
}

export function isEmptyRow(row: QuotationRow): boolean {
  if (isInactiveHarnessRow(row)) return true
  if (row.concept.trim() || row.detail.trim() || row.unitPrice.trim() || row.priceState !== 'pending'
    || row.fixedServiceOrigin?.requiresPriceReview) {
    return false
  }
  if (!row.quantity.trim()) return true
  const quantity = parseQuantity(row.quantity)
  return quantity.ok && quantity.thousandths === 1000
}

export function calculateRow(row: QuotationRow): CalculatedRow {
  const errors: string[] = []
  if (!row.concept.trim()) errors.push('Ingresá el concepto de la fila.')
  if (row.currency !== 'ARS' && row.currency !== 'USD') errors.push('Seleccioná una moneda válida para el ítem: $ o usd.')

  const quantity = parseQuantity(row.quantity)
  if (!quantity.ok) errors.push(quantity.reason)

  let unitCents: number | null = null
  if (row.priceState === 'included') {
    unitCents = 0
  } else if (row.priceState === 'priced') {
    const price = parseMoney(row.unitPrice)
    if (price.ok) unitCents = price.cents
    else errors.push(price.reason)
  } else {
    errors.push('El precio está pendiente. Ingresalo o marcá el concepto como incluido.')
  }

  if (errors.length || !quantity.ok || unitCents === null) {
    return { row, lineTotalCents: null, errors }
  }

  // Round each nonnegative line half up to the nearest cent using integer math.
  const roundedCents = (BigInt(unitCents) * BigInt(quantity.thousandths) + 500n) / 1000n
  if (roundedCents > maximumSafeInteger) {
    errors.push('El subtotal de la fila supera el límite de cálculo seguro.')
    return { row, lineTotalCents: null, errors }
  }
  return { row, lineTotalCents: Number(roundedCents), errors }
}

export function calculateQuotation(quotation: Quotation): QuotationCalculation {
  const issues: string[] = []
  if (!quotation.title.trim()) issues.push('Ingresá un título para el presupuesto.')
  const rows: CalculatedRow[] = []
  const subtotals = { ARS: 0n, USD: 0n }
  const orderedRows = orderQuotationRows(quotation.rows).filter((row) => !isEmptyRow(row))
  for (const [index, row] of orderedRows.entries()) {
    const calculated = calculateRow(row)
    rows.push(calculated)
    for (const error of calculated.errors) issues.push(`Fila ${index + 1}: ${error}`)
    if (calculated.lineTotalCents !== null) subtotals[row.currency] += BigInt(calculated.lineTotalCents)
  }
  if (!rows.length) issues.push('Agregá al menos un concepto para exportar el presupuesto.')

  const totalOverflow = subtotals.ARS > maximumSafeInteger || subtotals.USD > maximumSafeInteger
  if (totalOverflow) issues.push('El total supera el límite de cálculo seguro.')
  const nativeTotals = {
    ARS: subtotals.ARS > maximumSafeInteger ? 0 : Number(subtotals.ARS),
    USD: subtotals.USD > maximumSafeInteger ? 0 : Number(subtotals.USD),
  }
  const discount = calculateQuotationDiscount(quotation.discount, rows)
  if (discount) issues.push(...discount.errors)
  const discountedNativeTotals = {
    ARS: totalOverflow ? nativeTotals.ARS : nativeTotals.ARS - (discount?.amounts.ARS ?? 0),
    USD: totalOverflow ? nativeTotals.USD : nativeTotals.USD - (discount?.amounts.USD ?? 0),
  }
  const itemsComplete = rows.length > 0
    && rows.every((row) => row.errors.length === 0 && row.lineTotalCents !== null)
    && !totalOverflow && (discount?.errors.length ?? 0) === 0
  const conversion = convertMixedTotals(discountedNativeTotals.ARS, discountedNativeTotals.USD, quotation.exchangeRate ?? '')
  if (!conversion.ok) issues.push(conversion.reason)
  const totals: Record<Currency, number | null> = { ARS: null, USD: null }
  if (!rows.length) {
    totals.ARS = 0
    totals.USD = 0
  }
  if (itemsComplete) {
    if (conversion.ok) {
      totals.ARS = conversion.arsCents
      totals.USD = conversion.usdCents
    } else {
      // Without conversion, a native subtotal is a full total only for a single-currency quotation.
      for (const currency of ['ARS', 'USD'] as const) {
        if (rows.every(({ row }) => row.currency === currency)) totals[currency] = discountedNativeTotals[currency]
      }
    }
  }
  const canExport = quotation.title.trim().length > 0 && itemsComplete && conversion.ok
  return { nativeTotals, discountedNativeTotals, discount, totals, rows, itemsComplete, conversion, canExport, issues }
}
