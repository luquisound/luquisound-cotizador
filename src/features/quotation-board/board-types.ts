import type { Quotation } from '../quotation/model.ts'

export interface BoardCategory {
  id: string
  name: string
}

export interface BoardEntry {
  id: string
  name: string
  categoryId: string | null
  revision: number
  updatedAt: string
  quotation: Quotation
}

export interface BoardSaveRequest {
  mode: 'new' | 'replace'
  name: string
  categoryId: string | null
  newCategoryName?: string
}

export interface BoardCardEntry extends Omit<BoardEntry, 'quotation'> {
  quotation?: Quotation
  title?: string
  subtitle?: string
  pending?: boolean
}
