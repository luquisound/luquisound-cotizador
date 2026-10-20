import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateQuotation } from '../src/features/quotation/calculation.ts'
import { createQuotation, type QuotationRow } from '../src/features/quotation/model.ts'
import { updateRowUnitPrice } from '../src/features/quotation/row-price.ts'
import { getRowPriceOverride } from '../src/features/quotation/row-provenance.ts'
import { inspectQuotationAvailability } from '../src/features/quotation/quotation-availability.ts'
import { setRowFactoryMode } from '../src/features/quotation/factory-mode.ts'

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

test('price edits accept fifteen characters with local decimal separators and reject sixteen without mutation', () => {
  const original = Object.freeze(row())
  const before = structuredClone(original)
  for (const value of ['123456789012,34', '1.234.567.890,1']) {
    assert.equal(value.length, 15)
    const updated = updateRowUnitPrice(original, value)
    assert.equal(updated.unitPrice, value)
    assert.equal(updated.currency, original.currency)
    assert.equal(updated.quantity, original.quantity)
  }
  for (const value of ['1234567890123,45', '1.234.567.890,12', ' '.repeat(16)]) {
    assert.equal(value.length, 16)
    assert.throws(() => updateRowUnitPrice(original, value), /15 caracteres/)
    assert.deepEqual(original, before)
  }
  for (const value of ['123456789012345', '90071992547410']) {
    assert.ok(value.length <= 15)
    assert.throws(() => updateRowUnitPrice(original, value), /seguro/)
    assert.deepEqual(original, before)
  }
})

test('service price edits use quantity one and resolve a legacy review only through an explicit valid amount', () => {
  for (const audioCategory of ['cables', 'labor'] as const) {
    const original = row({ section: 'extras', audioCategory, quantity: '2', unitPrice: '100' })
    const before = structuredClone(original)
    const updated = updateRowUnitPrice(original, '200,00')
    assert.equal(updated.quantity, '1')
    assert.equal(updated.unitPrice, '200,00')
    assert.equal(updated.currency, 'USD')
    assert.equal(updated.provenance, original.provenance)
    assert.equal(updated.fixedServiceOrigin!.quantity, '2')
    assert.equal(updated.fixedServiceOrigin!.unitPrice, '100')
    assert.equal(calculateQuotation({ ...createQuotation(), exchangeRate: '1.000', rows: [updated] }).rows[0]!.lineTotalCents, 20000)
    assert.deepEqual(original, before)
    const invalid = row({ section: 'extras', audioCategory, quantity: 'legacy invalid quantity' })
    const resolved = updateRowUnitPrice(invalid, '75,25')
    assert.equal(resolved.quantity, '1')
    assert.equal(resolved.priceState, 'priced')
    assert.equal(resolved.fixedServiceOrigin!.requiresPriceReview, false)
    assert.equal(resolved.fixedServiceOrigin!.quantity, invalid.quantity)
    const pending = updateRowUnitPrice(invalid, '')
    assert.equal(pending.priceState, 'pending')
    assert.equal(pending.fixedServiceOrigin!.requiresPriceReview, true)
    for (const rejected of ['1,234', '1234567890123,45']) {
      const snapshot = structuredClone(invalid)
      assert.throws(() => updateRowUnitPrice(invalid, rejected))
      assert.deepEqual(invalid, snapshot)
    }
  }
})

test('factory equipment keeps its priced zero until its mode is explicitly disabled', () => {
  const factory = setRowFactoryMode(row({ audioCategory: 'speakers' }), true)
  const before = structuredClone(factory)
  assert.equal(updateRowUnitPrice(factory, '0'), factory)
  assert.equal(updateRowUnitPrice(factory, '0,00'), factory)
  for (const value of ['', '1', '75,25']) {
    assert.throws(() => updateRowUnitPrice(factory, value), /f\u00e1brica/)
    assert.deepEqual(factory, before)
  }
  const restored = setRowFactoryMode(factory, false)
  assert.equal(updateRowUnitPrice(restored, '75,25').unitPrice, '75,25')
})
