import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ADAPTER_VARIANTS, AUDIO_CATEGORIES, getAdapterVariant, getAudioCategories, getDirectExtraConcept, isDirectExtraRow,
  orderQuotationRows, readAudioCategory, selectAdapterVariant,
} from '../src/features/quotation/audio-categories.ts'
import type { AdapterSize } from '../src/features/quotation/audio-categories.ts'
import { calculateQuotation } from '../src/features/quotation/calculation.ts'
import { createQuotation, createRow } from '../src/features/quotation/model.ts'
import type { QuotationRow } from '../src/features/quotation/model.ts'

test('audio categories define the approved labels and order within each section', () => {
  assert.deepEqual(getAudioCategories('equipment'), [
    { id: 'amplifier-dsp', section: 'equipment', label: 'Amplificador / DSP' },
    { id: 'additional-amplifier', section: 'equipment', label: 'Amplificador adicional' },
    { id: 'subwoofer', section: 'equipment', label: 'Subwoofer' },
    { id: 'speakers', section: 'equipment', label: 'Parlantes o componentes' },
  ])
  assert.deepEqual(getAudioCategories('extras'), [
    { id: 'cables', section: 'extras', label: 'Cables y accesorios' },
    { id: 'harness', section: 'extras', label: 'Ficha bypass estéreo' },
    { id: 'adapters', section: 'extras', label: 'Aros adaptadores 3D' },
    { id: 'labor', section: 'extras', label: 'Mano de obra de instalación' },
  ])
  assert.equal(new Set(AUDIO_CATEGORIES.map((category) => category.id)).size, 8)
})

test('category metadata accepts only an exact identifier in its own section', () => {
  for (const category of AUDIO_CATEGORIES) {
    assert.equal(readAudioCategory(category.id, category.section), category.id)
    assert.equal(readAudioCategory(category.id, category.section === 'equipment' ? 'extras' : 'equipment'), undefined)
    assert.equal(readAudioCategory(category.label, category.section), undefined)
    assert.equal(readAudioCategory(category.id.toUpperCase(), category.section), undefined)
  }
  for (const value of [undefined, null, '', 'other', ' amplifier-dsp ', 'toString', 0, true, [], {}, { id: 'speakers' }]) {
    assert.equal(readAudioCategory(value, 'equipment'), undefined)
    assert.equal(readAudioCategory(value, 'extras'), undefined)
  }
})

test('direct extra concepts are available only for approved installation categories', () => {
  for (const category of getAudioCategories('extras')) {
    assert.equal(getDirectExtraConcept(category.id), category.label)
  }
  for (const category of getAudioCategories('equipment')) {
    assert.equal(getDirectExtraConcept(category.id), undefined)
  }
  assert.equal(getDirectExtraConcept(), undefined)
})

test('direct extra recognition preserves canonical and exact legacy concepts without changing row data', () => {
  const legacyConcepts = [
    { audioCategory: 'cables', concept: 'Cables y accesorios' },
    { audioCategory: 'harness', concept: 'Ficha / arnés' },
    { audioCategory: 'adapters', concept: 'Aros / adaptadores 3D' },
    { audioCategory: 'labor', concept: 'Mano de obra' },
  ] as const
  const concepts = [
    ...getAudioCategories('extras').map(({ id, label }) => ({ audioCategory: id, concept: label })),
    ...legacyConcepts,
  ]
  for (const concept of concepts) {
    const row: QuotationRow = {
      ...createRow('extras', 'USD'), ...concept,
      detail: 'Synthetic retained detail', quantity: '2,75', unitPrice: '123,45', priceState: 'included',
    }
    const snapshot = structuredClone(row)
    assert.equal(isDirectExtraRow(Object.freeze(row)), true)
    assert.deepEqual(row, snapshot)
    assert.equal(row.concept, concept.concept)
  }
})

