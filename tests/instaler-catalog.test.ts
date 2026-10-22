import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildInstalerCatalogCandidate, parseInstalerCatalogPolicy,
  type InstalerCatalogPolicy,
} from '../src/server/instaler-catalog.ts'
import { compareObservations, type ObservationSnapshot, type ObservationTable } from '../src/server/instaler-observation.ts'
import type { CatalogImportDocument } from '../src/features/quotation/catalog.ts'
import { mergeSharedCatalog } from '../src/features/quotation/shared-catalog.ts'
import { getCatalogSelectionStatus } from '../src/features/quotation/catalog-stock.ts'

function snapshot(rows: ObservationTable['rows'] = [
  { row: 2, values: ['SYN-A', 'Synthetic speaker', '123.45', '12.75', 'Speakers'] },
]): ObservationSnapshot {
  return {
    readAt: '2026-10-22T12:00:00.000Z', modifiedTime: '2026-10-21T12:00:00.000Z',
    table: {
      source: { document: 'synthetic-supplier.xlsx', version: 'synthetic', checksum: 'a'.repeat(64) },
      headerRow: 1, headers: ['SKU', 'DESCRIPCION', 'PRECIO', 'STOCK', 'CATEGORIA'], rows,
    },
  }
}

function policy(overrides: Partial<InstalerCatalogPolicy> = {}): InstalerCatalogPolicy {
  return {
    format: 'luquisound.instaler-catalog-policy', version: 1,
    names: [], exclusions: [], allowIdenticalDuplicates: false, ...overrides,
  }
}

function empty(): CatalogImportDocument { return { format: 'luquisound.catalog', version: 1, items: [] } }

test('candidate preserves ARS retail amounts, exact decimals and unknown supplier freshness without input mutations', () => {
  const input = snapshot()
  const before = structuredClone(input)
  const result = buildInstalerCatalogCandidate(input, empty())
  assert.deepEqual(input, before)
  assert.equal(result.changed, true)
  assert.deepEqual(result.document.refreshSuppliers, ['Instaler'])
  assert.deepEqual(result.document.instalerObservation, {
    readAt: input.readAt, checksum: input.table.source.checksum, supplierFreshnessEstablished: false,
  })
  const item = result.document.items[0]
  assert.equal(item.listPrice?.amount, '123.45')
  assert.equal(item.listPrice?.currency, 'ARS')
  assert.equal(item.listPrice?.basis, 'retail-list-before-discount')
  assert.equal(item.stock?.quantity, 12.75)
  assert.equal(item.stock?.observation, 'historical')
  assert.equal(item.stock?.checkedAt, null)
  assert.equal(item.stock?.validUntil, null)
  assert.equal(item.source?.date, null)
  assert.equal(item.source?.readAt, input.readAt)
  assert.equal(item.listPrice?.source.readAt, input.readAt)
  assert.equal(item.stock?.source.readAt, input.readAt)
  assert.equal(item.selectionBlock, undefined)
})

test('same reading is a semantic no-op despite source row changes, while a later reading renews transport evidence', () => {
  const current = buildInstalerCatalogCandidate(snapshot(), empty()).document
  const input = snapshot([{ row: 20, values: ['SYN-A', 'Synthetic speaker', '123.450', '12.750', 'Speakers'] }])
  // The price preparer accepts trailing zeros, without changing its safe cents contract.
  input.table.rows[0].values[2] = '123.45'
  const result = buildInstalerCatalogCandidate(input, current)
  assert.equal(result.changed, false)
  assert.equal(result.document, current)
  assert.equal(result.document.instalerObservation?.readAt, '2026-10-22T12:00:00.000Z')
  assert.equal(result.document.items[0].source?.row, 2)
  input.readAt = '2026-10-23T12:00:00.000Z'
  input.table.source.checksum = 'b'.repeat(64)
  input.table.source.version = 'later-download'
  const renewed = buildInstalerCatalogCandidate(input, current)
  assert.equal(renewed.changed, true)
  assert.equal(renewed.document.items[0].stock?.checkedAt, null)
  assert.equal(renewed.document.items[0].stock?.source.readAt, input.readAt)
  assert.equal(renewed.document.items[0].source?.date, null)
  const legacy = { ...current, refreshSuppliers: undefined }
  assert.equal(buildInstalerCatalogCandidate(input, legacy).changed, true)
})

