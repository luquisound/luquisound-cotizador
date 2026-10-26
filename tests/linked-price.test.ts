import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateRow, parseMoney } from '../src/features/quotation/calculation.ts'
import { getLinkedPriceTotal, getUnitPriceFromTotal } from '../src/features/quotation/linked-price.ts'
import { createRow } from '../src/features/quotation/model.ts'

test('unit edits derive a native line total using Argentine money and ungrouped quantity separators', () => {
  assert.deepEqual(getLinkedPriceTotal('25.000', '4'), { ok: true, cents: 10000000, input: '100.000,00' })
  assert.deepEqual(getLinkedPriceTotal('12,34', '2,5'), { ok: true, cents: 3085, input: '30,85' })
  assert.deepEqual(getLinkedPriceTotal('12,34', '2.5'), { ok: true, cents: 3085, input: '30,85' })
  assert.deepEqual(getLinkedPriceTotal('0', '4'), { ok: true, cents: 0, input: '0' })
})

test('total edits derive a rounded unit price and report the actual total that will be saved', () => {
  assert.deepEqual(getUnitPriceFromTotal('100.000', '4'), { ok: true, unitPrice: '25.000,00', totalCents: 10000000, adjusted: false })
  assert.deepEqual(getUnitPriceFromTotal('100', '3'), { ok: true, unitPrice: '33,33', totalCents: 9999, adjusted: true })
  assert.deepEqual(getUnitPriceFromTotal('100,01', '3'), { ok: true, unitPrice: '33,34', totalCents: 10002, adjusted: true })
  assert.deepEqual(getUnitPriceFromTotal('30,85', '2,5'), { ok: true, unitPrice: '12,34', totalCents: 3085, adjusted: false })
  assert.deepEqual(getUnitPriceFromTotal('0', '4'), { ok: true, unitPrice: '0', totalCents: 0, adjusted: false })
})

test('half-cent ties and values on either side use exact half-up rounding in both directions', () => {
  assert.deepEqual(getLinkedPriceTotal('0,01', '0,5'), { ok: true, cents: 1, input: '0,01' })
  assert.deepEqual(getLinkedPriceTotal('0,01', '0,499'), { ok: true, cents: 0, input: '0' })
  assert.deepEqual(getLinkedPriceTotal('0,01', '0,501'), { ok: true, cents: 1, input: '0,01' })
  assert.deepEqual(getUnitPriceFromTotal('0,01', '2'), { ok: true, unitPrice: '0,01', totalCents: 2, adjusted: true })
  assert.deepEqual(getUnitPriceFromTotal('0,01', '2,001'), { ok: true, unitPrice: '0', totalCents: 0, adjusted: true })
  assert.deepEqual(getUnitPriceFromTotal('0,01', '1,999'), { ok: true, unitPrice: '0,01', totalCents: 2, adjusted: true })
})

test('forward totals match the quotation calculator for fractional quantities and both native currencies', () => {
  for (const currency of ['ARS', 'USD'] as const) {
    for (const unitPrice of ['0', '0,01', '0,99', '12,34', '25.000', '999.999.999,99']) {
      for (const quantity of ['0,001', '0,499', '0,5', '1', '2,5', '3', '20,001']) {
        const linked = getLinkedPriceTotal(unitPrice, quantity)
        assert.ok(linked.ok)
        const calculated = calculateRow({ ...createRow(), concept: 'Synthetic product', currency, unitPrice, quantity, priceState: 'priced' })
        assert.equal(linked.cents, calculated.lineTotalCents)
        const parsed = parseMoney(linked.input)
        assert.ok(parsed.ok)
        assert.equal(parsed.cents, linked.cents)
      }
    }
  }
})

