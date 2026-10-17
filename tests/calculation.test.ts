import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  calculateQuotation,
  formatMoney,
  isEmptyRow,
  parseMoney,
  parseQuantity,
} from '../src/features/quotation/calculation.ts'
import type { Currency, Quotation, QuotationRow } from '../src/features/quotation/model.ts'

function row(overrides: Partial<QuotationRow> = {}): QuotationRow {
  return {
    id: 'synthetic-row', section: 'equipment', currency: 'ARS', concept: 'Concepto de prueba', detail: '',
    quantity: '1', unitPrice: '10', priceState: 'priced', ...overrides,
  }
}

function quotation(rows: QuotationRow[], overrides: Partial<Quotation> = {}): Quotation {
  return {
    id: 'synthetic-quotation', title: 'PRUEBA', subtitle: '', currency: 'ARS', exchangeRate: '1', rows, notes: '',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

test('money preserves Argentine decimals and explicit zero as integer cents', () => {
  for (const [input, cents] of [
    ['0', 0], ['0,00', 0], ['0,01', 1], ['1', 100], ['1,2', 120],
    ['1234,56', 123456], ['1.234,56', 123456], ['1.234', 123400],
    ['12.345.678,90', 1234567890], ['  0012,05  ', 1205],
    ['90.071.992.547.409,91', Number.MAX_SAFE_INTEGER],
  ] as const) {
    assert.deepEqual(parseMoney(input), { ok: true, cents }, input)
  }
})

test('money rejects empty, negative, ambiguous, nonfinite, and overprecise inputs', () => {
  for (const input of [
    '', ' ', '-1', '-0', '+1', 'NaN', 'Infinity', '1e3', '0x10',
    '1,234', '1234.56', '1.23', '1,234.56', '1.234,567', '1.2345',
    '1.', '1,', ',5', '.5', '1 234,56', '$1', 'ARS 1', '1\n2',
    '90.071.992.547.409,92', '90071992547409999999999999999999999',
  ]) {
    const result = parseMoney(input)
    assert.equal(result.ok, false, input)
    if (!result.ok) assert.ok(result.reason.length > 0)
  }
})

test('quantity supports ungrouped positive decimals with up to three places', () => {
  for (const [input, thousandths] of [
    ['1', 1000], ['0,001', 1], ['0.001', 1], ['1,25', 1250], ['1.250', 1250],
    ['12,345', 12345], [' 002,50 ', 2500],
    ['9007199254740,991', Number.MAX_SAFE_INTEGER],
  ] as const) {
    assert.deepEqual(parseQuantity(input), { ok: true, thousandths }, input)
  }
})

test('quantity requires a value and rejects zero, grouping, overflow, and excess precision', () => {
  for (const input of [
    '', ' ', '0', '0,000', '-1', '+1', 'NaN', 'Infinity', '1e3',
    '1,2345', '1.2345', '1.000,5', '1,000.5', '1.000.000', '1 000',
    ',5', '.5', '1.', '1,', '9007199254740,992',
  ]) assert.equal(parseQuantity(input).ok, false, input)
})

test('formatting displays the explicit currency without losing the last cent', () => {
  assert.equal(formatMoney(123456, 'ARS'), 'ARS 1.234,56')
  assert.equal(formatMoney(1, 'USD'), 'USD 0,01')
  assert.equal(formatMoney(0, 'ARS'), 'ARS 0,00')
  assert.equal(formatMoney(Number.MAX_SAFE_INTEGER, 'USD'), 'USD 90.071.992.547.409,91')
  for (const cents of [-1, 0.1, Number.MAX_SAFE_INTEGER + 1, Number.NaN, Infinity]) {
    assert.throws(() => formatMoney(cents, 'ARS'), RangeError)
  }
})

test('only truly empty rows are ignored; the default quantity does not create a row', () => {
  const empty = row({ concept: '', unitPrice: '', priceState: 'pending' })
  assert.equal(isEmptyRow(empty), true)
  assert.equal(isEmptyRow({ ...empty, quantity: '' }), true)
  assert.equal(isEmptyRow({ ...empty, quantity: '1,000' }), true)
  for (const changed of [
    { concept: 'Prueba' }, { detail: 'Detalle' }, { unitPrice: '0' },
    { priceState: 'included' as const }, { priceState: 'priced' as const },
    { quantity: '2' }, { quantity: '0' }, { quantity: 'inválida' },
  ]) assert.equal(isEmptyRow({ ...empty, ...changed }), false)
})

test('quantity times unit price rounds each line half up before summing', () => {
  const result = calculateQuotation(quotation([
    row({ id: 'a', quantity: '1,5', unitPrice: '0,01' }),
    row({ id: 'b', quantity: '0,499', unitPrice: '0,01' }),
    row({ id: 'c', quantity: '2,345', unitPrice: '12,34' }),
    row({ id: 'd', quantity: '0,001', unitPrice: '5' }),
  ]))
  assert.deepEqual(result.rows.map((item) => item.lineTotalCents), [2, 0, 2894, 1])
  assert.equal(result.nativeTotals.ARS, 2897)
  assert.equal(result.itemsComplete, true)
  assert.equal(result.canExport, true)
  assert.deepEqual(result.issues, [])
})

test('line rounding does not accumulate unrounded fractions across rows', () => {
  const result = calculateQuotation(quotation([
    row({ id: 'a', quantity: '0,5', unitPrice: '0,01' }),
    row({ id: 'b', quantity: '0,5', unitPrice: '0,01' }),
  ]))
  assert.equal(result.nativeTotals.ARS, 2)
})

test('pending, explicit zero, and included retain distinct meanings', () => {
  const result = calculateQuotation(quotation([
    row({ id: 'pending', priceState: 'pending', unitPrice: '' }),
    row({ id: 'zero', unitPrice: '0' }),
    row({ id: 'included', priceState: 'included', unitPrice: '' }),
  ]))
  assert.deepEqual(result.rows.map((item) => item.lineTotalCents), [null, 0, 0])
  assert.equal(result.rows[0].errors.length, 1)
  assert.equal(result.rows[1].row.priceState, 'priced')
  assert.equal(result.rows[2].row.priceState, 'included')
  assert.equal(result.nativeTotals.ARS, 0)
  assert.equal(result.itemsComplete, false)
  assert.equal(result.canExport, false)
  assert.match(result.issues[0], /pendiente/)
  assert.equal(calculateQuotation(quotation(result.rows.slice(1).map((item) => item.row))).canExport, true)
})

test('price state is explicit even when a pending row retains a numeric price', () => {
  const pending = calculateQuotation(quotation([row({ priceState: 'pending', unitPrice: '10' })]))
  assert.equal(pending.canExport, false)
  assert.equal(pending.rows[0].lineTotalCents, null)
  const included = calculateQuotation(quotation([row({ priceState: 'included', unitPrice: '10' })]))
  assert.equal(included.canExport, true)
  assert.equal(included.rows[0].lineTotalCents, 0)
})

test('incomplete or invalid rows block export and do not silently change the subtotal', () => {
  for (const override of [
    { concept: '' }, { quantity: '' }, { quantity: '0' }, { quantity: 'no' },
    { unitPrice: '' }, { unitPrice: '-1' }, { unitPrice: '1,234' },
    { concept: '', detail: 'Detalle sin concepto' },
    { quantity: '', priceState: 'included' as const },
  ]) {
    const result = calculateQuotation(quotation([row(), row({ id: 'invalid', ...override })]))
    assert.equal(result.canExport, false, JSON.stringify(override))
    assert.equal(result.itemsComplete, false)
    assert.equal(result.nativeTotals.ARS, 1000)
    assert.equal(result.rows[1].lineTotalCents, null)
    assert.ok(result.rows[1].errors.length > 0)
    assert.match(result.issues[0], /^Fila 2:/)
  }
})

test('a blank title or no nonempty rows blocks export', () => {
  const untitled = calculateQuotation(quotation([row()], { title: '   ' }))
  assert.equal(untitled.canExport, false)
  assert.equal(untitled.itemsComplete, true)
  for (const rows of [[], [row({ concept: '', unitPrice: '', priceState: 'pending' })]]) {
    const result = calculateQuotation(quotation(rows))
    assert.equal(result.canExport, false)
    assert.equal(result.itemsComplete, false)
    assert.equal(result.rows.length, 0)
    assert.equal(result.nativeTotals.ARS, 0)
    assert.ok(result.issues.length > 0)
  }
})

test('empty rows are excluded and issue numbering refers to the original row', () => {
  const result = calculateQuotation(quotation([
    row({ concept: '', unitPrice: '', priceState: 'pending' }),
    row({ id: 'pending', priceState: 'pending', unitPrice: '' }),
  ]))
  assert.equal(result.rows.length, 1)
  assert.equal(result.rows[0].row.id, 'pending')
  assert.match(result.issues[0], /^Fila 2:/)
})

test('line overflow is rejected even when both parsed inputs are safe', () => {
  const result = calculateQuotation(quotation([
    row({ unitPrice: '90.071.992.547.409,91', quantity: '2' }),
  ]))
  assert.equal(result.nativeTotals.ARS, 0)
  assert.equal(result.rows[0].lineTotalCents, null)
  assert.equal(result.itemsComplete, false)
  assert.equal(result.canExport, false)
  assert.match(result.rows[0].errors[0], /límite/)
})

test('safe intermediate inputs retain precision through multiplication and rounding', () => {
  const result = calculateQuotation(quotation([
    row({ unitPrice: '90.071.992.547.409,91', quantity: '0,5' }),
  ]))
  assert.equal(result.nativeTotals.ARS, 4503599627370496)
  assert.equal(result.canExport, true)
})

test('total overflow blocks export and never returns an unsafe integer', () => {
  const result = calculateQuotation(quotation([
    row({ id: 'max', unitPrice: '90.071.992.547.409,91' }),
    row({ id: 'extra', unitPrice: '0,01' }),
  ]))
  assert.equal(result.rows[0].lineTotalCents, Number.MAX_SAFE_INTEGER)
  assert.equal(result.rows[1].lineTotalCents, 1)
  assert.equal(result.nativeTotals.ARS, 0)
  assert.equal(Number.isSafeInteger(result.nativeTotals.ARS), true)
  assert.equal(result.itemsComplete, false)
  assert.equal(result.canExport, false)
  assert.match(result.issues[0], /total.*límite/)
})

test('many rows, long descriptions, and USD use the same arithmetic without mutating input', () => {
  const rows = Array.from({ length: 200 }, (_, index) => row({
    id: `synthetic-${index}`, concept: 'Concepto de prueba '.repeat(20),
    detail: 'Detalle sintético '.repeat(30), quantity: '0,125', unitPrice: '12,34', currency: 'USD',
  }))
  const input = quotation(rows, { currency: 'USD' })
  const snapshot = structuredClone(input)
  const result = calculateQuotation(input)
  assert.equal(result.nativeTotals.USD, 30800)
  assert.equal(result.rows.length, 200)
  assert.equal(result.canExport, true)
  assert.deepEqual(input, snapshot)
})

test('complete items retain their base total while a manual exchange rate is pending', () => {
  for (const exchangeRate of ['', '   ', undefined]) {
    const result = calculateQuotation(quotation([row()], { exchangeRate }))
    assert.equal(result.nativeTotals.ARS, 1000)
    assert.equal(result.itemsComplete, true)
    assert.equal(result.canExport, false)
    assert.equal(result.conversion.ok, false)
    assert.equal(result.issues.length, 1)
    assert.match(result.issues[0], /tipo de cambio/)
  }
})

test('legacy quotations without an exchange rate never receive an invented rate', () => {
  const input = quotation([row()])
  delete input.exchangeRate
  const result = calculateQuotation(input)
  assert.equal(result.itemsComplete, true)
  assert.equal(result.conversion.ok, false)
  assert.equal(result.canExport, false)
  assert.equal(Object.hasOwn(input, 'exchangeRate'), false)
})

test('invalid manual rates block final export without invalidating completed items', () => {
  for (const exchangeRate of ['0', '-1', '1.25', '1,2345678', 'Infinity', 'incorrecta']) {
    const result = calculateQuotation(quotation([row()], { exchangeRate }))
    assert.equal(result.nativeTotals.ARS, 1000)
    assert.equal(result.itemsComplete, true)
    assert.equal(result.conversion.ok, false)
    assert.equal(result.canExport, false)
    assert.equal(result.issues.length, 1)
  }
})

test('manual conversion preserves ARS and USD base cents in both directions', () => {
  const ars = calculateQuotation(quotation([row({ unitPrice: '0,03' })], { exchangeRate: '2' }))
  assert.equal(ars.nativeTotals.ARS, 3)
  assert.equal(ars.canExport, true)
  assert.deepEqual(ars.conversion, { ok: true, arsCents: 3, usdCents: 2, rateLabel: '1 USD = 2 ARS' })

  const usd = calculateQuotation(quotation([row({ unitPrice: '0,01', currency: 'USD' })], { currency: 'USD', exchangeRate: '1,5' }))
  assert.equal(usd.nativeTotals.USD, 1)
  assert.equal(usd.canExport, true)
  assert.deepEqual(usd.conversion, { ok: true, arsCents: 2, usdCents: 1, rateLabel: '1 USD = 1,5 ARS' })
})

test('conversion rounds the final total after rounding and summing the original rows', () => {
  const result = calculateQuotation(quotation([
    row({ id: 'a', quantity: '0,5', unitPrice: '0,01' }),
    row({ id: 'b', quantity: '0,5', unitPrice: '0,01' }),
  ], { exchangeRate: '2' }))
  assert.equal(result.nativeTotals.ARS, 2)
  assert.deepEqual(result.conversion, { ok: true, arsCents: 2, usdCents: 1, rateLabel: '1 USD = 2 ARS' })
})

test('equivalent-total overflow blocks export while preserving the complete base total', () => {
  for (const [currency, exchangeRate] of [['USD', '2'], ['ARS', '0,000001']] as const) {
    const result = calculateQuotation(quotation([
      row({ unitPrice: '90.071.992.547.409,91', currency }),
    ], { currency, exchangeRate }))
    assert.equal(result.nativeTotals[currency], Number.MAX_SAFE_INTEGER)
    assert.equal(result.itemsComplete, true)
    assert.equal(result.conversion.ok, false)
    assert.equal(result.canExport, false)
    assert.match(result.issues[0], /equivalente.*límite/)
  }
})

test('item completeness stays independent of title and exchange-rate validation', () => {
  const result = calculateQuotation(quotation([row()], { title: '', exchangeRate: '' }))
  assert.equal(result.itemsComplete, true)
  assert.equal(result.canExport, false)
  assert.equal(result.nativeTotals.ARS, 1000)
  assert.equal(result.issues.length, 2)
  assert.match(result.issues[0], /título/)
  assert.match(result.issues[1], /tipo de cambio/)
})

test('zero and included rows still require a deliberate manual rate for both totals', () => {
  const rows = [row({ id: 'zero', unitPrice: '0' }), row({ id: 'included', priceState: 'included', unitPrice: '' })]
  const pending = calculateQuotation(quotation(rows, { exchangeRate: '' }))
  assert.equal(pending.itemsComplete, true)
  assert.equal(pending.nativeTotals.ARS, 0)
  assert.equal(pending.canExport, false)
  assert.equal(pending.conversion.ok, false)

  const complete = calculateQuotation(quotation(rows, { exchangeRate: '2' }))
  assert.equal(complete.itemsComplete, true)
  assert.equal(complete.canExport, true)
  assert.deepEqual(complete.conversion, { ok: true, arsCents: 0, usdCents: 0, rateLabel: '1 USD = 2 ARS' })
})

test('mixed rows preserve native prices and produce both totals independently of the legacy default', () => {
  const rows = [row({ id: 'ars', unitPrice: '1.000' }), row({ id: 'usd', unitPrice: '20', currency: 'USD' })]
  const input = quotation(rows, { currency: 'USD', exchangeRate: '1.000' })
  const snapshot = structuredClone(input)
  const result = calculateQuotation(input)
  assert.deepEqual(result.nativeTotals, { ARS: 100000, USD: 2000 })
  assert.deepEqual(result.totals, { ARS: 2100000, USD: 2100 })
  assert.equal(result.canExport, true)
  assert.deepEqual(result.rows.map(({ row }) => row.currency), ['ARS', 'USD'])
  assert.deepEqual(input, snapshot)
  assert.deepEqual(calculateQuotation({ ...input, rows: [...rows].reverse() }).totals, result.totals)
})

test('mixed totals round foreign subtotals once instead of each conversion or the other total', () => {
  const accumulated = calculateQuotation(quotation([
    row({ id: 'ars-1', unitPrice: '0,01' }),
    row({ id: 'ars-2', unitPrice: '0,01' }),
    row({ id: 'usd', unitPrice: '0,01', currency: 'USD' }),
  ], { exchangeRate: '3' }))
  assert.deepEqual(accumulated.nativeTotals, { ARS: 2, USD: 1 })
  assert.deepEqual(accumulated.totals, { ARS: 5, USD: 2 })
  const independent = calculateQuotation(quotation([
    row({ id: 'ars', unitPrice: '0,02' }),
    row({ id: 'usd', unitPrice: '0,01', currency: 'USD' }),
  ], { exchangeRate: '1,5' }))
  assert.deepEqual(independent.totals, { ARS: 4, USD: 2 })
})

test('mixed quantities round each native line before grouping and conversion', () => {
  const result = calculateQuotation(quotation([
    row({ id: 'ars', unitPrice: '0,01', quantity: '0,5' }),
    row({ id: 'usd', unitPrice: '0,01', quantity: '0,5', currency: 'USD' }),
  ], { exchangeRate: '2' }))
  assert.deepEqual(result.rows.map(({ lineTotalCents }) => lineTotalCents), [1, 1])
  assert.deepEqual(result.totals, { ARS: 3, USD: 2 })
})

test('a missing rate never presents a mixed subtotal as the complete quotation total', () => {
  const rows = [row({ id: 'ars' }), row({ id: 'usd', unitPrice: '5', currency: 'USD' })]
  const mixed = calculateQuotation(quotation(rows, { exchangeRate: '' }))
  assert.deepEqual(mixed.nativeTotals, { ARS: 1000, USD: 500 })
  assert.deepEqual(mixed.totals, { ARS: null, USD: null })
  assert.equal(mixed.itemsComplete, true)
  assert.equal(mixed.canExport, false)
  assert.deepEqual(calculateQuotation(quotation([rows[0]], { exchangeRate: '' })).totals, { ARS: 1000, USD: null })
  assert.deepEqual(calculateQuotation(quotation([rows[1]], { exchangeRate: '' })).totals, { ARS: null, USD: 500 })
})

test('mixed pending, zero, and included rows retain their separate states', () => {
  const rows = [
    row({ id: 'ars-zero', unitPrice: '0' }),
    row({ id: 'usd-included', currency: 'USD', unitPrice: '', priceState: 'included' }),
    row({ id: 'usd-pending', currency: 'USD', unitPrice: '', priceState: 'pending' }),
  ]
  const pending = calculateQuotation(quotation(rows))
  assert.deepEqual(pending.rows.map(({ lineTotalCents }) => lineTotalCents), [0, 0, null])
  assert.deepEqual(pending.totals, { ARS: null, USD: null })
  assert.equal(pending.canExport, false)
  const complete = calculateQuotation(quotation(rows.slice(0, 2)))
  assert.deepEqual(complete.totals, { ARS: 0, USD: 0 })
  assert.equal(complete.canExport, true)
  assert.equal(calculateQuotation(quotation(rows.slice(0, 2), { exchangeRate: '' })).canExport, false)
})

test('overflow is checked for native groups and after adding converted amounts', () => {
  const maxUsd = row({ id: 'usd-max', currency: 'USD', unitPrice: '90.071.992.547.409,91' })
  const nativeOverflow = calculateQuotation(quotation([
    row(), maxUsd, row({ id: 'usd-extra', currency: 'USD', unitPrice: '0,01' }),
  ]))
  assert.deepEqual(nativeOverflow.nativeTotals, { ARS: 1000, USD: 0 })
  assert.equal(nativeOverflow.itemsComplete, false)
  assert.equal(nativeOverflow.canExport, false)
  const combinedOverflow = calculateQuotation(quotation([row({ unitPrice: '0,01' }), maxUsd]))
  assert.equal(combinedOverflow.itemsComplete, true)
  assert.equal(combinedOverflow.conversion.ok, false)
  assert.deepEqual(combinedOverflow.totals, { ARS: null, USD: null })
  assert.equal(combinedOverflow.canExport, false)
})

test('an invalid row currency is rejected instead of added to either native subtotal', () => {
  const result = calculateQuotation(quotation([row({ currency: 'EUR' as Currency })]))
  assert.equal(result.canExport, false)
  assert.deepEqual(result.nativeTotals, { ARS: 0, USD: 0 })
  assert.match(result.rows[0].errors[0], /moneda/)
})
