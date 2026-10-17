import assert from 'node:assert/strict'
import test from 'node:test'
import {
  normalizeCatalogQuery, queryCatalogRanked, resolveCatalogQuery,
} from '../src/features/quotation/catalog-search.ts'
import type { CatalogItem } from '../src/features/quotation/model.ts'

function item(id: string, changes: Partial<CatalogItem> = {}): CatalogItem {
  return {
    id, concept: `Synthetic product ${id}`, detail: '', section: 'equipment',
    currency: 'ARS', unitPrice: '', supplier: 'Synthetic Supplier', sku: `SYN-${id}`,
    brand: 'Synthetic Brand', category: 'Audio', ...changes,
  }
}

function ids(items: readonly CatalogItem[]): string[] {
  return items.map((entry) => entry.id)
}

const allowAll = (_item: CatalogItem): boolean => true

test('the selection predicate is mandatory and missing runtime arguments fail closed', () => {
  assert.throws(() => {
    // @ts-expect-error Callers must explicitly supply the eligibility predicate.
    resolveCatalogQuery([], 'SYN-001')
  }, /disponibilidad/)
})

test('normalization ignores case and accents while preserving punctuation', () => {
  assert.equal(normalizeCatalogQuery('M\u00d3DULO'), normalizeCatalogQuery('modulo'))
  assert.equal(normalizeCatalogQuery('conexio\u0301n'), normalizeCatalogQuery('CONEXION'))
  assert.notEqual(normalizeCatalogQuery('A-B'), normalizeCatalogQuery('AB'))
  assert.notEqual(normalizeCatalogQuery('A/B'), normalizeCatalogQuery('AB'))
  assert.equal(normalizeCatalogQuery('A-B/C.2'), 'a-b/c.2')
})

test('an exact SKU ranks ahead of more than twenty partial search results', () => {
  const partials = Array.from({ length: 24 }, (_, index) => item(`partial-${index}`, {
    detail: 'Compatible with CODE-7',
  }))
  const exact = item('exact', { sku: 'CODE-7' })
  const results = queryCatalogRanked([...partials, exact], 'code-7')
  assert.equal(results.length, 25)
  assert.equal(results[0], exact)
  assert.deepEqual(ids(results.slice(1)), ids(partials))
})

test('ranking preserves all exact SKU duplicates before partial results', () => {
  const partial = item('partial', { detail: 'CODE-7 replacement' })
  const first = item('first', { sku: 'CODE-7', supplier: 'Synthetic Supplier A' })
  const second = item('second', { sku: 'code-7', supplier: 'Synthetic Supplier B' })
  assert.deepEqual(ids(queryCatalogRanked([partial, first, second], 'CODE-7')), [
    'first', 'second', 'partial',
  ])
})

test('ranked search intersects category and accent-insensitive search terms', () => {
  const matching = item('matching', {
    concept: 'M\u00f3dulo de conexi\u00f3n', detail: 'Synthetic rear installation', category: 'Parlantes',
  })
  const wrongCategory = item('wrong-category', { concept: matching.concept, category: 'Cables' })
  const wrongTerm = item('wrong-term', { concept: 'Synthetic speaker', category: 'Parlantes' })
  assert.deepEqual(queryCatalogRanked(
    [wrongCategory, matching, wrongTerm], 'MODULO conexion rear', 'category:parlantes',
  ), [matching])
  assert.deepEqual(queryCatalogRanked([matching, wrongCategory], '', 'category:parlantes'), [matching])
})

test('an exact SKU outside the selected category does not escape its filter', () => {
  const excludedExact = item('excluded', { sku: 'CODE-7', category: 'Cables' })
  const includedPartial = item('included', { detail: 'CODE-7 replacement', category: 'Parlantes' })
  assert.deepEqual(queryCatalogRanked(
    [excludedExact, includedPartial], 'CODE-7', 'category:parlantes',
  ), [includedPartial])
})

test('ranked search preserves punctuation and AND semantics across search fields', () => {
  const punctuated = item('punctuated', { sku: 'A-B', brand: 'Synthetic Beta' })
  const compact = item('compact', { sku: 'AB', brand: 'Synthetic Beta' })
  const wrongBrand = item('wrong-brand', { sku: 'A-B-2', brand: 'Synthetic Gamma' })
  assert.deepEqual(queryCatalogRanked([punctuated, compact, wrongBrand], 'a-b beta'), [punctuated])
})

