import { isEmptyRow } from './calculation.ts'
import type { Quotation } from './model.ts'

export interface QuotationOrderUndo {
  quotationId: string
  topology: string
  rowOrder?: string[]
  blockOrder?: string[]
}

function orderTopology(quotation: Quotation): string {
  return JSON.stringify(quotation.rows.map((row) => [
    row.id, row.section, row.audioCategory ?? null, !isEmptyRow(row),
  ]))
}

/** Remember layout only, so undo cannot roll back later price or text edits. */
export function rememberQuotationOrder(quotation: Quotation): QuotationOrderUndo {
  return {
    quotationId: quotation.id,
    topology: orderTopology(quotation),
    ...(quotation.rowOrder ? { rowOrder: [...quotation.rowOrder] } : {}),
    ...(quotation.blockOrder ? { blockOrder: [...quotation.blockOrder] } : {}),
  }
}

export function canUndoQuotationOrder(quotation: Quotation, undo: QuotationOrderUndo | null): boolean {
  return undo !== null && undo.quotationId === quotation.id
    && quotation.rowOrder === undefined && quotation.blockOrder === undefined
    && undo.topology === orderTopology(quotation)
}

export function undoQuotationOrder(quotation: Quotation, undo: QuotationOrderUndo | null): Quotation {
  if (!undo || !canUndoQuotationOrder(quotation, undo)) return quotation
  return {
    ...quotation,
    ...(undo.rowOrder ? { rowOrder: [...undo.rowOrder] } : {}),
    ...(undo.blockOrder ? { blockOrder: [...undo.blockOrder] } : {}),
  }
}
