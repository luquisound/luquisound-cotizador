import { readAdapterVariant } from './adapters.ts'
import { AUDIO_CATEGORIES, orderQuotationRows, quotationRowBlockId, readAudioCategory } from './audio-categories.ts'
import type { AudioCategory } from './audio-categories.ts'
import { isEmptyRow } from './calculation.ts'
import type { Quotation, QuotationRow, RowSection } from './model.ts'

export interface QuotationBlock {
  id: string
  label: string
  category?: AudioCategory
  rows: QuotationRow[]
}

export function getQuotationBlocks(quotation: Quotation, section: RowSection): QuotationBlock[] {
  const blocks = new Map<string, QuotationBlock>()
  for (const row of orderQuotationRows(quotation.rows, quotation.blockOrder)) {
    if (row.section !== section || isEmptyRow(row)) continue
    const id = quotationRowBlockId(row)
    const existing = blocks.get(id)
    if (existing) {
      existing.rows.push(row)
      continue
    }
    const category = readAudioCategory(row.audioCategory, section)
    blocks.set(id, {
      id, label: AUDIO_CATEGORIES.find((entry) => entry.id === category)?.label
        ?? (row.concept.trim() || 'Concepto pendiente'),
      ...(category ? { category } : {}), rows: [row],
    })
  }
  return [...blocks.values()]
}

function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const moved = [...items]
  const [item] = moved.splice(from, 1)
  moved.splice(to, 0, item!)
  return moved
}

export function moveQuotationBlock(
  quotation: Quotation, section: RowSection, activeId: string, overId: string,
): Quotation {
  if (activeId === overId) return quotation
  const blocks = getQuotationBlocks(quotation, section)
  const from = blocks.findIndex((block) => block.id === activeId)
  const to = blocks.findIndex((block) => block.id === overId)
  if (from === -1 || to === -1) return quotation
  const moved = moveItem(blocks, from, to).map((block) => block.id)
  const sections = new Map(AUDIO_CATEGORIES.map((category) => [`category:${category.id}`, category.section]))
  for (const row of quotation.rows) sections.set(quotationRowBlockId(row), row.section)
  const retained = [...new Set(quotation.blockOrder ?? [])].filter((id) => sections.has(id))
  const current = retained.filter((id) => sections.get(id) === section)
  const remembered = new Set(current)
  for (const block of blocks) if (!remembered.has(block.id)) current.push(block.id)
  const activeIds = new Set(moved)
  let index = 0
  // Keep hidden category slots, such as an inactive bypass, while sorting visible blocks.
  const ordered = current.map((id) => activeIds.has(id) ? moved[index++]! : id)
  const other = retained.filter((id) => sections.get(id) !== section)
  return { ...quotation, blockOrder: [...ordered, ...other] }
}

export function moveQuotationRow(quotation: Quotation, activeRowId: string, overRowId: string): Quotation {
  if (activeRowId === overRowId) return quotation
  const active = quotation.rows.find((row) => row.id === activeRowId)
  const over = quotation.rows.find((row) => row.id === overRowId)
  if (!active || !over || isEmptyRow(active) || isEmptyRow(over)) return quotation
  const category = readAudioCategory(active.audioCategory, active.section)
  if (!category || active.section !== over.section
    || category !== readAudioCategory(over.audioCategory, over.section)) return quotation
  const isVariant = (row: QuotationRow): boolean => (
    readAdapterVariant(row.adapterVariant, row.section, row.audioCategory) !== undefined
  )
  if (category === 'adapters' && isVariant(active) !== isVariant(over)) return quotation
  const members = quotation.rows.filter((row) => (
    row.section === active.section && readAudioCategory(row.audioCategory, row.section) === category
    && !isEmptyRow(row) && (category !== 'adapters' || isVariant(row) === isVariant(active))
  ))
  const moved = moveItem(members, members.indexOf(active), members.indexOf(over))
  const ids = new Set(members.map((row) => row.id))
  let index = 0
  return { ...quotation, rows: quotation.rows.map((row) => ids.has(row.id) ? moved[index++]! : row) }
}

/** Invalid optional layout metadata must not make the quotation unreadable. */
export function readQuotationBlockOrder(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length > 1008) return undefined
  const categories = new Set(AUDIO_CATEGORIES.map((category) => `category:${category.id}`))
  const valid = value.filter((id): id is string => (
    typeof id === 'string' && (categories.has(id) || /^row:[a-zA-Z0-9_-]{1,128}$/.test(id))
  ))
  return [...new Set(valid)]
}
