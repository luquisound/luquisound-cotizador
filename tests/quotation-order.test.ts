import assert from 'node:assert/strict'
import test from 'node:test'
import { orderQuotationRows } from '../src/features/quotation/audio-categories.ts'
import { calculateQuotation } from '../src/features/quotation/calculation.ts'
import { createQuotation, createRow, duplicateQuotation } from '../src/features/quotation/model.ts'
import type { Quotation, QuotationRow } from '../src/features/quotation/model.ts'
import { parseWorkspace, serializeWorkspace } from '../src/features/quotation/persistence.ts'
import {
  getQuotationBlocks, hasCustomQuotationOrder, moveQuotationBlock, moveQuotationRow,
  readQuotationBlockOrder, readQuotationRowOrder, restoreQuotationOrder,
} from '../src/features/quotation/quotation-order.ts'
import {
  CURRENT_QUOTATION_STORAGE_KEY, loadCurrentQuotation, saveCurrentQuotation,
} from '../src/features/quotation/working-storage.ts'

function row(id: string, fields: Partial<QuotationRow> = {}): QuotationRow {
  return { ...createRow(), id, concept: `Synthetic ${id}`, unitPrice: '100', priceState: 'priced', ...fields }
}

function quote(): Quotation {
  return {
    ...createQuotation(), exchangeRate: '1000', exchangeRateMode: 'frozen',
    rows: [
      row('rear', { audioCategory: 'speakers', currency: 'USD', unitPrice: '10' }),
      row('work', { section: 'extras', audioCategory: 'labor' }),
      row('custom-a'),
      row('bass', { audioCategory: 'subwoofer', quantity: '0,5', unitPrice: '0,01' }),
      row('front', { audioCategory: 'speakers' }),
      row('custom-b'),
      row('cables', { section: 'extras', audioCategory: 'cables' }),
    ],
  }
}

function ids(quotation: Quotation): string[] {
  return orderQuotationRows(quotation.rows, quotation.blockOrder, quotation.rowOrder).map((entry) => entry.id)
}

test('legacy quotations retain canonical grouped display order without changing their source rows', () => {
  const quotation = quote()
  const before = structuredClone(quotation)
  assert.deepEqual(ids(quotation), ['bass', 'rear', 'front', 'custom-a', 'custom-b', 'cables', 'work'])
  assert.deepEqual(getQuotationBlocks(quotation, 'equipment').map((block) => ({ id: block.id, rows: block.rows.map((entry) => entry.id) })), [
    { id: 'category:subwoofer', rows: ['bass'] },
    { id: 'category:speakers', rows: ['rear', 'front'] },
    { id: 'row:custom-a', rows: ['custom-a'] },
    { id: 'row:custom-b', rows: ['custom-b'] },
  ])
  assert.deepEqual(quotation, before)
  assert.equal(quotation.blockOrder, undefined)
})

test('category and free-row blocks move within their section while preserving all source fields and totals', () => {
  const quotation = quote()
  quotation.discount = { percentage: '12,5', rowIds: ['rear', 'bass'] }
  const before = calculateQuotation(quotation)
  const original = structuredClone(quotation)
  let moved = moveQuotationBlock(quotation, 'equipment', 'category:speakers', 'category:subwoofer')
  moved = moveQuotationBlock(moved, 'equipment', 'row:custom-b', 'category:subwoofer')
  moved = moveQuotationBlock(moved, 'extras', 'category:labor', 'category:cables')
  assert.deepEqual(ids(moved), ['rear', 'front', 'custom-b', 'bass', 'custom-a', 'work', 'cables'])
  assert.equal(moved.rows, quotation.rows)
  assert.equal(moved.discount, quotation.discount)
  const after = calculateQuotation(moved)
  assert.deepEqual(after.nativeTotals, before.nativeTotals)
  assert.deepEqual(after.discountedNativeTotals, before.discountedNativeTotals)
  assert.deepEqual(after.totals, before.totals)
  assert.deepEqual(after.discount, before.discount)
  assert.deepEqual(quotation, original)
  assert.deepEqual(after.rows.map((item) => item.row.id), ids(moved))
})

