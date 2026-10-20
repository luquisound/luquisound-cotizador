import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateRow, parseMoney } from '../src/features/quotation/calculation.ts'
import { setRowFactoryMode, isFactoryRow } from '../src/features/quotation/factory-mode.ts'
import { createQuotation, createRow, type QuotationRow } from '../src/features/quotation/model.ts'
import { parseWorkspace, serializeWorkspace } from '../src/features/quotation/persistence.ts'
import {
  createQuotationLibrary, openLibraryQuotation, parseQuotationLibraryBackup, saveQuotationToLibrary, serializeQuotationLibrary,
} from '../src/features/quotation/quotation-library.ts'
import {
  changePriceCurrency, changeRowCurrency, clearRowCurrencyConversion, parseRowCurrencyConversionOrigin,
} from '../src/features/quotation/row-currency.ts'
import { loadCurrentQuotation, saveCurrentQuotation } from '../src/features/quotation/working-storage.ts'
import { updateRowUnitPrice } from '../src/features/quotation/row-price.ts'

function row(changes: Partial<QuotationRow> = {}): QuotationRow {
  return {
    ...createRow(), audioCategory: 'speakers', concept: 'Synthetic component', detail: 'Retained detail',
    quantity: '2,5', unitPrice: '25.000', priceState: 'priced',
    provenance: {
      catalogItemId: 'synthetic-component', source: { document: 'Synthetic private source', date: null },
      originalCurrency: 'ARS', originalUnitPrice: '25.000', priceBasis: 'manual',
    },
    ...changes,
  }
}

test('explicit item currency changes convert the unit amount with the supplied quotation rate and keep every other field', () => {
  const original = Object.freeze(row())
  const before = structuredClone(original)
  const usd = changeRowCurrency(original, 'USD', '1.100')
  assert.equal(usd.currency, 'USD')
  assert.equal(usd.unitPrice, '22,73')
  assert.equal(usd.quantity, '2,5')
  assert.equal(usd.priceState, 'priced')
  assert.equal(usd.provenance, original.provenance)
  assert.deepEqual(original, before)
  assert.deepEqual(clearRowCurrencyConversion(usd), { ...before, currency: 'USD', unitPrice: '22,73' })
  const ars = changeRowCurrency(row({ currency: 'USD', unitPrice: '12,34' }), 'ARS', '1.100')
  assert.equal(ars.unitPrice, '13.574,00')
  assert.equal(ars.currency, 'ARS')
  assert.equal(ars.quantity, original.quantity)
  assert.equal(changeRowCurrency(original, 'ARS'), original)
})

test('half-cent boundaries use exact half-up arithmetic while a rounded zero retains its positive base', () => {
  for (const [currency, target, rate, expected] of [
    ['ARS', 'USD', '2', '0,01'], ['ARS', 'USD', '2,000001', '0'],
    ['USD', 'ARS', '0,5', '0,01'], ['USD', 'ARS', '0,499999', '0'],
  ] as const) {
    const converted = changeRowCurrency(row({ currency, unitPrice: '0,01' }), target, rate)
    assert.equal(converted.unitPrice, expected)
    assert.equal(changeRowCurrency(converted, currency, rate).unitPrice, '0,01')
  }
  const zero = changeRowCurrency(row({ unitPrice: '0,01' }), 'USD', '1.000')
  const before = structuredClone(zero)
  assert.equal(zero.unitPrice, '0')
  assert.ok(zero.currencyConversionOrigin)
  assert.throws(() => changeRowCurrency(zero, 'ARS'), /tipo de cambio/)
  assert.deepEqual(zero, before)
  assert.equal(changeRowCurrency(zero, 'ARS', '1000,000000').unitPrice, '0,01')
  const changedRate = changeRowCurrency(zero, 'ARS', '2.000')
  assert.equal(changedRate.unitPrice, '0')
  assert.equal(changedRate.currencyConversionOrigin, undefined)
})

test('repeated currency toggles reuse the exact source amount across equivalent rate spellings', () => {
  for (const currency of ['ARS', 'USD'] as const) {
    for (const unitPrice of ['0,01', '12,34', '25.000', '999.999,99']) {
      for (const rate of ['0,5', '1,5', '2', '1.100', '1234,567890']) {
        const original = row({ currency, unitPrice })
        const before = structuredClone(original)
        let current = original
        for (let iteration = 0; iteration < 10; iteration++) {
          current = changeRowCurrency(current, currency === 'ARS' ? 'USD' : 'ARS', rate)
          current = changeRowCurrency(current, currency, rate)
          assert.equal(current.unitPrice, unitPrice)
          assert.equal(current.currency, currency)
          assert.equal(current.quantity, original.quantity)
          assert.deepEqual(original, before)
        }
      }
    }
  }
  const usd = changeRowCurrency(row(), 'USD', '1100')
  assert.equal(changeRowCurrency(usd, 'ARS', '1.100,000000').unitPrice, '25.000')
})

