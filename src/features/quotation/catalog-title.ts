import type { CatalogItem } from './model.ts'

export function getCatalogQuotationTitle(item: Pick<CatalogItem, 'concept' | 'sku' | 'supplier'>): string {
  const sku = item.sku?.trim()
  if (!sku || item.supplier?.trim().toLowerCase() !== 'instaler') return item.concept

  const escaped = sku.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Match a complete code, preserving longer model names and code continuations.
  const continuation = '\\p{L}\\p{N}\\p{M}_./+\\-'
  const code = new RegExp(
    `\\(\\s*${escaped}\\s*\\)|\\[\\s*${escaped}\\s*\\]|\\{\\s*${escaped}\\s*\\}`
    + `|(^|[^${continuation}])${escaped}(?=$|[^${continuation}])`,
    'giu',
  )
  const stripped = item.concept.replace(code, (_match, prefix: string | undefined) => `${prefix ?? ''} `)
  if (stripped === item.concept) return item.concept

  const title = stripped.replace(/\s+/g, ' ').trim()
    .replace(/^[-\u2013\u2014|:;,]+\s*|\s*[-\u2013\u2014|:;,]+$/g, '').trim()
  return /[\p{L}\p{N}]/u.test(title) ? title : item.concept
}