test('row moves save a visual order without moving source rows or metadata', () => {
  const quotation = quote()
  quotation.rows[0]!.currencyConversionOrigin = {
    version: 1, sourceCurrency: 'ARS', sourceUnitPrice: '10000', exchangeRate: '1000',
    derivedCurrency: 'USD', derivedUnitPrice: '10', priceState: 'priced',
  }
  const moved = moveQuotationRow(quotation, 'front', 'rear')
  assert.deepEqual(ids(moved), ['bass', 'front', 'rear', 'custom-a', 'custom-b', 'cables', 'work'])
  assert.equal(moved.rows, quotation.rows)
  assert.equal(moved.rows[0]!.currencyConversionOrigin, quotation.rows[0]!.currencyConversionOrigin)
  assert.deepEqual(moved.rowOrder, ['bass', 'front', 'rear', 'custom-a', 'custom-b', 'cables', 'work'])
  assert.equal(moved.blockOrder, undefined)
})

test('invalid targets, identical positions and cross-section moves are no-ops', () => {
  const quotation = quote()
  for (const [active, over] of [['front', 'front'], ['front', 'missing'], ['front', 'work']]) {
    assert.equal(moveQuotationRow(quotation, active, over), quotation)
  }
  for (const [active, over] of [['category:speakers', 'category:speakers'], ['row:missing', 'category:speakers'], ['category:speakers', 'category:labor']]) {
    assert.equal(moveQuotationBlock(quotation, 'equipment', active, over), quotation)
  }
})

test('blank rows and inactive harnesses remain stored but cannot be dragged or become block targets', () => {
  const quotation = quote()
  quotation.rows.push(createRow(), row('inactive', {
    section: 'extras', audioCategory: 'harness', harnessSelection: { enabled: false },
  }))
  assert.deepEqual(getQuotationBlocks(quotation, 'extras').map((block) => block.id), ['category:cables', 'category:labor'])
  assert.equal(moveQuotationBlock(quotation, 'extras', 'category:harness', 'category:cables'), quotation)
  assert.equal(moveQuotationRow(quotation, 'inactive', 'cables'), quotation)
  assert.equal(quotation.rows.at(-1)!.harnessSelection!.enabled, false)
})

test('new blocks append after an explicit order and deleted block references do not create entries', () => {
  let quotation = moveQuotationBlock(quote(), 'equipment', 'row:custom-b', 'category:subwoofer')
  quotation = { ...quotation, rows: [...quotation.rows.filter((entry) => entry.id !== 'bass'), row('dsp', { audioCategory: 'amplifier-dsp' }), row('custom-new')] }
  assert.deepEqual(getQuotationBlocks(quotation, 'equipment').map((block) => block.id), [
    'row:custom-b', 'category:speakers', 'row:custom-a', 'category:amplifier-dsp', 'row:custom-new',
  ])
  assert.ok(!ids(quotation).includes('bass'))
})

test('repeated deletion and replacement prune stale references without losing recovered order', () => {
  let quotation = quote()
  quotation.blockOrder = ['category:labor', 'category:cables']
  for (let index = 0; index < 1010; index += 1) {
    const replacement = row(`replacement-${index}`)
    quotation = { ...quotation, rows: [
      ...quotation.rows.filter((entry) => !entry.id.startsWith('replacement-')), replacement,
    ] }
    quotation = moveQuotationBlock(quotation, 'equipment', `row:${replacement.id}`, 'category:subwoofer')
    assert.ok(quotation.blockOrder!.length <= 7)
    assert.ok(!quotation.blockOrder!.some((id) => id.startsWith('row:replacement-') && id !== `row:${replacement.id}`))
  }
  const restored = parseWorkspace(serializeWorkspace({ version: 1, activeQuotationId: quotation.id, quotations: [quotation], catalog: [] })).quotations[0]!
  assert.deepEqual(restored.blockOrder, quotation.blockOrder)
  assert.deepEqual(getQuotationBlocks(restored, 'extras').map((block) => block.id), ['category:labor', 'category:cables'])
  assert.equal(getQuotationBlocks(restored, 'equipment')[0]!.id, 'row:replacement-1009')
})

test('inactive category slots and other-section custom order survive movement and harness reactivation', () => {
  const quotation = quote()
  quotation.rows.push(row('harness', { section: 'extras', audioCategory: 'harness', harnessSelection: { enabled: false } }))
  quotation.blockOrder = [
    'row:custom-b', 'category:speakers', 'category:subwoofer', 'row:custom-a',
    'category:labor', 'category:harness', 'category:cables',
    'category:unknown', 'row:deleted', 'row:front',
  ]
  const moved = moveQuotationBlock(quotation, 'extras', 'category:cables', 'category:labor')
  assert.deepEqual(moved.blockOrder, [
    'category:cables', 'category:harness', 'category:labor',
    'row:custom-b', 'category:speakers', 'category:subwoofer', 'row:custom-a',
  ])
  assert.deepEqual(getQuotationBlocks(moved, 'equipment').map((block) => block.id), [
    'row:custom-b', 'category:speakers', 'category:subwoofer', 'row:custom-a',
  ])
  const reactivated = { ...moved, rows: moved.rows.map((entry) => entry.id === 'harness'
    ? { ...entry, harnessSelection: { enabled: true } } : entry) }
  assert.deepEqual(getQuotationBlocks(reactivated, 'extras').map((block) => block.id), [
    'category:cables', 'category:harness', 'category:labor',
  ])
  assert.equal(quotation.rows.at(-1)!.harnessSelection!.enabled, false)
})

