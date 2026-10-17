import { queryCatalog } from './catalog.ts'
import type { CatalogItem } from './model.ts'

export type CatalogSelectionPredicate = (item: CatalogItem) => boolean
export type CatalogQueryStatus = 'matched' | 'ambiguous' | 'unmatched' | 'blocked'

export interface CatalogQueryResolution {
  status: CatalogQueryStatus
  matchKind: 'sku' | 'name' | 'search' | null
  candidates: CatalogItem[]
  blockedCandidates: CatalogItem[]
  manualAllowed: boolean
}

/** Preserve identifier punctuation while accepting case, accents and surrounding spaces. */
export function normalizeCatalogQuery(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').trim().replace(/\s+/g, ' ').toLowerCase()
}

export function queryCatalogRanked(
  items: readonly CatalogItem[], query: string, selectedCategory?: string,
): CatalogItem[] {
  const results = queryCatalog(items, query, selectedCategory)
  const normalized = normalizeCatalogQuery(query)
  if (!normalized) return results
  // A stable sort keeps the existing section and catalogue order within each group.
  return results.sort((left, right) => (
    Number(normalizeCatalogQuery(right.sku ?? '') === normalized)
    - Number(normalizeCatalogQuery(left.sku ?? '') === normalized)
  ))
}

export function resolveCatalogQuery(
  items: readonly CatalogItem[], query: string, canSelect: CatalogSelectionPredicate,
): CatalogQueryResolution {
  if (typeof canSelect !== 'function') throw new TypeError('No se pudo verificar la disponibilidad del catálogo.')
  const normalized = normalizeCatalogQuery(query)
  if (!normalized) {
    return { status: 'unmatched', matchKind: null, candidates: [], blockedCandidates: [], manualAllowed: true }
  }
  const exactSku = items.filter((item) => normalizeCatalogQuery(item.sku ?? '') === normalized)
  const exactName = exactSku.length ? [] : items.filter((item) => normalizeCatalogQuery(item.concept) === normalized)
  const matches = exactSku.length ? exactSku : exactName.length ? exactName : queryCatalogRanked(items, query)
  const matchKind = exactSku.length ? 'sku' : exactName.length ? 'name' : matches.length ? 'search' : null
  const candidates: CatalogItem[] = []
  const blockedCandidates: CatalogItem[] = []
  for (const item of matches) (canSelect(item) ? candidates : blockedCandidates).push(item)
  const exact = matchKind === 'sku' || matchKind === 'name'
  const status = matches.length === 0 ? 'unmatched'
    : candidates.length === 0 ? 'blocked'
      : exact && matches.length === 1 ? 'matched' : 'ambiguous'
  return {
    status, matchKind, candidates, blockedCandidates,
    // An exact blocked item must not turn into an unannounced manual stock override.
    manualAllowed: !(exact && blockedCandidates.length > 0),
  }
}
