import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateQuotation } from '../src/features/quotation/calculation.ts'
import {
  adapterVariantAmount, adapterVariantDescription, buildQuotationPresentation,
} from '../src/features/quotation/presentation.ts'
import type { AdapterPresentationBlock } from '../src/features/quotation/presentation.ts'
import type { Quotation, QuotationRow } from '../src/features/quotation/model.ts'

function adapter(id: string, changes: Partial<QuotationRow> = {}): QuotationRow {
  return {
    id, section: 'extras', audioCategory: 'adapters', currency: 'ARS',
    concept: 'Aros adaptadores 3D', detail: '', quantity: '1', unitPrice: '100', priceState: 'priced',
    adapterVariant: { productKey: 'manual-synthetic-ring', size: '6,5', presentation: 'unit' },
    ...changes,
  }
}

function present(rows: QuotationRow[]) {
  const quotation: Quotation = {
    id: 'synthetic', title: 'PRESUPUESTO', subtitle: '', currency: 'ARS', exchangeRate: '1000',
    rows, notes: '', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  }
  return buildQuotationPresentation(calculateQuotation(quotation).rows)
}

function onlyGroup(rows: QuotationRow[]): AdapterPresentationBlock {
  const result = present(rows)
  assert.equal(result.length, 1)
  const block = result[0]
  assert.equal(block.kind, 'adapters')
  if (block.kind !== 'adapters') throw new Error('Expected an adapter group.')
  return block
}

test('groups explicit adapter variants with quantities, sale presentations and native subtotal', () => {
  const rows = [
    adapter('small', { quantity: '2', adapterVariant: { productKey: 'small', size: '6,5', presentation: 'pair' } }),
    adapter('large', { quantity: '3', adapterVariant: { productKey: 'large', size: '8', presentation: 'set' } }),
  ]
  const snapshot = structuredClone(rows)
  const block = onlyGroup(rows)
  assert.equal(block.title, 'Aros adaptadores 3D')
  assert.deepEqual(block.details, ['2 pares × 6,5″ · ARS 200,00', '3 juegos × 8″ · ARS 300,00'])
  assert.deepEqual(block.amounts, ['ARS 500,00'])
  assert.deepEqual(block.items.map(({ row }) => row.id), ['small', 'large'])
  assert.equal(block.pending, false)
  assert.deepEqual(rows, snapshot)
})

test('preserves single quantities, custom descriptions and manual details in the adapter breakdown', () => {
  const block = onlyGroup([adapter('custom', {
    concept: 'Aro de prueba reforzado', detail: 'Terminación especial\nDetalle final',
    adapterVariant: { productKey: 'custom', size: '6.50', presentation: 'pair' },
  })])
  assert.deepEqual(block.details, [
    '1 par × 6,5″ · Aro de prueba reforzado · Terminación especial\nDetalle final · ARS 100,00',
  ])
})

test('exposes separate adapter descriptions and amounts for individual editing controls', () => {
  const block = onlyGroup([adapter('editable', { quantity: '2' })])
  assert.equal(adapterVariantDescription(block.items[0]), '2 unidades × 6,5″')
  assert.equal(adapterVariantAmount(block.items[0]), 'ARS 200,00')
  assert.equal(block.details[0], `${adapterVariantDescription(block.items[0])} · ${adapterVariantAmount(block.items[0])}`)
})

test('sums rounded source rows instead of recalculating a combined quantity', () => {
  const block = onlyGroup([
    adapter('fraction-a', { quantity: '0,5', unitPrice: '0,01' }),
    adapter('fraction-b', { quantity: '0,5', unitPrice: '0,01' }),
  ])
  assert.deepEqual(block.items.map(({ lineTotalCents }) => lineTotalCents), [1, 1])
  assert.deepEqual(block.amounts, ['ARS 0,02'])
})

