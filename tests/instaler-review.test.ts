import assert from 'node:assert/strict'
import test from 'node:test'
import type { CatalogImportDocument, CatalogImportItem } from '../src/features/quotation/catalog.ts'
import { compareInstalerSnapshot } from '../src/server/instaler-review.ts'
import type { InstalerSnapshotReview } from '../src/server/instaler-snapshot.ts'

const source = { document: 'synthetic-baseline.xlsx', sheet: 'Precios', row: 2, date: null, kind: 'snapshot' as const }

function item(sku: string, overrides: Partial<CatalogImportItem> = {}): CatalogImportItem {
  return {
    supplier: 'Instaler', sku, brand: '', name: 'Synthetic speaker', description: '', category: 'Speakers',
    section: 'equipment', referencePrices: [], source,
    listPrice: { amount: '12.50', currency: 'ARS', basis: 'retail-list-before-discount', provisional: true, source },
    stock: { quantity: 2.75, checkedAt: null, validUntil: null, observation: 'historical', source },
    availabilityPolicy: 'historical-positive', ...overrides,
  }
}

function catalogue(items: CatalogImportItem[]): CatalogImportDocument {
  return { format: 'luquisound.catalog', version: 1, items }
}

function review(items: CatalogImportItem[]): InstalerSnapshotReview {
  return {
    mode: 'snapshot-review', scope: 'precios-only', reviewRequired: true,
    source, items, issues: [], sections: [], nameReviews: [],
  }
}

test('partial comparisons identify additions and absences without creating a replacement or mutating inputs', () => {
  const current = catalogue([
    item('SYN-MATCH'), item('SYN-ABSENT'), item('SYN-OTHER', { supplier: 'Synthetic other supplier' }),
  ])
  const incoming = review([item('SYN-MATCH'), item('SYN-ADD')])
  const previous = structuredClone({ current, incoming })
  const result = compareInstalerSnapshot(incoming, current)
  assert.equal(result.mode, 'snapshot-comparison')
  assert.equal(result.reviewRequired, true)
  assert.equal(result.publicationAllowed, false)
  assert.deepEqual(result.coverage, { complete: false, kits: 'pending', units: 'pending' })
  assert.equal(result.summary.matched, 1)
  assert.equal(result.summary.unchanged, 1)
  assert.equal(result.summary.changed, 0)
  assert.equal(result.summary.additions, 1)
  assert.equal(result.summary.absentExisting, 1)
  assert.equal(result.summary.ignoredExisting, 1)
  assert.deepEqual(result.additions, [{ supplier: 'Instaler', sku: 'SYN-ADD', incomingIndex: 1 }])
  assert.deepEqual(result.absentExisting, [{ supplier: 'Instaler', sku: 'SYN-ABSENT', currentIndex: 1 }])
  assert.equal('replaceSourceDocuments' in result, false)
  assert.equal('removals' in result, false)
  assert.equal('items' in result, false)
  assert.deepEqual({ current, incoming }, previous)
})

test('source version and checksums are provenance-only changes rather than price or stock changes', () => {
  const existing = item('SYN-A')
  const nextSource = { ...source, checksum: 'a'.repeat(64), version: 'synthetic-new-version', row: 5 }
  const incoming = item('syn-a', {
    supplier: ' INSTALER ', source: nextSource,
    listPrice: { ...existing.listPrice!, amount: '12.5', source: nextSource },
    stock: { ...existing.stock!, source: nextSource },
  })
  const result = compareInstalerSnapshot(review([incoming]), catalogue([existing]))
  assert.equal(result.summary.matched, 1)
  assert.equal(result.summary.changed, 0)
  assert.equal(result.summary.unchanged, 1)
  assert.equal(result.summary.provenanceOnly, 1)
  assert.deepEqual(result.matches[0].changes, [])
  assert.equal(result.matches[0].provenanceChanged, true)
})

test('price, decimal stock, category and explicit sale units have separate before/after values without conversions', () => {
  const previous = item('SYN-A', { unit: 'meter', presentation: 'roll' })
  const incoming = item('SYN-A', {
    category: 'Synthetic cables', unit: 'pair', presentation: 'box',
    stock: { ...previous.stock!, quantity: 0.125 },
    listPrice: { ...previous.listPrice!, amount: '15.25', currency: 'USD' },
  })
  const result = compareInstalerSnapshot(review([incoming]), catalogue([previous]))
  assert.equal(result.summary.changed, 1)
  assert.deepEqual(result.matches[0].changes, [
    { field: 'category', before: 'Speakers', after: 'Synthetic cables' },
    { field: 'unit', before: 'meter', after: 'pair' },
    { field: 'presentation', before: 'roll', after: 'box' },
    { field: 'listPrice.amount', before: '12.50', after: '15.25' },
    { field: 'listPrice.currency', before: 'ARS', after: 'USD' },
    { field: 'stock.quantity', before: 2.75, after: 0.125 },
  ])
})

