import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateQuotation, calculateRow, isEmptyRow } from '../src/features/quotation/calculation.ts'
import {
  isFixedServiceRow, parseFixedServiceOrigin, prepareFixedServiceQuotation,
  prepareFixedServiceRow, resolveFixedServicePrice,
} from '../src/features/quotation/fixed-services.ts'
import { createQuotation, createRow, hasQuotationContent, type FixedServiceOrigin, type Quotation, type QuotationRow } from '../src/features/quotation/model.ts'
import { parseWorkspace, serializeWorkspace } from '../src/features/quotation/persistence.ts'
import {
  createQuotationLibrary, hasArchivableQuotationContent, openLibraryQuotation, parseQuotationLibraryBackup,
  saveQuotationToLibrary, serializeQuotationLibrary,
} from '../src/features/quotation/quotation-library.ts'
import { CURRENT_QUOTATION_STORAGE_KEY, loadCurrentQuotation, saveCurrentQuotation } from '../src/features/quotation/working-storage.ts'

function service(changes: Partial<QuotationRow> = {}): QuotationRow {
  return {
    ...createRow('extras'), audioCategory: 'cables', concept: 'Synthetic custom service',
    detail: 'Retained synthetic detail', quantity: '2', unitPrice: '100', priceState: 'priced', ...changes,
  }
}

function quotation(rows: QuotationRow[]): Quotation {
  return { ...createQuotation(), title: 'Synthetic service quotation', exchangeRate: '1.000', rows }
}

function origin(row: QuotationRow, requiresPriceReview = false): FixedServiceOrigin {
  return {
    version: 1, quantity: row.quantity, unitPrice: row.unitPrice,
    priceState: row.priceState, currency: row.currency, requiresPriceReview,
  }
}

test('fixed services depend on exact section and category IDs regardless of wording or catalogue provenance', () => {
  for (const audioCategory of ['cables', 'labor'] as const) {
    assert.equal(isFixedServiceRow(service({ audioCategory, concept: 'Custom wording' })), true)
    assert.equal(isFixedServiceRow(service({ audioCategory, section: 'equipment' })), false)
  }
  for (const audioCategory of ['harness', 'adapters', 'speakers', undefined] as const) {
    const row = service({ audioCategory, concept: 'Cables y accesorios' })
    assert.equal(isFixedServiceRow(row), false)
    assert.equal(prepareFixedServiceRow(row), row)
  }
})

test('legacy quantities become one service while preserving its native line amount, raw origin and private trace', () => {
  const row = service({
    quantity: ' 02,000 ', unitPrice: ' 100,00 ', currency: 'USD',
    provenance: {
      catalogItemId: 'synthetic-service', supplier: 'Synthetic supplier', sku: 'SYN-SERVICE',
      originalUnitPrice: '100', originalCurrency: 'USD', priceBasis: 'manual',
      source: { document: 'Synthetic private source', date: null },
    },
  })
  const before = structuredClone(row)
  const prepared = prepareFixedServiceRow(row)
  assert.notEqual(prepared, row)
  assert.equal(prepared.quantity, '1')
  assert.equal(prepared.unitPrice, '200,00')
  assert.equal(prepared.currency, 'USD')
  assert.equal(prepared.priceState, 'priced')
  assert.equal(prepared.id, row.id)
  assert.equal(prepared.concept, row.concept)
  assert.equal(prepared.detail, row.detail)
  assert.equal(prepared.provenance, row.provenance)
  assert.deepEqual(prepared.fixedServiceOrigin, origin(row))
  assert.equal(calculateRow(prepared).lineTotalCents, calculateRow(row).lineTotalCents)
  assert.deepEqual(row, before)
  assert.equal(prepareFixedServiceRow(prepared), prepared)
  const edited = { ...prepared, unitPrice: '250,75' }
  assert.equal(prepareFixedServiceRow(edited), edited)
  assert.deepEqual(edited.fixedServiceOrigin, origin(row))
})

