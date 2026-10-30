import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateQuotation, calculateRow } from '../src/features/quotation/calculation.ts'
import {
  adapterVariantQuantity, buildQuotationPresentation, presentQuotationRow,
} from '../src/features/quotation/presentation.ts'
import type { Quotation, QuotationRow } from '../src/features/quotation/model.ts'

function adapter(id: string, changes: Partial<QuotationRow> = {}): QuotationRow {
  return {
    id, section: 'extras', audioCategory: 'adapters', currency: 'ARS',
    concept: 'Aros adaptadores 3D', detail: '', quantity: '1', unitPrice: '100', priceState: 'priced',
    adapterVariant: { productKey: 'manual-synthetic-ring', size: '6,5', presentation: 'unit' },
    ...changes,
  }
}

function quotation(rows: QuotationRow[], rowOrder?: string[]): Quotation {
  return {
    id: 'synthetic', title: 'PRESUPUESTO', subtitle: '', currency: 'ARS', exchangeRate: '1000',
    rows, rowOrder, notes: '', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  }
}

test('presents each explicit adapter independently with its own quantity, presentation and rounded amount', () => {
  const rows = [
    adapter('small', { quantity: '2', adapterVariant: { productKey: 'small', size: '6,5', presentation: 'pair' } }),
    adapter('large', { quantity: '3', adapterVariant: { productKey: 'large', size: '8', presentation: 'set' } }),
  ]
  const snapshot = structuredClone(rows)
  const calculated = calculateQuotation(quotation(rows)).rows
  const result = buildQuotationPresentation(calculated)
  assert.equal(result.length, 2)
  assert.deepEqual(result.map(({ concept, quantity }) => [concept, quantity]), [
    ['Aros adaptadores 3D', '2 pares × 6,5″'], ['Aros adaptadores 3D', '3 juegos × 8″'],
  ])
  assert.deepEqual(result.map(({ item }) => item.lineTotalCents), [20000, 30000])
  assert.equal(result[0].item, calculated[0])
  assert.equal(result[1].item, calculated[1])
  assert.deepEqual(rows, snapshot)
})

test('keeps custom product names and details separate from explicit adapter size and quantity', () => {
  const row = adapter('custom', {
    concept: ' Aro de prueba reforzado ', detail: ' Terminación especial\nDetalle final ',
    adapterVariant: { productKey: 'custom', size: '6.50', presentation: 'pair' },
  })
  const result = presentQuotationRow(calculateRow(row))
  assert.equal(result.concept, 'Aro de prueba reforzado')
  assert.equal(result.detail, 'Terminación especial\nDetalle final')
  assert.equal(result.quantity, '1 par × 6,5″')
  assert.equal(result.item.row, row)
})

test('preserves the resolved sequence without regrouping adapter variants or other categories', () => {
  const rows = [
    adapter('large', { adapterVariant: { productKey: 'large', size: '8', presentation: 'unit' } }),
    adapter('manual', { audioCategory: undefined, adapterVariant: undefined, concept: 'Otro concepto' }),
    adapter('small'),
    adapter('wire', { audioCategory: 'cables', adapterVariant: undefined }),
    adapter('bass', { section: 'equipment', audioCategory: 'subwoofer', adapterVariant: undefined }),
  ]
  const calculated = rows.map(calculateRow)
  const result = buildQuotationPresentation(calculated)
  assert.deepEqual(result.map(({ item }) => item.row.id), rows.map(({ id }) => id))
  assert.ok(result.every((entry, index) => entry.item === calculated[index]))
})

test('uses the saved free row order for separate equipment and interleaved adapter rows', () => {
  const rows = [
    adapter('small'),
    adapter('large', { adapterVariant: { productKey: 'large', size: '8', presentation: 'unit' } }),
    adapter('work', { audioCategory: 'labor', adapterVariant: undefined }),
    adapter('bass', { section: 'equipment', audioCategory: 'subwoofer', adapterVariant: undefined }),
    adapter('speaker', { section: 'equipment', audioCategory: 'speakers', adapterVariant: undefined }),
    adapter('amp', { section: 'equipment', audioCategory: 'amplifier-dsp', adapterVariant: undefined }),
  ]
  const result = buildQuotationPresentation(calculateQuotation(quotation(rows, [
    'speaker', 'amp', 'bass', 'large', 'work', 'small',
  ])).rows)
  assert.deepEqual(result.map(({ item }) => item.row.id), ['speaker', 'amp', 'bass', 'large', 'work', 'small'])
})

