import { readAdapterVariant } from './adapters.ts'
import { isSingleRowCategory } from './audio-categories.ts'
import { calculateQuotation, isEmptyRow, parseMoney, parseQuantity } from './calculation.ts'
import type { Quotation, QuotationRow } from './model.ts'
import { parseRowProvenance } from './row-provenance.ts'

export type SaveQuotationRowResult = {
  ok: true
  rows: QuotationRow[]
  rowId: string
  merged: boolean
} | { ok: false; error: string; existingRowId?: string }

const MAXIMUM_ROWS = 1000
const maximumSafeInteger = BigInt(Number.MAX_SAFE_INTEGER)

function normalizedRow(row: QuotationRow): QuotationRow {
  const { adapterVariant: _variant, ...fields } = row
  const adapterVariant = readAdapterVariant(row.adapterVariant, row.section, row.audioCategory)
  return { ...fields, ...(adapterVariant ? { adapterVariant } : {}) }
}

function priceCents(row: QuotationRow): number | null {
  if (row.priceState === 'included') return 0
  if (row.priceState !== 'priced') return null
  const price = parseMoney(row.unitPrice)
  return price.ok ? price.cents : null
}

function sameProvenance(existing: QuotationRow, incoming: QuotationRow): boolean {
  if (existing.provenance === undefined || incoming.provenance === undefined) {
    return existing.provenance === incoming.provenance
  }
  try {
    return JSON.stringify(parseRowProvenance(existing.provenance)) === JSON.stringify(parseRowProvenance(incoming.provenance))
  } catch {
    return false
  }
}

function matchesAdapter(existing: QuotationRow, incoming: QuotationRow): boolean {
  const left = readAdapterVariant(existing.adapterVariant, existing.section, existing.audioCategory)
  const right = incoming.adapterVariant
  const price = priceCents(incoming)
  return left !== undefined && right !== undefined && price !== null
    && left.productKey === right.productKey && left.size === right.size && left.presentation === right.presentation
    && existing.concept.trim() === incoming.concept.trim() && existing.detail.trim() === incoming.detail.trim()
    && existing.currency === incoming.currency && existing.priceState === incoming.priceState
    && priceCents(existing) === price && sameProvenance(existing, incoming)
}

function quantityText(thousandths: bigint): string {
  const fraction = String(thousandths % 1000n).padStart(3, '0').replace(/0+$/, '')
  return `${thousandths / 1000n}${fraction ? `,${fraction}` : ''}`
}

function mergeAdapter(
  quotation: Quotation, existing: QuotationRow, incoming: QuotationRow,
): QuotationRow | { error: string } | null {
  const previousQuantity = parseQuantity(existing.quantity)
  const addedQuantity = parseQuantity(incoming.quantity)
  if (!previousQuantity.ok || !addedQuantity.ok) return null
  const thousandths = BigInt(previousQuantity.thousandths) + BigInt(addedQuantity.thousandths)
  if (thousandths > maximumSafeInteger) {
    return { error: 'La cantidad acumulada supera el límite de cálculo seguro.' }
  }
  const merged = { ...existing, quantity: quantityText(thousandths) }
  const before = calculateQuotation({ ...quotation, rows: [existing, incoming] })
  const after = calculateQuotation({ ...quotation, rows: [merged] })
  if (before.rows.some((row) => row.lineTotalCents === null)) return null
  if (after.rows[0]?.lineTotalCents === null) {
    return { error: 'El subtotal acumulado supera el límite de cálculo seguro.' }
  }
  const beforeTotal = before.rows.reduce((total, row) => total + BigInt(row.lineTotalCents!), 0n)
  if (beforeTotal !== BigInt(after.rows[0]?.lineTotalCents ?? -1)) return null
  return merged
}

export function saveQuotationRow(
  quotation: Quotation, row: QuotationRow, kind: 'new' | 'existing',
): SaveQuotationRowResult {
  const incoming = normalizedRow(row)
  const previous = quotation.rows.find((candidate) => candidate.id === incoming.id)
  if (kind === 'existing' && !previous) return { ok: false, error: 'Este concepto ya no está en el presupuesto.' }
  if (kind === 'new' && previous) return { ok: false, error: 'Este concepto ya está en el presupuesto.' }
  if (isSingleRowCategory(incoming.audioCategory)
    && (kind === 'new' || previous?.audioCategory !== incoming.audioCategory || previous?.section !== incoming.section)) {
    const occupied = quotation.rows.find((candidate) => candidate.id !== incoming.id
      && candidate.section === incoming.section && candidate.audioCategory === incoming.audioCategory && !isEmptyRow(candidate))
    if (occupied) {
      return {
        ok: false, error: 'Esta categoría ya tiene un concepto. Editá la fila existente.', existingRowId: occupied.id,
      }
    }
  }
  if (kind === 'existing') {
    return { ok: true, rows: quotation.rows.map((candidate) => candidate.id === incoming.id ? incoming : candidate), rowId: incoming.id, merged: false }
  }
  if (incoming.adapterVariant && incoming.priceState !== 'pending') {
    const matches = quotation.rows.filter((candidate) => matchesAdapter(candidate, incoming))
    if (matches.length === 1) {
      const existing = matches[0]!
      const merged = mergeAdapter(quotation, existing, incoming)
      if (merged && 'error' in merged) return { ok: false, error: merged.error }
      if (merged) {
        return { ok: true, rows: quotation.rows.map((candidate) => candidate.id === existing.id ? merged : candidate), rowId: existing.id, merged: true }
      }
    }
  }
  if (quotation.rows.length >= MAXIMUM_ROWS) {
    return { ok: false, error: 'Llegaste al máximo de 1000 conceptos en este presupuesto.' }
  }
  return { ok: true, rows: [...quotation.rows, incoming], rowId: incoming.id, merged: false }
}