test('only an exact private source-text correspondence resolves mixed names and adds reviewed presentation', () => {
  const sourceText = 'Synthetic model | Inputs two channels | Outputs four channels'
  const input = snapshot([{ row: 2, values: ['SYN-A', sourceText, 10, 2, 'DSP'] }])
  const withoutPolicy = buildInstalerCatalogCandidate(input, empty())
  assert.equal(withoutPolicy.document.items[0].name, 'SYN-A')
  assert.equal(withoutPolicy.summary.unresolvedNames, 1)
  assert.ok(withoutPolicy.document.items[0].selectionBlock)
  const approved = policy({ names: [{ sku: ' syn-a ', sourceText, name: 'Synthetic model four channels', unit: 'unit', presentation: 'single unit' }] })
  const resolved = buildInstalerCatalogCandidate(input, empty(), approved)
  assert.equal(resolved.document.items[0].name, 'Synthetic model four channels')
  assert.equal(resolved.document.items[0].presentation, 'single unit')
  assert.equal(resolved.document.items[0].selectionBlock, undefined)
  assert.equal(resolved.summary.unresolvedNames, 0)
  input.table.rows[0].values[1] = 'Synthetic model changed'
  const changed = buildInstalerCatalogCandidate(input, resolved.document, approved)
  assert.ok(changed.document.items[0].selectionBlock)
  assert.equal(changed.summary.unresolvedNames, 1)
  assert.equal(changed.changed, true)
})

test('mappings never clear invalid price, invalid stock or discontinuation blocks', () => {
  for (const [price, stock, category] of [[null, 2, 'DSP'], [10, '#REF!', 'DSP'], [10, 2, 'DISCONTINUADOS']]) {
    const sourceText = 'Synthetic model | Specifications'
    const result = buildInstalerCatalogCandidate(snapshot([
      { row: 2, values: ['SYN-A', sourceText, price, stock, category] },
    ]), empty(), policy({ names: [{ sku: 'SYN-A', sourceText, name: 'Reviewed synthetic model' }] }))
    assert.ok(result.document.items[0].selectionBlock)
  }
})

test('identical duplicates require an explicit policy and preserve all evidence without summing stock', () => {
  const input = snapshot([
    { row: 2, values: ['SYN-A', 'Synthetic speaker', 10, 2, 'Speakers'], unit: 'unit' },
    { row: 9, values: ['SYN-A', 'Synthetic speaker', 10, 2, 'Speakers'], unit: 'unit' },
  ])
  const blocked = buildInstalerCatalogCandidate(input, empty())
  assert.ok(blocked.document.items[0].selectionBlock)
  assert.equal(blocked.document.items[0].listPrice, undefined)
  assert.equal(blocked.document.items[0].stock?.quantity, null)
  const resolved = buildInstalerCatalogCandidate(input, empty(), policy({ allowIdenticalDuplicates: true }))
  assert.equal(resolved.document.items[0].selectionBlock, undefined)
  assert.equal(resolved.document.items[0].stock?.quantity, 2)
  assert.equal(resolved.document.items[0].listPrice?.amount, '10')
  assert.deepEqual(resolved.evidence.duplicates, [{ sku: 'SYN-A', rows: [2, 9], resolution: 'identical' }])
  assert.equal(resolved.summary.resolvedDuplicateGroups, 1)
  input.table.rows[1].presentation = 'pair'
  assert.ok(buildInstalerCatalogCandidate(input, empty(), policy({ allowIdenticalDuplicates: true })).document.items[0].selectionBlock)
})

test('conflicting duplicate transitions are evaluated even when the observer commercial deltas are unchanged', () => {
  const previous = snapshot()
  const current = buildInstalerCatalogCandidate(previous, empty()).document
  const next = snapshot([
    ...previous.table.rows,
    { row: 3, values: ['SYN-A', 'Synthetic different model', 999, 999, 'Speakers'] },
  ])
  const observation = compareObservations(next, previous)
  assert.equal(observation.summary.priceChanges + observation.summary.stockChanges + observation.summary.otherChanged
    + observation.summary.additions + observation.summary.absent, 0)
  const result = buildInstalerCatalogCandidate(next, current, policy({ allowIdenticalDuplicates: true }))
  assert.equal(result.changed, true)
  assert.equal(result.document.items[0].name, current.items[0].name)
  assert.equal(result.document.items[0].listPrice, undefined)
  assert.equal(result.document.items[0].stock?.quantity, null)
  assert.deepEqual(result.evidence.duplicates[0].rows, [2, 3])
})

