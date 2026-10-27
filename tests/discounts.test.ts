import assert from 'node:assert/strict'
import { test } from 'node:test'
import { calculateQuotation, calculateRow } from '../src/features/quotation/calculation.ts'
import {
  isDiscountEligibleItem, isDiscountSuggestedItem, parseDiscountPercentage, readQuotationDiscount,
} from '../src/features/quotation/discounts.ts'
import { createQuotation, duplicateQuotation, hasQuotationContent, type Quotation, type QuotationRow } from '../src/features/quotation/model.ts'
import { parseWorkspace, serializeWorkspace, type StorageAdapter } from '../src/features/quotation/persistence.ts'
import { CURRENT_QUOTATION_STORAGE_KEY, loadCurrentQuotation, saveCurrentQuotation } from '../src/features/quotation/working-storage.ts'
import { setRowFactoryMode } from '../src/features/quotation/factory-mode.ts'
import { createQuotationLibrary, openLibraryQuotation, saveQuotationToLibrary } from '../src/features/quotation/quotation-library.ts'

function row(id: string, overrides: Partial<QuotationRow> = {}): QuotationRow {
  return {
    id, section: 'equipment', audioCategory: 'speakers', currency: 'ARS', concept: `Synthetic ${id}`,
    detail: '', quantity: '1', unitPrice: '100', priceState: 'priced', ...overrides,
  }
}

function quotation(rows: QuotationRow[], overrides: Partial<Quotation> = {}): Quotation {
  return { ...createQuotation(), title: 'SYNTHETIC DISCOUNT', rows, exchangeRate: '1.000', ...overrides }
}

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  const writes: string[] = []
  const storage: StorageAdapter = {
    getItem(key) { return values.get(key) ?? null },
    setItem(key, value) { writes.push(key); values.set(key, value) },
  }
  return { values, writes, storage }
}

test('discount percentage accepts manual decimal percentages and returns exact integer basis points', () => {
  for (const [input, basisPoints, normalized] of [
    ['1', 100, '1'], ['7,5', 750, '7,5'], ['7.50', 750, '7,5'], ['0,01', 1, '0,01'],
    ['100', 10000, '100'], ['100,00', 10000, '100'], [' 005,20 ', 520, '5,2'],
  ] as const) assert.deepEqual(parseDiscountPercentage(input), { ok: true, basisPoints, normalized })
  for (const input of ['', '0', '0,00', '100,01', '101', '-5', '5%', '1e1', '1,234', '1.', '.5', '999999999999999999']) {
    assert.equal(parseDiscountPercentage(input).ok, false, input)
  }
})

test('discount metadata validates identifiers and never accepts empty or duplicate selections', () => {
  assert.deepEqual(readQuotationDiscount({ percentage: '7.50', rowIds: ['row-one', 'removed-row'] }), {
    percentage: '7,5', rowIds: ['row-one', 'removed-row'],
  })
  for (const value of [
    null, [], {}, { percentage: 10, rowIds: ['one'] }, { percentage: '0', rowIds: ['one'] },
    { percentage: '10', rowIds: [] }, { percentage: '10', rowIds: ['one', 'one'] },
    { percentage: '10', rowIds: ['invalid id'] }, { percentage: '10', rowIds: ['x'.repeat(129)] },
    { percentage: '10', rowIds: Array.from({ length: 1001 }, (_, index) => `row-${index}`) },
  ]) assert.throws(() => readQuotationDiscount(value))
})

test('only complete priced positive equipment is eligible and manual equipment requires explicit selection', () => {
  assert.equal(isDiscountSuggestedItem(calculateRow(row('speakers'))), true)
  const manual = calculateRow(row('manual', { audioCategory: undefined }))
  assert.equal(isDiscountEligibleItem(manual), true)
  assert.equal(isDiscountSuggestedItem(manual), false)
  for (const item of [
    row('pending', { priceState: 'pending' }), row('included', { priceState: 'included' }),
    row('zero', { unitPrice: '0' }), row('quantity', { quantity: '0' }), row('amount', { unitPrice: 'invalid' }),
    row('title', { concept: '' }), row('cables', { section: 'extras', audioCategory: 'cables' }),
    row('labor', { section: 'extras', audioCategory: 'labor' }),
    row('adapters', { section: 'extras', audioCategory: 'adapters' }),
    row('harness', { section: 'extras', audioCategory: 'harness' }),
    row('misclassified', { audioCategory: 'cables' }), setRowFactoryMode(row('factory'), true),
  ]) assert.equal(isDiscountEligibleItem(calculateRow(item)), false, item.id)
})

