import { formatMoney, parseMoney } from './calculation.ts'
import { convertTotals, parseExchangeRate } from './exchange.ts'
import { isFactoryRow } from './factory-mode.ts'
import { PRICE_INPUT_MAX_LENGTH } from './price-input.ts'
import type { Currency, CurrencyConversionOrigin, QuotationRow, RowCurrencyConversionOrigin } from './model.ts'

export type { CurrencyConversionOrigin } from './model.ts'

export interface PriceCurrencyState {
  currency: Currency
  unitPrice: string
  conversionOrigin?: CurrencyConversionOrigin
}

function isCurrency(value: unknown): value is Currency {
  return value === 'ARS' || value === 'USD'
}

function equivalentCents(amount: number, source: Currency, target: Currency, rateInput: string): number {
  const converted = convertTotals(amount, source, rateInput)
  if (!converted.ok) throw new Error(converted.reason)
  return target === 'ARS' ? converted.arsCents : converted.usdCents
}

function parseOrigin(value: unknown): CurrencyConversionOrigin {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid currency conversion origin.')
  const input = value as Record<string, unknown>
  if (input.version !== 1 || !isCurrency(input.sourceCurrency) || !isCurrency(input.derivedCurrency)
    || typeof input.sourceUnitPrice !== 'string' || input.sourceUnitPrice.length > 64
    || typeof input.derivedUnitPrice !== 'string' || input.derivedUnitPrice.length > PRICE_INPUT_MAX_LENGTH
    || typeof input.exchangeRate !== 'string' || input.exchangeRate.length > 64) {
    throw new Error('Invalid currency conversion origin.')
  }
  const source = parseMoney(input.sourceUnitPrice)
  const derived = parseMoney(input.derivedUnitPrice)
  const rate = parseExchangeRate(input.exchangeRate)
  if (!source.ok || !derived.ok || !rate.ok
    || equivalentCents(source.cents, input.sourceCurrency, input.derivedCurrency, input.exchangeRate) !== derived.cents) {
    throw new Error('Invalid currency conversion relation.')
  }
  return {
    version: 1, sourceCurrency: input.sourceCurrency, sourceUnitPrice: input.sourceUnitPrice,
    exchangeRate: input.exchangeRate, derivedCurrency: input.derivedCurrency, derivedUnitPrice: input.derivedUnitPrice,
  }
}

export function parseRowCurrencyConversionOrigin(value: unknown): RowCurrencyConversionOrigin {
  const origin = parseOrigin(value)
  const input = value as Record<string, unknown>
  if (input.priceState !== 'pending' && input.priceState !== 'priced' && input.priceState !== 'included') {
    throw new Error('Invalid currency conversion price state.')
  }
  return { ...origin, priceState: input.priceState }
}

function sameRate(first: string, second: string): boolean {
  const left = parseExchangeRate(first)
  const right = parseExchangeRate(second)
  return left.ok && right.ok && left.numerator * right.denominator === right.numerator * left.denominator
}

function matchingOrigin(state: PriceCurrencyState): CurrencyConversionOrigin | undefined {
  if (!state.conversionOrigin) return undefined
  try {
    const origin = parseOrigin(state.conversionOrigin)
    return origin.derivedCurrency === state.currency && origin.derivedUnitPrice === state.unitPrice ? origin : undefined
  } catch {
    return undefined
  }
}

function convertedPrice(amount: number, currency: Currency, original?: string): string {
  if (original !== undefined && original.length <= PRICE_INPUT_MAX_LENGTH) return original
  if (amount === 0) return '0'
  const grouped = formatMoney(amount, currency).slice(currency.length + 1)
  if (grouped.length <= PRICE_INPUT_MAX_LENGTH) return grouped
  const cents = BigInt(amount)
  const ungrouped = `${cents / 100n},${String(cents % 100n).padStart(2, '0')}`
  if (ungrouped.length <= PRICE_INPUT_MAX_LENGTH) return ungrouped
  throw new Error('El precio convertido supera los 15 caracteres. El importe y la moneda anteriores se conservan.')
}

export function changePriceCurrency(
  state: PriceCurrencyState, target: Currency, rateInput?: string,
): PriceCurrencyState {
  if (!isCurrency(state.currency) || !isCurrency(target)) throw new Error('Seleccion\u00e1 una moneda v\u00e1lida: ARS o USD.')
  if (target === state.currency) return state
  if (!state.unitPrice.trim()) return { currency: target, unitPrice: state.unitPrice }
  const price = parseMoney(state.unitPrice)
  if (!price.ok) throw new Error(price.reason)
  const exchangeRate = typeof rateInput === 'string' ? rateInput : ''
  const rate = parseExchangeRate(exchangeRate)
  const matching = matchingOrigin(state)
  const source = matching ? parseMoney(matching.sourceUnitPrice) : undefined
  const matchesPositive = source?.ok && source.cents > 0
  if (price.cents === 0 && (!matchesPositive || (rate.ok && !sameRate(matching!.exchangeRate, exchangeRate)))) {
    return { currency: target, unitPrice: '0' }
  }
  if (!rate.ok) throw new Error(`No se puede convertir el precio. ${rate.reason}`)
  const anchor = matching && sameRate(matching.exchangeRate, exchangeRate) ? matching : undefined
  const sourceCurrency = anchor?.sourceCurrency ?? state.currency
  const sourceUnitPrice = anchor?.sourceUnitPrice ?? state.unitPrice
  const base = parseMoney(sourceUnitPrice)
  if (!base.ok) throw new Error(base.reason)
  const cents = equivalentCents(base.cents, sourceCurrency, target, exchangeRate)
  const unitPrice = convertedPrice(cents, target, target === sourceCurrency ? sourceUnitPrice : undefined)
  return {
    currency: target, unitPrice,
    conversionOrigin: {
      version: 1, sourceCurrency, sourceUnitPrice, exchangeRate: anchor?.exchangeRate ?? rate.normalized,
      derivedCurrency: target, derivedUnitPrice: unitPrice,
    },
  }
}

export function clearRowCurrencyConversion(row: QuotationRow): QuotationRow {
  if (row.currencyConversionOrigin === undefined) return row
  const { currencyConversionOrigin: _origin, ...fields } = row
  return fields
}

export function changeRowCurrency(row: QuotationRow, target: Currency, rateInput?: string): QuotationRow {
  if (!isCurrency(target)) throw new Error('Seleccion\u00e1 una moneda v\u00e1lida: ARS o USD.')
  if (target === row.currency) return row
  if (isFactoryRow(row)) return { ...row, currency: target }
  const origin = row.currencyConversionOrigin?.priceState === row.priceState ? row.currencyConversionOrigin : undefined
  const converted = changePriceCurrency({ currency: row.currency, unitPrice: row.unitPrice, conversionOrigin: origin }, target, rateInput)
  const fields = clearRowCurrencyConversion(row)
  return {
    ...fields, currency: converted.currency, unitPrice: converted.unitPrice,
    ...(converted.conversionOrigin === undefined ? {} : { currencyConversionOrigin: { ...converted.conversionOrigin, priceState: row.priceState } }),
  }
}