test('duplicate rows in a discontinued section cannot be enabled through the identical-duplicate rule', () => {
  const input = snapshot([
    { row: 2, values: ['SYN-A', 'Synthetic speaker', 10, 2, 'Speakers'] },
    { row: 3, values: ['', 'DISCONTINUADOS', '', '', ''] },
    { row: 4, values: ['SYN-A', 'Synthetic speaker', 10, 2, 'Speakers'] },
  ])
  const result = buildInstalerCatalogCandidate(input, empty(), policy({ allowIdenticalDuplicates: true }))
  assert.ok(result.document.items[0].selectionBlock)
})

test('reviewed duplicate resolution requires the exact source-text multiset and equal price, stock, unit and presentation', () => {
  const input = snapshot([
    { row: 2, values: ['SYN-A', 'Synthetic first supplier wording', '123.45', '2.75', 'Speakers'], unit: 'pair', presentation: 'one pair' },
    { row: 3, values: ['SYN-A', 'Synthetic second supplier wording', '123.45', '2.75', 'Speakers'], unit: 'pair', presentation: 'one pair' },
  ])
  const rules = policy({ allowIdenticalDuplicates: true, duplicates: [{
    sku: 'SYN-A', sourceTexts: ['Synthetic second supplier wording', 'Synthetic first supplier wording'],
    name: 'Synthetic reviewed same model',
  }] })
  const result = buildInstalerCatalogCandidate(input, empty(), rules)
  const item = result.document.items[0]
  assert.equal(item.name, 'Synthetic reviewed same model')
  assert.equal(item.listPrice?.amount, '123.45')
  assert.equal(item.stock?.quantity, 2.75)
  assert.equal(item.unit, 'pair')
  assert.equal(item.presentation, 'one pair')
  assert.equal(item.selectionBlock, undefined)
  assert.equal(result.evidence.duplicates[0].resolution, 'reviewed')
  for (const mutate of [
    (row: ObservationTable['rows'][number]) => { row.values[1] = 'Synthetic changed wording' },
    (row: ObservationTable['rows'][number]) => { row.values[2] = '999' },
    (row: ObservationTable['rows'][number]) => { row.values[3] = '999' },
    (row: ObservationTable['rows'][number]) => { row.unit = 'unit' },
    (row: ObservationTable['rows'][number]) => { row.presentation = 'single unit' },
  ]) {
    const changed = structuredClone(input)
    mutate(changed.table.rows[1])
    const blocked = buildInstalerCatalogCandidate(changed, result.document, rules)
    assert.ok(blocked.document.items[0].selectionBlock)
    assert.equal(blocked.document.items[0].listPrice, undefined)
    assert.equal(blocked.document.items[0].stock?.quantity, null)
  }
  const single = { ...input, table: { ...input.table, rows: input.table.rows.slice(0, 1) } }
  assert.ok(buildInstalerCatalogCandidate(single, result.document, rules).document.items[0].selectionBlock)
})

test('a category conflict in a reviewed duplicate remains blocked without an approved category', () => {
  const input = snapshot([
    { row: 2, values: ['SYN-A', 'Synthetic first supplier wording', 10, 2, 'Speakers'] },
    { row: 3, values: ['SYN-A', 'Synthetic second supplier wording', 10, 2, 'Components'] },
  ])
  const resolution = { sku: 'SYN-A', sourceTexts: input.table.rows.map((row) => row.values[1] as string), name: 'Synthetic reviewed model' }
  const blocked = buildInstalerCatalogCandidate(input, empty(), policy({ duplicates: [resolution] }))
  assert.ok(blocked.document.items[0].selectionBlock)
  const approved = buildInstalerCatalogCandidate(input, empty(), policy({ duplicates: [{ ...resolution, category: 'Reviewed speakers' }] }))
  assert.equal(approved.document.items[0].category, 'Reviewed speakers')
  assert.equal(approved.document.items[0].selectionBlock, undefined)
})

