import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateQuotation, isEmptyRow } from '../src/features/quotation/calculation.ts'
import { renderQuotationCanvas } from '../src/features/quotation/export.ts'
import {
  createHarnessPresetRow, isHarnessPresetRow, isInactiveHarnessRow, parseHarnessSelection, setHarnessPresetSelected,
} from '../src/features/quotation/harness-preset.ts'
import { createQuotation, createRow, duplicateQuotation, type Quotation, type QuotationRow, type Workspace } from '../src/features/quotation/model.ts'
import { parseWorkspace, serializeWorkspace } from '../src/features/quotation/persistence.ts'
import { inspectQuotationAvailability } from '../src/features/quotation/quotation-availability.ts'
import {
  createQuotationLibrary, openLibraryQuotation, parseQuotationLibrary, saveQuotationToLibrary, serializeQuotationLibrary,
} from '../src/features/quotation/quotation-library.ts'
import { updateRowUnitPrice } from '../src/features/quotation/row-price.ts'
import { saveQuotationRow } from '../src/features/quotation/row-actions.ts'
import { changeRowCurrency } from '../src/features/quotation/row-currency.ts'
import { CURRENT_QUOTATION_STORAGE_KEY, loadCurrentQuotation, saveCurrentQuotation } from '../src/features/quotation/working-storage.ts'

function quotation(harness?: QuotationRow): Quotation {
  return {
    ...createQuotation(), title: 'Synthetic quote', exchangeRate: '1000', exchangeRateMode: 'frozen',
    rows: [
      { ...createRow('equipment'), concept: 'Synthetic equipment', unitPrice: '10', priceState: 'priced' },
      ...(harness ? [harness] : []),
    ],
  }
}

function workspace(quote: Quotation): Workspace {
  return { version: 1, activeQuotationId: quote.id, quotations: [quote], catalog: [] }
}

test('the approved bypass preset starts unselected at ARS 70000 without entering new quotations automatically', () => {
  const preset = createHarnessPresetRow()
  assert.equal(preset.section, 'extras')
  assert.equal(preset.audioCategory, 'harness')
  assert.equal(preset.concept, 'Ficha bypass est\u00e9reo')
  assert.equal(preset.currency, 'ARS')
  assert.equal(preset.unitPrice, '70.000')
  assert.equal(preset.priceState, 'priced')
  assert.equal(preset.quantity, '1')
  assert.deepEqual(preset.harnessSelection, { enabled: false })
  assert.equal(isHarnessPresetRow(preset), true)
  assert.equal(isInactiveHarnessRow(preset), true)
  assert.equal(createQuotation().rows.some(isHarnessPresetRow), false)
  assert.equal(createHarnessPresetRow(true).harnessSelection?.enabled, true)
  for (const rows of [[], [preset]]) {
    const empty = calculateQuotation({ ...createQuotation(), rows, exchangeRate: '' })
    assert.deepEqual(empty.nativeTotals, { ARS: 0, USD: 0 })
    assert.deepEqual(empty.totals, { ARS: 0, USD: 0 })
    assert.equal(empty.canExport, false)
    assert.equal(empty.itemsComplete, false)
  }
})

test('only explicit stable harness classification can acquire selection metadata', () => {
  const legacy = { ...createHarnessPresetRow(), concept: 'Custom preserved connector' }
  delete legacy.harnessSelection
  assert.equal(isHarnessPresetRow(legacy), false)
  assert.equal(isInactiveHarnessRow(legacy), false)
  const selected = setHarnessPresetSelected(legacy, true)
  assert.deepEqual(selected, { ...legacy, harnessSelection: { enabled: true } })
  assert.equal(legacy.harnessSelection, undefined)
  const other = { ...legacy, audioCategory: undefined, concept: 'Ficha bypass est\u00e9reo' }
  assert.equal(isHarnessPresetRow(other), false)
  assert.throws(() => setHarnessPresetSelected(other, false))
  assert.equal(isInactiveHarnessRow({ ...other, harnessSelection: { enabled: false } }), false)
  assert.throws(() => setHarnessPresetSelected({ ...legacy, section: 'equipment' }, true))
})