test('direct extra recognition excludes sourced, custom, incompatible and normalized-looking rows', () => {
  for (const category of getAudioCategories('extras')) {
    const row: QuotationRow = { ...createRow('extras'), audioCategory: category.id, concept: category.label }
    const provenance = { catalogItemId: 'synthetic-source', originalUnitPrice: '', originalCurrency: 'ARS', priceBasis: 'pending' } as const
    const rejected: QuotationRow[] = [
      { ...row, section: 'equipment' },
      { ...row, audioCategory: undefined },
      { ...row, audioCategory: 'subwoofer' },
      { ...row, provenance },
      { ...row, concept: ` ${row.concept}` },
      { ...row, concept: `${row.concept} ` },
      { ...row, concept: row.concept.toUpperCase() },
      { ...row, concept: `${row.concept} personalizado` },
      { ...row, concept: '' },
    ]
    const snapshot = structuredClone(rejected)
    for (const candidate of rejected) assert.equal(isDirectExtraRow(Object.freeze(candidate)), false)
    assert.deepEqual(rejected, snapshot)
  }
  assert.equal(isDirectExtraRow({ ...createRow('extras'), audioCategory: 'harness', concept: 'Mano de obra' }), false)
  assert.equal(isDirectExtraRow({ ...createRow('extras'), audioCategory: 'harness', concept: 'Ficha / arnes' }), false)
  assert.equal(isDirectExtraRow({ ...createRow('extras'), audioCategory: 'labor', concept: 'Mano de obra ' }), false)
  assert.equal(isDirectExtraRow({ ...createRow('equipment'), audioCategory: 'subwoofer', concept: 'Subwoofer' }), false)
})

test('adapter variants contain only the two approved per-unit ARS prices', () => {
  assert.deepEqual(ADAPTER_VARIANTS, [
    { id: '6.5', label: '6,5 pulgadas', concept: 'Aros adaptadores 3D 6,5 pulgadas', currency: 'ARS', unitPrice: '25.000' },
    { id: '8', label: '8 pulgadas', concept: 'Aros adaptadores 3D 8 pulgadas', currency: 'ARS', unitPrice: '35.000' },
  ])
})

test('adapter recognition is exact and preserves quantity, overrides and legacy generic prices', () => {
  for (const variant of ADAPTER_VARIANTS) {
    const row: QuotationRow = {
      ...createRow('extras', 'USD'), audioCategory: 'adapters', concept: variant.concept,
      quantity: '3', unitPrice: '17,25', priceState: 'priced', detail: 'Synthetic retained adapter detail',
    }
    const snapshot = structuredClone(row)
    assert.equal(getAdapterVariant(row.concept), variant)
    assert.equal(isDirectExtraRow(Object.freeze(row)), true)
    assert.deepEqual(row, snapshot)
    for (const concept of [` ${variant.concept}`, `${variant.concept} `, variant.concept.toUpperCase(), `${variant.concept} custom`]) {
      assert.equal(getAdapterVariant(concept), undefined)
      assert.equal(isDirectExtraRow({ ...row, concept }), false)
    }
    assert.equal(isDirectExtraRow({ ...row, section: 'equipment' }), false)
    assert.equal(isDirectExtraRow({ ...row, audioCategory: 'harness' }), false)
    assert.equal(isDirectExtraRow({ ...row, provenance: { catalogItemId: 'synthetic-adapter', originalUnitPrice: '17,25', originalCurrency: 'USD', priceBasis: 'manual' } }), false)
  }
  for (const concept of ['Aros adaptadores 3D', 'Aros / adaptadores 3D']) {
    for (const unitPrice of ['', '12,34', '35.000']) {
      const row: QuotationRow = { ...createRow('extras', 'USD'), audioCategory: 'adapters', concept, unitPrice, priceState: 'pending' }
      const snapshot = structuredClone(row)
      assert.equal(getAdapterVariant(row.concept), undefined)
      assert.equal(isDirectExtraRow(Object.freeze(row)), true)
      assert.deepEqual(row, snapshot)
    }
  }
  for (const concept of ['Aros adaptadores 3D 6.5 pulgadas', 'Aros adaptadores 3D 6,50 pulgadas', 'Aros adaptadores 3D 10 pulgadas']) {
    assert.equal(getAdapterVariant(concept), undefined)
  }
})

