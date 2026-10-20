import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyCatalogStock, parseCatalogStockFields } from '../src/features/quotation/catalog-stock.ts'
import type { CatalogStockSnapshot } from '../src/features/quotation/catalog-stock.ts'

const checkedAt = '2026-10-17T10:00:00.000Z'
const validUntil = '2026-10-17T10:15:00.000Z'
const now = Date.parse('2026-10-17T10:05:00.000Z')

function snapshot(quantity: number | null): CatalogStockSnapshot {
  return {
    quantity, checkedAt, validUntil,
    source: { document: 'Synthetic private source', sheet: 'Products', row: 2, date: null },
  }
}

test('stock keeps an explicit zero distinct from unknown without assigning a default validity period', () => {
  for (const quantity of [null, -Number.MAX_SAFE_INTEGER, -2.75, 0, 0.125, 1, 27.375, Number.MAX_SAFE_INTEGER]) {
    assert.deepEqual(parseCatalogStockFields(quantity, checkedAt, validUntil), { quantity, checkedAt, validUntil })
  }
  assert.equal(parseCatalogStockFields(0, checkedAt, undefined), null)
  assert.equal(parseCatalogStockFields(undefined, checkedAt, validUntil), null)
})

test('stock rejects non-finite, coerced and unsafe quantities while preserving signed observations', () => {
  assert.equal(parseCatalogStockFields(-1, checkedAt, validUntil)?.quantity, -1)
  for (const quantity of ['0', '0.5', '', false, Number.NaN, Infinity, -Infinity,
    Number.MAX_SAFE_INTEGER + 1, -Number.MAX_SAFE_INTEGER - 1]) {
    assert.equal(parseCatalogStockFields(quantity, checkedAt, validUntil), null)
  }
})

test('decimal stock keeps its sign and value without truncation or changing freshness', () => {
  for (const quantity of [-2.75, 0.125, 27.375]) {
    const stock = snapshot(quantity)
    const before = structuredClone(stock)
    assert.equal(classifyCatalogStock(stock, now), quantity < 0 ? 'negative' : 'available')
    assert.equal(classifyCatalogStock(stock, Date.parse(validUntil)), 'stale')
    assert.deepEqual(stock, before)
  }
  assert.equal(classifyCatalogStock(snapshot(0.125), now, 1), 'low')
  assert.equal(classifyCatalogStock(snapshot(1.125), now, 1), 'available')
})

test('stock requires canonical UTC instants and an explicit positive validity interval', () => {
  for (const value of [null, '', '2026-10-17', '2026-02-30T10:00:00.000Z',
    '2026-10-17T10:00:00Z', '2026-10-17T10:00:00.000+00:00', ' 2026-10-17T10:00:00.000Z']) {
    assert.equal(parseCatalogStockFields(0, value, validUntil), null)
    assert.equal(parseCatalogStockFields(0, checkedAt, value), null)
  }
  assert.equal(parseCatalogStockFields(0, checkedAt, checkedAt), null)
  assert.equal(parseCatalogStockFields(0, validUntil, checkedAt), null)
})

test('only a currently valid explicit zero classifies as unavailable', () => {
  assert.equal(classifyCatalogStock(undefined, now), 'unknown')
  assert.equal(classifyCatalogStock(snapshot(null), now), 'unknown')
  assert.equal(classifyCatalogStock(snapshot(0), now), 'out-of-stock')
  assert.equal(classifyCatalogStock(snapshot(1), now), 'available')
  assert.equal(classifyCatalogStock(snapshot(100), now), 'available')
})

test('validity boundaries never turn future or expired zero into current unavailability', () => {
  const zero = snapshot(0)
  assert.equal(classifyCatalogStock(zero, Date.parse(checkedAt) - 1), 'unknown')
  assert.equal(classifyCatalogStock(zero, Date.parse(checkedAt)), 'out-of-stock')
  assert.equal(classifyCatalogStock(zero, Date.parse(validUntil) - 1), 'out-of-stock')
  assert.equal(classifyCatalogStock(zero, Date.parse(validUntil)), 'stale')
  assert.equal(classifyCatalogStock(zero, Date.parse(validUntil) + 1), 'stale')
  assert.equal(classifyCatalogStock(snapshot(null), Date.parse(validUntil)), 'stale')
  assert.equal(classifyCatalogStock(zero, Number.NaN), 'unknown')
})

test('low stock requires an explicitly supplied threshold and never replaces zero or stale states', () => {
  assert.equal(classifyCatalogStock(snapshot(2), now), 'available')
  assert.equal(classifyCatalogStock(snapshot(2), now, 3), 'low')
  assert.equal(classifyCatalogStock(snapshot(3), now, 3), 'low')
  assert.equal(classifyCatalogStock(snapshot(4), now, 3), 'available')
  assert.equal(classifyCatalogStock(snapshot(0), now, 3), 'out-of-stock')
  assert.equal(classifyCatalogStock(snapshot(1), Date.parse(validUntil), 3), 'stale')
  for (const threshold of [0, -1, 0.5, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => classifyCatalogStock(snapshot(2), now, threshold), RangeError)
  }
})

test('classification does not mutate observations or manufacture a new freshness timestamp', () => {
  const stock = snapshot(0)
  const original = structuredClone(stock)
  assert.equal(classifyCatalogStock(stock, now), 'out-of-stock')
  assert.equal(classifyCatalogStock(stock, Date.parse(validUntil)), 'stale')
  assert.deepEqual(stock, original)
  assert.equal(classifyCatalogStock({ ...stock, quantity: -1 }, now), 'negative')
  assert.equal(classifyCatalogStock({ ...stock, checkedAt: '' }, now), 'unknown')
})