test('one hundred quantity and price combinations retain exact half-up native line rounding', () => {
  const quantities = ['0,001', '0,125', '0,333', '0,5', '0,999', '1,005', '1,5', '2', '3,125', '1000,999']
  const prices = ['0', '0,01', '0,02', '1,01', '13,37', '99,99', '100', '1.234,56', '0,03', '450000']
  let checked = 0
  for (const [quantityIndex, quantity] of quantities.entries()) {
    for (const [priceIndex, unitPrice] of prices.entries()) {
      const row = service({ quantity, unitPrice, currency: priceIndex % 2 ? 'USD' : 'ARS', audioCategory: quantityIndex % 2 ? 'labor' : 'cables' })
      const prepared = prepareFixedServiceRow(row)
      assert.equal(prepared.quantity, '1')
      assert.equal(prepared.currency, row.currency)
      assert.equal(prepared.priceState, 'priced')
      assert.equal(calculateRow(prepared).lineTotalCents, calculateRow(row).lineTotalCents)
      assert.equal(prepared.fixedServiceOrigin!.requiresPriceReview, false)
      checked++
    }
  }
  assert.equal(checked, 100)
  assert.equal(prepareFixedServiceRow(service({ quantity: '0,5', unitPrice: '0,01' })).unitPrice, '0,01')
  assert.equal(prepareFixedServiceRow(service({ quantity: '0,001', unitPrice: '0,01' })).unitPrice, '0,00')
})

test('preparing a working quotation retains duplicate services, mixed totals and every unrelated row', () => {
  const first = service({ quantity: '0,5', unitPrice: '0,01' })
  const second = service({ quantity: '0,5', unitPrice: '0,01' })
  const labor = service({ audioCategory: 'labor', currency: 'USD', quantity: '3,125', unitPrice: '12,34' })
  const adapter = service({ audioCategory: 'adapters', quantity: '2,5' })
  const equipment = service({ section: 'equipment', audioCategory: 'speakers', quantity: '4' })
  const original = quotation([first, second, labor, adapter, equipment])
  const before = structuredClone(original)
  const prepared = prepareFixedServiceQuotation(original)
  assert.notEqual(prepared, original)
  assert.deepEqual(prepared.rows.map((row) => row.id), original.rows.map((row) => row.id))
  assert.equal(prepared.rows[3], adapter)
  assert.equal(prepared.rows[4], equipment)
  assert.deepEqual(calculateQuotation(prepared).nativeTotals, calculateQuotation(original).nativeTotals)
  assert.deepEqual(calculateQuotation(prepared).totals, calculateQuotation(original).totals)
  assert.equal(calculateRow(prepared.rows[0]!).lineTotalCents, 1)
  assert.equal(calculateRow(prepared.rows[1]!).lineTotalCents, 1)
  assert.deepEqual(original, before)
  assert.equal(prepareFixedServiceQuotation(prepared), prepared)
})

test('pending, invalid and overflowing legacy values remain pending with their exact original fields', () => {
  const invalid = [
    service({ priceState: 'pending' }), service({ priceState: 'pending', unitPrice: '' }),
    service({ quantity: '' }), service({ quantity: 'quantity pending' }), service({ quantity: '0' }),
    service({ quantity: '-1' }), service({ quantity: '1,2345' }), service({ quantity: '9'.repeat(64) }),
    service({ unitPrice: '' }), service({ unitPrice: 'price pending' }), service({ unitPrice: '-1' }),
    service({ unitPrice: '90071992547409,91' }), service({ quantity: 'bad', priceState: 'included' }),
  ]
  for (const row of invalid) {
    const before = structuredClone(row)
    const prepared = prepareFixedServiceRow(row)
    assert.equal(prepared.quantity, '1')
    assert.equal(prepared.unitPrice, '')
    assert.equal(prepared.priceState, 'pending')
    assert.deepEqual(prepared.fixedServiceOrigin, origin(row, true))
    assert.equal(calculateQuotation(quotation([prepared])).canExport, false)
    assert.equal(resolveFixedServicePrice(prepared), prepared)
    assert.equal(prepareFixedServiceRow(prepared), prepared)
    assert.deepEqual(row, before)
  }
})

