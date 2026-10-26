import type { Currency } from './model.ts'

export function getCurrencyLabel(currency: Currency): '$' | 'usd' {
  return currency === 'ARS' ? '$' : 'usd'
}
