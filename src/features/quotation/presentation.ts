import { readAdapterVariant } from './adapters.ts'
import { parseQuantity } from './calculation.ts'
import type { CalculatedRow } from './calculation.ts'
import type { QuotationRow } from './model.ts'

export interface QuotationPresentationItem {
  kind: 'row'
  item: CalculatedRow
  concept: string
  detail: string
  quantity: string
}

const quantityFormatter = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })

/** Format an already validated quantity without rounding its thousandths. */
export function formatQuantityThousandths(thousandths: number): string {
  const amount = BigInt(thousandths)
  const fraction = String(amount % 1000n).padStart(3, '0').replace(/0+$/g, '')
  return `${quantityFormatter.format(amount / 1000n)}${fraction ? `,${fraction}` : ''}`
}

export function adapterVariantQuantity(row: QuotationRow): string | undefined {
  const variant = readAdapterVariant(row.adapterVariant, row.section, row.audioCategory)
  if (!variant) return undefined
  const quantity = parseQuantity(row.quantity)
  const quantityLabel = quantity.ok ? formatQuantityThousandths(quantity.thousandths)
    : row.quantity.trim() || 'Cantidad pendiente'
  const singular = quantity.ok && quantity.thousandths === 1000
  const presentation = variant.presentation === 'unit' ? (singular ? 'unidad' : 'unidades')
    : variant.presentation === 'pair' ? (singular ? 'par' : 'pares')
      : singular ? 'juego' : 'juegos'
  return `${quantityLabel} ${presentation} × ${variant.size}″`
}

export function presentQuotationRow(item: CalculatedRow): QuotationPresentationItem {
  const { row } = item
  const quantity = parseQuantity(row.quantity)
  return {
    kind: 'row', item,
    concept: row.concept.trim() || 'Concepto pendiente',
    detail: row.detail.trim(),
    quantity: adapterVariantQuantity(row)
      ?? (quantity.ok && quantity.thousandths === 1000 ? '' : `Cantidad: ${row.quantity.trim() || 'pendiente'}`),
  }
}

/** Keep the calculation's resolved row order without regrouping independent items. */
export function buildQuotationPresentation(rows: readonly CalculatedRow[]): QuotationPresentationItem[] {
  return rows.map(presentQuotationRow)
}
