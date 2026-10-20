import { parseMoney } from './calculation.ts'
import type { QuotationRow } from './model.ts'
import { prepareFixedServiceRow, resolveFixedServicePrice } from './fixed-services.ts'
import { getPriceInputLengthError } from './price-input.ts'
import { isFactoryRow } from './factory-mode.ts'
import { clearRowCurrencyConversion } from './row-currency.ts'

export function updateRowUnitPrice(row: QuotationRow, unitPrice: string): QuotationRow {
  const lengthError = getPriceInputLengthError(unitPrice)
  if (lengthError) throw new Error(lengthError)
  row = prepareFixedServiceRow(row)
  const price = unitPrice.trim() ? parseMoney(unitPrice) : null
  if (price && !price.ok) throw new Error(price.reason)
  if (isFactoryRow(row)) {
    if (price?.ok && price.cents === 0) return row
    throw new Error('Desmarc\u00e1 De f\u00e1brica para editar el precio del producto.')
  }
  // Opening and saving an included amount must not silently turn it into a priced zero.
  if (row.priceState === 'included' && price?.ok && price.cents === 0) return clearRowCurrencyConversion(row)
  row = clearRowCurrencyConversion(row)
  const priceState = unitPrice.trim() ? 'priced' : 'pending'
  if (row.unitPrice === unitPrice && row.priceState === priceState) return resolveFixedServicePrice(row)
  return resolveFixedServicePrice({ ...row, unitPrice, priceState })
}