test('derived input formatting prefers groups, then ungrouped decimals and minimal exact text within the input bound', () => {
  assert.deepEqual(getLinkedPriceTotal('999999999', '1'), { ok: true, cents: 99999999900, input: '999.999.999,00' })
  assert.deepEqual(getLinkedPriceTotal('9999999999', '1'), { ok: true, cents: 999999999900, input: '9999999999,00' })
  assert.deepEqual(getUnitPriceFromTotal('9999999999', '1'), { ok: true, unitPrice: '9999999999,00', totalCents: 999999999900, adjusted: false })
  assert.deepEqual(getUnitPriceFromTotal('999999999999', '1'), { ok: true, unitPrice: '999999999999,00', totalCents: 99999999999900, adjusted: false })
  assert.deepEqual(getUnitPriceFromTotal('1000000000000', '1'), { ok: true, unitPrice: '1000000000000', totalCents: 100000000000000, adjusted: false })
  assert.deepEqual(getUnitPriceFromTotal('1000000000000,1', '1'), { ok: true, unitPrice: '1000000000000,1', totalCents: 100000000000010, adjusted: false })
  assert.deepEqual(getUnitPriceFromTotal('9999999999999', '0,3'), { ok: true, unitPrice: '33333333333330', totalCents: 999999999999900, adjusted: false })
  assert.deepEqual(getLinkedPriceTotal('1000000000000,10', '1'), { ok: true, cents: 100000000000010, input: '1000000000000,1' })
  const tooLong = getUnitPriceFromTotal('9999999999998', '0,3')
  assert.equal(tooLong.ok, false)
  if (!tooLong.ok) assert.match(tooLong.reason, /15 caracteres/)
})

test('safe historical prices and large quantity totals remain readable without a manual-edit allowance', () => {
  assert.deepEqual(getLinkedPriceTotal('90.071.992.547.409,91', '1'), {
    ok: true, cents: Number.MAX_SAFE_INTEGER, input: '90.071.992.547.409,91',
  })
  assert.deepEqual(getLinkedPriceTotal('1.000.000.000', '1000'), {
    ok: true, cents: 100000000000000, input: '1000000000000',
  })
  const manual = getUnitPriceFromTotal('1.000.000.000.000,00', '1000')
  assert.equal(manual.ok, false)
  if (!manual.ok) assert.match(manual.reason, /15 caracteres/)
})

test('invalid amounts and nonpositive, malformed or unsafe quantities are rejected', () => {
  for (const unitPrice of ['', '-1', '1,001', '1.25', 'abc', '90071992547409,92']) {
    assert.equal(getLinkedPriceTotal(unitPrice, '1').ok, false, unitPrice)
    assert.equal(getUnitPriceFromTotal(unitPrice, '1').ok, false, unitPrice)
  }
  for (const quantity of ['', '0', '0,000', '-1', '1.000,5', '0,0001', 'abc', '9007199254740,992']) {
    assert.equal(getLinkedPriceTotal('10', quantity).ok, false, quantity)
    assert.equal(getUnitPriceFromTotal('10', quantity).ok, false, quantity)
  }
})

test('manual input bounds and safe-cent checks reject instead of truncating or overflowing', () => {
  const overlong = getUnitPriceFromTotal('0000000000000001', '1')
  assert.equal(overlong.ok, false)
  if (!overlong.ok) assert.match(overlong.reason, /15 caracteres/)
  const lineOverflow = getLinkedPriceTotal('90.071.992.547.409,91', '1,001')
  assert.equal(lineOverflow.ok, false)
  if (!lineOverflow.ok) assert.match(lineOverflow.reason, /límite de cálculo seguro/)
  const unitOverflow = getUnitPriceFromTotal('1000000000000', '0,001')
  assert.equal(unitOverflow.ok, false)
  if (!unitOverflow.ok) assert.match(unitOverflow.reason, /límite de cálculo seguro/)
  const roundedTotalOverflow = getUnitPriceFromTotal('90071992547409', '8999000000000')
  assert.equal(roundedTotalOverflow.ok, false)
  if (!roundedTotalOverflow.ok) assert.match(roundedTotalOverflow.reason, /subtotal.*límite de cálculo seguro/)
})
