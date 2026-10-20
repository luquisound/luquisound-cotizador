import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateQuotation } from '../src/features/quotation/calculation.ts'
import { renderQuotationCanvas } from '../src/features/quotation/export.ts'
import { isFactoryEligibleRow, isFactoryRow, parseFactoryEquipment, setRowFactoryMode } from '../src/features/quotation/factory-mode.ts'
import { createQuotation, createRow, duplicateQuotation, type CatalogItem, type Quotation, type QuotationRow, type Workspace } from '../src/features/quotation/model.ts'
import { parseWorkspace, serializeWorkspace } from '../src/features/quotation/persistence.ts'
import { getRowAvailabilityItem, inspectQuotationAvailability } from '../src/features/quotation/quotation-availability.ts'
import {
  createQuotationLibrary, openLibraryQuotation, parseQuotationLibrary, saveQuotationToLibrary, serializeQuotationLibrary,
} from '../src/features/quotation/quotation-library.ts'
import { rowFromCatalog } from '../src/features/quotation/row-provenance.ts'

const now = Date.parse('2026-10-20T10:05:00.000Z')
const source = { document: 'Synthetic source', date: null, kind: 'snapshot' as const }

function product(): CatalogItem {
  return {
    id: 'synthetic-speaker', section: 'equipment', concept: 'Synthetic component set', detail: 'Original product detail',
    currency: 'USD', unitPrice: '12,34', supplier: 'Synthetic supplier', sku: 'SYN-1', source,
    availabilityPolicy: 'fresh-positive',
    stock: { quantity: 5, checkedAt: '2026-10-20T10:00:00.000Z', validUntil: '2026-10-20T10:15:00.000Z', source },
  }
}

function row(): QuotationRow {
  return { ...rowFromCatalog(product(), 'equipment', 'ARS', 'speakers', now), detail: 'Manual installation detail\nKeep exactly', quantity: '2,5' }
}

function quotation(item: QuotationRow): Quotation {
  return { ...createQuotation(), title: 'Synthetic quotation', exchangeRate: '1000', exchangeRateMode: 'frozen', rows: [item] }
}

function workspace(item: QuotationRow): Workspace {
  const quote = quotation(item)
  return { version: 1, activeQuotationId: quote.id, quotations: [quote], catalog: [] }
}

test('factory eligibility uses equipment categories, never a matching product name', () => {
  const base = row()
  for (const category of ['speakers', 'subwoofer'] as const) {
    assert.equal(isFactoryEligibleRow({ ...base, audioCategory: category }), true)
  }
  for (const category of [undefined, 'amplifier-dsp', 'additional-amplifier', 'cables', 'labor', 'adapters'] as const) {
    const other = { ...base, audioCategory: category, concept: 'Parlantes de f\u00e1brica', unitPrice: '0' }
    assert.equal(isFactoryEligibleRow(other), false)
    assert.equal(setRowFactoryMode(other, true), other)
  }
  assert.equal(isFactoryEligibleRow({ ...base, section: 'extras' }), false)
  assert.equal(isFactoryRow({ ...base, concept: 'Parlantes de f\u00e1brica', unitPrice: '0' }), false)
})

test('factory mode is an explicit zero and keeps a lossless independent restoration snapshot', () => {
  const original = row()
  const before = structuredClone(original)
  const factory = setRowFactoryMode(original, true)
  assert.equal(isFactoryRow(factory), true)
  assert.equal(factory.concept, 'Parlantes de f\u00e1brica')
  assert.equal(factory.detail, '')
  assert.equal(factory.unitPrice, '0')
  assert.equal(factory.priceState, 'priced')
  assert.equal(factory.quantity, original.quantity)
  assert.equal(factory.currency, 'USD')
  assert.deepEqual(factory.provenance, original.provenance)
  assert.deepEqual(original, before)
  assert.deepEqual(setRowFactoryMode(factory, false), original)
  assert.equal(setRowFactoryMode(factory, true), factory)
  assert.equal(setRowFactoryMode(original, false), original)
  let current = original
  for (let index = 0; index < 5; index += 1) {
    current = setRowFactoryMode(setRowFactoryMode(current, true), false)
    assert.deepEqual(current, original)
  }
})

test('factory toggling restores pending, invalid, zero and included prices without approving them', () => {
  for (const [priceState, unitPrice] of [
    ['pending', ''], ['pending', '150'], ['priced', 'invalid draft'], ['priced', '0'], ['included', '99,99'],
  ] as const) {
    const original = { ...row(), priceState, unitPrice }
    const factory = setRowFactoryMode(original, true)
    assert.equal(calculateQuotation(quotation(factory)).nativeTotals.USD, 0)
    const restored = setRowFactoryMode(factory, false)
    assert.deepEqual(restored, original)
    assert.equal(calculateQuotation(quotation(restored)).itemsComplete, priceState === 'included' || unitPrice === '0')
  }
})