test('retains each rounded native source line instead of combining adapter quantities', () => {
  const rows = [
    adapter('fraction-a', { quantity: '0,5', unitPrice: '0,01' }),
    adapter('fraction-b', { quantity: '0,5', unitPrice: '0,01' }),
  ]
  const calculation = calculateQuotation(quotation(rows))
  const result = buildQuotationPresentation(calculation.rows)
  assert.deepEqual(result.map(({ item }) => item.lineTotalCents), [1, 1])
  assert.equal(calculation.nativeTotals.ARS, 2)
})

test('keeps currencies, included state and explicit zero distinct on independent adapter rows', () => {
  const result = buildQuotationPresentation(calculateQuotation(quotation([
    adapter('ars', { quantity: '2' }),
    adapter('usd', { currency: 'USD', unitPrice: '5' }),
    adapter('included', { currency: 'USD', priceState: 'included', unitPrice: '' }),
    adapter('zero', { unitPrice: '0' }),
  ])).rows)
  assert.deepEqual(result.map(({ item }) => [item.row.currency, item.row.priceState, item.lineTotalCents]), [
    ['ARS', 'priced', 20000], ['USD', 'priced', 500], ['USD', 'included', 0], ['ARS', 'priced', 0],
  ])
})

test('preserves individual pending errors without presenting a merged partial amount', () => {
  const result = buildQuotationPresentation(calculateQuotation(quotation([
    adapter('complete'), adapter('pending', { priceState: 'pending', unitPrice: '' }),
  ])).rows)
  assert.equal(result[0].item.lineTotalCents, 10000)
  assert.equal(result[1].item.lineTotalCents, null)
  assert.equal(result[0].item.errors.length, 0)
  assert.ok(result[1].item.errors.length > 0)
})

test('formats valid quantity boundaries and fractions without losing their final thousandth', () => {
  for (const [quantity, expected] of [
    ['0,001', '0,001 unidades'], ['1', '1 unidad'], ['123456789,125', '123.456.789,125 unidades'],
    ['9007199254740,991', '9.007.199.254.740,991 unidades'],
  ]) {
    const result = presentQuotationRow(calculateRow(adapter('quantity', { quantity, priceState: 'included' })))
    assert.equal(result.quantity, `${expected} × 6,5″`)
  }
})

test('preserves legacy adapter text and never infers a size from absent, invalid or misplaced metadata', () => {
  for (const row of [
    adapter('legacy', { concept: 'Aros antiguos de 6,5 pulgadas', adapterVariant: undefined }),
    adapter('invalid', { adapterVariant: { productKey: 'invalid', size: 'unknown', presentation: 'unit' } }),
    adapter('wrong-category', { audioCategory: 'cables' }),
  ]) {
    assert.equal(adapterVariantQuantity(row), undefined)
    assert.equal(presentQuotationRow(calculateRow(row)).concept, row.concept)
    assert.equal(presentQuotationRow(calculateRow(row)).quantity, '')
  }
})

test('ordinary quantity summaries and pending adapter quantities remain explicit without altering drafts', () => {
  const manual = adapter('manual', { adapterVariant: undefined, quantity: '2' })
  assert.equal(presentQuotationRow(calculateRow(manual)).quantity, 'Cantidad: 2')
  const pending = adapter('pending', { concept: '', quantity: '' })
  const snapshot = structuredClone(pending)
  const result = presentQuotationRow(calculateRow(pending))
  assert.equal(result.concept, 'Concepto pendiente')
  assert.equal(result.quantity, 'Cantidad pendiente unidades × 6,5″')
  assert.deepEqual(pending, snapshot)
})
