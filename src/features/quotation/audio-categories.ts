import { readAdapterVariant } from './adapters.ts'
import type { QuotationRow, RowSection } from './model.ts'

export type AudioCategory = 'amplifier-dsp' | 'additional-amplifier' | 'subwoofer' | 'speakers'
  | 'cables' | 'harness' | 'adapters' | 'labor'

export type AdapterSize = '6.5' | '8'

export interface AdapterVariant {
  readonly id: AdapterSize
  readonly label: string
  readonly concept: string
  readonly currency: 'ARS'
  readonly unitPrice: string
}

export const ADAPTER_VARIANTS: readonly AdapterVariant[] = [
  { id: '6.5', label: '6,5 pulgadas', concept: 'Aros adaptadores 3D 6,5 pulgadas', currency: 'ARS', unitPrice: '25.000' },
  { id: '8', label: '8 pulgadas', concept: 'Aros adaptadores 3D 8 pulgadas', currency: 'ARS', unitPrice: '35.000' },
]

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
  { id: 'harness', section: 'extras', label: 'Ficha bypass estéreo' },
  { id: 'adapters', section: 'extras', label: 'Aros adaptadores 3D' },
  { id: 'labor', section: 'extras', label: 'Mano de obra de instalación' },
]

const legacyExtraConcepts: Partial<Record<AudioCategory, string>> = {
  cables: 'Cables y accesorios',
  harness: 'Ficha / arnés',
  adapters: 'Aros / adaptadores 3D',
  labor: 'Mano de obra',
}

export function getAudioCategories(section: RowSection): readonly AudioCategoryDefinition[] {
  return AUDIO_CATEGORIES.filter((category) => category.section === section)
}

export function readAudioCategory(value: unknown, section: RowSection): AudioCategory | undefined {
  return AUDIO_CATEGORIES.find((category) => category.id === value && category.section === section)?.id
}

export function getDirectExtraConcept(audioCategory?: AudioCategory): string | undefined {
  return AUDIO_CATEGORIES.find((category) => category.section === 'extras' && category.id === audioCategory)?.label
}

export function getAdapterVariant(concept: string): AdapterVariant | undefined {
  return ADAPTER_VARIANTS.find((variant) => variant.concept === concept)
}

export function selectAdapterVariant(row: QuotationRow, size: AdapterSize): QuotationRow {
  if (row.section !== 'extras' || row.audioCategory !== 'adapters' || row.provenance !== undefined) {
    throw new Error('La medida s\u00f3lo se puede elegir para aros adaptadores manuales.')
  }
  const variant = ADAPTER_VARIANTS.find((candidate) => candidate.id === size)
  if (!variant) throw new RangeError('Eleg\u00ed una medida de aros adaptadores v\u00e1lida.')
  const { currencyConversionOrigin: _origin, ...fields } = row
  return { ...fields, concept: variant.concept, currency: variant.currency, unitPrice: variant.unitPrice, priceState: 'priced' }
}

export function isDirectExtraRow(row: QuotationRow): boolean {
  if (row.section !== 'extras' || row.provenance !== undefined) return false
  const category = readAudioCategory(row.audioCategory, 'extras')
  if (category === undefined) return false
  if (row.adapterVariant !== undefined) {
    const metadata = readAdapterVariant(row.adapterVariant, row.section, category)
    if (!metadata || metadata.presentation !== 'unit' || (metadata.size !== '6,5' && metadata.size !== '8')) return false
    const variant = getAdapterVariant(row.concept)
    if (variant && metadata.size !== variant.id.replace('.', ',')) return false
  }
  const concept = getDirectExtraConcept(category)
  return concept !== undefined && (row.concept === concept || row.concept === legacyExtraConcepts[category]
    || (category === 'adapters' && getAdapterVariant(row.concept) !== undefined))
}

export function isSingleRowCategory(category: AudioCategory | undefined): boolean {
  return category === 'cables' || category === 'labor'
}

export function hasRepeatCategoryAction(category: AudioCategory): boolean {
  return !isSingleRowCategory(category) && category !== 'harness'
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
