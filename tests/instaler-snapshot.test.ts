import assert from 'node:assert/strict'
import test from 'node:test'
import { prepareInstalerSnapshot } from '../src/server/instaler-snapshot.ts'
import { getCatalogSelectionStatus } from '../src/features/quotation/catalog-stock.ts'
import { mergeSharedCatalog } from '../src/features/quotation/shared-catalog.ts'

function table(rows: unknown[] = [{ row: 2, values: ['SYN-A', 'Synthetic speaker', '123.45', '12.75', 'Speakers'] }]) {
  return {
    source: { document: 'synthetic-supplier.xlsx', version: 'synthetic-review', checksum: 'a'.repeat(64) },
    headerRow: 1,
    headers: ['SKU', 'DESCRIPCION', 'PRECIO', 'STOCK', 'CATEGORIA', 'Ignored column'],
    rows,
  }
}

test('snapshot preparation preserves the reviewed ARS list amount and decimal stock without discounts or VAT changes', () => {
  const input = table()
  const before = structuredClone(input)
  const review = prepareInstalerSnapshot(input)
  assert.deepEqual(input, before)
  assert.equal(review.mode, 'snapshot-review')
  assert.equal(review.scope, 'precios-only')
  assert.equal(review.reviewRequired, true)
  assert.equal('format' in review, false)
  assert.deepEqual(review.issues, [])
  const item = review.items[0]
  assert.deepEqual([item.supplier, item.sku, item.name, item.brand, item.category],
    ['Instaler', 'SYN-A', 'Synthetic speaker', '', 'Speakers'])
  assert.equal(item.listPrice?.amount, '123.45')
  assert.equal(item.listPrice?.currency, 'ARS')
  assert.equal(item.listPrice?.basis, 'retail-list-before-discount')
  assert.equal(item.listPrice?.provisional, true)
  assert.equal(item.stock?.quantity, 12.75)
  assert.equal(item.stock?.observation, 'historical')
  assert.equal(item.stock?.checkedAt, null)
  assert.equal(item.stock?.validUntil, null)
  assert.equal(item.source?.date, null)
  assert.equal(item.source?.kind, 'snapshot')
  assert.equal(item.source?.sheet, 'Precios')
  assert.equal(item.source?.row, 2)
  assert.deepEqual(item.referencePrices, [])
  assert.equal(item.availabilityPolicy, 'historical-positive')
  const maximumPrice = prepareInstalerSnapshot(table([
    { row: 2, values: ['SYN-MAX', 'Synthetic maximum cents', '90071992547409.91', 1, ''] },
  ]))
  assert.equal(maximumPrice.items[0].listPrice?.amount, '90071992547409.91')
  assert.deepEqual(maximumPrice.issues, [])
})

test('zero, missing and negative observations remain distinct and no download time becomes freshness', () => {
  const review = prepareInstalerSnapshot(table([
    { row: 2, values: ['SYN-Z', 'Zero', 0, 0, ''] },
    { row: 3, values: ['SYN-M', 'Missing', null, '', ''] },
    { row: 4, values: ['SYN-N', 'Negative', 12, '-0.25', ''] },
  ]))
  assert.equal(review.items[0].listPrice?.amount, '0')
  assert.equal(review.items[0].stock?.quantity, 0)
  assert.equal(review.items[1].listPrice, undefined)
  assert.equal(review.items[1].stock?.quantity, null)
  assert.equal(review.items[2].stock?.quantity, -0.25)
  assert.deepEqual(review.issues.map(({ code }) => code), ['missing-price', 'missing-stock'])
  const document = { format: 'luquisound.catalog' as const, version: 1 as const, items: review.items }
  const entries = mergeSharedCatalog([], document)
  assert.deepEqual(entries.map((entry) => getCatalogSelectionStatus(entry).selectable), [false, false, false])
  for (const item of review.items) assert.equal(item.stock?.checkedAt, null)
})

test('unformatted decimal strings roundtrip without truncation, invented precision or locale guessing', () => {
  for (const quantity of ['00012.7500', 0.0000001, '0.0000001', '-12.75']) {
    const review = prepareInstalerSnapshot(table([{ row: 2, values: ['SYN-A', 'Synthetic', 1, quantity, ''] }]))
    assert.equal(review.items[0].stock?.quantity, Number(quantity))
    assert.deepEqual(review.issues, [])
  }
  for (const quantity of ['1,5', '1.234,5', '1e3', '0.10000000000000001',
    '0.' + '0'.repeat(400) + '1', '9007199254740992', Number.MAX_SAFE_INTEGER + 1, true, Number.NaN, Infinity, '#REF!', '=A1']) {
    const review = prepareInstalerSnapshot(table([{ row: 2, values: ['SYN-A', 'Synthetic', 1, quantity, ''] }]))
    assert.equal(review.items[0].stock?.quantity, null)
    assert.equal(review.items[0].selectionBlock !== undefined, true)
    assert.equal(review.issues.some(({ code }) => code === 'invalid-stock'), true)
  }
})