test('keeps ARS and USD subtotals separate and included variants explicit', () => {
  const block = onlyGroup([
    adapter('ars', { quantity: '2' }),
    adapter('usd', { currency: 'USD', unitPrice: '5' }),
    adapter('included', { currency: 'USD', priceState: 'included', unitPrice: '' }),
  ])
  assert.deepEqual(block.amounts, ['ARS 200,00', 'USD 5,00'])
  assert.equal(block.details[2], '1 unidad × 6,5″ · Incluido')
})

test('distinguishes included groups from explicitly zero-priced groups', () => {
  assert.deepEqual(onlyGroup([adapter('included', { priceState: 'included' })]).amounts, ['Incluido'])
  const zero = onlyGroup([
    adapter('zero', { unitPrice: '0' }), adapter('included', { priceState: 'included' }),
  ])
  assert.deepEqual(zero.amounts, ['ARS 0,00'])
  assert.match(zero.details[0], /ARS 0,00$/)
  assert.match(zero.details[1], /Incluido$/)
})

test('marks incomplete adapter groups pending without presenting a partial subtotal as complete', () => {
  const block = onlyGroup([
    adapter('complete'), adapter('pending', { priceState: 'pending', unitPrice: '' }),
  ])
  assert.equal(block.pending, true)
  assert.deepEqual(block.amounts, ['Pendiente'])
  assert.match(block.details[0], /ARS 100,00$/)
  assert.match(block.details[1], /Pendiente$/)
})

test('guards group subtotals that exceed the safe integer range', () => {
  const block = onlyGroup([
    adapter('large-a', { unitPrice: '90071992547409,91' }),
    adapter('large-b', { unitPrice: '0,01' }),
  ])
  assert.equal(block.pending, true)
  assert.deepEqual(block.amounts, ['Pendiente'])
})

test('formats valid quantity boundaries and fractions without losing their final thousandth', () => {
  for (const [quantity, expected] of [
    ['0,001', '0,001 unidades'], ['1', '1 unidad'], ['123456789,125', '123.456.789,125 unidades'],
    ['9007199254740,991', '9.007.199.254.740,991 unidades'],
  ]) {
    const block = onlyGroup([adapter('quantity', { quantity, priceState: 'included' })])
    assert.equal(block.details[0], `${expected} × 6,5″ · Incluido`)
  }
})

test('preserves legacy adapter rows and ignores absent, invalid or misplaced metadata', () => {
  const rows = [
    adapter('legacy', { concept: 'Aros antiguos de 6,5 pulgadas', adapterVariant: undefined }),
    adapter('invalid', { adapterVariant: { productKey: 'invalid', size: 'unknown', presentation: 'unit' } }),
    adapter('wrong-category', { audioCategory: 'cables' }),
  ]
  const result = present(rows)
  assert.ok(result.every((item) => item.kind === 'row'))
  assert.deepEqual(result.map((item) => item.kind === 'row' ? item.item.row.id : ''), [
    'wrong-category', 'legacy', 'invalid',
  ])
})

test('keeps repeated equipment independent and canonical ordering stable around adapter groups', () => {
  const result = present([
    adapter('labor', { audioCategory: 'labor', adapterVariant: undefined }),
    adapter('small'),
    adapter('bass-a', { section: 'equipment', audioCategory: 'subwoofer', adapterVariant: undefined }),
    adapter('legacy', { adapterVariant: undefined }),
    adapter('large', { adapterVariant: { productKey: 'large', size: '8', presentation: 'unit' } }),
    adapter('bass-b', { section: 'equipment', audioCategory: 'subwoofer', adapterVariant: undefined }),
  ])
  assert.deepEqual(result.map((item) => item.kind === 'row' ? item.item.row.id : 'group'), [
    'bass-a', 'bass-b', 'group', 'legacy', 'labor',
  ])
  const group = result[2]
  assert.equal(group.kind, 'adapters')
  if (group.kind === 'adapters') assert.deepEqual(group.items.map(({ row }) => row.id), ['small', 'large'])
})