test('a discontinued marker may retain a residual category but never an amount or stock observation', () => {
  const input = snapshot([
    ...snapshot().table.rows,
    { row: 3, values: ['', 'DISCONTINUADOS', null, null, 'Synthetic residual category'] },
    { row: 4, values: ['SYN-D', 'Synthetic discontinued model', 10, 2, 'Speakers'] },
  ])
  const result = buildInstalerCatalogCandidate(input, empty())
  assert.ok(result.document.items.find((item) => item.sku === 'SYN-D')?.selectionBlock)
  for (const column of [2, 3]) {
    const changed = structuredClone(input)
    changed.table.rows[1].values[column] = 1
    assert.throws(() => buildInstalerCatalogCandidate(changed, empty()))
  }
})

test('missing, zero, negative and decimal stock remain distinct and zero price is explicit', () => {
  const input = snapshot([
    { row: 2, values: ['SYN-Z', 'Synthetic zero price', 0, 2, ''] },
    { row: 3, values: ['SYN-M', 'Synthetic missing', null, null, ''] },
    { row: 4, values: ['SYN-N', 'Synthetic negative', -1, -0.25, ''] },
    { row: 5, values: ['SYN-S', 'Synthetic zero stock', 10, 0, ''] },
    { row: 6, values: ['SYN-D', 'Synthetic decimal stock', 10, 1.5, ''] },
  ])
  const result = buildInstalerCatalogCandidate(input, empty())
  const bySku = new Map(result.document.items.map((item) => [item.sku, item]))
  assert.equal(bySku.get('SYN-Z')?.listPrice?.amount, '0')
  assert.equal(bySku.get('SYN-M')?.stock?.quantity, null)
  assert.equal(bySku.get('SYN-M')?.listPrice, undefined)
  assert.equal(bySku.get('SYN-N')?.stock?.quantity, -0.25)
  assert.equal(bySku.get('SYN-S')?.stock?.quantity, 0)
  assert.equal(bySku.get('SYN-D')?.stock?.quantity, 1.5)
  const entries = mergeSharedCatalog([], result.document)
  const enabled = entries.filter((entry) => getCatalogSelectionStatus(entry, Date.parse(input.readAt)).selectable).map((entry) => entry.sku).sort()
  assert.deepEqual(enabled, ['SYN-D', 'SYN-Z'])
})

test('absences retain blocked identities with unknown stock and historical price instead of reactivating old availability', () => {
  const current = buildInstalerCatalogCandidate(snapshot(), empty()).document
  const input = snapshot([{ row: 2, values: ['SYN-B', 'Synthetic replacement', 20, 3, 'Speakers'] }])
  const before = structuredClone(current)
  const result = buildInstalerCatalogCandidate(input, current)
  const absent = result.document.items.find((item) => item.sku === 'SYN-A')!
  assert.deepEqual(current, before)
  assert.equal(result.summary.absent, 1)
  assert.equal(absent.name, 'Synthetic speaker')
  assert.equal(absent.listPrice, undefined)
  assert.equal(absent.referencePrices.at(-1)?.amount, '123.45')
  assert.equal(absent.stock?.quantity, null)
  assert.match(absent.selectionBlock!, /ausente/)
  const repeated = buildInstalerCatalogCandidate(input, result.document)
  assert.equal(repeated.changed, false)
  const returning = buildInstalerCatalogCandidate(snapshot(), result.document)
  const returned = returning.document.items.find((item) => item.sku === 'SYN-A')!
  assert.equal(returned.selectionBlock, undefined)
  assert.equal(returned.listPrice?.amount, '123.45')
  assert.equal(returned.stock?.quantity, 12.75)
})

test('other providers and manually maintained descriptions and presentations survive publication', () => {
  const current = buildInstalerCatalogCandidate(snapshot(), empty()).document
  current.items[0].description = 'Synthetic manual instructions'
  current.items[0].unit = 'unit'
  current.items[0].presentation = 'single unit'
  const other = { ...structuredClone(current.items[0]), supplier: 'Synthetic other supplier', sku: 'OTHER-A' }
  current.items.push(other)
  const next = snapshot()
  next.table.rows[0].values[2] = 456
  const result = buildInstalerCatalogCandidate(next, current)
  assert.deepEqual(result.document.items.find((item) => item.supplier === other.supplier), other)
  assert.equal(result.document.items[0].description, 'Synthetic manual instructions')
  assert.equal(result.document.items[0].presentation, 'single unit')
})