test('explicit adapter selection copies native unit prices without forcing a pair or mutating the original', () => {
  for (const [index, variant] of ADAPTER_VARIANTS.entries()) {
    const row: QuotationRow = {
      ...createRow('extras', 'USD'), id: 'retained-adapter-id', audioCategory: 'adapters',
      concept: 'Aros / adaptadores 3D', detail: 'Synthetic custom fitting', quantity: '3',
      unitPrice: '19,99', priceState: 'included',
    }
    const snapshot = structuredClone(row)
    const selected = selectAdapterVariant(Object.freeze(row), variant.id)
    assert.notEqual(selected, row)
    assert.deepEqual(selected, { ...snapshot, concept: variant.concept, currency: 'ARS', unitPrice: variant.unitPrice, priceState: 'priced' })
    assert.deepEqual(row, snapshot)
    const calculation = calculateQuotation({ ...createQuotation(), currency: 'USD', exchangeRate: '1.000', rows: [selected] })
    assert.equal(calculation.rows[0].lineTotalCents, index === 0 ? 7_500_000 : 10_500_000)
    assert.deepEqual(calculation.nativeTotals, { ARS: index === 0 ? 7_500_000 : 10_500_000, USD: 0 })
  }
  const row: QuotationRow = { ...createRow('extras'), audioCategory: 'adapters', quantity: '1' }
  assert.equal(selectAdapterVariant(row, '6.5').quantity, '1')
  assert.equal(selectAdapterVariant({ ...row, quantity: '2,750' }, '8').quantity, '2,750')
})

test('adapter selection rejects foreign and sourced rows and unknown sizes without modifying them', () => {
  const base: QuotationRow = { ...createRow('extras'), audioCategory: 'adapters', concept: 'Aros adaptadores 3D' }
  const rejected: QuotationRow[] = [
    { ...base, section: 'equipment' },
    { ...base, audioCategory: undefined },
    { ...base, audioCategory: 'cables' },
    { ...base, provenance: { catalogItemId: 'synthetic-adapter', originalUnitPrice: '', originalCurrency: 'ARS', priceBasis: 'pending' } },
  ]
  for (const row of rejected) {
    const snapshot = structuredClone(row)
    assert.throws(() => selectAdapterVariant(Object.freeze(row), '6.5'))
    assert.deepEqual(row, snapshot)
  }
  const snapshot = structuredClone(base)
  for (const size of ['', '6,5', '6.50', '10', 'toString', undefined, null, 6.5]) {
    assert.throws(() => selectAdapterVariant(Object.freeze(base), size as unknown as AdapterSize), RangeError)
    assert.deepEqual(base, snapshot)
  }
})

test('row ordering groups categories canonically while retaining insertion order within each group', () => {
  const categorized = AUDIO_CATEGORIES.map((category) => ({
    ...createRow(category.section), id: category.id, audioCategory: category.id, concept: `Synthetic ${category.id}`,
  }))
  const rows: QuotationRow[] = [
    { ...createRow('extras'), id: 'free-extra-1', concept: 'Synthetic free work' },
    ...categorized.toReversed(),
    { ...createRow(), id: 'free-equipment-1', concept: 'Synthetic free equipment' },
    { ...createRow(), id: 'speaker-2', audioCategory: 'speakers', concept: 'Synthetic second speaker' },
    { ...createRow('extras'), id: 'free-extra-2', concept: 'Synthetic second free work' },
    { ...createRow(), id: 'free-equipment-2', concept: 'Synthetic second free equipment' },
    { ...createRow('extras'), id: 'cable-2', audioCategory: 'cables', concept: 'Synthetic second cable' },
  ]
  const snapshot = structuredClone(rows)
  const ordered = orderQuotationRows(Object.freeze(rows))
  assert.deepEqual(ordered.map((row) => row.id), [
    'amplifier-dsp', 'additional-amplifier', 'subwoofer', 'speakers', 'speaker-2',
    'free-equipment-1', 'free-equipment-2', 'cables', 'cable-2', 'harness', 'adapters', 'labor',
    'free-extra-1', 'free-extra-2',
  ])
  assert.deepEqual(rows, snapshot)
  assert.notEqual(ordered, rows)
  for (const row of rows) assert.equal(ordered.find((candidate) => candidate.id === row.id), row)
  assert.deepEqual(orderQuotationRows(ordered), ordered)
})

test('ordering retains empty rows and treats incompatible category metadata as a free concept', () => {
  const rows: QuotationRow[] = [
    { ...createRow('extras'), id: 'blank-extras' },
    { ...createRow(), id: 'wrong-section', audioCategory: 'labor', concept: 'Synthetic retained item' },
    { ...createRow(), id: 'blank-equipment' },
    { ...createRow(), id: 'categorized-blank', audioCategory: 'subwoofer' },
    { ...createRow(), id: 'amplifier', audioCategory: 'amplifier-dsp', concept: 'Synthetic amplifier' },
  ]
  assert.deepEqual(orderQuotationRows(rows).map((row) => row.id), [
    'amplifier', 'categorized-blank', 'wrong-section', 'blank-equipment', 'blank-extras',
  ])
  assert.deepEqual(orderQuotationRows([]), [])
})
