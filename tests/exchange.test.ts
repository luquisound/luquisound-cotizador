import assert from 'node:assert/strict'
import { test } from 'node:test'
import { convertMixedTotals, convertTotals, parseExchangeRate } from '../src/features/quotation/exchange.ts'
import type { Currency } from '../src/features/quotation/model.ts'

test('mixed conversion preserves the existing single-currency contract exactly', () => {
  for (const currency of ['ARS', 'USD'] as const) {
    for (const cents of [0, 1, 2, 123456, Number.MAX_SAFE_INTEGER]) {
      for (const rate of ['0,000001', '0,5', '1', '1,234567', '1.234,56', '2', '']) {
        const mixed = convertMixedTotals(currency === 'ARS' ? cents : 0, currency === 'USD' ? cents : 0, rate)
        assert.deepEqual(mixed, convertTotals(cents, currency, rate), `${cents} ${currency} at ${rate}`)
      }
    }
  }
})

test('mixed totals convert each foreign subtotal once and preserve half-up boundaries', () => {
  for (const [ars, usd, rate, expectedArs, expectedUsd] of [
    [100000, 2000, '1.000', 2100000, 2100],
    [2, 1, '1,5', 4, 2],
    [1, 1, '0,499999', 1, 3],
    [1, 1, '0,5', 2, 3],
    [1, 1, '1,999999', 3, 2],
    [1, 1, '2,000001', 3, 1],
  ] as const) {
    const result = convertMixedTotals(ars, usd, rate)
    assert.equal(result.ok, true)
    if (result.ok) assert.deepEqual([result.arsCents, result.usdCents], [expectedArs, expectedUsd])
  }
})