test('private exclusions require the exact source text and keep existing excluded identities blocked', () => {
  const input = snapshot([
    { row: 2, values: ['SYN-A', 'Synthetic speaker', 10, 2, 'Speakers'] },
    { row: 3, values: ['12345', 'Synthetic date marker', null, null, ''] },
  ])
  const current = buildInstalerCatalogCandidate(input, empty()).document
  const rules = policy({ exclusions: [{ sku: '12345', sourceText: 'Synthetic date marker' }] })
  const result = buildInstalerCatalogCandidate(input, current, rules)
  assert.equal(result.summary.excluded, 1)
  assert.deepEqual(result.evidence.excludedRows, [3])
  assert.match(result.document.items.find((item) => item.sku === '12345')!.selectionBlock!, /excluido/)
  input.table.rows[1].values[1] = 'Synthetic different record'
  assert.equal(buildInstalerCatalogCandidate(input, empty(), rules).summary.excluded, 0)
})

test('reviewed non-product rows without identities require an exact full A:E fingerprint', () => {
  const values = [' ', 'Synthetic explanatory price heading', null, 'not stock', '']
  const input = snapshot([
    ...snapshot().table.rows,
    { row: 3, values },
  ])
  assert.throws(() => buildInstalerCatalogCandidate(input, empty()))
  const rules = policy({ ignoredRows: [{ values }] })
  const result = buildInstalerCatalogCandidate(input, empty(), rules)
  assert.deepEqual(result.evidence.ignoredRows, [3])
  assert.equal(result.document.items.length, 1)
  input.table.rows[1].row = 9
  assert.deepEqual(buildInstalerCatalogCandidate(input, empty(), rules).evidence.ignoredRows, [9])
  input.table.rows[1].values = [' ', 'Synthetic explanatory price heading changed', null, 'not stock', '']
  assert.throws(() => buildInstalerCatalogCandidate(input, empty(), rules))
  assert.throws(() => parseInstalerCatalogPolicy(policy({ ignoredRows: [{ values: ['SYN-A', 'Synthetic', 1, 2, ''] }] })))
  assert.throws(() => parseInstalerCatalogPolicy(policy({ ignoredRows: [{ values: ['', 'DISCONTINUADOS', '', '', ''] }] })))
})

test('structural and identity drift, duplicate current identities and invalid policies fail without a candidate', () => {
  for (const rows of [
    [{ row: 2, values: ['SYN-A', 'Synthetic', 10, 2, ''] }, { row: 3, values: ['', 'Synthetic unkeyed product', 10, 2, ''] }],
    [{ row: 2, values: ['SYN-A', 'Synthetic', 10, 2, ''] }, { row: 3, values: ['#REF!', 'Synthetic invalid identity', 10, 2, ''] }],
  ]) assert.throws(() => buildInstalerCatalogCandidate(snapshot(rows), empty()))
  const current = buildInstalerCatalogCandidate(snapshot(), empty()).document
  current.items.push(structuredClone(current.items[0]))
  assert.throws(() => buildInstalerCatalogCandidate(snapshot(), current))
  for (const rules of [null, {}, policy({ names: [
    { sku: 'SYN-A', sourceText: 'Synthetic', name: 'First' },
    { sku: 'syn-a', sourceText: 'Synthetic', name: 'Second' },
  ] }), policy({ names: [{ sku: 'SYN-A', sourceText: 'Synthetic', name: 'X'.repeat(501) }] }),
  policy({ names: [{ sku: 'SYN-A', sourceText: 'Synthetic', name: 'Synthetic' }], exclusions: [{ sku: 'SYN-A', sourceText: 'Synthetic' }] })]) {
    assert.throws(() => parseInstalerCatalogPolicy(rules))
  }
})

test('the complete candidate respects both the item limit and the protected response byte limit', () => {
  const current = buildInstalerCatalogCandidate(snapshot(), empty()).document
  const template = current.items[0]
  current.items = Array.from({ length: 2000 }, (_, index) => ({ ...structuredClone(template), sku: `OLD-${index}` }))
  assert.throws(() => buildInstalerCatalogCandidate(snapshot(), current))
  const large = buildInstalerCatalogCandidate(snapshot(), empty()).document
  large.items = Array.from({ length: 1700 }, (_, index) => ({
    ...structuredClone(template), supplier: 'Synthetic other supplier', sku: `OTHER-${index}`, description: '界'.repeat(2000),
  }))
  assert.throws(() => buildInstalerCatalogCandidate(snapshot(), large))
})
