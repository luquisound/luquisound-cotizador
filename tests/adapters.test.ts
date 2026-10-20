import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeAdapterSize, readAdapterVariant } from '../src/features/quotation/adapters.ts'
import { getAdapterVariant, isDirectExtraRow, selectAdapterVariant } from '../src/features/quotation/audio-categories.ts'
import { createRow, type AdapterVariant, type QuotationRow } from '../src/features/quotation/model.ts'

const variant: AdapterVariant = { productKey: 'synthetic-ring-1', size: '6,5', presentation: 'pair' }

test('adapter sizes normalize positive ungrouped inches without floating-point rounding', () => {
  for (const [input, expected] of [
    ['6.5', '6,5'], ['6,500', '6,5'], [' 06.500 ', '6,5'], ['8', '8'], ['8,000', '8'],
    ['0.001', '0,001'], ['00001,010', '1,01'], ['9007199254740,991', '9007199254740,991'],
  ]) assert.equal(normalizeAdapterSize(input!), expected)
  for (const input of [
    '', ' ', '0', '0,000', '-6,5', '+6,5', '.5', '6.', '6,', '6.5000', '6,5000',
    '1.000,5', '1,000.5', '6 5', '6,5″', '6e1', 'Infinity', '9007199254740,992', '1'.repeat(65),
  ]) assert.equal(normalizeAdapterSize(input), null, input)
})

test('adapter metadata is optional, whitelisted and restricted to its category and section', () => {
  assert.deepEqual(readAdapterVariant({ ...variant, size: '06.500', extra: 'discard' }, 'extras', 'adapters'), variant)
  assert.notEqual(readAdapterVariant(variant, 'extras', 'adapters'), variant)
  for (const section of ['equipment', 'extras'] as const) {
    for (const category of [undefined, 'cables', 'subwoofer'] as const) {
      assert.equal(readAdapterVariant(variant, section, category), undefined)
    }
  }
  assert.equal(readAdapterVariant(variant, 'equipment', 'adapters'), undefined)
  for (const presentation of ['unit', 'pair', 'set'] as const) {
    assert.deepEqual(readAdapterVariant({ ...variant, presentation }, 'extras', 'adapters'), { ...variant, presentation })
  }
})

test('malformed adapter metadata never supplies a partial product identity', () => {
  for (const value of [
    undefined, null, [], {}, 5, true, '6,5',
    ...['', 'with spaces', '../path', 'x'.repeat(129), 1, null].map((productKey) => ({ ...variant, productKey })),
    ...['', '0', '6,5000', 6.5, null].map((size) => ({ ...variant, size })),
    ...['', 'pairs', 'PAIR', null, 1].map((presentation) => ({ ...variant, presentation })),
  ]) assert.equal(readAdapterVariant(value, 'extras', 'adapters'), undefined)
  const key = 'A_0-'.repeat(32)
  assert.equal(readAdapterVariant({ ...variant, productKey: key }, 'extras', 'adapters')?.productKey, key)
})

test('direct adapter editing preserves unit presets and leaves pairs, sets and custom variants in the full editor', () => {
  const row: QuotationRow = {
    ...createRow('extras'), audioCategory: 'adapters', concept: 'Aros adaptadores 3D 6,5 pulgadas',
    adapterVariant: { productKey: 'synthetic-unit', size: '6,5', presentation: 'unit' },
  }
  assert.equal(isDirectExtraRow(row), true)
  assert.equal(isDirectExtraRow({ ...row, adapterVariant: undefined }), true)
  for (const presentation of ['pair', 'set'] as const) {
    assert.equal(isDirectExtraRow({ ...row, adapterVariant: { ...row.adapterVariant!, presentation } }), false)
  }
  for (const size of ['8', '10', 'bad-size']) {
    assert.equal(isDirectExtraRow({ ...row, adapterVariant: { ...row.adapterVariant!, size } }), false)
  }
  assert.equal(isDirectExtraRow({ ...row, concept: 'Synthetic custom adapter' }), false)
  assert.equal(isDirectExtraRow({
    ...row, provenance: { catalogItemId: 'synthetic', originalUnitPrice: '', originalCurrency: 'ARS', priceBasis: 'pending' },
  }), false)
})

test('recognizing and selecting approved legacy adapter presets never infers persisted identity', () => {
  const row: QuotationRow = {
    ...createRow('extras'), audioCategory: 'adapters', concept: 'Aros adaptadores 3D 6,5 pulgadas',
    quantity: '2', unitPrice: '17,25', priceState: 'priced',
  }
  const snapshot = structuredClone(row)
  assert.equal(getAdapterVariant(row.concept)?.id, '6.5')
  assert.equal(isDirectExtraRow(row), true)
  assert.deepEqual(row, snapshot)
  const selected = selectAdapterVariant(row, '8')
  assert.equal(selected.unitPrice, '35.000')
  assert.equal(selected.currency, 'ARS')
  assert.equal(selected.quantity, '2')
  assert.equal(Object.hasOwn(selected, 'adapterVariant'), false)
  assert.deepEqual(row, snapshot)
})
