import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { prepareLocalInstalerReview, writePrivateInstalerReview } from '../scripts/prepare-instaler-snapshot.ts'
import { mergeSharedCatalog } from '../src/features/quotation/shared-catalog.ts'

function extraction() {
  return {
    format: 'luquisound.instaler-xlsx-extraction', version: 1,
    source: { document: 'synthetic-supplier.xlsx', checksum: 'a'.repeat(64), byteLength: 100 },
    sheet: 'Precios', headerRow: 1,
    headers: ['999.0', 'Instaler', 'PRECIO', 'STOCK', 'PRODUCTO'],
    rows: [{ row: 2, values: ['SYN-A', 'Synthetic speaker', '10.25', '0.125', 'Speakers'], cells: [
      { column: 'C', reference: 'C2', type: 'n', value: '10.25', rawValue: '10.25',
        formula: 'IFERROR(SYNTHETIC_REFERENCE,10.25)', hasCachedValue: true },
    ] }],
    coverage: { complete: false, kits: 'pending', units: 'pending', otherSheets: ['Synthetic kit sheet'] },
  }
}

const baseline = JSON.stringify({ format: 'luquisound.catalog', version: 1, items: [] })

test('local preparation retains cache/formula evidence and baseline identity without creating a publication envelope', () => {
  const input = extraction()
  const before = structuredClone(input)
  const report = prepareLocalInstalerReview(input, '\ufeff' + baseline, 'synthetic-current.json')
  assert.deepEqual(input, before)
  assert.equal(report.format, 'luquisound.instaler-snapshot-review')
  assert.equal(report.reviewRequired, true)
  assert.equal(report.publicationAllowed, false)
  assert.equal(report.baseline.verifiedLive, false)
  assert.equal(report.baseline.checksum, createHash('sha256').update('\ufeff' + baseline).digest('hex'))
  assert.equal(report.snapshot.items[0].stock?.quantity, 0.125)
  assert.equal(report.snapshot.items[0].stock?.checkedAt, null)
  assert.equal(report.snapshot.items[0].listPrice?.amount, '10.25')
  assert.deepEqual(report.extraction, before)
  assert.equal(report.comparison.summary.additions, 1)
  assert.equal('replaceSourceDocuments' in report, false)
  assert.equal('items' in report, false)
  assert.equal(report.coverage.complete, false)
  assert.equal(report.coverage.kits, 'pending')
})

test('invalid extraction identity, partial-contract drift or unreadable baseline cannot become a review', () => {
  for (const input of [null, {}, { ...extraction(), format: 'other' }, { ...extraction(), version: 2 },
    { ...extraction(), sheet: 'Other' }, { ...extraction(), coverage: { complete: true } },
    { ...extraction(), source: { ...extraction().source, checksum: 'invalid' } },
    { ...extraction(), source: { ...extraction().source, byteLength: Infinity } }]) {
    assert.throws(() => prepareLocalInstalerReview(input, baseline, 'synthetic.json'))
  }
  assert.throws(() => prepareLocalInstalerReview(extraction(), '{}', 'synthetic.json'))
})

test('name-only source updates preserve manually entered descriptions and approved price overrides', () => {
  const input = extraction()
  const report = prepareLocalInstalerReview(input, baseline, 'synthetic-current.json')
  const document = { format: 'luquisound.catalog' as const, version: 1 as const, items: report.snapshot.items }
  const existing = mergeSharedCatalog([], document)
  existing[0].detail = 'Manually entered installation note'
  existing[0].unitPrice = '99,50'
  existing[0].currency = 'USD'
  const before = structuredClone(existing)
  const next = extraction()
  next.rows[0].values[1] = 'Synthetic updated complete name'
  next.rows[0].values[2] = '12.75'
  const updated = prepareLocalInstalerReview(next, baseline, 'synthetic-current.json')
  const merged = mergeSharedCatalog(existing, { ...document, items: updated.snapshot.items })
  assert.equal(merged[0].concept, 'Synthetic updated complete name')
  assert.equal(merged[0].detail, 'Manually entered installation note')
  assert.equal(merged[0].unitPrice, '99,50')
  assert.equal(merged[0].currency, 'USD')
  assert.equal(merged[0].id, existing[0].id)
  assert.deepEqual(existing, before)
})

test('private report creation is exclusive, rejects Git worktrees and never overwrites inputs', () => {
  const directory = mkdtempSync(join(tmpdir(), 'instaler-preparation-'))
  try {
    const output = join(directory, 'review.json')
    const report = prepareLocalInstalerReview(extraction(), baseline, 'synthetic-current.json')
    writePrivateInstalerReview(output, report)
    assert.equal(JSON.parse(readFileSync(output, 'utf8')).publicationAllowed, false)
    const saved = readFileSync(output, 'utf8')
    assert.throws(() => writePrivateInstalerReview(output, report))
    assert.equal(readFileSync(output, 'utf8'), saved)
    const checkout = join(directory, 'synthetic-checkout')
    mkdirSync(checkout)
    writeFileSync(join(checkout, '.git'), 'gitdir: synthetic')
    assert.throws(() => writePrivateInstalerReview(join(checkout, 'private.json'), report))
    assert.equal(existsSync(join(checkout, 'private.json')), false)
    const repository = dirname(dirname(fileURLToPath(import.meta.url)))
    assert.throws(() => writePrivateInstalerReview(join(repository, 'private-source-review.json'), report))
    assert.equal(existsSync(join(repository, 'private-source-review.json')), false)
    assert.throws(() => writePrivateInstalerReview(join(directory, 'invalid.json'), { quantity: Infinity }))
    assert.equal(existsSync(join(directory, 'invalid.json')), false)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
