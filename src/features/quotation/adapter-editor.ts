import { readAdapterVariant } from './adapters.ts'
import { getAdapterVariant, selectAdapterVariant, type AdapterSize } from './audio-categories.ts'
import type { QuotationRow } from './model.ts'

export function getRowAdapterSize(row: QuotationRow): AdapterSize | '' {
  const variant = readAdapterVariant(row.adapterVariant, row.section, row.audioCategory)
  if (variant?.presentation === 'unit') {
    if (variant.size === '6,5') return '6.5'
    if (variant.size === '8') return '8'
  }
  return getAdapterVariant(row.concept)?.id ?? ''
}

export function selectDirectAdapterSize(row: QuotationRow, size: AdapterSize): QuotationRow {
  return {
    ...selectAdapterVariant(row, size),
    adapterVariant: {
      productKey: `direct-adapter-${size.replace('.', '_')}`,
      size: size.replace('.', ','),
      presentation: 'unit',
    },
  }
}
