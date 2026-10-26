import assert from 'node:assert/strict'
import test from 'node:test'
import { getCatalogQuotationTitle } from '../src/features/quotation/catalog-title.ts'

function title(concept: string, sku: string | undefined = 'SYN-A', supplier: string | undefined = 'Instaler'): string {
  return getCatalogQuotationTitle({ concept, sku, supplier })
}

test('Instaler quotation titles remove exact code-only wrappers while retaining model and presentation', () => {
  for (const [concept, expected] of [
    ['Synthetic RX-65 MK-II 6.5-inch (pair) (SYN-A)', 'Synthetic RX-65 MK-II 6.5-inch (pair)'],
    ['Synthetic RX-65 (Class D)(SYN-A)', 'Synthetic RX-65 (Class D)'],
    ['Synthetic RX-65 [ SYN-A ] (set)', 'Synthetic RX-65 (set)'],
    ['{SYN-A} Synthetic RX-65', 'Synthetic RX-65'],
    ['Synthetic [SYN-A] RX-65 (pair)', 'Synthetic RX-65 (pair)'],
    ['(SYN-A) Synthetic RX-65 [SYN-A] (pair)', 'Synthetic RX-65 (pair)'],
  ]) {
    assert.equal(title(concept), expected, concept)
  }
})

test('standalone repeated codes and their edge separators are removed without shortening other words', () => {
  for (const [concept, expected] of [
    ['SYN-A - Synthetic RX-65', 'Synthetic RX-65'],
    ['Synthetic RX-65 | SYN-A', 'Synthetic RX-65'],
    ['SYN-A: Synthetic RX-65', 'Synthetic RX-65'],
    ['Synthetic RX-65; SYN-A', 'Synthetic RX-65'],
    ['SYN-A \u2014 Synthetic RX-65', 'Synthetic RX-65'],
    ['Synthetic RX-65 \u2013 SYN-A', 'Synthetic RX-65'],
    ['Synthetic SYN-A RX-65 (pair)', 'Synthetic RX-65 (pair)'],
    ['SYN-A Synthetic RX-65 SYN-A', 'Synthetic RX-65'],
    ['Synthetic RX-65 (sYn-a)', 'Synthetic RX-65'],
  ]) {
    assert.equal(title(concept, ' SYN-A ', ' instaler '), expected, concept)
  }
})

test('the literal SKU may contain regex punctuation without matching a different code', () => {
  assert.equal(title('Synthetic RX-65 (SYN.A+1)', 'SYN.A+1'), 'Synthetic RX-65')
  assert.equal(title('Synthetic RX-65 [SYN(1)]', 'SYN(1)'), 'Synthetic RX-65')
  assert.equal(title('Synthetic RX-65 {SYN/A1}', 'SYN/A1'), 'Synthetic RX-65')
  assert.equal(title('Synthetic RX-65 (SYNxAAAA1)', 'SYN.A+1'), 'Synthetic RX-65 (SYNxAAAA1)')
})

test('larger codes, Unicode letters and combining marks never become partial matches', () => {
  for (const concept of [
    'Synthetic XSYN-A', 'Synthetic SYN-A2', 'Synthetic SYN-A-EXT',
    'Synthetic SYN-A_EXT', 'Synthetic SYN-A.foo', 'Synthetic SYN-A/EXT',
    'Synthetic SYN-A+EXT', 'Synthetic \u00e9SYN-A', 'Synthetic SYN-A\u00e9',
    'Synthetic SYN-A\u0301', 'Synthetic (SYN-\u00c1)',
  ]) {
    assert.equal(title(concept), concept, concept)
  }
})

test('unmatched titles and catalogue entries without an Instaler SKU remain byte-for-byte unchanged', () => {
  const unchanged = '  Synthetic RX-65 MK-II 6.5-inch (pair)  '
  assert.equal(title(unchanged), unchanged)
  for (const sku of [undefined, '', ' \t ']) {
    assert.equal(getCatalogQuotationTitle({ concept: 'Synthetic (SYN-A)', sku, supplier: 'Instaler' }), 'Synthetic (SYN-A)')
  }
  for (const supplier of [undefined, '', 'Synthetic Supplier', 'Instaler Other']) {
    assert.equal(getCatalogQuotationTitle({ concept: 'Synthetic (SYN-A)', sku: 'SYN-A', supplier }), 'Synthetic (SYN-A)')
  }
})

test('removing a sole code or punctuation-only remainder falls back to the original title', () => {
  for (const concept of ['SYN-A', ' (SYN-A) ', '[SYN-A]', 'SYN-A | (SYN-A)']) {
    assert.equal(title(concept), concept, concept)
  }
})

test('selection title preparation never mutates the original catalogue item or its separate SKU', () => {
  const item = Object.freeze({
    concept: 'Synthetic RX-65 (SYN-A)', sku: 'SYN-A', supplier: 'Instaler',
    detail: 'Synthetic maintained source detail', unitPrice: '123,45',
  })
  const before = structuredClone(item)
  assert.equal(getCatalogQuotationTitle(item), 'Synthetic RX-65')
  assert.deepEqual(item, before)
  assert.equal(item.sku, 'SYN-A')
})
