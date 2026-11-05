import type { Quotation } from '../quotation/model.ts'
import type { BoardCategory, BoardEntry } from './board-types.ts'

export interface SharedBoardEntry extends BoardEntry {
  createdAt: string
  lastOperationId: string
  lastOperationHash: string
}

export interface SharedBoardDocument {
  schema: 'luquisound.quotation-board'
  version: 1
  epoch: string
  revision: number
  categories: BoardCategory[]
  entries: SharedBoardEntry[]
}

export interface BoardEntrySummary {
  id: string
  name: string
  categoryId: string | null
  revision: number
  updatedAt: string
  title: string
  subtitle: string
  pending: boolean
}

export interface BoardListResponse {
  epoch: string
  revision: number
  categories: BoardCategory[]
  entries: BoardEntrySummary[]
}

export interface BoardDetailResponse {
  epoch: string
  entry: BoardEntry
}

export interface BoardSaveCommand {
  type: 'save'
  operationId: string
  epoch: string
  mode: 'new' | 'replace'
  entryId: string
  expectedRevision: number | null
  name: string
  categoryId: string | null
  newCategoryName?: string
  quotation: Quotation
}

export interface BoardSaveResponse extends BoardDetailResponse {
  operationId: string
}

export interface BoardWorkingContext {
  entryId: string
  revision: number
  epoch: string
  name: string
  categoryId: string | null
  baseline: string
}
