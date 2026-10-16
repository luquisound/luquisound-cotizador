export type Currency = 'ARS' | 'USD'
export type RowSection = 'equipment' | 'extras'
export type PriceState = 'pending' | 'priced' | 'included'

export interface QuotationRow {
  id: string
  section: RowSection
  concept: string
  detail: string
  quantity: string
  unitPrice: string
  priceState: PriceState
}

export interface Quotation {
  id: string
  title: string
  subtitle: string
  currency: Currency
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
}

export interface Workspace {
  version: 1
  activeQuotationId: string
  quotations: Quotation[]
  catalog: CatalogItem[]
}

export function createRow(section: RowSection = 'equipment'): QuotationRow {
  return {
    id: crypto.randomUUID(), section, concept: '', detail: '', quantity: '1',
    unitPrice: '', priceState: 'pending',
  }
}

export function createQuotation(): Quotation {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(), title: 'PRESUPUESTO', subtitle: '', currency: 'ARS',
    rows: [createRow(), createRow('extras')], notes: '', createdAt: now, updatedAt: now,
  }
}

export function createWorkspace(): Workspace {
  const quotation = createQuotation()
  return { version: 1, activeQuotationId: quotation.id, quotations: [quotation], catalog: [] }
}

export function duplicateQuotation(quotation: Quotation): Quotation {
  const now = new Date().toISOString()
  return {
    ...quotation, id: crypto.randomUUID(), title: `${(quotation.title || 'PRESUPUESTO').slice(0, 492)} (copia)`,
    rows: quotation.rows.map((row) => ({ ...row, id: crypto.randomUUID() })),
    createdAt: now, updatedAt: now,
  }
}
