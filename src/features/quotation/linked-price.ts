import { formatMoneyAmount, parseMoney, parseQuantity } from './calculation.ts'
import { getPriceInputLengthError, PRICE_INPUT_MAX_LENGTH } from './price-input.ts'

type LinkedPriceFailure = { ok: false; reason: string }
export type LinkedPriceTotal = { ok: true; cents: number; input: string } | LinkedPriceFailure
export type UnitPriceFromTotal = { ok: true; unitPrice: string; totalCents: number; adjusted: boolean } | LinkedPriceFailure

const maximumSafeInteger = BigInt(Number.MAX_SAFE_INTEGER)

function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / 2n) / denominator
}

function formatPriceInput(cents: number, allowLongDisplay = false): string | null {
  if (cents === 0) return '0'
  const grouped = formatMoneyAmount(cents)
  if (grouped.length <= PRICE_INPUT_MAX_LENGTH) return grouped
  const amount = BigInt(cents)
  const whole = String(amount / 100n)
  const fraction = String(amount % 100n).padStart(2, '0')
  const ungrouped = `${whole},${fraction}`
  if (ungrouped.length <= PRICE_INPUT_MAX_LENGTH) return ungrouped
  const shortFraction = fraction.replace(/0+$/, '')
  const minimal = shortFraction ? `${whole},${shortFraction}` : whole
  if (minimal.length <= PRICE_INPUT_MAX_LENGTH) return minimal
  return allowLongDisplay ? grouped : null
}

export function getLinkedPriceTotal(unitPrice: string, quantity: string): LinkedPriceTotal {
  const price = parseMoney(unitPrice)
  if (!price.ok) return price
  const parsedQuantity = parseQuantity(quantity)
  if (!parsedQuantity.ok) return parsedQuantity
  const cents = roundHalfUp(BigInt(price.cents) * BigInt(parsedQuantity.thousandths), 1000n)
  if (cents > maximumSafeInteger) return { ok: false, reason: 'El subtotal de la fila supera el límite de cálculo seguro.' }
  const amount = Number(cents)
  // Derived values remain readable even when a compatible saved amount exceeds the manual input limit.
  return { ok: true, cents: amount, input: formatPriceInput(amount, true)! }
}

export function getUnitPriceFromTotal(totalPrice: string, quantity: string): UnitPriceFromTotal {
  const lengthError = getPriceInputLengthError(totalPrice)
  if (lengthError) return { ok: false, reason: lengthError }
  const total = parseMoney(totalPrice)
  if (!total.ok) return total
  const parsedQuantity = parseQuantity(quantity)
  if (!parsedQuantity.ok) return parsedQuantity
  const thousandths = BigInt(parsedQuantity.thousandths)
  const unitCents = roundHalfUp(BigInt(total.cents) * 1000n, thousandths)
  if (unitCents > maximumSafeInteger) return { ok: false, reason: 'El precio unitario supera el límite de cálculo seguro.' }
  const unitPrice = formatPriceInput(Number(unitCents))
  if (unitPrice === null) return { ok: false, reason: 'El precio unitario calculado supera los 15 caracteres. El importe anterior se conserva.' }
  const actualTotal = roundHalfUp(unitCents * thousandths, 1000n)
  if (actualTotal > maximumSafeInteger) return { ok: false, reason: 'El subtotal de la fila supera el límite de cálculo seguro.' }
  return { ok: true, unitPrice, totalCents: Number(actualTotal), adjusted: actualTotal !== BigInt(total.cents) }
}