test('search and resolution neither mutate frozen catalogues nor copy their entries', () => {
  const partial = Object.freeze(item('partial', { detail: 'CODE-7 replacement' }))
  const exact = Object.freeze(item('exact', { sku: 'CODE-7' }))
  const catalogue = Object.freeze([partial, exact])
  const before = structuredClone(catalogue)
  const results = queryCatalogRanked(catalogue, 'CODE-7')
  const resolved = resolveCatalogQuery(catalogue, 'CODE-7', allowAll)
  assert.equal(results[0], exact)
  assert.equal(resolved.candidates[0], exact)
  assert.deepEqual(catalogue, before)
  const unfiltered = queryCatalogRanked(catalogue, '')
  assert.notEqual(unfiltered, catalogue)
  assert.deepEqual(unfiltered, catalogue)
})

test('a unique exact SKU can be matched after normalizing case and accents', () => {
  const exact = item('exact', { sku: 'M\u00d3D-7' })
  const partial = item('partial', { sku: 'MOD-7-X', detail: 'Synthetic variant' })
  const result = resolveCatalogQuery([partial, exact], 'mod-7', allowAll)
  assert.equal(result.status, 'matched')
  assert.equal(result.matchKind, 'sku')
  assert.deepEqual(result.candidates, [exact])
  assert.deepEqual(result.blockedCandidates, [])
})

test('a unique exact product name can be matched without a SKU', () => {
  const exact = item('exact', { sku: '', concept: 'M\u00f3dulo Sint\u00e9tico' })
  const partial = item('partial', { concept: 'M\u00f3dulo Sint\u00e9tico Plus' })
  const result = resolveCatalogQuery([partial, exact], 'modulo sintetico', allowAll)
  assert.equal(result.status, 'matched')
  assert.equal(result.matchKind, 'name')
  assert.deepEqual(result.candidates, [exact])
  assert.deepEqual(result.blockedCandidates, [])
})

test('an exact SKU takes priority over another entry with the same exact name', () => {
  const byName = item('by-name', { concept: 'CODE-7' })
  const bySku = item('by-sku', { sku: 'CODE-7' })
  const result = resolveCatalogQuery([byName, bySku], 'CODE-7', allowAll)
  assert.equal(result.status, 'matched')
  assert.equal(result.matchKind, 'sku')
  assert.deepEqual(result.candidates, [bySku])
})

test('a unique partial result still requires an explicit choice', () => {
  const partial = item('partial', { concept: 'Synthetic component set' })
  const result = resolveCatalogQuery([partial], 'component', allowAll)
  assert.equal(result.status, 'ambiguous')
  assert.equal(result.matchKind, 'search')
  assert.deepEqual(result.candidates, [partial])
  assert.deepEqual(result.blockedCandidates, [])
})

test('multiple partial results remain choices rather than selecting the first entry', () => {
  const first = item('first', { concept: 'Synthetic component front' })
  const second = item('second', { concept: 'Synthetic component rear' })
  const result = resolveCatalogQuery([first, second], 'component', allowAll)
  assert.equal(result.status, 'ambiguous')
  assert.equal(result.matchKind, 'search')
  assert.deepEqual(result.candidates, [first, second])
})

test('duplicate exact SKUs across suppliers are ambiguous in the total catalogue', () => {
  const first = item('first', { sku: 'CODE-7', supplier: 'Synthetic Supplier A' })
  const second = item('second', { sku: 'code-7', supplier: 'Synthetic Supplier B' })
  const result = resolveCatalogQuery([first, second], 'CODE-7', allowAll)
  assert.equal(result.status, 'ambiguous')
  assert.equal(result.matchKind, 'sku')
  assert.deepEqual(result.candidates, [first, second])
  assert.deepEqual(result.blockedCandidates, [])
})

test('one eligible and one blocked exact SKU remain ambiguous across suppliers', () => {
  const eligible = item('eligible', { sku: 'CODE-7', supplier: 'Synthetic Supplier A' })
  const blocked = item('blocked', { sku: 'CODE-7', supplier: 'Synthetic Supplier B' })
  for (const catalogue of [[eligible, blocked], [blocked, eligible]]) {
    const result = resolveCatalogQuery(catalogue, 'CODE-7', (entry) => entry.id === eligible.id)
    assert.equal(result.status, 'ambiguous')
    assert.equal(result.matchKind, 'sku')
    assert.deepEqual(result.candidates, [eligible])
    assert.deepEqual(result.blockedCandidates, [blocked])
    assert.equal(result.manualAllowed, false)
  }
})