test('rate, manual amount and price-state changes reset the reusable base to the current value', () => {
  const usd = changeRowCurrency(row(), 'USD', '1.100')
  const newRate = changeRowCurrency(usd, 'ARS', '1.000')
  assert.equal(newRate.unitPrice, '22.730,00')
  assert.equal(newRate.currencyConversionOrigin!.sourceCurrency, 'USD')
  assert.equal(newRate.currencyConversionOrigin!.sourceUnitPrice, '22,73')
  assert.equal(changeRowCurrency(newRate, 'USD', '1.000').unitPrice, '22,73')
  const manuallyEdited = { ...usd, unitPrice: '30' }
  assert.equal(changeRowCurrency(manuallyEdited, 'ARS', '1.100').unitPrice, '33.000,00')
  const sameAmountEdit = clearRowCurrencyConversion(usd)
  assert.equal(sameAmountEdit.currencyConversionOrigin, undefined)
  assert.equal(clearRowCurrencyConversion(sameAmountEdit), sameAmountEdit)
  assert.equal(changeRowCurrency(sameAmountEdit, 'ARS', '1.100').unitPrice, '25.003,00')
  const pending = changeRowCurrency({ ...usd, priceState: 'pending' }, 'ARS', '1.100')
  assert.equal(pending.priceState, 'pending')
  assert.equal(pending.unitPrice, '25.003,00')
})

test('blank and native zero amounts change currency without a rate and never approve pending or included states', () => {
  for (const priceState of ['pending', 'priced', 'included'] as const) {
    for (const unitPrice of ['', '   ', '0', '0,00']) {
      const original = row({ unitPrice, priceState })
      const changed = changeRowCurrency(original, 'USD')
      assert.equal(changed.currency, 'USD')
      assert.equal(changed.unitPrice, unitPrice.trim() ? '0' : unitPrice)
      assert.equal(changed.priceState, priceState)
      assert.equal(changed.quantity, original.quantity)
      assert.equal(changed.currencyConversionOrigin, undefined)
    }
  }
  const included = row({ unitPrice: '1.100', priceState: 'included' })
  const converted = changeRowCurrency(included, 'USD', '1.100')
  assert.equal(converted.unitPrice, '1,00')
  assert.equal(converted.priceState, 'included')
  assert.equal(calculateRow(converted).lineTotalCents, 0)
  assert.equal(changeRowCurrency(converted, 'ARS', '1.100').unitPrice, '1.100')
})

test('explicit edits of an included derived zero clear its base while a state-only toggle can preserve it', () => {
  const derived = changeRowCurrency(row({ unitPrice: '0,01' }), 'USD', '1.000')
  const included = { ...derived, priceState: 'included' as const }
  const before = structuredClone(included)
  const restoredState = { ...included, priceState: 'priced' as const }
  assert.equal(changeRowCurrency(restoredState, 'ARS', '1.000').unitPrice, '0,01')
  for (const zero of ['0', '0,00']) {
    const edited = updateRowUnitPrice(included, zero)
    assert.equal(edited.priceState, 'included')
    assert.equal(edited.unitPrice, '0')
    assert.equal(edited.currencyConversionOrigin, undefined)
    assert.equal(changeRowCurrency(edited, 'ARS').unitPrice, '0')
  }
  assert.deepEqual(included, before)
})

test('missing rates, invalid money, overflow and overlong converted prices leave the original item untouched', () => {
  const original = Object.freeze(row())
  const before = structuredClone(original)
  for (const rate of [undefined, '', '0', '-1', '1.23', '0,0000001', 'NaN']) {
    assert.throws(() => changeRowCurrency(original, 'USD', rate), /tipo de cambio/)
    assert.deepEqual(original, before)
  }
  for (const unitPrice of ['invalid price', '-1', '1,234', '90071992547409,92']) {
    const invalid = row({ unitPrice })
    const snapshot = structuredClone(invalid)
    assert.throws(() => changeRowCurrency(invalid, 'USD', '1.100'))
    assert.deepEqual(invalid, snapshot)
  }
  const overflowing = row({ currency: 'USD', unitPrice: '90071992547409,91' })
  assert.throws(() => changeRowCurrency(overflowing, 'ARS', '2'), /seguro/)
  const tooLong = row({ currency: 'USD', unitPrice: '1234567890123' })
  const tooLongBefore = structuredClone(tooLong)
  assert.throws(() => changeRowCurrency(tooLong, 'ARS', '1'), /15 caracteres/)
  assert.deepEqual(tooLong, tooLongBefore)
  const ungrouped = changeRowCurrency(row({ currency: 'USD', unitPrice: '1000000000' }), 'ARS', '1')
  assert.equal(ungrouped.unitPrice, '1000000000,00')
  assert.ok(ungrouped.unitPrice.length <= 15)
  assert.deepEqual(parseMoney(ungrouped.unitPrice), { ok: true, cents: 100000000000 })
})