test('variant rows can move freely past generic adapters and other accessory categories', () => {
  const variant = { productKey: 'synthetic-ring', size: '6,5', presentation: 'unit' as const }
  const quotation = { ...quote(), rows: [
    row('small', { section: 'extras', audioCategory: 'adapters', adapterVariant: variant }),
    row('legacy', { section: 'extras', audioCategory: 'adapters' }),
    row('large', { section: 'extras', audioCategory: 'adapters', adapterVariant: { ...variant, size: '8' } }),
    row('labor', { section: 'extras', audioCategory: 'labor' }),
  ] }
  const moved = moveQuotationRow(quotation, 'large', 'small')
  assert.deepEqual(ids(moved), ['large', 'small', 'legacy', 'labor'])
  assert.deepEqual(ids(moveQuotationRow(quotation, 'small', 'legacy')), ['legacy', 'small', 'large', 'labor'])
  assert.deepEqual(ids(moveQuotationRow(quotation, 'labor', 'large')), ['small', 'legacy', 'labor', 'large'])
  assert.equal(moved.rows[1], quotation.rows[1])
})

test('current-quotation recovery retains block and row order without writing catalogue or legacy stores', () => {
  const quotation = moveQuotationRow(moveQuotationBlock(quote(), 'equipment', 'category:speakers', 'category:subwoofer'), 'front', 'rear')
  const values = new Map([['luquisound.catalog.v1', 'catalogue-bytes'], ['luquisound.quotation-library.v1', 'library-bytes'], ['luquisound.workspace.v1', 'legacy-bytes']])
  const writes: string[] = []
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); writes.push(key) } }
  assert.equal(saveCurrentQuotation(storage, quotation).ok, true)
  const loaded = loadCurrentQuotation(storage)
  assert.equal(loaded.error, null)
  assert.deepEqual(loaded.quotation, quotation)
  assert.deepEqual(ids(loaded.quotation), ['front', 'rear', 'bass', 'custom-a', 'custom-b', 'cables', 'work'])
  assert.deepEqual(writes, [CURRENT_QUOTATION_STORAGE_KEY])
  assert.equal(values.get('luquisound.catalog.v1'), 'catalogue-bytes')
  assert.equal(values.get('luquisound.quotation-library.v1'), 'library-bytes')
  assert.equal(values.get('luquisound.workspace.v1'), 'legacy-bytes')
})

test('optional ordering metadata is bounded, deduplicated and ignores unknown tokens without losing rows', () => {
  assert.equal(readQuotationBlockOrder(undefined), undefined)
  assert.equal(readQuotationBlockOrder({}), undefined)
  assert.equal(readQuotationBlockOrder(Array(1009).fill('category:speakers')), undefined)
  const metadata = ['category:speakers', 'category:unknown', 'row:custom-a', 'row:deleted', 'row:bad key', null, 'category:speakers']
  assert.deepEqual(readQuotationBlockOrder(metadata), ['category:speakers', 'row:custom-a', 'row:deleted'])
  const quotation = { ...quote(), blockOrder: metadata }
  const stored = JSON.stringify({ version: 1, activeQuotationId: quotation.id, quotations: [quotation], catalog: [] })
  const restored = parseWorkspace(stored).quotations[0]!
  assert.deepEqual(restored.rows, quotation.rows)
  assert.deepEqual(restored.blockOrder, ['category:speakers', 'row:custom-a', 'row:deleted'])
})

