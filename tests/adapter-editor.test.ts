import assert from 'node:assert/strict'
import test from 'node:test'
import { getRowAdapterSize, selectDirectAdapterSize } from '../src/features/quotation/adapter-editor.ts'
import type { AdapterSize } from '../src/features/quotation/audio-categories.ts'
import { createQuotation, createRow, type QuotationRow } from '../src/features/quotation/model.ts'
import { saveQuotationRow } from '../src/features/quotation/row-actions.ts'

function draft(id: string, fields: Partial<QuotationRow> = {}): QuotationRow {
  return { ...createRow('extras'), id, audioCategory: 'adapters', concept: 'Aros adaptadores 3D', ...fields }
}

test('switching the direct size replaces description, approved price and identity together', () => {
  const initial = selectDirectAdapterSize(draft('retained', { quantity: '2,750', detail: 'Synthetic fitting' }), '6.5')
  const snapshot = structuredClone(initial)
  const selected = selectDirectAdapterSize(Object.freeze(initial), '8')
  assert.deepEqual(selected, {
    ...initial, concept: 'Aros adaptadores 3D 8 pulgadas', currency: 'ARS', unitPrice: '35.000', priceState: 'priced',
    adapterVariant: { productKey: 'direct-adapter-8', size: '8', presentation: 'unit' },
  })
  assert.equal(getRowAdapterSize(selected), '8')
  assert.equal(selected.id, 'retained')
  assert.equal(selected.quantity, '2,750')
  assert.deepEqual(initial, snapshot)
  const reverted = selectDirectAdapterSize(selected, '6.5')
  assert.equal(reverted.concept, 'Aros adaptadores 3D 6,5 pulgadas')
  assert.equal(reverted.unitPrice, '25.000')
  assert.deepEqual(reverted.adapterVariant, { productKey: 'direct-adapter-6_5', size: '6,5', presentation: 'unit' })
})

test('explicit selection copies approved native ARS values while preserving row identity and quantity', () => {
  const initial = draft('retained', { currency: 'USD', quantity: '3', unitPrice: '7,25', priceState: 'included' })
  const selected = selectDirectAdapterSize(initial, '6.5')
  assert.equal(selected.currency, 'ARS')
  assert.equal(selected.unitPrice, '25.000')
  assert.equal(selected.priceState, 'priced')
  assert.equal(selected.id, initial.id)
  assert.equal(selected.quantity, initial.quantity)
  assert.equal(initial.currency, 'USD')
  assert.equal(initial.unitPrice, '7,25')
})

test('reading a row prioritizes explicit unit metadata without mutating legacy text, prices or identity', () => {
  const legacy = draft('legacy', { concept: 'Aros adaptadores 3D 6,5 pulgadas', currency: 'USD', unitPrice: '7,25' })
  const snapshot = structuredClone(legacy)
  assert.equal(getRowAdapterSize(Object.freeze(legacy)), '6.5')
  assert.equal(Object.hasOwn(legacy, 'adapterVariant'), false)
  assert.deepEqual(legacy, snapshot)
  const mismatched = {
    ...legacy, adapterVariant: { productKey: 'explicit-eight', size: '8', presentation: 'unit' as const },
  }
  const mismatchedSnapshot = structuredClone(mismatched)
  assert.equal(getRowAdapterSize(Object.freeze(mismatched)), '8')
  assert.deepEqual(mismatched, mismatchedSnapshot)
  assert.equal(getRowAdapterSize(draft('generic', { unitPrice: '35.000' })), '')
  assert.equal(getRowAdapterSize(draft('custom', { concept: 'Synthetic 8-inch adapter', unitPrice: '35.000' })), '')
})

test('unsupported metadata uses only exact approved description fallback without changing any row', () => {
  for (const presentation of ['pair', 'set'] as const) {
    const row = draft('legacy', {
      concept: 'Aros adaptadores 3D 6,5 pulgadas',
      adapterVariant: { productKey: 'synthetic', size: '8', presentation },
    })
    const snapshot = structuredClone(row)
    assert.equal(getRowAdapterSize(row), '6.5')
    assert.deepEqual(row, snapshot)
  }
  assert.equal(getRowAdapterSize(draft('unsupported', {
    adapterVariant: { productKey: 'synthetic', size: '10', presentation: 'unit' },
  })), '')
})

test('new six-and-a-half and eight-inch drafts save as independent rows without altering source work', () => {
  const original = createQuotation()
  original.rows = [selectDirectAdapterSize(draft('six-existing', { quantity: '2' }), '6.5')]
  const snapshot = structuredClone(original)
  const eight = selectDirectAdapterSize(draft('eight-new', { quantity: '2' }), '8')
  const savedEight = saveQuotationRow(original, eight, 'new')
  assert.equal(savedEight.ok, true)
  if (!savedEight.ok) return
  assert.equal(savedEight.merged, false)
  assert.equal(savedEight.rows.length, 2)
  assert.deepEqual(savedEight.rows.map((row) => [row.adapterVariant?.size, row.quantity]), [['6,5', '2'], ['8', '2']])
  assert.deepEqual(original, snapshot)
  const sixAgain = selectDirectAdapterSize(draft('six-again', { quantity: '1' }), '6.5')
  const savedSix = saveQuotationRow({ ...original, rows: savedEight.rows }, sixAgain, 'new')
  assert.equal(savedSix.ok, true)
  if (!savedSix.ok) return
  assert.equal(savedSix.merged, true)
  assert.equal(savedSix.rows.length, 2)
  assert.deepEqual(savedSix.rows.map((row) => [row.adapterVariant?.size, row.quantity]), [['6,5', '3'], ['8', '2']])
  assert.equal(savedSix.rowId, 'six-existing')
  assert.deepEqual(original, snapshot)
  assert.equal(savedEight.rows[0]?.quantity, '2')
})

test('direct selection keeps existing category, source and supported-size guards', () => {
  for (const row of [
    draft('wrong-section', { section: 'equipment' }),
    draft('wrong-category', { audioCategory: 'harness' }),
    draft('sourced', { provenance: { catalogItemId: 'synthetic', originalUnitPrice: '', originalCurrency: 'ARS', priceBasis: 'pending' } }),
  ]) {
    const snapshot = structuredClone(row)
    assert.throws(() => selectDirectAdapterSize(row, '8'))
    assert.deepEqual(row, snapshot)
  }
  const row = draft('valid')
  assert.throws(() => selectDirectAdapterSize(row, '10' as AdapterSize), RangeError)
})