test('both factory categories calculate zero in their native currency and preserve all other rows', () => {
  const quote = quotation(setRowFactoryMode(row(), true))
  quote.rows.push(setRowFactoryMode({ ...row(), id: 'synthetic-subwoofer', audioCategory: 'subwoofer', currency: 'ARS' }, true))
  quote.rows.push({ ...createRow('extras', 'ARS'), concept: 'Synthetic labour', unitPrice: '10,25', priceState: 'priced', quantity: '2' })
  const result = calculateQuotation(quote)
  assert.equal(quote.rows[1]!.concept, 'Subwoofer de f\u00e1brica')
  assert.deepEqual(result.nativeTotals, { ARS: 2050, USD: 0 })
  assert.equal(result.rows.filter(({ lineTotalCents }) => lineTotalCents === 0).length, 2)
  assert.equal(result.canExport, true)
})

test('an explicit factory currency change keeps zero while preserving the original paid product for restoration', () => {
  for (const originalCurrency of ['ARS', 'USD'] as const) {
    const original: QuotationRow = { ...row(), currency: originalCurrency }
    const before = structuredClone(original)
    const factory = setRowFactoryMode(original, true)
    const changed: QuotationRow = { ...factory, currency: originalCurrency === 'ARS' ? 'USD' : 'ARS' }
    assert.equal(isFactoryRow(changed), true)
    assert.equal(setRowFactoryMode(changed, true), changed)
    assert.equal(changed.unitPrice, '0')
    assert.deepEqual(changed.factoryEquipment, factory.factoryEquipment)
    assert.equal(changed.factoryEquipment?.original.currency, originalCurrency)
    assert.equal(changed.factoryEquipment?.original.unitPrice, original.unitPrice)
    const result = calculateQuotation(quotation(changed))
    assert.deepEqual(result.nativeTotals, { ARS: 0, USD: 0 })
    assert.equal(result.canExport, true)
    const unavailable = { ...product(), selectionBlock: 'Synthetic source block' }
    assert.equal(getRowAvailabilityItem(changed, [unavailable]), undefined)
    assert.deepEqual(inspectQuotationAvailability(quotation(changed), [unavailable], now), { issues: [], hasProvisional: false })
    const restored = parseWorkspace(serializeWorkspace(workspace(changed))).quotations[0]!.rows[0]!
    assert.equal(restored.currency, changed.currency)
    assert.deepEqual(setRowFactoryMode(restored, false), original)
    const library = saveQuotationToLibrary(createQuotationLibrary(), quotation(changed), 'Synthetic currency change')
    const archived = library.entries[0]!
    const archivedBefore = structuredClone(archived)
    const reopened = openLibraryQuotation(archived).rows[0]!
    assert.equal(isFactoryRow(reopened), true)
    assert.equal(reopened.currency, changed.currency)
    const originalAgain = setRowFactoryMode(reopened, false)
    assert.equal(originalAgain.currency, originalCurrency)
    assert.equal(originalAgain.unitPrice, original.unitPrice)
    assert.equal(originalAgain.detail, original.detail)
    assert.deepEqual(originalAgain.provenance, original.provenance)
    assert.deepEqual(archived, archivedBefore)
    assert.deepEqual(original, before)
  }
})

test('recovery and saved library snapshots preserve factory mode and restoration data through open and duplication', () => {
  const original = row()
  const factory = setRowFactoryMode(original, true)
  const state = workspace(factory)
  const before = structuredClone(state)
  const restored = parseWorkspace(serializeWorkspace(state))
  assert.deepEqual(restored, before)
  assert.deepEqual(state, before)
  assert.deepEqual(setRowFactoryMode(restored.quotations[0]!.rows[0]!, false), original)
  const library = saveQuotationToLibrary(createQuotationLibrary(), state.quotations[0]!, 'Synthetic saved factory')
  const bytes = serializeQuotationLibrary(library)
  const parsed = parseQuotationLibrary(bytes)
  const entry = parsed.entries[0]!
  const entryBefore = structuredClone(entry)
  const copies = [openLibraryQuotation(entry), openLibraryQuotation(entry, { duplicate: true }), duplicateQuotation(entry.quotation)]
  for (const copy of copies) {
    const item = copy.rows[0]!
    assert.equal(isFactoryRow(item), true)
    assert.notEqual(item.id, factory.id)
    assert.notEqual(item.factoryEquipment, factory.factoryEquipment)
    assert.equal(copy.exchangeRate, '1000')
    assert.equal(setRowFactoryMode(item, false).detail, original.detail)
    item.factoryEquipment!.original.detail = 'Edited private copy'
  }
  assert.deepEqual(entry, entryBefore)
  assert.equal(serializeQuotationLibrary(parsed), bytes)
})