test('included services keep their state and retained amount without treating zero or missing amounts as included', () => {
  const included = prepareFixedServiceRow(service({ priceState: 'included' }))
  assert.equal(included.priceState, 'included')
  assert.equal(included.unitPrice, '200,00')
  assert.equal(calculateRow(included).lineTotalCents, 0)
  for (const unitPrice of ['', 'invalid previous price']) {
    const row = service({ unitPrice, priceState: 'included' })
    const prepared = prepareFixedServiceRow(row)
    assert.equal(prepared.priceState, 'included')
    assert.equal(prepared.unitPrice, '')
    assert.deepEqual(prepared.fixedServiceOrigin, origin(row))
    assert.equal(calculateRow(prepared).lineTotalCents, 0)
  }
  const retainedOverflow = service({ unitPrice: '90071992547409,91', priceState: 'included' })
  const overflowIncluded = prepareFixedServiceRow(retainedOverflow)
  assert.equal(calculateRow(retainedOverflow).lineTotalCents, 0)
  assert.equal(overflowIncluded.priceState, 'included')
  assert.equal(overflowIncluded.unitPrice, '')
  assert.deepEqual(overflowIncluded.fixedServiceOrigin, origin(retainedOverflow))
  assert.equal(calculateRow(overflowIncluded).lineTotalCents, 0)
  const zero = prepareFixedServiceRow(service({ unitPrice: '0' }))
  assert.equal(zero.priceState, 'priced')
  assert.equal(zero.unitPrice, '0,00')
  const noConcept = prepareFixedServiceRow(service({ concept: '' }))
  assert.equal(noConcept.unitPrice, '200,00')
  assert.equal(noConcept.concept, '')
  assert.equal(calculateQuotation(quotation([noConcept])).canExport, false)
})

test('a quantity-only legacy service remains recoverable and incomplete after its quantity becomes one', () => {
  const row = service({ concept: '', detail: '', quantity: '2', unitPrice: '', priceState: 'pending' })
  const prepared = prepareFixedServiceRow(row)
  const quote = { ...createQuotation(), rows: [prepared] }
  assert.equal(prepared.fixedServiceOrigin!.requiresPriceReview, true)
  assert.equal(isEmptyRow(prepared), false)
  assert.equal(hasQuotationContent(quote), true)
  assert.equal(hasArchivableQuotationContent(quote), true)
  assert.equal(calculateQuotation(quote).canExport, false)
  const text = serializeWorkspace({ version: 1, activeQuotationId: quote.id, quotations: [quote], catalog: [] })
  assert.deepEqual(parseWorkspace(text).quotations[0]!.rows[0], prepared)
})

test('price review clears only through a separate valid price or included action on a canonical fixed service', () => {
  const prepared = prepareFixedServiceRow(service({ quantity: 'legacy invalid' }))
  const before = structuredClone(prepared)
  const priced = resolveFixedServicePrice({ ...prepared, unitPrice: '75,25', priceState: 'priced' })
  assert.equal(priced.fixedServiceOrigin!.requiresPriceReview, false)
  assert.deepEqual({ ...priced.fixedServiceOrigin, requiresPriceReview: true }, prepared.fixedServiceOrigin)
  assert.equal(priced.unitPrice, '75,25')
  const included = resolveFixedServicePrice({ ...prepared, priceState: 'included' })
  assert.equal(included.fixedServiceOrigin!.requiresPriceReview, false)
  for (const invalid of [
    { ...prepared, priceState: 'priced' as const, unitPrice: 'bad' },
    { ...prepared, priceState: 'priced' as const, unitPrice: '' },
    { ...prepared, priceState: 'included' as const, quantity: '2' },
    { ...prepared, priceState: 'included' as const, audioCategory: 'adapters' as const },
  ]) assert.equal(resolveFixedServicePrice(invalid), invalid)
  assert.deepEqual(prepared, before)
  const canonical = service({ quantity: '1' })
  assert.equal(prepareFixedServiceRow(canonical), canonical)
  assert.equal(resolveFixedServicePrice(canonical), canonical)
})

