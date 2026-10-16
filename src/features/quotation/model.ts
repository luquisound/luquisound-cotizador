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
  activeQuotationId: string | null
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

export function hasQuotationContent(quotation: Quotation): boolean {
  const title = quotation.title.trim()
  if (title && !/^presupuesto(?:\s*\(copia\))*$/i.test(title)) return true
  if (quotation.subtitle.trim() || quotation.notes.trim()) return true
  return quotation.rows.some((row) => (
    row.concept.trim() !== ''
    || row.detail.trim() !== ''
    || row.unitPrice.trim() !== ''
    || row.priceState === 'included'
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
  return {
    ...quotation, id: crypto.randomUUID(), title: `${(quotation.title || 'PRESUPUESTO').slice(0, 492)} (copia)`,
    rows: quotation.rows.map((row) => ({ ...row, id: crypto.randomUUID() })),
    createdAt: now, updatedAt: now,
  }
}
