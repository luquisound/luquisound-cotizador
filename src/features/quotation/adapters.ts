import { parseQuantity } from './calculation.ts'
import type { AudioCategory } from './audio-categories.ts'
import type { AdapterVariant, RowSection } from './model.ts'

export function normalizeAdapterSize(value: string): string | null {
  if (value.length > 64) return null
  const quantity = parseQuantity(value)
  if (!quantity.ok) return null
  const thousandths = BigInt(quantity.thousandths)
  const fraction = String(thousandths % 1000n).padStart(3, '0').replace(/0+$/, '')
  return `${thousandths / 1000n}${fraction ? `,${fraction}` : ''}`
}

export function readAdapterVariant(
  value: unknown, section: RowSection, category: AudioCategory | undefined,
): AdapterVariant | undefined {
  if (section !== 'extras' || category !== 'adapters'
    || typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const variant = value as Record<string, unknown>
  if (typeof variant.productKey !== 'string' || variant.productKey.length > 128
    || !/^[a-zA-Z0-9_-]+$/.test(variant.productKey)
    || typeof variant.size !== 'string'
    || (variant.presentation !== 'unit' && variant.presentation !== 'pair' && variant.presentation !== 'set')) {
    return undefined
  }
  const size = normalizeAdapterSize(variant.size)
  if (size === null) return undefined
  return { productKey: variant.productKey, size, presentation: variant.presentation }
}
