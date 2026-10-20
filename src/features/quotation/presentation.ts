import { orderQuotationRows } from './audio-categories.ts'
import { readAdapterVariant } from './adapters.ts'
import { formatMoney, parseQuantity } from './calculation.ts'
import type { CalculatedRow } from './calculation.ts'
import type { Currency } from './model.ts'

export interface AdapterPresentationBlock {
  kind: 'adapters'
  items: CalculatedRow[]
  title: string
  details: string[]
  amounts: string[]
  pending: boolean
}

export type QuotationPresentationItem = { kind: 'row'; item: CalculatedRow }
  | AdapterPresentationBlock

const quantityFormatter = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })
const genericAdapterConcepts = new Set(['Aros adaptadores 3D', 'Aros / adaptadores 3D'])

export function adapterVariantDescription(item: CalculatedRow): string {
  const { row } = item
  const variant = readAdapterVariant(row.adapterVariant, row.section, row.audioCategory)
  if (!variant) throw new Error('Adapter details require an explicit valid variant.')
  const quantity = parseQuantity(row.quantity)
  let quantityLabel = row.quantity.trim() || 'Cantidad pendiente'
  if (quantity.ok) {
    const amount = BigInt(quantity.thousandths)
    const fraction = String(amount % 1000n).padStart(3, '0').replace(/0+$/g, '')
    quantityLabel = `${quantityFormatter.format(amount / 1000n)}${fraction ? `,${fraction}` : ''}`
  }
  const singular = quantity.ok && quantity.thousandths === 1000
  const presentation = variant.presentation === 'unit' ? (singular ? 'unidad' : 'unidades')
    : variant.presentation === 'pair' ? (singular ? 'par' : 'pares')
      : singular ? 'juego' : 'juegos'
  const concept = row.concept.trim()
  return [
    `${quantityLabel} ${presentation} × ${variant.size}″`,
    concept && !genericAdapterConcepts.has(concept) ? concept : '',
    row.detail.trim(),
  ].filter(Boolean).join(' · ')
}

export function adapterVariantAmount(item: CalculatedRow): string {
  return item.errors.length || item.lineTotalCents === null
    || !Number.isSafeInteger(item.lineTotalCents) || item.lineTotalCents < 0
    ? 'Pendiente'
    : item.row.priceState === 'included' ? 'Incluido'
      : formatMoney(item.lineTotalCents, item.row.currency)
}

export function adapterVariantDetail(item: CalculatedRow): string {
  return `${adapterVariantDescription(item)} · ${adapterVariantAmount(item)}`
}

function adapterBlock(items: CalculatedRow[]): AdapterPresentationBlock {
  const totals: Record<Currency, bigint> = { ARS: 0n, USD: 0n }
  const pricedCurrencies = new Set<Currency>()
  let pending = false
  for (const item of items) {
    if (item.errors.length || item.lineTotalCents === null
      || !Number.isSafeInteger(item.lineTotalCents) || item.lineTotalCents < 0) {
      pending = true
      continue
    }
    if (item.row.priceState !== 'included') {
      pricedCurrencies.add(item.row.currency)
      totals[item.row.currency] += BigInt(item.lineTotalCents)
    }
  }
  if (totals.ARS > BigInt(Number.MAX_SAFE_INTEGER) || totals.USD > BigInt(Number.MAX_SAFE_INTEGER)) {
    pending = true
  }
  const amounts = pending ? ['Pendiente']
    : pricedCurrencies.size === 0 ? ['Incluido']
      : (['ARS', 'USD'] as const).filter((currency) => pricedCurrencies.has(currency))
        .map((currency) => formatMoney(Number(totals[currency]), currency))
  return {
    kind: 'adapters', items, title: 'Aros adaptadores 3D',
    details: items.map(adapterVariantDetail), amounts, pending,
  }
}

/** Group explicit adapter variants without changing the source rows or their rounded amounts. */
export function buildQuotationPresentation(rows: readonly CalculatedRow[]): QuotationPresentationItem[] {
  const byRow = new Map(rows.map((item) => [item.row, item]))
  const ordered = orderQuotationRows(rows.map((item) => item.row)).map((row) => byRow.get(row)!)
  const adapters = ordered.filter(({ row }) => (
    readAdapterVariant(row.adapterVariant, row.section, row.audioCategory) !== undefined
  ))
  let grouped = false
  const result: QuotationPresentationItem[] = []
  for (const item of ordered) {
    if (readAdapterVariant(item.row.adapterVariant, item.row.section, item.row.audioCategory)) {
      if (!grouped) result.push(adapterBlock(adapters))
      grouped = true
    } else {
      result.push({ kind: 'row', item })
    }
  }
  return result
}