test('factory currency moves keep canonical zero and its original snapshot and temporarily ignore the saved price base', () => {
  const original = row({ unitPrice: '0,01' })
  const converted = changeRowCurrency(original, 'USD', '1.000')
  const factory = setRowFactoryMode(converted, true)
  const factoryBefore = structuredClone(factory)
  const movedFactory = changeRowCurrency(factory, 'ARS')
  assert.equal(movedFactory.unitPrice, '0')
  assert.equal(movedFactory.currency, 'ARS')
  assert.equal(isFactoryRow(movedFactory), true)
  assert.equal(movedFactory.factoryEquipment, factory.factoryEquipment)
  assert.equal(movedFactory.currencyConversionOrigin, converted.currencyConversionOrigin)
  assert.deepEqual(factory, factoryBefore)
  const restored = setRowFactoryMode(movedFactory, false)
  assert.equal(restored.currency, 'USD')
  assert.equal(restored.unitPrice, '0')
  const ars = changeRowCurrency(restored, 'ARS', '1.000')
  assert.equal(ars.unitPrice, '0,01')
  assert.equal(ars.quantity, original.quantity)
})

test('catalogue editing can keep a temporary conversion base without adding it to catalogue schema', () => {
  const state = { currency: 'ARS' as const, unitPrice: '25.000' }
  const before = structuredClone(state)
  const usd = changePriceCurrency(state, 'USD', '1.100')
  assert.equal(usd.unitPrice, '22,73')
  assert.equal(changePriceCurrency(usd, 'ARS', '1.100').unitPrice, '25.000')
  const manuallyEdited = { currency: usd.currency, unitPrice: '22,73' }
  assert.equal(changePriceCurrency(manuallyEdited, 'ARS', '1.100').unitPrice, '25.003,00')
  assert.deepEqual(state, before)
})

test('saved conversion bases survive recovery and frozen library copies without converting on read', () => {
  const original = row()
  const converted = changeRowCurrency(original, 'USD', '1.100')
  const quotation = { ...createQuotation(), exchangeRate: '1.100', rows: [converted] }
  const raw = serializeWorkspace({ version: 1, activeQuotationId: quotation.id, quotations: [quotation], catalog: [] })
  assert.deepEqual(parseWorkspace(raw).quotations[0], quotation)
  const values = new Map<string, string>()
  const storage = { getItem(key: string) { return values.get(key) ?? null }, setItem(key: string, value: string) { values.set(key, value) } }
  assert.equal(saveCurrentQuotation(storage, quotation).ok, true)
  assert.deepEqual(loadCurrentQuotation(storage).quotation, quotation)
  const archive = saveQuotationToLibrary(createQuotationLibrary(), quotation, 'Synthetic converted item')
  const archiveText = serializeQuotationLibrary(archive)
  const restored = parseQuotationLibraryBackup(archiveText)
  for (const duplicate of [false, true]) {
    const opened = openLibraryQuotation(restored.entries[0]!, { duplicate })
    assert.equal(opened.rows[0]!.currency, 'USD')
    assert.equal(opened.rows[0]!.unitPrice, '22,73')
    assert.equal(opened.exchangeRateMode, 'frozen')
    assert.notEqual(opened.rows[0]!.currencyConversionOrigin, converted.currencyConversionOrigin)
    assert.equal(changeRowCurrency(opened.rows[0]!, 'ARS', opened.exchangeRate).unitPrice, '25.000')
  }
  assert.equal(serializeQuotationLibrary(restored), archiveText)
  assert.equal(original.currencyConversionOrigin, undefined)
})

test('conversion metadata validates its intrinsic relation and reads stale active fields without trusting the old base', () => {
  const converted = changeRowCurrency(row(), 'USD', '1.100')
  const origin = converted.currencyConversionOrigin!
  assert.deepEqual(parseRowCurrencyConversionOrigin({ ...origin, unknown: 'discard' }), origin)
  for (const invalid of [
    null, [], {}, { ...origin, version: 2 }, { ...origin, sourceCurrency: 'EUR' },
    { ...origin, sourceUnitPrice: 'x'.repeat(65) }, { ...origin, sourceUnitPrice: '' },
    { ...origin, derivedUnitPrice: '99' }, { ...origin, derivedUnitPrice: '1'.repeat(16) },
    { ...origin, exchangeRate: '0' }, { ...origin, priceState: 'valid' },
  ]) assert.throws(() => parseRowCurrencyConversionOrigin(invalid))
  const stale = { ...converted, unitPrice: '31' }
  const quotation = { ...createQuotation(), rows: [stale] }
  const raw = serializeWorkspace({ version: 1, activeQuotationId: quotation.id, quotations: [quotation], catalog: [] })
  const recovered = parseWorkspace(raw).quotations[0]!.rows[0]!
  assert.deepEqual(recovered, stale)
  assert.equal(changeRowCurrency(recovered, 'ARS', '1.100').unitPrice, '34.100,00')
  const forged = { ...origin, sourceUnitPrice: '99' }
  const invalid = { ...quotation, rows: [{ ...converted, currencyConversionOrigin: forged }] }
  assert.throws(() => serializeWorkspace({ version: 1, activeQuotationId: invalid.id, quotations: [invalid], catalog: [] }))
})