test('a discount adjusts only explicitly selected native equipment subtotals before currency conversion', () => {
  const input = quotation([
    row('ars', { unitPrice: '800.000' }), row('usd', { currency: 'USD', unitPrice: '100' }),
    row('not-selected', { unitPrice: '50.000' }), row('labor', { section: 'extras', audioCategory: 'labor', unitPrice: '200.000' }),
  ], { discount: { percentage: '10', rowIds: ['ars', 'usd'] } })
  const original = structuredClone(input)
  const result = calculateQuotation(input)
  assert.deepEqual(result.nativeTotals, { ARS: 105_000_000, USD: 10_000 })
  assert.deepEqual(result.discount?.eligibleTotals, { ARS: 80_000_000, USD: 10_000 })
  assert.deepEqual(result.discount?.amounts, { ARS: 8_000_000, USD: 1_000 })
  assert.deepEqual(result.discountedNativeTotals, { ARS: 97_000_000, USD: 9_000 })
  assert.deepEqual(result.totals, { ARS: 106_000_000, USD: 106_000 })
  assert.equal(result.canExport, true)
  assert.deepEqual(input, original)
  assert.deepEqual(calculateQuotation(input), result)
})

test('discounts use exact half-up rounding on each selected currency subtotal after line rounding', () => {
  const input = quotation([
    row('one', { unitPrice: '0,01', quantity: '0,5' }),
    row('two', { unitPrice: '0,01', quantity: '0,5' }),
    row('usd', { unitPrice: '0,01', quantity: '0,5', currency: 'USD' }),
  ], { exchangeRate: '2', discount: { percentage: '50', rowIds: ['one', 'two', 'usd'] } })
  const result = calculateQuotation(input)
  assert.deepEqual(result.rows.map(item => item.lineTotalCents), [1, 1, 1])
  assert.deepEqual(result.discount?.amounts, { ARS: 1, USD: 1 })
  assert.deepEqual(result.discountedNativeTotals, { ARS: 1, USD: 0 })
  assert.deepEqual(result.totals, { ARS: 1, USD: 1 })
})

test('one-hundred percent equipment discount keeps installation and price states intact', () => {
  const input = quotation([row('equipment'), row('labor', { section: 'extras', audioCategory: 'labor' })], {
    discount: { percentage: '100', rowIds: ['equipment'] },
  })
  const result = calculateQuotation(input)
  assert.deepEqual(result.discountedNativeTotals, { ARS: 10_000, USD: 0 })
  assert.equal(result.rows[0]!.row.priceState, 'priced')
  assert.equal(result.rows[0]!.row.unitPrice, '100')
  assert.equal(result.canExport, true)
})

test('invalid or no-longer-eligible selected concepts never discount services and require review', () => {
  for (const selected of [
    row('selected', { section: 'extras', audioCategory: 'labor' }),
    row('selected', { priceState: 'pending' }), row('selected', { priceState: 'included' }),
    setRowFactoryMode(row('selected'), true),
  ]) {
    const input = quotation([selected, row('valid')], { discount: { percentage: '10', rowIds: ['selected', 'valid'] } })
    const result = calculateQuotation(input)
    assert.deepEqual(result.discount?.amounts, { ARS: 1_000, USD: 0 })
    assert.ok(result.discount!.errors.length > 0)
    assert.equal(result.canExport, false)
    assert.deepEqual(result.totals, { ARS: null, USD: null })
  }
})

test('deleted IDs are ignored without selecting new equipment and an entirely missing selection requires review', () => {
  const input = quotation([row('kept'), row('new')], { discount: { percentage: '10', rowIds: ['removed', 'kept'] } })
  const result = calculateQuotation(input)
  assert.deepEqual(result.discount?.eligibleTotals, { ARS: 10_000, USD: 0 })
  assert.deepEqual(result.discount?.errors, [])
  assert.equal(result.canExport, true)
  const missing = calculateQuotation({ ...input, discount: { percentage: '10', rowIds: ['removed'] } })
  assert.deepEqual(missing.discount?.amounts, { ARS: 0, USD: 0 })
  assert.equal(missing.canExport, false)
})

test('discount percentage edits and removal always recompute from untouched base prices and provenance', () => {
  const provenance = { catalogItemId: 'synthetic-product', originalUnitPrice: '100', originalCurrency: 'ARS' as const, priceBasis: 'manual' as const }
  const input = quotation([row('selected', { provenance })], { discount: { percentage: '10', rowIds: ['selected'] } })
  assert.equal(calculateQuotation(input).totals.ARS, 9_000)
  const edited = { ...input, discount: { ...input.discount!, percentage: '20' } }
  assert.equal(calculateQuotation(edited).totals.ARS, 8_000)
  const { discount: _discount, ...removed } = edited
  assert.equal(calculateQuotation(removed).totals.ARS, 10_000)
  assert.equal(input.rows[0]!.unitPrice, '100')
  assert.deepEqual(input.rows[0]!.provenance, provenance)
  assert.equal(calculateQuotation({ ...input, rows: [row('selected', { unitPrice: '200', quantity: '2' })] }).totals.ARS, 36_000)
})

