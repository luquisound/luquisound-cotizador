import type { Currency } from './model.ts'
import { getCurrencyLabel } from './currency-display.ts'

type ExchangeFailure = { ok: false; reason: string }

export type ExchangeRateResult = {
  ok: true
  numerator: bigint
  denominator: bigint
  normalized: string
  rateLabel: string
} | ExchangeFailure

export type ConvertedTotalsResult = {
  ok: true
  arsCents: number
  usdCents: number
  rateLabel: string
} | ExchangeFailure

const maximumSafeInteger = BigInt(Number.MAX_SAFE_INTEGER)
const maximumRateInputLength = 64
const integerFormatter = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })

export function parseExchangeRate(input: string): ExchangeRateResult {
  // Bound input before trimming or BigInt parsing. Rates allow six decimal places
  // and a value no greater than MAX_SAFE_INTEGER, without floating-point parsing.
  if (input.length > maximumRateInputLength) {
    return { ok: false, reason: 'El tipo de cambio supera el límite de longitud permitido.' }
  }
  const value = input.trim()
  if (!value) {
    return { ok: false, reason: 'Ingresá el tipo de cambio: 1 usd = X $.' }
  }
  if (!/^(?:[0-9]+|[1-9][0-9]{0,2}(?:\.[0-9]{3})+)(?:,[0-9]{1,6})?$/.test(value)) {
    return {
      ok: false,
      reason: 'Usá un tipo de cambio positivo, como 1234,56 o 1.234,56, con hasta 6 decimales.',
    }
  }

  const [whole, fraction = ''] = value.replaceAll('.', '').split(',')
  const numerator = BigInt(`${whole}${fraction}`)
  const denominator = 10n ** BigInt(fraction.length)
  if (numerator === 0n) {
    return { ok: false, reason: 'El tipo de cambio debe ser mayor que cero.' }
  }
  if (numerator > maximumSafeInteger * denominator) {
    return { ok: false, reason: 'El tipo de cambio supera el límite de cálculo seguro.' }
  }

  const normalized = `${integerFormatter.format(BigInt(whole))}${fraction ? `,${fraction}` : ''}`
  return { ok: true, numerator, denominator, normalized, rateLabel: `1 ${getCurrencyLabel('USD')} = ${normalized} ${getCurrencyLabel('ARS')}` }
}

export function convertTotals(
  totalCents: number,
  baseCurrency: Currency,
  rateInput: string,
): ConvertedTotalsResult {
  if (!Number.isSafeInteger(totalCents) || totalCents < 0) {
    return { ok: false, reason: 'El total base debe ser un importe válido en centavos enteros, mayor o igual a cero.' }
  }
  if (baseCurrency !== 'ARS' && baseCurrency !== 'USD') {
    return { ok: false, reason: 'Seleccioná una moneda base válida: $ o usd.' }
  }
  const rate = parseExchangeRate(rateInput)
  if (!rate.ok) return rate

  const base = BigInt(totalCents)
  const numerator = base * (baseCurrency === 'USD' ? rate.numerator : rate.denominator)
  const denominator = baseCurrency === 'USD' ? rate.denominator : rate.numerator
  // Round the equivalent half up once, at the final cent. The base is unchanged.
  const rounded = numerator / denominator + (numerator % denominator * 2n >= denominator ? 1n : 0n)
  if (rounded > maximumSafeInteger) {
    return { ok: false, reason: 'El total equivalente supera el límite de cálculo seguro.' }
  }
  const equivalentCents = Number(rounded)
  return {
    ok: true,
    arsCents: baseCurrency === 'ARS' ? totalCents : equivalentCents,
    usdCents: baseCurrency === 'USD' ? totalCents : equivalentCents,
    rateLabel: rate.rateLabel,
  }
}

export function convertMixedTotals(
  arsCents: number,
  usdCents: number,
  rateInput: string,
): ConvertedTotalsResult {
  if (![arsCents, usdCents].every((amount) => Number.isSafeInteger(amount) && amount >= 0)) {
    return { ok: false, reason: 'Los subtotales deben ser importes válidos en centavos enteros, mayores o iguales a cero.' }
  }
  const rate = parseExchangeRate(rateInput)
  if (!rate.ok) return rate

  function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
    return numerator / denominator + (numerator % denominator * 2n >= denominator ? 1n : 0n)
  }

  const ars = BigInt(arsCents)
  const usd = BigInt(usdCents)
  // Convert each foreign subtotal once; neither displayed total is derived from the other.
  const totalArs = ars + roundHalfUp(usd * rate.numerator, rate.denominator)
  const totalUsd = usd + roundHalfUp(ars * rate.denominator, rate.numerator)
  if (totalArs > maximumSafeInteger || totalUsd > maximumSafeInteger) {
    return { ok: false, reason: 'El total equivalente supera el límite de cálculo seguro.' }
  }
  return { ok: true, arsCents: Number(totalArs), usdCents: Number(totalUsd), rateLabel: rate.rateLabel }
}
