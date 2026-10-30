import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateQuotation } from '../src/features/quotation/calculation.ts'
import { createQuotation, createRow } from '../src/features/quotation/model.ts'
import type { Quotation } from '../src/features/quotation/model.ts'
import { canUndoQuotationOrder, rememberQuotationOrder, undoQuotationOrder } from '../src/features/quotation/order-history.ts'
import { moveQuotationRow, restoreQuotationOrder } from '../src/features/quotation/quotation-order.ts'

function quote(): Quotation {
  return {
    ...createQuotation(), exchangeRate: '1000',
    rows: [
      { ...createRow(), id: 'amp', audioCategory: 'amplifier-dsp', concept: 'Synthetic amp', unitPrice: '100', priceState: 'priced' },
      { ...createRow(), id: 'speaker', audioCategory: 'speakers', concept: 'Synthetic speaker', unitPrice: '200', priceState: 'priced' },
      { ...createRow('extras'), id: 'labor', audioCategory: 'labor', concept: 'Synthetic installation', unitPrice: '50', priceState: 'priced' },
    ],
  }
}

function ids(quotation: Quotation): string[] {
  return calculateQuotation(quotation).rows.map(({ row }) => row.id)
}

test('undo restores the exact row layout without rolling back later price, text or rate edits', () => {
  const custom = moveQuotationRow(quote(), 'speaker', 'amp')
  custom.discount = { percentage: '10', rowIds: ['speaker'] }
  const undo = rememberQuotationOrder(custom)
  const restored = restoreQuotationOrder(custom)
  const edited = {
    ...restored, title: 'Edited title', exchangeRate: '1200',
    rows: restored.rows.map((row) => row.id === 'speaker'
      ? { ...row, concept: 'Edited speaker', detail: 'Edited detail', unitPrice: '300', quantity: '2' } : row),
  }
  assert.deepEqual(ids(restored), ['amp', 'speaker', 'labor'])
  assert.equal(canUndoQuotationOrder(edited, undo), true)
  const result = undoQuotationOrder(edited, undo)
  assert.deepEqual(ids(result), ['speaker', 'amp', 'labor'])
  assert.equal(result.rows, edited.rows)
  assert.equal(result.discount, edited.discount)
  assert.equal(result.title, 'Edited title')
  assert.equal(result.exchangeRate, '1200')
  assert.equal(result.rows[1]!.unitPrice, '300')
  assert.deepEqual(calculateQuotation(result).totals, calculateQuotation(edited).totals)
  assert.equal(canUndoQuotationOrder(result, undo), false)
})

test('undo supports a recovered legacy block layout and keeps its metadata isolated', () => {
  const custom = { ...quote(), blockOrder: ['category:speakers', 'category:amplifier-dsp'] }
  const undo = rememberQuotationOrder(custom)
  const restored = restoreQuotationOrder(custom)
  assert.equal(canUndoQuotationOrder(restored, undo), true)
  const result = undoQuotationOrder(restored, undo)
  assert.deepEqual(result.blockOrder, custom.blockOrder)
  assert.notEqual(result.blockOrder, custom.blockOrder)
  assert.notEqual(undo.blockOrder, custom.blockOrder)
  assert.deepEqual(ids(result), ids(custom))
  assert.equal(result.rowOrder, undefined)
})

test('adding, removing, reclassifying or hiding a row invalidates restoration undo', () => {
  const custom = moveQuotationRow(quote(), 'speaker', 'amp')
  const undo = rememberQuotationOrder(custom)
  const restored = restoreQuotationOrder(custom)
  const changes: Quotation[] = [
    { ...restored, rows: [...restored.rows, createRow()] },
    { ...restored, rows: restored.rows.filter((row) => row.id !== 'speaker') },
    { ...restored, rows: restored.rows.map((row) => row.id === 'speaker' ? { ...row, audioCategory: 'subwoofer' } : row) },
    { ...restored, rows: restored.rows.map((row) => row.id === 'speaker' ? { ...row, section: 'extras' } : row) },
    { ...restored, rows: restored.rows.map((row) => row.id === 'speaker' ? { ...row, concept: '', detail: '', unitPrice: '', priceState: 'pending' } : row) },
  ]
  for (const changed of changes) {
    assert.equal(canUndoQuotationOrder(changed, undo), false)
    assert.equal(undoQuotationOrder(changed, undo), changed)
  }
})

test('new movements, a different quotation and missing history cannot undo a restoration', () => {
  const custom = moveQuotationRow(quote(), 'speaker', 'amp')
  const undo = rememberQuotationOrder(custom)
  const restored = restoreQuotationOrder(custom)
  const moved = moveQuotationRow(restored, 'amp', 'speaker')
  for (const changed of [moved, { ...restored, id: 'another-quotation' }]) {
    assert.equal(canUndoQuotationOrder(changed, undo), false)
    assert.equal(undoQuotationOrder(changed, undo), changed)
  }
  assert.equal(canUndoQuotationOrder(restored, null), false)
  assert.equal(undoQuotationOrder(restored, null), restored)
})

test('undo does not reactivate a harness after its selection changes', () => {
  const original = quote()
  original.rows.push({ ...createRow('extras'), id: 'harness', audioCategory: 'harness', concept: 'Synthetic harness', unitPrice: '70', priceState: 'priced', harnessSelection: { enabled: true } })
  const custom = moveQuotationRow(original, 'labor', 'harness')
  const undo = rememberQuotationOrder(custom)
  const restored = restoreQuotationOrder(custom)
  const changed = { ...restored, rows: restored.rows.map((row) => row.id === 'harness'
    ? { ...row, harnessSelection: { enabled: false } } : row) }
  assert.equal(canUndoQuotationOrder(changed, undo), false)
  assert.equal(undoQuotationOrder(changed, undo), changed)
  assert.equal(changed.rows.at(-1)!.harnessSelection!.enabled, false)
})