test('missing prices, explicit zero and unknown stock are reported without manufacturing zero values', () => {
  const zero = item('SYN-A', { listPrice: { ...item('SYN-A').listPrice!, amount: '0' }, stock: { ...item('SYN-A').stock!, quantity: 0 } })
  const unknown = item('SYN-A', { listPrice: undefined, stock: { ...zero.stock!, quantity: null } })
  const result = compareInstalerSnapshot(review([unknown]), catalogue([zero]))
  assert.deepEqual(result.matches[0].changes.filter(({ field }) => field === 'listPrice.amount' || field === 'stock.quantity'), [
    { field: 'listPrice.amount', before: '0', after: null },
    { field: 'stock.quantity', before: 0, after: null },
  ])
  assert.equal(result.summary.changed, 1)
})

test('contradictory existing keys do not select a winner or become additions or removals', () => {
  const previous = item('SYN-A')
  const current = catalogue([previous, item(' syn-a ', { listPrice: { ...previous.listPrice!, amount: '99' } })])
  const result = compareInstalerSnapshot(review([item('SYN-A')]), current)
  assert.equal(result.summary.duplicatesExisting, 1)
  assert.equal(result.summary.conflicts, 1)
  assert.equal(result.summary.matched, 0)
  assert.equal(result.summary.additions, 0)
  assert.equal(result.summary.absentExisting, 0)
  assert.deepEqual(result.conflicts, [{ supplier: 'Instaler', sku: 'SYN-A', side: 'current', reason: 'duplicate-key', indexes: [0, 1] }])
})

test('incoming duplicate keys and incomplete existing identities require review without arbitrary matching', () => {
  const result = compareInstalerSnapshot(review([item('SYN-A'), item('syn-a')]), catalogue([
    item('SYN-A'), item('', { supplier: '' }),
  ]))
  assert.equal(result.summary.duplicatesIncoming, 1)
  assert.equal(result.summary.missingKeysExisting, 1)
  assert.equal(result.summary.conflicts, 2)
  assert.equal(result.summary.matched, 0)
  assert.equal(result.summary.additions, 0)
  assert.equal(result.summary.absentExisting, 0)
  assert.deepEqual(result.conflicts.map(({ reason }) => reason), ['missing-key', 'duplicate-key'])
})

test('identities preserve accents, punctuation, leading zeros and supplier boundaries', () => {
  const result = compareInstalerSnapshot(review([item('SYN-A'), item('001')]), catalogue([
    item('SYN-\u00c1'), item('1'), item('SYN-A', { supplier: 'Synthetic other supplier' }),
  ]))
  assert.equal(result.summary.additions, 2)
  assert.equal(result.summary.matched, 0)
  assert.equal(result.summary.absentExisting, 2)
  assert.equal(result.summary.ignoredExisting, 1)
})

test('current local price fields are outside this source comparison and remain untouched', () => {
  const withManualPrice = { ...item('SYN-A'), id: 'synthetic-local-id', unitPrice: '777,25', currency: 'USD' }
  const baseline = catalogue([withManualPrice])
  const before = structuredClone(baseline)
  const result = compareInstalerSnapshot(review([item('SYN-A')]), baseline)
  assert.equal(result.summary.changed, 0)
  assert.equal(JSON.stringify(result).includes('777,25'), false)
  assert.equal(JSON.stringify(result).includes('synthetic-local-id'), false)
  assert.equal(JSON.stringify(result).includes('unitPrice'), false)
  assert.deepEqual(baseline, before)
})

test('a blank source description does not propose clearing a manually saved detail', () => {
  const baseline = catalogue([item('SYN-A', { description: 'Manual saved description' })])
  const before = structuredClone(baseline)
  const result = compareInstalerSnapshot(review([item('SYN-A', { description: '' })]), baseline)
  assert.deepEqual(result.matches[0].changes, [])
  assert.equal(result.summary.changed, 0)
  assert.equal(result.summary.unchanged, 1)
  assert.equal(result.matches[0].provenanceChanged, false)
  assert.deepEqual(baseline, before)
  assert.equal(baseline.items[0].description, 'Manual saved description')
})

test('malformed documents, foreign review scope and invalid numeric observations fail before comparison', () => {
  const valid = review([item('SYN-A')])
  for (const quantity of [Number.NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const invalid = item('SYN-A', { stock: { ...item('SYN-A').stock!, quantity } })
    assert.throws(() => compareInstalerSnapshot(review([invalid]), catalogue([])))
    assert.throws(() => compareInstalerSnapshot(valid, catalogue([invalid])))
  }
  assert.throws(() => compareInstalerSnapshot({ ...valid, scope: 'complete-workbook' } as unknown as InstalerSnapshotReview, catalogue([])))
  assert.throws(() => compareInstalerSnapshot(review([item('SYN-A', { supplier: 'Synthetic foreign supplier' })]), catalogue([])))
  assert.throws(() => compareInstalerSnapshot(valid, { ...catalogue([]), version: 2 } as unknown as CatalogImportDocument))
})
