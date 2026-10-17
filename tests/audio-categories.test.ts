import assert from 'node:assert/strict'
import test from 'node:test'
import { AUDIO_CATEGORIES, getAudioCategories, orderQuotationRows, readAudioCategory } from '../src/features/quotation/audio-categories.ts'
import { createRow } from '../src/features/quotation/model.ts'
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
    { id: 'harness', section: 'extras', label: 'Ficha / arnés' },
    { id: 'adapters', section: 'extras', label: 'Aros / adaptadores 3D' },
    { id: 'labor', section: 'extras', label: 'Mano de obra' },
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