test('factory metadata rejects malformed restoration data and noncanonical active records', () => {
  const factory = setRowFactoryMode(row(), true)
  const metadata = factory.factoryEquipment!
  for (const invalid of [
    null, [], { ...metadata, version: 2 }, { ...metadata, category: 'labor' },
    { ...metadata, original: { ...metadata.original, concept: 'a'.repeat(501) } },
    { ...metadata, original: { ...metadata.original, detail: 'a'.repeat(2001) } },
    { ...metadata, original: { ...metadata.original, unitPrice: '1'.repeat(65) } },
    { ...metadata, original: { ...metadata.original, priceState: 'approved' } },
    { ...metadata, original: { ...metadata.original, currency: 'EUR' } },
  ]) assert.throws(() => parseFactoryEquipment(invalid))
  for (const altered of [
    { ...factory, audioCategory: 'subwoofer' as const }, { ...factory, section: 'extras' as const },
    { ...factory, concept: 'Selling the previous component' }, { ...factory, detail: 'Old product' },
    { ...factory, unitPrice: '1' }, { ...factory, priceState: 'included' as const },
    { ...factory, currency: 'EUR' as QuotationRow['currency'] },
  ]) {
    assert.equal(isFactoryRow(altered), false)
    assert.throws(() => parseWorkspace(JSON.stringify(workspace(altered))))
    assert.throws(() => setRowFactoryMode(altered, true))
  }
})

test('factory equipment skips unavailable replaced products while restoring their stock guards when unchecked', () => {
  const original = row()
  const factory = setRowFactoryMode(original, true)
  const unavailable: CatalogItem = { ...product(), stock: { ...product().stock!, quantity: 0 }, selectionBlock: 'Synthetic quarantine' }
  const catalog = [unavailable]
  const before = structuredClone(catalog)
  assert.equal(getRowAvailabilityItem(factory, catalog), undefined)
  assert.deepEqual(inspectQuotationAvailability(quotation(factory), catalog, now), { issues: [], hasProvisional: false })
  assert.equal(inspectQuotationAvailability(quotation(original), catalog, now).issues.length, 1)
  assert.equal(inspectQuotationAvailability(quotation(setRowFactoryMode(factory, false)), catalog, now).issues.length, 1)
  const ordinaryZero = { ...original, concept: 'Parlantes de f\u00e1brica', unitPrice: '0' }
  assert.equal(inspectQuotationAvailability(quotation(ordinaryZero), catalog, now).issues.length, 1)
  assert.deepEqual(catalog, before)
  assert.deepEqual(factory.provenance, original.provenance)
})

test('PNG drawing uses only factory names and zero amounts, retaining original product details privately', () => {
  const quote = quotation(setRowFactoryMode(row(), true))
  quote.rows.push(setRowFactoryMode({ ...row(), id: 'synthetic-subwoofer', audioCategory: 'subwoofer' }, true))
  const texts: string[] = []
  const noop = () => {}
  const context = {
    font: '', fillStyle: '', strokeStyle: '', textAlign: '', textBaseline: '', lineWidth: 0,
    measureText: (text: string) => ({ width: text.length * 14 }),
    fillText: (text: string) => { texts.push(text) }, fillRect: noop,
    beginPath: noop, moveTo: noop, lineTo: noop, quadraticCurveTo: noop,
    stroke: noop, arc: noop, fill: noop, bezierCurveTo: noop, closePath: noop,
    drawImage: noop, save: noop, translate: noop, scale: noop, restore: noop,
  }
  const canvas = { width: 0, height: 0, getContext: () => context }
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => canvas } })
  try {
    renderQuotationCanvas(quote, {} as CanvasImageSource)
  } finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous)
    else Reflect.deleteProperty(globalThis, 'document')
  }
  assert.ok(texts.includes('Parlantes de f\u00e1brica'))
  assert.ok(texts.includes('Subwoofer de f\u00e1brica'))
  assert.ok(texts.filter((text) => text === 'USD 0,00').length >= 2)
  const output = texts.join('\n')
  for (const privateText of ['Synthetic component set', 'Original product detail', 'Manual installation detail', 'Synthetic source', 'SYN-1', '12,34']) {
    assert.equal(output.includes(privateText), false)
  }
  assert.equal(setRowFactoryMode(quote.rows[0]!, false).detail, row().detail)
})