test('repeated selection preserves custom prices, currencies, quantities, descriptions and catalogue provenance', () => {
  const original: QuotationRow = {
    ...createHarnessPresetRow(), concept: 'Synthetic original connector', detail: 'Keep manual notes\nunchanged',
    currency: 'USD', quantity: '2,5', unitPrice: '12,34',
    provenance: { catalogItemId: 'synthetic-connector', originalCurrency: 'USD', originalUnitPrice: '10', priceBasis: 'manual', sku: 'SYN-1' },
  }
  delete original.harnessSelection
  const before = structuredClone(original)
  let current = original
  for (let index = 0; index < 5; index += 1) {
    current = setHarnessPresetSelected(setHarnessPresetSelected(current, false), true)
    assert.deepEqual(current, { ...original, harnessSelection: { enabled: true } })
  }
  assert.equal(setHarnessPresetSelected(current, true), current)
  assert.deepEqual(original, before)
  const inactiveEdited = updateRowUnitPrice(setHarnessPresetSelected(current, false), '23,45')
  assert.equal(inactiveEdited.harnessSelection?.enabled, false)
  assert.equal(setHarnessPresetSelected(inactiveEdited, true).unitPrice, '23,45')
})

test('saving only bypass selection preserves pending and included prices and exact currency restoration', () => {
  const original = createHarnessPresetRow(true)
  const converted = changeRowCurrency(original, 'USD', '1100')
  assert.equal(converted.unitPrice, '63,64')
  for (const source of [
    converted,
    { ...original, unitPrice: '99', priceState: 'pending' as const },
    { ...original, unitPrice: '', priceState: 'pending' as const },
    { ...original, unitPrice: '99', priceState: 'included' as const },
  ]) {
    const before = structuredClone(source)
    for (const enabled of [false, true]) {
      const result = saveQuotationRow(quotation(source), setHarnessPresetSelected(source, enabled), 'existing')
      assert.ok(result.ok)
      const saved = result.rows.find((candidate) => candidate.id === source.id)!
      assert.deepEqual(saved, { ...before, harnessSelection: { enabled } })
      const recovered = parseWorkspace(serializeWorkspace(workspace(quotation(saved)))).quotations[0]!.rows[1]!
      assert.deepEqual(recovered, saved)
      if (source === converted) {
        const restored = changeRowCurrency(recovered, 'ARS', '1100')
        assert.equal(restored.unitPrice, original.unitPrice)
        assert.equal(restored.currency, original.currency)
        assert.deepEqual(restored.harnessSelection, { enabled })
        assert.equal(changeRowCurrency(changeRowCurrency(restored, 'USD', '1100'), 'ARS', '1100').unitPrice, '70.000')
      }
    }
    assert.deepEqual(source, before)
  }
})

test('inactive bypass contributes no amounts or validation while unchecked, including retained invalid drafts', () => {
  const inactive = createHarnessPresetRow()
  const result = calculateQuotation(quotation(inactive))
  assert.equal(isEmptyRow(inactive), true)
  assert.equal(result.rows.length, 1)
  assert.deepEqual(result.nativeTotals, { ARS: 1000, USD: 0 })
  assert.equal(result.canExport, true)
  const selected = calculateQuotation(quotation(setHarnessPresetSelected(inactive, true)))
  assert.equal(selected.rows.length, 2)
  assert.deepEqual(selected.nativeTotals, { ARS: 7001000, USD: 0 })
  const invalid: QuotationRow = { ...inactive, quantity: 'invalid', unitPrice: '', priceState: 'pending' }
  assert.equal(calculateQuotation(quotation(invalid)).canExport, true)
  assert.equal(calculateQuotation(quotation(setHarnessPresetSelected(invalid, true))).canExport, false)
  const unrelated = { ...inactive, audioCategory: undefined }
  assert.equal(isEmptyRow(unrelated), false)
  assert.equal(calculateQuotation(quotation(unrelated)).nativeTotals.ARS, 7001000)
})

test('inactive source-backed bypass is not sold and cannot block image delivery through stock rules', () => {
  const inactive: QuotationRow = {
    ...createHarnessPresetRow(), provenance: {
      catalogItemId: 'synthetic-connector', originalCurrency: 'ARS', originalUnitPrice: '70.000', priceBasis: 'manual',
      availabilityPolicy: 'fresh-positive', selectionBlock: 'Synthetic source block',
    },
  }
  assert.deepEqual(inspectQuotationAvailability(quotation(inactive)), { issues: [], hasProvisional: false })
  assert.equal(inspectQuotationAvailability(quotation(setHarnessPresetSelected(inactive, true))).issues.length, 1)
})