test('safe-cent limits remain enforced even if a discount could reduce an overflowing base', () => {
  const input = quotation([
    row('max', { unitPrice: '90.071.992.547.409,91' }), row('extra', { unitPrice: '0,01' }),
  ], { discount: { percentage: '100', rowIds: ['max', 'extra'] } })
  const result = calculateQuotation(input)
  assert.equal(result.canExport, false)
  assert.ok(result.issues.some(issue => issue.includes('seguro')))
  const exact = calculateQuotation({ ...input, rows: input.rows.slice(0, 1), discount: { percentage: '50', rowIds: ['max'] } })
  assert.deepEqual(exact.discount?.amounts, { ARS: 4_503_599_627_370_496, USD: 0 })
  assert.equal(exact.discountedNativeTotals.ARS, 4_503_599_627_370_495)
})

test('current recovery preserves percentage and selection without altering row snapshots or catalogues', () => {
  const input = quotation([row('saved')], { discount: { percentage: '7,5', rowIds: ['saved'] } })
  const { storage, values, writes } = memoryStorage({ 'luquisound.quotation-library.v1': 'legacy bytes', 'luquisound.workspace.v1': 'older bytes' })
  assert.equal(saveCurrentQuotation(storage, input).ok, true)
  const restored = loadCurrentQuotation(storage)
  assert.equal(restored.error, null)
  assert.deepEqual(restored.quotation, input)
  assert.deepEqual(writes, [CURRENT_QUOTATION_STORAGE_KEY])
  assert.equal(values.get('luquisound.quotation-library.v1'), 'legacy bytes')
  assert.equal(values.get('luquisound.workspace.v1'), 'older bytes')
  assert.equal(calculateQuotation(restored.quotation).totals.ARS, 9_250)
})

test('malformed discount metadata preserves unreadable current storage without approving undiscounted totals', () => {
  const input = quotation([row('saved')])
  for (const discount of [{ percentage: '101', rowIds: ['saved'] }, { percentage: '10', rowIds: ['saved', 'saved'] }, null]) {
    const raw = JSON.stringify({ version: 1, activeQuotationId: input.id, quotations: [{ ...input, discount }], catalog: [] })
    const { storage, values, writes } = memoryStorage({ [CURRENT_QUOTATION_STORAGE_KEY]: raw })
    assert.throws(() => parseWorkspace(raw))
    assert.notEqual(loadCurrentQuotation(storage).error, null)
    assert.equal(values.get(CURRENT_QUOTATION_STORAGE_KEY), raw)
    assert.deepEqual(writes, [])
  }
})

test('a new quotation has no discount and recovery keeps an adjustment awaiting review after all rows are cleared', () => {
  assert.equal(createQuotation().discount, undefined)
  const input = { ...createQuotation(), discount: { percentage: '10', rowIds: ['removed'] } }
  assert.equal(hasQuotationContent(input), true)
  const { storage } = memoryStorage()
  assert.equal(saveCurrentQuotation(storage, input).ok, true)
  assert.deepEqual(loadCurrentQuotation(storage).quotation.discount, input.discount)
  assert.equal(calculateQuotation(input).canExport, false)
})

test('compatible workspace round trips and cloning remap selected row identifiers independently', () => {
  const input = quotation([row('one'), row('two')], { discount: { percentage: '10', rowIds: ['one'] } })
  const serialized = serializeWorkspace({ version: 1, activeQuotationId: input.id, quotations: [input], catalog: [] })
  assert.deepEqual(parseWorkspace(serialized).quotations[0]!.discount, input.discount)
  const duplicate = duplicateQuotation(input)
  assert.deepEqual(duplicate.discount?.rowIds, [duplicate.rows[0]!.id])
  assert.notEqual(duplicate.discount, input.discount)
  duplicate.discount!.rowIds.push(duplicate.rows[1]!.id)
  assert.deepEqual(input.discount!.rowIds, ['one'])
  const library = saveQuotationToLibrary(createQuotationLibrary(), input, 'Synthetic discounted quote')
  const entry = library.entries[0]!
  assert.deepEqual(entry.quotation.discount?.rowIds, [entry.quotation.rows[0]!.id])
  const opened = openLibraryQuotation(entry)
  assert.deepEqual(opened.discount?.rowIds, [opened.rows[0]!.id])
  assert.equal(calculateQuotation(opened).totals.ARS, 19_000)
})
