import type { FactoryEquipment, QuotationRow } from './model.ts'

export function isFactoryEligibleRow(row: QuotationRow): boolean {
  return row.section === 'equipment' && (row.audioCategory === 'speakers' || row.audioCategory === 'subwoofer')
}

function factoryConcept(category: FactoryEquipment['category']): string {
  return category === 'speakers' ? 'Parlantes de f\u00e1brica' : 'Subwoofer de f\u00e1brica'
}

export function isFactoryRow(row: QuotationRow): boolean {
  const factory = row.factoryEquipment
  return isFactoryEligibleRow(row) && factory?.version === 1 && factory.category === row.audioCategory
    && row.concept === factoryConcept(factory.category) && row.detail === ''
    && row.unitPrice === '0' && row.priceState === 'priced' && (row.currency === 'ARS' || row.currency === 'USD')
}

export function setRowFactoryMode(row: QuotationRow, enabled: boolean): QuotationRow {
  if (!enabled) {
    if (row.factoryEquipment === undefined) return row
    const { factoryEquipment, ...restored } = row
    return { ...restored, ...factoryEquipment.original }
  }
  if (row.factoryEquipment !== undefined) {
    if (!isFactoryRow(row)) throw new Error('Invalid factory equipment state.')
    return row
  }
  if (!isFactoryEligibleRow(row)) return row
  const category = row.audioCategory === 'speakers' ? 'speakers' : 'subwoofer'
  const factoryEquipment: FactoryEquipment = {
    version: 1, category,
    original: {
      concept: row.concept, detail: row.detail, unitPrice: row.unitPrice,
      priceState: row.priceState, currency: row.currency,
    },
  }
  return {
    ...row, factoryEquipment, concept: factoryConcept(category), detail: '', unitPrice: '0', priceState: 'priced',
  }
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid factory equipment metadata.')
  return value as Record<string, unknown>
}

function text(value: unknown, limit: number): string {
  if (typeof value !== 'string' || value.length > limit) throw new Error('Invalid factory equipment text.')
  return value
}

export function parseFactoryEquipment(value: unknown): FactoryEquipment {
  const input = record(value)
  if (input.version !== 1 || (input.category !== 'speakers' && input.category !== 'subwoofer')) {
    throw new Error('Invalid factory equipment metadata.')
  }
  const original = record(input.original)
  if (original.currency !== 'ARS' && original.currency !== 'USD') throw new Error('Invalid original equipment currency.')
  if (original.priceState !== 'pending' && original.priceState !== 'priced' && original.priceState !== 'included') {
    throw new Error('Invalid original equipment price state.')
  }
  return {
    version: 1, category: input.category,
    original: {
      concept: text(original.concept, 500), detail: text(original.detail, 2000),
      unitPrice: text(original.unitPrice, 64), priceState: original.priceState, currency: original.currency,
    },
  }
}