test('duplicate exact names cannot become unique after applying eligibility', () => {
  const eligible = item('eligible', { concept: 'Synthetic component', supplier: 'Synthetic Supplier A' })
  const blocked = item('blocked', { concept: 'SYNTHETIC COMPONENT', supplier: 'Synthetic Supplier B' })
  const result = resolveCatalogQuery([blocked, eligible], 'Synthetic component', (entry) => entry.id === eligible.id)
  assert.equal(result.status, 'ambiguous')
  assert.equal(result.matchKind, 'name')
  assert.deepEqual(result.candidates, [eligible])
  assert.deepEqual(result.blockedCandidates, [blocked])
  assert.equal(result.manualAllowed, false)
})

test('a blocked exact SKU never falls back to an eligible variant', () => {
  const exact = item('blocked', { sku: 'CODE-7' })
  const variant = item('variant', { sku: 'CODE-7-X' })
  const result = resolveCatalogQuery([variant, exact], 'CODE-7', (entry) => entry.id === variant.id)
  assert.equal(result.status, 'blocked')
  assert.equal(result.matchKind, 'sku')
  assert.deepEqual(result.candidates, [])
  assert.deepEqual(result.blockedCandidates, [exact])
  assert.equal(result.manualAllowed, false)
})

test('a blocked exact name never falls back to an eligible extended name', () => {
  const exact = item('blocked', { concept: 'Synthetic component' })
  const variant = item('variant', { concept: 'Synthetic component Plus' })
  const result = resolveCatalogQuery([variant, exact], 'Synthetic component', (entry) => entry.id === variant.id)
  assert.equal(result.status, 'blocked')
  assert.equal(result.matchKind, 'name')
  assert.deepEqual(result.candidates, [])
  assert.deepEqual(result.blockedCandidates, [exact])
  assert.equal(result.manualAllowed, false)
})

test('a blocked exact SKU does not fall back to an eligible exact name', () => {
  const exactSku = item('blocked', { sku: 'CODE-7' })
  const exactName = item('eligible', { concept: 'CODE-7' })
  const result = resolveCatalogQuery([exactName, exactSku], 'CODE-7', (entry) => entry.id === exactName.id)
  assert.equal(result.status, 'blocked')
  assert.equal(result.matchKind, 'sku')
  assert.deepEqual(result.candidates, [])
  assert.deepEqual(result.blockedCandidates, [exactSku])
  assert.equal(result.manualAllowed, false)
})

test('punctuation-distinct SKUs resolve independently without creating false duplicates', () => {
  const punctuated = item('punctuated', { sku: 'A-B' })
  const compact = item('compact', { sku: 'AB' })
  for (const [query, expected] of [['a-b', punctuated], ['ab', compact]] as const) {
    const result = resolveCatalogQuery([punctuated, compact], query, allowAll)
    assert.equal(result.status, 'matched')
    assert.equal(result.matchKind, 'sku')
    assert.deepEqual(result.candidates, [expected])
  }
})

test('partial decisions separate eligible and blocked results using the supplied predicate', () => {
  const eligible = item('eligible', { concept: 'Synthetic component front' })
  const blocked = item('blocked', { concept: 'Synthetic component rear' })
  const unrelated = item('unrelated', { concept: 'Synthetic connector' })
  const result = resolveCatalogQuery([blocked, unrelated, eligible], 'component', (entry) => entry.id === eligible.id)
  assert.equal(result.status, 'ambiguous')
  assert.equal(result.matchKind, 'search')
  assert.deepEqual(result.candidates, [eligible])
  assert.deepEqual(result.blockedCandidates, [blocked])
  assert.ok(!result.candidates.some((entry) => result.blockedCandidates.includes(entry)))
})

test('an unknown query permits a manual concept without selecting unrelated products', () => {
  const result = resolveCatalogQuery([item('unrelated')], 'unknown handwritten concept', allowAll)
  assert.equal(result.status, 'unmatched')
  assert.equal(result.matchKind, null)
  assert.deepEqual(result.candidates, [])
  assert.deepEqual(result.blockedCandidates, [])
  assert.equal(result.manualAllowed, true)
})

test('an empty catalogue permits an unknown manual concept', () => {
  assert.deepEqual(resolveCatalogQuery([], 'Synthetic manual concept', allowAll), {
    status: 'unmatched', matchKind: null, candidates: [], blockedCandidates: [], manualAllowed: true,
  })
})
