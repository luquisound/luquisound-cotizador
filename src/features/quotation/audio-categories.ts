import type { QuotationRow, RowSection } from './model.ts'

export type AudioCategory = 'amplifier-dsp' | 'additional-amplifier' | 'subwoofer' | 'speakers'
  | 'cables' | 'harness' | 'adapters' | 'labor'

export interface AudioCategoryDefinition {
  id: AudioCategory
  section: RowSection
  label: string
}

export const AUDIO_CATEGORIES: readonly AudioCategoryDefinition[] = [
  { id: 'amplifier-dsp', section: 'equipment', label: 'Amplificador / DSP' },
  { id: 'additional-amplifier', section: 'equipment', label: 'Amplificador adicional' },
  { id: 'subwoofer', section: 'equipment', label: 'Subwoofer' },
  { id: 'speakers', section: 'equipment', label: 'Parlantes o componentes' },
  { id: 'cables', section: 'extras', label: 'Cables y accesorios' },
  { id: 'harness', section: 'extras', label: 'Ficha / arnés' },
  { id: 'adapters', section: 'extras', label: 'Aros / adaptadores 3D' },
  { id: 'labor', section: 'extras', label: 'Mano de obra' },
]

export function getAudioCategories(section: RowSection): readonly AudioCategoryDefinition[] {
  return AUDIO_CATEGORIES.filter((category) => category.section === section)
}

export function readAudioCategory(value: unknown, section: RowSection): AudioCategory | undefined {
  return AUDIO_CATEGORIES.find((category) => category.id === value && category.section === section)?.id
}

function rowOrder(row: QuotationRow): number {
  const sectionStart = row.section === 'equipment' ? 0 : AUDIO_CATEGORIES.length + 1
  const category = readAudioCategory(row.audioCategory, row.section)
  const categoryIndex = AUDIO_CATEGORIES.findIndex((definition) => definition.id === category)
  return sectionStart + (categoryIndex === -1 ? AUDIO_CATEGORIES.length : categoryIndex)
}

export function orderQuotationRows(rows: readonly QuotationRow[]): QuotationRow[] {
  return [...rows].sort((left, right) => rowOrder(left) - rowOrder(right))
}
