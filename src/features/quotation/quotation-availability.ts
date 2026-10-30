import { orderQuotationRows } from './audio-categories.ts'
import { isEmptyRow } from './calculation.ts'
import { getCatalogAvailabilityPolicy, getCatalogSelectionStatus, parseCatalogStockFields } from './catalog-stock.ts'
import type { CatalogSelectionReason, CatalogStockSnapshot } from './catalog-stock.ts'
import type { CatalogItem, Quotation, QuotationRow } from './model.ts'
import { isFactoryRow } from './factory-mode.ts'

export function describeCatalogAvailability(item: CatalogItem, now = Date.now()): {
  quantityLabel: string
  ageLabel: string
  selectionLabel: string
  sourceDateLabel: string
  provisional: boolean
  blocked: boolean
} {
  const status = getCatalogSelectionStatus(item, now)
  const quantity = item.stock?.quantity
  const quantityLabel = status.quantityState === 'unknown' ? 'Stock no informado'
    : `Stock registrado: ${quantity}${status.quantityState === 'negative' ? ' (negativo)' : ''}`
  const ageLabel = {
    historical: 'Histórico', fresh: 'Observación vigente', stale: 'Observación vencida',
    future: 'Observación con fecha futura', unknown: 'Fecha de observación no informada',
  }[status.age]
  const source = item.source ?? item.stock?.source
  const sourceDateLabel = `Fecha comercial de fuente: ${source?.date ?? 'no informada'}`
  const provisional = status.provisional || item.listPrice?.provisional === true
  const selectionLabel = item.selectionBlock ?? (!getCatalogAvailabilityPolicy(item) ? 'Concepto manual independiente'
    : status.reason === 'pending-price' ? 'Precio de venta pendiente · No habilitado para cotizar'
      : status.reason === 'invalid-price' ? 'Precio de venta inválido · No habilitado para cotizar'
    : !status.selectable ? 'No habilitado para cotizar'
      : provisional ? 'Disponibilidad a confirmar' : 'Habilitado según la observación de stock')
  return { quantityLabel, ageLabel, selectionLabel, sourceDateLabel, provisional, blocked: !status.selectable }
}

export interface QuotationAvailability {
  issues: string[]
  hasProvisional: boolean
}