test('compatible duplication remaps free-row block references and discount selection to new row identities', () => {
  const quotation = moveQuotationBlock(quote(), 'equipment', 'row:custom-b', 'category:subwoofer')
  quotation.discount = { percentage: '10', rowIds: ['front'] }
  const copy = duplicateQuotation(quotation)
  const custom = copy.rows.find((entry) => entry.concept === 'Synthetic custom-b')!
  const front = copy.rows.find((entry) => entry.concept === 'Synthetic front')!
  assert.equal(copy.blockOrder![0], `row:${custom.id}`)
  assert.deepEqual(copy.discount!.rowIds, [front.id])
  assert.notEqual(copy.blockOrder, quotation.blockOrder)
  const restored = parseWorkspace(serializeWorkspace({ version: 1, activeQuotationId: copy.id, quotations: [copy], catalog: [] })).quotations[0]!
  assert.deepEqual(restored.blockOrder, copy.blockOrder)
})

test('validation issue numbers follow the saved block order and the reordered category rows', () => {
  const quotation = quote()
  quotation.rows[0]!.unitPrice = ''
  quotation.rows[0]!.priceState = 'pending'
  const moved = moveQuotationRow(moveQuotationBlock(quotation, 'equipment', 'category:speakers', 'category:subwoofer'), 'front', 'rear')
  assert.match(calculateQuotation(moved).issues[0]!, /^Fila 2:/)
})

test('adapter validation numbers follow independent rows even with interleaved legacy rows', () => {
  const variant = { productKey: 'synthetic-ring', size: '6,5', presentation: 'unit' as const }
  const quotation = { ...quote(), rows: [
    row('small', { section: 'extras', audioCategory: 'adapters', adapterVariant: variant }),
    row('legacy', { section: 'extras', audioCategory: 'adapters' }),
    row('pending', { section: 'extras', audioCategory: 'adapters', adapterVariant: { ...variant, size: '8' }, unitPrice: '', priceState: 'pending' }),
  ] }
  const calculation = calculateQuotation(quotation)
  assert.deepEqual(calculation.rows.map((item) => item.row.id), ['small', 'legacy', 'pending'])
  assert.match(calculation.issues[0]!, /^Fila 3:/)
  assert.deepEqual(quotation.rows.map((entry) => entry.id), ['small', 'legacy', 'pending'])
})

test('rows cross subcategories and free concepts within a parent while retaining prices and discounts', () => {
  const quotation = quote()
  quotation.discount = { percentage: '12,5', rowIds: ['rear', 'bass'] }
  quotation.rows[0]!.provenance = {
    catalogItemId: 'synthetic-rear', originalUnitPrice: '10', originalCurrency: 'USD', priceBasis: 'manual',
  }
  const snapshot = structuredClone(quotation)
  const before = calculateQuotation(quotation)
  let moved = moveQuotationRow(quotation, 'front', 'bass')
  moved = moveQuotationRow(moved, 'custom-b', 'rear')
  assert.deepEqual(ids(moved), ['front', 'bass', 'custom-b', 'rear', 'custom-a', 'cables', 'work'])
  assert.equal(moved.rows, quotation.rows)
  assert.equal(moved.discount, quotation.discount)
  const after = calculateQuotation(moved)
  assert.deepEqual(after.nativeTotals, before.nativeTotals)
  assert.deepEqual(after.discountedNativeTotals, before.discountedNativeTotals)
  assert.deepEqual(after.totals, before.totals)
  assert.deepEqual(after.discount, before.discount)
  assert.deepEqual(quotation, snapshot)
})

test('custom row order takes precedence over legacy blocks and preserves the other parent', () => {
  const quotation = { ...quote(), blockOrder: ['category:labor', 'category:cables'] }
  const moved = moveQuotationRow(quotation, 'front', 'bass')
  assert.deepEqual(ids(moved), ['front', 'bass', 'rear', 'custom-a', 'custom-b', 'work', 'cables'])
  assert.deepEqual(ids(moveQuotationRow(moved, 'cables', 'work')), [
    'front', 'bass', 'rear', 'custom-a', 'custom-b', 'cables', 'work',
  ])
})

test('new rows append in source order and subcategory edits do not move existing rows', () => {
  const moved = moveQuotationRow(quote(), 'front', 'bass')
  const added = { ...moved, rows: [
    ...moved.rows.map((entry) => entry.id === 'rear' ? { ...entry, audioCategory: 'amplifier-dsp' as const } : entry),
    row('new-speaker', { audioCategory: 'speakers' }),
    row('new-extra', { section: 'extras' }),
    row('new-dsp', { audioCategory: 'amplifier-dsp' }),
  ] }
  assert.deepEqual(ids(added), [
    'front', 'bass', 'rear', 'custom-a', 'custom-b', 'new-speaker', 'new-dsp', 'cables', 'work', 'new-extra',
  ])
})