test('current recovery, backup, saved quotation reopening and duplication retain both selection states and edited price', () => {
  for (const enabled of [false, true]) {
    const harness = { ...createHarnessPresetRow(enabled), unitPrice: '72.345,67', detail: 'Synthetic retained note' }
    const quote = quotation(harness)
    const state = workspace(quote)
    const before = structuredClone(state)
    assert.deepEqual(parseWorkspace(serializeWorkspace(state)), before)
    const values = new Map<string, string>()
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
    assert.equal(saveCurrentQuotation(storage, quote).ok, true)
    assert.ok(values.has(CURRENT_QUOTATION_STORAGE_KEY))
    assert.deepEqual(loadCurrentQuotation(storage).quotation, quote)
    const library = saveQuotationToLibrary(createQuotationLibrary(), quote, 'Synthetic saved bypass')
    const bytes = serializeQuotationLibrary(library)
    const restored = parseQuotationLibrary(bytes)
    const entry = restored.entries[0]!
    const snapshot = structuredClone(entry)
    for (const copy of [openLibraryQuotation(entry), openLibraryQuotation(entry, { duplicate: true }), duplicateQuotation(entry.quotation)]) {
      const copiedHarness = copy.rows.find(isHarnessPresetRow)!
      assert.deepEqual(copiedHarness.harnessSelection, { enabled })
      assert.notEqual(copiedHarness.id, harness.id)
      assert.equal(copiedHarness.unitPrice, '72.345,67')
      assert.equal(setHarnessPresetSelected(copiedHarness, !enabled).unitPrice, '72.345,67')
      copiedHarness.harnessSelection!.enabled = !enabled
      copiedHarness.detail = 'Private copied edit'
    }
    assert.deepEqual(entry, snapshot)
    assert.equal(serializeQuotationLibrary(restored), bytes)
    assert.deepEqual(state, before)
  }
})

test('legacy harness rows and legacy named lookalikes roundtrip without new presets or selection metadata', () => {
  const first = createHarnessPresetRow(true)
  delete first.harnessSelection
  const second = { ...first, id: crypto.randomUUID(), concept: 'Second legacy connector', unitPrice: '0', priceState: 'included' as const }
  const lookalike = { ...first, id: crypto.randomUUID(), audioCategory: undefined }
  delete lookalike.audioCategory
  const quote = quotation(first)
  quote.rows.push(second, lookalike)
  const restored = parseWorkspace(serializeWorkspace(workspace(quote))).quotations[0]!
  assert.deepEqual(restored, quote)
  assert.equal(restored.rows.some(isHarnessPresetRow), false)
  assert.deepEqual(calculateQuotation(restored).nativeTotals, calculateQuotation(quote).nativeTotals)
})

test('harness selection metadata rejects malformed booleans and incompatible row categories', () => {
  for (const invalid of [null, [], false, 0, '', {}, { enabled: 'false' }, { enabled: 0 }, { enabled: null }]) {
    assert.throws(() => parseHarnessSelection(invalid))
  }
  const preset = createHarnessPresetRow()
  for (const invalid of [{ ...preset, section: 'equipment' as const }, { ...preset, audioCategory: 'cables' as const }, { ...preset, audioCategory: undefined }]) {
    assert.throws(() => parseWorkspace(JSON.stringify(workspace(quotation(invalid)))))
  }
  assert.deepEqual(parseHarnessSelection({ enabled: false }), { enabled: false })
})

function renderTexts(quote: Quotation): string[] {
  const texts: string[] = []
  const noop = () => {}
  const context = {
    font: '', fillStyle: '', strokeStyle: '', textAlign: '', textBaseline: '', lineWidth: 0,
    measureText: (text: string) => ({ width: text.length * 14 }), fillText: (text: string) => { texts.push(text) },
    fillRect: noop, beginPath: noop, moveTo: noop, lineTo: noop, quadraticCurveTo: noop,
    stroke: noop, arc: noop, fill: noop, bezierCurveTo: noop, closePath: noop,
    drawImage: noop, save: noop, translate: noop, scale: noop, restore: noop,
  }
  const canvas = { width: 0, height: 0, getContext: () => context }
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => canvas } })
  try { renderQuotationCanvas(quote, {} as CanvasImageSource) }
  finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous)
    else Reflect.deleteProperty(globalThis, 'document')
  }
  return texts
}

test('PNG output omits unchecked bypass entirely and includes its edited amount only when selected', () => {
  const inactive = { ...createHarnessPresetRow(), unitPrice: '72.345', detail: 'Synthetic bypass description' }
  const before = structuredClone(inactive)
  const hidden = renderTexts(quotation(inactive)).join('\n')
  assert.equal(hidden.includes('Ficha bypass'), false)
  assert.equal(hidden.includes('72.345'), false)
  assert.equal(hidden.includes('Synthetic bypass description'), false)
  const shown = renderTexts(quotation(setHarnessPresetSelected(inactive, true))).join('\n')
  assert.equal(shown.includes('Ficha bypass est\u00e9reo'), true)
  assert.equal(shown.includes('ARS 72.345,00'), true)
  assert.equal(shown.includes('Synthetic bypass description'), true)
  assert.deepEqual(inactive, before)
})
