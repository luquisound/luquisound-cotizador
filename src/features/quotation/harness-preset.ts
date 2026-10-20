import { createRow, type HarnessSelection, type QuotationRow } from './model.ts'

export const HARNESS_PRESET_CONCEPT = 'Ficha bypass est\u00e9reo'
export const HARNESS_PRESET_UNIT_PRICE = '70.000'
export const HARNESS_PRESET_CURRENCY = 'ARS'

function isHarnessRow(row: QuotationRow): boolean {
  return row.section === 'extras' && row.audioCategory === 'harness'
}

export function isHarnessPresetRow(row: QuotationRow): boolean {
  return isHarnessRow(row) && typeof row.harnessSelection?.enabled === 'boolean'
}

export function isInactiveHarnessRow(row: QuotationRow): boolean {
  return isHarnessPresetRow(row) && row.harnessSelection?.enabled === false
}

export function createHarnessPresetRow(enabled = false): QuotationRow {
  if (typeof enabled !== 'boolean') throw new Error('Invalid stereo bypass selection.')
  return {
    ...createRow('extras', HARNESS_PRESET_CURRENCY), audioCategory: 'harness', concept: HARNESS_PRESET_CONCEPT,
    unitPrice: HARNESS_PRESET_UNIT_PRICE, priceState: 'priced', harnessSelection: { enabled },
  }
}

export function setHarnessPresetSelected(row: QuotationRow, enabled: boolean): QuotationRow {
  if (!isHarnessRow(row)) throw new Error('Only a classified stereo bypass can be selected.')
  if (typeof enabled !== 'boolean') throw new Error('Invalid stereo bypass selection.')
  if (row.harnessSelection?.enabled === enabled) return row
  return { ...row, harnessSelection: { enabled } }
}

export function parseHarnessSelection(value: unknown): HarnessSelection {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid stereo bypass selection.')
  const input = value as Record<string, unknown>
  if (typeof input.enabled !== 'boolean') throw new Error('Invalid stereo bypass selection.')
  return { enabled: input.enabled }
}