test('prices with missing precision, formula errors, negatives or unsafe cents are quarantined rather than rounded', () => {
  for (const price of ['1.234', '12,34', '1e3', -1, '#N/A', '=IMPORTRANGE("synthetic", "A1")', Number.NaN, Infinity,
    '90071992547409.92']) {
    const review = prepareInstalerSnapshot(table([{ row: 2, values: ['SYN-A', 'Synthetic', price, 2, ''] }]))
    assert.equal(review.items[0].listPrice, undefined)
    assert.equal(review.items[0].selectionBlock !== undefined, true)
    assert.deepEqual(review.issues.map(({ code }) => code), ['invalid-price'])
  }
})

test('duplicate SKUs retain one explicitly blocked identity and every conflicting row reference', () => {
  const review = prepareInstalerSnapshot(table([
    { row: 2, values: ['SYN-A', 'Synthetic first', 10, 2, 'Speakers'] },
    { row: 4, values: [' syn-a ', 'Synthetic conflicting', 20, 3, 'Speakers'] },
  ]))
  assert.equal(review.items.length, 1)
  assert.equal(review.items[0].selectionBlock !== undefined, true)
  assert.deepEqual(review.issues, [
    { row: 2, code: 'duplicate-sku', relatedRows: [2, 4] },
  ])
  const distinct = prepareInstalerSnapshot(table([
    { row: 2, values: ['SYN-A', 'Synthetic first', 10, 2, ''] },
    { row: 3, values: ['SYN-Á', 'Synthetic distinct identity', 10, 2, ''] },
  ]))
  assert.equal(distinct.items.length, 2)
  assert.deepEqual(distinct.issues, [])
  const many = prepareInstalerSnapshot(table(Array.from({ length: 10000 }, (_, index) => ({
    row: index + 2, values: ['SYN-A', 'Synthetic repeated', 10, 2, ''],
  }))))
  assert.equal(many.issues.length, 1)
  assert.equal(many.issues[0].relatedRows?.length, 10000)
})

test('discontinued section and explicitly partial kits remain visible but blocked even with positive stock', () => {
  const review = prepareInstalerSnapshot(table([
    { row: 2, values: ['SYN-K', 'Synthetic kit', 10, 2, 'Multimedia'], incompleteKit: true },
    { row: 3, values: ['', 'DISCONTINUADOS', '', '', ''] },
    { row: 4, values: ['SYN-D', 'Synthetic discontinued', 20, 3, 'Speakers'] },
  ]))
  assert.deepEqual(review.issues.map(({ code }) => code), ['incomplete-kit', 'discontinued'])
  assert.equal(review.items.length, 2)
  assert.equal(review.items.every((item) => item.selectionBlock !== undefined), true)
  const entries = mergeSharedCatalog([], { format: 'luquisound.catalog', version: 1, items: review.items })
  for (const entry of entries) {
    entry.unitPrice = '99'
    assert.equal(getCatalogSelectionStatus(entry).selectable, false)
    assert.equal(getCatalogSelectionStatus(entry).reason, 'blocked')
  }
  const anomalousMarker = prepareInstalerSnapshot(table([
    { row: 2, values: ['', 'DISCONTINUADOS', '', 0, ''] },
    { row: 3, values: ['SYN-D', 'Synthetic discontinued', 10, 2, ''] },
  ]))
  assert.equal(anomalousMarker.items[0].selectionBlock !== undefined, true)
  assert.deepEqual(anomalousMarker.issues.map(({ code }) => code), ['unclassified-row', 'discontinued'])
})

test('blank rows are skipped while unkeyed rows and missing descriptions demand review without invented keys', () => {
  const review = prepareInstalerSnapshot(table([
    { row: 2, values: ['', '', '', '', ''] },
    { row: 3, values: ['', 'Unkeyed synthetic description', 2, 3, ''] },
    { row: 4, values: ['SYN-A', '', 2, 3, ''] },
  ]))
  assert.equal(review.items.length, 1)
  assert.equal(review.items[0].name, 'SYN-A')
  assert.equal(review.items[0].selectionBlock !== undefined, true)
  assert.deepEqual(review.issues.map(({ code }) => code), ['missing-sku', 'missing-name'])
})