test('row moves retain an inactive bypass slot and prune deleted references', () => {
  const quotation = { ...quote(), rows: [
    row('cables', { section: 'extras', audioCategory: 'cables' }),
    row('harness', { section: 'extras', audioCategory: 'harness', concept: 'Ficha bypass estéreo', harnessSelection: { enabled: false } }),
    row('work', { section: 'extras', audioCategory: 'labor' }),
  ], rowOrder: ['deleted', 'cables', 'harness', 'work'] }
  const moved = moveQuotationRow(quotation, 'work', 'cables')
  assert.deepEqual(moved.rowOrder, ['work', 'harness', 'cables'])
  assert.deepEqual(calculateQuotation(moved).rows.map((item) => item.row.id), ['work', 'cables'])
  const enabled = { ...moved, rows: moved.rows.map((entry) => entry.id === 'harness'
    ? { ...entry, harnessSelection: { enabled: true } } : entry) }
  assert.deepEqual(calculateQuotation(enabled).rows.map((item) => item.row.id), ['work', 'harness', 'cables'])
})

test('restoring removes both ordering layers and retains stable source order and all quotation fields', () => {
  const original = quote()
  original.discount = { percentage: '10', rowIds: ['rear'] }
  const moved = moveQuotationRow(moveQuotationBlock(original, 'extras', 'category:labor', 'category:cables'), 'front', 'bass')
  assert.equal(hasCustomQuotationOrder(moved), true)
  const restored = restoreQuotationOrder(moved)
  assert.deepEqual(restored, original)
  assert.equal(restored.rows, original.rows)
  assert.equal(restored.discount, original.discount)
  assert.equal(restored.rowOrder, undefined)
  assert.equal(restored.blockOrder, undefined)
  assert.equal(hasCustomQuotationOrder(restored), false)
  assert.equal(restoreQuotationOrder(restored), restored)
  const same = { ...restored, rowOrder: ids(restored) }
  assert.equal(hasCustomQuotationOrder(same), false)
  assert.equal(restoreQuotationOrder(same), same)
})

test('row order metadata is bounded and sanitized without rejecting recovered rows', () => {
  for (const value of [undefined, {}, 'front', Array(1001).fill('front')]) {
    assert.equal(readQuotationRowOrder(value), undefined)
  }
  const quotation = quote()
  const rowOrder = ['front', 'category:speakers', 'bad key', null, 'front', 'deleted', 'bass']
  assert.deepEqual(readQuotationRowOrder(rowOrder), ['front', 'deleted', 'bass'])
  const stored = JSON.stringify({ version: 1, activeQuotationId: quotation.id, quotations: [{ ...quotation, rowOrder }], catalog: [] })
  const restored = parseWorkspace(stored).quotations[0]!
  assert.deepEqual(restored.rowOrder, ['front', 'deleted', 'bass'])
  assert.deepEqual(restored.rows, quotation.rows)
  assert.deepEqual(ids(restored), ['front', 'bass', 'rear', 'custom-a', 'custom-b', 'work', 'cables'])
})

test('empty and wholly obsolete row orders fall back safely to the existing default or legacy layout', () => {
  const quotation = quote()
  assert.deepEqual(readQuotationRowOrder([]), [])
  assert.deepEqual(readQuotationRowOrder(['bad key', null]), [])
  for (const rowOrder of [[], ['deleted']]) {
    const empty = { ...quotation, rowOrder }
    assert.deepEqual(ids(empty), ids(quotation))
    assert.equal(hasCustomQuotationOrder(empty), false)
    const legacy = { ...empty, blockOrder: ['category:labor', 'category:cables'] }
    assert.deepEqual(ids(legacy), ['bass', 'rear', 'front', 'custom-a', 'custom-b', 'work', 'cables'])
  }
})

test('duplication remaps every custom row-order ID and discards stale references', () => {
  const quotation = moveQuotationRow(quote(), 'front', 'bass')
  quotation.rowOrder!.push('deleted')
  const copy = duplicateQuotation(quotation)
  assert.notEqual(copy.rowOrder, quotation.rowOrder)
  assert.equal(copy.rowOrder!.length, quotation.rows.length)
  assert.deepEqual(ids(copy).map((id) => copy.rows.find((entry) => entry.id === id)!.concept),
    ids(quotation).map((id) => quotation.rows.find((entry) => entry.id === id)!.concept))
  assert.ok(copy.rowOrder!.every((id) => copy.rows.some((entry) => entry.id === id)))
})
