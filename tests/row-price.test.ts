import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateQuotation } from '../src/features/quotation/calculation.ts'
import { createQuotation, type QuotationRow } from '../src/features/quotation/model.ts'
import { updateRowUnitPrice } from '../src/features/quotation/row-price.ts'
import { getRowPriceOverride } from '../src/features/quotation/row-provenance.ts'
import { inspectQuotationAvailability } from '../src/features/quotation/quotation-availability.ts'

function row(changes: Partial<QuotationRow> = {}): QuotationRow {
  return {
    id: 'synthetic-row', section: 'equipment', audioCategory: 'amplifier-dsp',
    concept: 'Synthetic component', detail: 'Original detail', quantity: '2,5',
    currency: 'USD', unitPrice: '10', priceState: 'priced',
    provenance: {
      catalogItemId: 'synthetic-item', originalUnitPrice: '10', originalCurrency: 'USD',
      priceBasis: 'manual', supplier: 'Synthetic supplier', sku: 'SYNTHETIC',
      availabilityPolicy: 'historical-positive',
      stock: { quantity: 3, checkedAt: null, validUntil: null, observation: 'historical', source: { document: 'synthetic.xlsx', date: null } },
    },
    ...changes,
  }
}

test('dedicated price changes preserve every unrelated row field and original trace', () => {
  const original = row()
  const before = structuredClone(original)
  const updated = updateRowUnitPrice(original, '12,50')
  assert.deepEqual(updated, { ...before, unitPrice: '12,50', priceState: 'priced' })
  assert.deepEqual(original, before)
  assert.equal(updated.provenance, original.provenance)
  assert.equal(getRowPriceOverride(updated), true)
  assert.equal(getRowPriceOverride(updateRowUnitPrice(updated, '10,00')), false)
  const quotation = { ...createQuotation(), exchangeRate: '1.000', rows: [updated] }
  assert.equal(calculateQuotation(quotation).rows[0]?.lineTotalCents, 3125)
  assert.equal(calculateQuotation(quotation).totals.ARS, 3125000)
})

test('zero remains a normal valid price and blank becomes pending without approving a missing value', () => {
  const original = row({ provenance: undefined })
  const zero = updateRowUnitPrice(original, '0')
  assert.equal(zero.priceState, 'priced')
  assert.equal(calculateQuotation({ ...createQuotation(), exchangeRate: '1.000', rows: [zero] }).canExport, true)
  for (const value of ['', '   ']) {
    const pending = updateRowUnitPrice(original, value)
    assert.equal(pending.priceState, 'pending')
    assert.equal(pending.unitPrice, value)
    assert.equal(calculateQuotation({ ...createQuotation(), exchangeRate: '1.000', rows: [pending] }).canExport, false)
  }
})

test('included zero stays explicitly included; positive and blank changes are intentional', () => {
  const included = row({ unitPrice: '99', priceState: 'included' })
  assert.equal(updateRowUnitPrice(included, '0'), included)
  assert.equal(updateRowUnitPrice(included, '0,00'), included)
  assert.deepEqual(updateRowUnitPrice(included, '2'), { ...included, unitPrice: '2', priceState: 'priced' })
  assert.deepEqual(updateRowUnitPrice(included, ''), { ...included, unitPrice: '', priceState: 'pending' })
})

test('invalid prices never alter the current row or bypass safe-money validation', () => {
  const original = Object.freeze(row())
  const before = structuredClone(original)
  for (const value of ['-1', '1.23', '1,234', 'NaN', '1e3', '90071992547409,92']) {
    assert.throws(() => updateRowUnitPrice(original, value))
    assert.deepEqual(original, before)
  }
})

test('unchanged price is a no-op; changing an amount never clears stock protections', () => {
  const original = row()
  assert.equal(updateRowUnitPrice(original, '10'), original)
  const blocked = row({ provenance: { ...original.provenance!, selectionBlock: 'Synthetic conflict' } })
  const updated = updateRowUnitPrice(blocked, '0')
  const quotation = { ...createQuotation(), exchangeRate: '1.000', rows: [updated] }
  assert.ok(inspectQuotationAvailability(quotation, []).issues.length > 0)
  assert.equal(updated.provenance?.selectionBlock, 'Synthetic conflict')
})