test('schema drift, empty tables and ambiguous row positions fail before producing a candidate', () => {
  const invalid = [null, {}, { ...table(), rows: [] }, { ...table(), headers: ['SKU', 'Description', 'Cost', 'Stock', 'Category'] },
    { ...table(), headerRow: 0 }, { ...table(), source: { document: '' } },
    table([{ row: 1, values: ['SYN-A', 'Synthetic', 2, 3, ''] }]),
    table([{ row: 2, values: ['', 'Only missing key', 2, 3, ''] }]),
    table([{ row: 2, values: ['SYN-A', 'Synthetic', 2, 3, ''], incompleteKit: 'yes' }]),
    table([{ row: 2, values: ['SYN-A', 'Synthetic', 2, 3, ''] }, { row: 2, values: ['SYN-B', 'Synthetic', 2, 3, ''] }])]
  for (const input of invalid) assert.throws(() => prepareInstalerSnapshot(input))
})

test('formula text and spreadsheet errors cannot become valid identifiers, descriptions or categories', () => {
  const review = prepareInstalerSnapshot(table([
    { row: 2, values: ['SYN-OK', 'Synthetic valid', 10, 2, 'Speakers'] },
    { row: 3, values: ['#REF!', 'Synthetic invalid key', 10, 2, ''] },
    { row: 4, values: ['=A1', 'Synthetic unresolved key', 10, 2, ''] },
    { row: 5, values: ['SYN-B', '=B3', 10, 2, ''] },
    { row: 6, values: ['SYN-C', 'Synthetic unresolved category', 10, 2, '#N/A'] },
  ]))
  assert.equal(review.items.length, 3)
  assert.equal(review.items[0].selectionBlock, undefined)
  assert.equal(review.items[1].name, 'SYN-B')
  assert.equal(review.items[2].category, '')
  assert.equal(review.items.slice(1).every((item) => item.selectionBlock !== undefined), true)
  assert.deepEqual(review.issues.map(({ code }) => code),
    ['invalid-sku', 'invalid-sku', 'invalid-name', 'invalid-category'])
})

test('combined source text and overlong names stay in private review evidence without description import or semantic cuts', () => {
  const combined = 'Synthetic DSP | Inputs six channels | Outputs eight channels'
  const long = 'Synthetic model with a complete identifier '.repeat(20)
  const review = prepareInstalerSnapshot(table([
    { row: 2, values: ['SYN-COMBINED', combined, 10, 2, 'DSP'] },
    { row: 3, values: ['SYN-LONG', long, 10, 2, 'DSP'] },
    { row: 4, values: ['SYN-NAME', 'Synthetic complete model name', 10, 2, 'DSP'] },
  ]))
  assert.deepEqual(review.items.map(({ name }) => name), ['SYN-COMBINED', 'SYN-LONG', 'Synthetic complete model name'])
  assert.equal(review.items.every(({ description }) => description === ''), true)
  assert.equal(review.items.slice(0, 2).every(({ selectionBlock }) => selectionBlock !== undefined), true)
  assert.deepEqual(review.nameReviews.map(({ sourceText }) => sourceText), [combined, long.trim()])
  assert.deepEqual(review.nameReviews.map(({ reason }) => reason), ['combined-source-text', 'over-name-limit'])
})

test('provider headers and section labels preserve explicit units without importing the supplier exchange rate', () => {
  const input = {
    ...table([
      { row: 2, values: ['', 'Synthetic section', '', '', ''] },
      { row: 3, values: ['SYN-U', 'Synthetic cable', 1, '2.75', 'Cables'], unit: 'metre', presentation: 'cut length' },
    ]),
    headers: ['999.0', 'Instaler', 'PRECIO', 'STOCK', 'PRODUCTO'],
  }
  const review = prepareInstalerSnapshot(input)
  assert.deepEqual(review.sections, [{ row: 2, label: 'Synthetic section', discontinued: false }])
  assert.deepEqual(review.issues, [])
  assert.equal(review.items[0].sku, 'SYN-U')
  assert.equal(review.items[0].stock?.quantity, 2.75)
  assert.equal(review.items[0].unit, 'metre')
  assert.equal(review.items[0].presentation, 'cut length')
  assert.equal('exchangeRate' in review, false)
  assert.equal('currency' in review.items[0].stock!, false)
  const invalidUnit = prepareInstalerSnapshot(table([
    { row: 2, values: ['SYN-U', 'Synthetic cable', 1, '2.75', 'Cables'], unit: '#REF!' },
  ]))
  assert.equal(invalidUnit.items[0].unit, undefined)
  assert.equal(invalidUnit.items[0].selectionBlock !== undefined, true)
  assert.deepEqual(invalidUnit.issues.map(({ code }) => code), ['invalid-unit'])
})
