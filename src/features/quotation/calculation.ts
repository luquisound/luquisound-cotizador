import type { Currency, Quotation, QuotationRow } from './model.ts'

type ParseFailure = { ok: false; reason: string }
export type MoneyResult = { ok: true; cents: number } | ParseFailure
export type QuantityResult = { ok: true; thousandths: number } | ParseFailure

export interface CalculatedRow {
  row: QuotationRow
  lineTotalCents: number | null
  errors: string[]
}

export interface QuotationCalculation {
  totalCents: number
  rows: CalculatedRow[]
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

export function formatMoney(cents: number, currency: Currency): string {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new RangeError('Money must be a nonnegative safe integer in cents.')
  }
  const amount = BigInt(cents)
  const whole = integerFormatter.format(amount / 100n)
  const fraction = String(amount % 100n).padStart(2, '0')
  return `${currency} ${whole},${fraction}`
}

export function isEmptyRow(row: QuotationRow): boolean {
  if (row.concept.trim() || row.detail.trim() || row.unitPrice.trim() || row.priceState !== 'pending') {
    return false
  }
  if (!row.quantity.trim()) return true
  const quantity = parseQuantity(row.quantity)
  return quantity.ok && quantity.thousandths === 1000
}

function calculateRow(row: QuotationRow): CalculatedRow {
  const errors: string[] = []
  if (!row.concept.trim()) errors.push('Ingresá el concepto de la fila.')

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
  if (quotation.currency !== 'ARS' && quotation.currency !== 'USD') {
    issues.push('Seleccioná una moneda válida: ARS o USD.')
  }

  const rows: CalculatedRow[] = []
  let total = 0n
  for (const [index, row] of quotation.rows.entries()) {
    if (isEmptyRow(row)) continue
    const calculated = calculateRow(row)
    rows.push(calculated)
    for (const error of calculated.errors) issues.push(`Fila ${index + 1}: ${error}`)
    if (calculated.lineTotalCents !== null) total += BigInt(calculated.lineTotalCents)
  }
  if (!rows.length) issues.push('Agregá al menos un concepto para exportar el presupuesto.')

  const totalOverflow = total > maximumSafeInteger
  if (totalOverflow) issues.push('El total supera el límite de cálculo seguro.')
  // An overflowing total is unavailable; canExport and issues must be checked.
  const totalCents = totalOverflow ? 0 : Number(total)
  return { totalCents, rows, canExport: issues.length === 0, issues }
}