test('readers preserve legacy rows and converted metadata without rewriting archive entries or source backups', () => {
  const legacy = quotation([service({ quantity: '2', unitPrice: '100' })])
  const legacyText = serializeWorkspace({ version: 1, activeQuotationId: legacy.id, quotations: [legacy], catalog: [] })
  assert.deepEqual(parseWorkspace(legacyText).quotations[0], legacy)
  const archive = saveQuotationToLibrary(createQuotationLibrary(), legacy, 'Synthetic original service')
  const archiveText = serializeQuotationLibrary(archive)
  const restoredArchive = parseQuotationLibraryBackup(archiveText)
  assert.equal(restoredArchive.entries[0]!.quotation.rows[0]!.quantity, '2')
  assert.equal(restoredArchive.entries[0]!.quotation.rows[0]!.unitPrice, '100')
  const working = openLibraryQuotation(restoredArchive.entries[0]!)
  assert.equal(working.rows[0]!.quantity, '1')
  assert.equal(working.rows[0]!.unitPrice, '200,00')
  assert.equal(working.exchangeRateMode, 'frozen')
  const duplicate = openLibraryQuotation(restoredArchive.entries[0]!, { duplicate: true })
  assert.equal(duplicate.rows[0]!.quantity, '1')
  assert.equal(duplicate.rows[0]!.unitPrice, '200,00')
  assert.equal(duplicate.exchangeRateMode, 'frozen')
  assert.notEqual(duplicate.id, working.id)
  assert.notEqual(duplicate.rows[0]!.id, working.rows[0]!.id)
  assert.equal(serializeQuotationLibrary(restoredArchive), archiveText)
  assert.deepEqual(parseWorkspace(legacyText).quotations[0], legacy)
  const convertedText = serializeWorkspace({ version: 1, activeQuotationId: working.id, quotations: [working], catalog: [] })
  assert.deepEqual(parseWorkspace(convertedText).quotations[0], working)
  const convertedArchive = saveQuotationToLibrary(createQuotationLibrary(), working, 'Synthetic converted service')
  const convertedBackup = parseQuotationLibraryBackup(serializeQuotationLibrary(convertedArchive))
  assert.deepEqual(convertedBackup.entries[0]!.quotation.rows[0]!.fixedServiceOrigin, working.rows[0]!.fixedServiceOrigin)
  const values = new Map<string, string>([[CURRENT_QUOTATION_STORAGE_KEY, legacyText]])
  const storage = { getItem(key: string) { return values.get(key) ?? null }, setItem(key: string, value: string) { values.set(key, value) } }
  const recovered = loadCurrentQuotation(storage).quotation
  assert.deepEqual(recovered, legacy)
  assert.equal(prepareFixedServiceQuotation(recovered).rows[0]!.quantity, '1')
  assert.equal(values.get(CURRENT_QUOTATION_STORAGE_KEY), legacyText)
  assert.equal(saveCurrentQuotation(storage, working).ok, true)
  assert.deepEqual(loadCurrentQuotation(storage).quotation, working)
  working.rows[0]!.fixedServiceOrigin!.quantity = 'changed outside archive'
  assert.equal(convertedBackup.entries[0]!.quotation.rows[0]!.fixedServiceOrigin!.quantity, '2')
  assert.equal(restoredArchive.entries[0]!.quotation.rows[0]!.quantity, '2')
})

test('fixed service origin validates its envelope strictly while preserving original invalid draft text', () => {
  const raw = origin(service({ quantity: 'invalid quantity', unitPrice: ' invalid price ', priceState: 'pending' }), true)
  assert.deepEqual(parseFixedServiceOrigin({ ...raw, unknown: 'discard' }), raw)
  assert.notEqual(parseFixedServiceOrigin(raw), raw)
  for (const invalid of [
    null, undefined, [], {}, { ...raw, version: 2 }, { ...raw, quantity: 2 },
    { ...raw, quantity: 'x'.repeat(65) }, { ...raw, unitPrice: 'x'.repeat(65) },
    { ...raw, priceState: 'valid' }, { ...raw, currency: 'EUR' }, { ...raw, requiresPriceReview: 'true' },
  ]) {
    assert.throws(() => parseFixedServiceOrigin(invalid))
    const row = { ...service(), fixedServiceOrigin: invalid }
    const quote = quotation([])
    const text = JSON.stringify({ version: 1, activeQuotationId: quote.id, quotations: [{ ...quote, rows: [row] }], catalog: [] })
    if (invalid === undefined) assert.equal(parseWorkspace(text).quotations[0]!.rows[0]!.fixedServiceOrigin, undefined)
    else assert.throws(() => parseWorkspace(text))
  }
  const untouched = service({ quantity: 'bad quantity', unitPrice: 'bad price', fixedServiceOrigin: raw })
  const quote = quotation([untouched])
  const text = serializeWorkspace({ version: 1, activeQuotationId: quote.id, quotations: [quote], catalog: [] })
  assert.deepEqual(parseWorkspace(text).quotations[0]!.rows[0], untouched)
})
