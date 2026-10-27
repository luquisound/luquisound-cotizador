import type { CatalogListPrice, CatalogReferencePrice, CatalogSource } from './catalog.ts'
import type { CatalogAvailabilityPolicy, CatalogStockSnapshot } from './catalog-stock.ts'
import type { QuotationRowProvenance } from './row-provenance.ts'
import type { BlueDollarQuote } from './exchange-quote.ts'
import type { AudioCategory } from './audio-categories.ts'

export type { CatalogReferencePrice, CatalogSource } from './catalog.ts'
export type { CatalogStockSnapshot } from './catalog-stock.ts'

export type Currency = 'ARS' | 'USD'
export type RowSection = 'equipment' | 'extras'
export type PriceState = 'pending' | 'priced' | 'included'
export type AdapterPresentation = 'unit' | 'pair' | 'set'

export interface AdapterVariant {
  productKey: string
  size: string
  presentation: AdapterPresentation
}

export interface FixedServiceOrigin {
  version: 1
  quantity: string
  unitPrice: string
  priceState: PriceState
  currency: Currency
  requiresPriceReview: boolean
}

export interface FactoryEquipment {
  version: 1
  category: 'speakers' | 'subwoofer'
  original: {
    concept: string
    detail: string
    unitPrice: string
    priceState: PriceState
    currency: Currency
  }
}

export interface HarnessSelection {
  enabled: boolean
}

export interface CurrencyConversionOrigin {
  version: 1
  sourceCurrency: Currency
  sourceUnitPrice: string
  exchangeRate: string
  derivedCurrency: Currency
  derivedUnitPrice: string
}

export interface RowCurrencyConversionOrigin extends CurrencyConversionOrigin {
  priceState: PriceState
}

export interface QuotationRow {
  id: string
  section: RowSection
  audioCategory?: AudioCategory
  adapterVariant?: AdapterVariant
  currency: Currency
  concept: string
  detail: string
  quantity: string
  unitPrice: string
  priceState: PriceState
  provenance?: QuotationRowProvenance
  fixedServiceOrigin?: FixedServiceOrigin
  factoryEquipment?: FactoryEquipment
  harnessSelection?: HarnessSelection
  currencyConversionOrigin?: RowCurrencyConversionOrigin
}

export interface QuotationDiscount {
  percentage: string
  rowIds: string[]
}

export interface Quotation {
  id: string
  title: string
  subtitle: string
  // Compatibility default for older saved rows without their own currency.
  currency: Currency
  exchangeRate?: string
  exchangeRateQuote?: BlueDollarQuote
  exchangeRateMode?: 'automatic' | 'frozen'
  discount?: QuotationDiscount
  rows: QuotationRow[]
  notes: string
  createdAt: string
  updatedAt: string
}

export interface CatalogItem {
  id: string
  concept: string
  detail: string
  section: RowSection
  currency: Currency
  unitPrice: string
  supplier?: string
  sku?: string
  brand?: string
  category?: string
  unit?: string
  presentation?: string
  source?: CatalogSource
  referencePrices?: CatalogReferencePrice[]
  stock?: CatalogStockSnapshot
  listPrice?: CatalogListPrice
  availabilityPolicy?: CatalogAvailabilityPolicy
  selectionBlock?: string
}

export interface Workspace {
  version: 1
  activeQuotationId: string | null
  quotations: Quotation[]
  catalog: CatalogItem[]
}

export function createRow(section: RowSection = 'equipment', currency: Currency = 'ARS'): QuotationRow {
  return {
    id: crypto.randomUUID(), section, currency, concept: '', detail: '', quantity: '1',
    unitPrice: '', priceState: 'pending',
  }
}

export function createQuotation(): Quotation {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(), title: 'PRESUPUESTO', subtitle: '', currency: 'ARS', exchangeRate: '',
    rows: [createRow(), createRow('extras')], notes: '', createdAt: now, updatedAt: now,
  }
}

export function createWorkspace(): Workspace {
  const quotation = createQuotation()
  return { version: 1, activeQuotationId: quotation.id, quotations: [quotation], catalog: [] }
}

export function hasQuotationContent(quotation: Quotation): boolean {
  if (quotation.discount !== undefined) return true
  const title = quotation.title.trim()
  if (title && !/^presupuesto(?:\s*\(copia\))*$/i.test(title)) return true
  if (quotation.subtitle.trim() || quotation.notes.trim()) return true
  if (quotation.exchangeRate?.trim() && !quotation.exchangeRateQuote) return true
  return quotation.rows.some((row) => (
    row.concept.trim() !== ''
    || row.detail.trim() !== ''
    || row.unitPrice.trim() !== ''
    || row.priceState === 'included'
    || row.fixedServiceOrigin?.requiresPriceReview === true
    || row.quantity.trim() !== '1'
  ))
}

export function ensureBlankQuotation(workspace: Workspace): Workspace {
  const active = workspace.quotations.find((quotation) => quotation.id === workspace.activeQuotationId)
  const blank = active && !hasQuotationContent(active)
    ? active
    : workspace.quotations.find((quotation) => !hasQuotationContent(quotation))
  if (blank) {
    return workspace.activeQuotationId === blank.id ? workspace : { ...workspace, activeQuotationId: blank.id }
  }
  const quotation = createQuotation()
  return { ...workspace, activeQuotationId: quotation.id, quotations: [...workspace.quotations, quotation] }
}

export function prepareWorkspaceForStorage(workspace: Workspace, persistedIds: ReadonlySet<string>): Workspace {
  const quotations = workspace.quotations.filter((quotation) => persistedIds.has(quotation.id) || hasQuotationContent(quotation))
  const activeQuotationId = quotations.some((quotation) => quotation.id === workspace.activeQuotationId)
    ? workspace.activeQuotationId
    : quotations[0]?.id ?? null
  return { ...workspace, activeQuotationId, quotations }
}

export function duplicateQuotation(quotation: Quotation): Quotation {
  const now = new Date().toISOString()
  const rows = quotation.rows.map((row) => ({ ...structuredClone(row), id: crypto.randomUUID() }))
  const rowIds = new Map(quotation.rows.map((row, index) => [row.id, rows[index]!.id]))
  return {
    ...quotation, id: crypto.randomUUID(), title: `${(quotation.title || 'PRESUPUESTO').slice(0, 492)} (copia)`,
    rows,
    ...(quotation.discount ? { discount: {
      ...quotation.discount, rowIds: quotation.discount.rowIds.map((id) => rowIds.get(id) ?? id),
    } } : {}),
    ...(quotation.exchangeRateQuote ? { exchangeRateQuote: { ...quotation.exchangeRateQuote } } : {}),
    createdAt: now, updatedAt: now,
  }
}