function normalizedKey(value: string | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

function keyMatches(first: { supplier?: string; sku?: string }, second: { supplier?: string; sku?: string }): boolean {
  const supplier = normalizedKey(first.supplier)
  const sku = normalizedKey(first.sku)
  return !!supplier && !!sku && supplier === normalizedKey(second.supplier) && sku === normalizedKey(second.sku)
}

export function getRowAvailabilityItem(
  row: QuotationRow, catalog: readonly CatalogItem[] = [],
): CatalogItem | undefined {
  if (isFactoryRow(row)) return undefined
  const provenance = row.provenance
  if (!provenance) return undefined
  const policy = getCatalogAvailabilityPolicy(provenance)
  const stored: CatalogItem = {
    id: provenance.catalogItemId, concept: row.concept, detail: row.detail,
    section: row.section, currency: row.currency, unitPrice: row.priceState === 'included' ? '0' : row.unitPrice,
    ...(provenance.supplier === undefined ? {} : { supplier: provenance.supplier }),
    ...(provenance.sku === undefined ? {} : { sku: provenance.sku }),
    ...(provenance.source === undefined ? {} : { source: provenance.source }),
    ...(provenance.listPrice === undefined ? {} : { listPrice: provenance.listPrice }),
    ...(provenance.stock === undefined ? {} : { stock: provenance.stock }),
    ...(policy === undefined ? {} : { availabilityPolicy: policy }),
    ...(provenance.selectionBlock === undefined ? {} : { selectionBlock: provenance.selectionBlock }),
  }
  const identityMatches = catalog.filter((item) => item.id === provenance.catalogItemId)
  const matches = identityMatches.length ? identityMatches : catalog.filter((item) => keyMatches(provenance, item))
  if (matches.length > 1) return { ...stored, selectionBlock: 'El catálogo tiene coincidencias ambiguas para este producto.' }
  const latest = matches[0]
  if (!latest) return stored
  const selectionBlock = provenance.selectionBlock ?? latest.selectionBlock
  // Manual selections do not silently acquire a supplier-stock policy later.
  if (policy === undefined) {
    return { ...stored, ...(selectionBlock === undefined ? {} : { selectionBlock }) }
  }
  return {
    ...stored,
    // A matching catalogue snapshot is authoritative for availability, never for row prices.
    stock: latest.stock,
    availabilityPolicy: getCatalogAvailabilityPolicy(latest) ?? policy,
    source: latest.source ?? provenance.source,
    ...(selectionBlock === undefined ? {} : { selectionBlock }),
  }
}

const selectionIssues: Record<CatalogSelectionReason, string> = {
  manual: '', available: '', 'historical-positive': '',
  'pending-price': 'El producto no tiene un precio de venta aprobado.',
  'invalid-price': 'El precio de venta del producto no es válido.',
  blocked: 'El producto está bloqueado por un conflicto en la fuente.',
  'zero-stock': 'El stock registrado es cero. Elegí otro producto.',
  'negative-stock': 'El stock registrado es negativo y requiere revisión.',
  'unknown-stock': 'No hay stock verificable para este producto.',
  'stale-stock': 'La observación de stock venció. Revisá una fuente vigente.',
  'future-stock': 'La observación de stock tiene una fecha futura y no es válida todavía.',
  'invalid-stock': 'La información de disponibilidad no es válida.',
}

export function inspectQuotationAvailability(
  quotation: Quotation, catalog: readonly CatalogItem[] = [], now = Date.now(),
): QuotationAvailability {
  const issues: string[] = []
  let hasProvisional = false
  const rows = orderQuotationRows(quotation.rows, quotation.blockOrder, quotation.rowOrder).filter((row) => !isEmptyRow(row))
  for (const [index, row] of rows.entries()) {
    const item = getRowAvailabilityItem(row, catalog)
    if (!item) continue
    const status = getCatalogSelectionStatus(item, now)
    if (status.provisional || row.provenance?.priceBasis === 'provisional-list'
      || row.provenance?.listPrice?.provisional === true
      || (row.provenance !== undefined && getCatalogAvailabilityPolicy(row.provenance) !== undefined
        && row.provenance.stock?.observation === 'historical')) {
      hasProvisional = true
    }
    if (!status.selectable) {
      const reason = item.selectionBlock ?? selectionIssues[status.reason]
      issues.push(`Fila ${index + 1}: ${reason}`)
    }
  }
  return { issues, hasProvisional }
}

export function getNextAvailabilityBoundary(
  catalog: readonly CatalogItem[], rows: readonly QuotationRow[] = [], now = Date.now(),
): number | null {
  if (!Number.isFinite(now)) return null
  let next: number | null = null
  const inspect = (stock: CatalogStockSnapshot | undefined): void => {
    if (!stock) return
    const fields = parseCatalogStockFields(stock.quantity, stock.checkedAt, stock.validUntil, stock.observation)
    if (!fields) return
    const boundaries = fields.observation === 'historical' ? [fields.checkedAt] : [fields.checkedAt, fields.validUntil]
    for (const boundary of boundaries) {
      if (boundary === null) continue
      const value = Date.parse(boundary)
      if (value > now && (next === null || value < next)) next = value
    }
  }
  for (const item of catalog) inspect(item.stock)
  for (const row of rows) inspect(getRowAvailabilityItem(row, catalog)?.stock)
  return next
}

export function getAvailabilityRefreshDelay(
  catalog: readonly CatalogItem[], rows: readonly QuotationRow[] = [], now = Date.now(),
): number {
  const boundary = getNextAvailabilityBoundary(catalog, rows, now)
  return boundary === null ? 60_000 : Math.max(1, Math.min(60_000, boundary - now))
}