test('mixed conversion checks final addition and exact safe limits in both currencies', () => {
  assert.deepEqual(convertMixedTotals(Number.MAX_SAFE_INTEGER - 1, 1, '1'), {
    ok: true, arsCents: Number.MAX_SAFE_INTEGER, usdCents: Number.MAX_SAFE_INTEGER, rateLabel: '1 USD = 1 ARS',
  })
  for (const [ars, usd] of [[Number.MAX_SAFE_INTEGER, 1], [1, Number.MAX_SAFE_INTEGER]]) {
    assert.equal(convertMixedTotals(ars, usd, '1').ok, false)
  }
  assert.deepEqual(convertMixedTotals(0, 1, '9.007.199.254.740.991,000000'), {
    ok: true, arsCents: Number.MAX_SAFE_INTEGER, usdCents: 1,
    rateLabel: '1 USD = 9.007.199.254.740.991,000000 ARS',
  })
  for (const amount of [-1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(convertMixedTotals(amount, 0, '1').ok, false)
    assert.equal(convertMixedTotals(0, amount, '1').ok, false)
  }
})

test('manual exchange rates parse Argentine grouping and preserve entered precision exactly', () => {
  for (const [input, numerator, denominator, normalized] of [
    ['1', 1n, 1n, '1'],
    ['1234,56', 123456n, 100n, '1.234,56'],
    ['1.234,56', 123456n, 100n, '1.234,56'],
    ['1.234', 1234n, 1n, '1.234'],
    ['  001234,560000  ', 1234560000n, 1000000n, '1.234,560000'],
    ['0,000001', 1n, 1000000n, '0,000001'],
    ['9.007.199.254.740.991,000000', 9007199254740991000000n, 1000000n, '9.007.199.254.740.991,000000'],
  ] as const) {
    assert.deepEqual(parseExchangeRate(input), {
      ok: true, numerator, denominator, normalized, rateLabel: `1 USD = ${normalized} ARS`,
    }, input)
  }
})

test('rates require a positive finite amount with unambiguous separators and at most six decimals', () => {
  for (const input of [
    '', ' ', '0', '00', '0,000000', '-1', '-0', '+1', 'NaN', 'Infinity', '1e3', '0x10',
    '1234.56', '1.23', '1,234.56', '1.234,5678901', '1.2345', '0,0000001',
    '1.', '1,', ',5', '.5', '1 234,56', 'ARS 1', '1 USD = 2 ARS', '1\n2',
    '1,000,000', '0.000', '01.234', '9.007.199.254.740.992',
    '9.007.199.254.740.991,000001', '99999999999999999999999999999999999',
    '0'.repeat(65), `${' '.repeat(64)}1`,
  ]) {
    const result = parseExchangeRate(input)
    assert.equal(result.ok, false, input)
    if (!result.ok) assert.ok(result.reason.length > 0, input)
  }
})

test('ARS base divides by the manual rate and leaves original cents unchanged', () => {
  assert.deepEqual(convertTotals(123456, 'ARS', '1.234,56'), {
    ok: true, arsCents: 123456, usdCents: 100, rateLabel: '1 USD = 1.234,56 ARS',
  })
  assert.deepEqual(convertTotals(123456789, 'ARS', '1234,56'), {
    ok: true, arsCents: 123456789, usdCents: 100001, rateLabel: '1 USD = 1.234,56 ARS',
  })
})

test('USD base multiplies by the manual rate and leaves original cents unchanged', () => {
  assert.deepEqual(convertTotals(100, 'USD', '1.234,56'), {
    ok: true, arsCents: 123456, usdCents: 100, rateLabel: '1 USD = 1.234,56 ARS',
  })
  assert.deepEqual(convertTotals(123, 'USD', '1234,56'), {
    ok: true, arsCents: 151851, usdCents: 123, rateLabel: '1 USD = 1.234,56 ARS',
  })
})

test('equivalents round half up once at the final cent in both directions', () => {
  for (const [totalCents, currency, rate, arsCents, usdCents] of [
    [1, 'ARS', '2', 1, 1],
    [1, 'ARS', '2,000001', 1, 0],
    [1, 'ARS', '1,999999', 1, 1],
    [3, 'ARS', '2', 3, 2],
    [1, 'ARS', '3', 1, 0],
    [2, 'ARS', '3', 2, 1],
    [1, 'USD', '0,5', 1, 1],
    [1, 'USD', '0,499999', 0, 1],
    [1, 'USD', '0,500001', 1, 1],
    [3, 'USD', '0,5', 2, 3],
    [1000000, 'USD', '0,000001', 1, 1000000],
  ] as const) {
    const result = convertTotals(totalCents, currency, rate)
    assert.equal(result.ok, true, `${totalCents} ${currency} at ${rate}`)
    if (result.ok) assert.deepEqual([result.arsCents, result.usdCents], [arsCents, usdCents])
  }
})

test('exact integer math preserves the last safe cent and avoids floating-point intermediates', () => {
  assert.deepEqual(convertTotals(Number.MAX_SAFE_INTEGER, 'ARS', '1'), {
    ok: true, arsCents: Number.MAX_SAFE_INTEGER, usdCents: Number.MAX_SAFE_INTEGER,
    rateLabel: '1 USD = 1 ARS',
  })
  assert.deepEqual(convertTotals(Number.MAX_SAFE_INTEGER, 'USD', '0,5'), {
    ok: true, arsCents: 4503599627370496, usdCents: Number.MAX_SAFE_INTEGER,
    rateLabel: '1 USD = 0,5 ARS',
  })
  assert.deepEqual(convertTotals(Number.MAX_SAFE_INTEGER, 'ARS', '2'), {
    ok: true, arsCents: Number.MAX_SAFE_INTEGER, usdCents: 4503599627370496,
    rateLabel: '1 USD = 2 ARS',
  })
})

test('conversion rejects invalid or unsafe totals and unknown runtime currencies', () => {
  for (const total of [-1, 0.1, Number.MAX_SAFE_INTEGER + 1, Number.NaN, Infinity, -Infinity]) {
    const result = convertTotals(total, 'ARS', '1')
    assert.equal(result.ok, false, String(total))
    if (!result.ok) assert.match(result.reason, /total base/)
  }
  for (const currency of ['', 'EUR', 'ars']) {
    const result = convertTotals(100, currency as Currency, '1')
    assert.equal(result.ok, false, currency)
    if (!result.ok) assert.match(result.reason, /moneda base/)
  }
})

test('invalid or pending rates block conversion even for a zero base total', () => {
  for (const currency of ['ARS', 'USD'] as const) {
    for (const rate of ['', '0', '-1', 'Infinity', '0,0000001', '999999999999999999999999']) {
      assert.deepEqual(convertTotals(0, currency, rate), parseExchangeRate(rate), `${currency}: ${rate}`)
    }
    assert.deepEqual(convertTotals(0, currency, '1.234,5600'), {
      ok: true, arsCents: 0, usdCents: 0, rateLabel: '1 USD = 1.234,5600 ARS',
    })
  }
})

test('large and tiny valid rates reject equivalent overflow without returning unsafe amounts', () => {
  for (const [totalCents, currency, rate] of [
    [Number.MAX_SAFE_INTEGER, 'USD', '2'],
    [2, 'USD', '9.007.199.254.740.991'],
    [Number.MAX_SAFE_INTEGER, 'ARS', '0,000001'],
    [9007199255, 'ARS', '0,000001'],
    [Number.MAX_SAFE_INTEGER, 'USD', '1,000001'],
  ] as const) {
    const result = convertTotals(totalCents, currency, rate)
    assert.equal(result.ok, false, `${totalCents} ${currency} at ${rate}`)
    if (!result.ok) assert.match(result.reason, /equivalente.*límite/)
  }
})

test('conversion preserves caller inputs and produces independent repeatable results', () => {
  const source = Object.freeze({ totalCents: 987654, baseCurrency: 'ARS' as const, rateInput: '1234,567890' })
  const snapshot = { ...source }
  const first = convertTotals(source.totalCents, source.baseCurrency, source.rateInput)
  if (first.ok) first.arsCents = 1
  const second = convertTotals(source.totalCents, source.baseCurrency, source.rateInput)
  assert.deepEqual(source, snapshot)
  assert.deepEqual(second, {
    ok: true, arsCents: 987654, usdCents: 800, rateLabel: '1 USD = 1.234,567890 ARS',
  })
})
