import { parseMoney } from './calculation.ts'
import { CATALOG_IMPORT_MAX_ITEMS } from './catalog.ts'
import type { CatalogItem } from './model.ts'

export interface CatalogEditBaseline {
  id: string
  snapshot: string | null
}

const optionalFields = [
  ['supplier', 200, 'El proveedor'],
  ['sku', 128, 'El c\u00f3digo'],
  ['brand', 200, 'La marca'],
  ['category', 200, 'La categor\u00eda'],
  ['unit', 200, 'La unidad'],
  ['presentation', 200, 'La presentaci\u00f3n'],
] as const

function text(value: unknown, limit: number, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} debe ser texto.`)
  if (value.length > limit) throw new Error(`${label} admite hasta ${limit} caracteres.`)
  return value.trim()
}

function key(value: string | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

export function captureCatalogEditBaseline(item: CatalogItem, exists: boolean): CatalogEditBaseline {
  return { id: item.id, snapshot: exists ? JSON.stringify(item) : null }
}

export function buildCatalogEdit(
  catalog: readonly CatalogItem[], draft: CatalogItem, baseline: CatalogEditBaseline,
): CatalogItem[] {
  if (typeof draft.id !== 'string' || !draft.id.trim() || draft.id !== baseline.id
    || (baseline.snapshot !== null && typeof baseline.snapshot !== 'string')) {
    throw new Error('La opci\u00f3n no coincide con la que abriste. Volv\u00e9 a abrirla antes de guardar.')
  }

  const identifiers = new Set<string>()
  for (const item of catalog) {
    if (identifiers.has(item.id)) {
      throw new Error('El cat\u00e1logo contiene identificaciones repetidas. Revisalo antes de guardar esta opci\u00f3n.')
    }
    identifiers.add(item.id)
  }

  const matches = catalog.filter((item) => item.id === baseline.id)
  const current = matches[0]
  if (baseline.snapshot === null) {
    if (matches.length > 0) {
      throw new Error('Ya existe otra opci\u00f3n con esta identificaci\u00f3n. Cre\u00e1 una nueva opci\u00f3n antes de guardar.')
    }
  } else if (matches.length !== 1 || JSON.stringify(current) !== baseline.snapshot) {
    throw new Error('La opci\u00f3n cambi\u00f3 o fue retirada del cat\u00e1logo. Volv\u00e9 a abrirla antes de guardar; tus cambios siguen en el formulario.')
  }

  if (catalog.length + (baseline.snapshot === null ? 1 : 0) > CATALOG_IMPORT_MAX_ITEMS) {
    throw new Error('El cat\u00e1logo admite hasta 2000 opciones. Elimin\u00e1 una antes de agregar otra.')
  }

  const concept = text(draft.concept, 500, 'El concepto')
  if (!concept) throw new Error('Escrib\u00ed un concepto para guardar esta opci\u00f3n.')
  const detail = text(draft.detail, 2000, 'El detalle')
  const unitPrice = text(draft.unitPrice, 64, 'El precio de venta')
  if (unitPrice && !parseMoney(unitPrice).ok) {
    throw new Error('Revis\u00e1 el precio de venta. Us\u00e1 cero o un importe positivo y coma para decimales.')
  }
  if (draft.section !== 'equipment' && draft.section !== 'extras') {
    throw new Error('Eleg\u00ed una secci\u00f3n v\u00e1lida para esta opci\u00f3n.')
  }
  if (draft.currency !== 'ARS' && draft.currency !== 'USD') {
    throw new Error('Eleg\u00ed ARS o USD para el precio de venta.')
  }

  const manual: CatalogItem = {
    id: baseline.id, concept, detail, section: draft.section, currency: draft.currency, unitPrice,
  }
  for (const [field, limit, label] of optionalFields) {
    if (draft[field] !== undefined) manual[field] = text(draft[field], limit, label)
  }

  const supplier = key(manual.supplier)
  const sku = key(manual.sku)
  if (supplier && sku && catalog.some((item) => item.id !== baseline.id
    && key(item.supplier) === supplier && key(item.sku) === sku)) {
    throw new Error('Ya existe otra opci\u00f3n con ese proveedor y c\u00f3digo. Buscala para editarla o revis\u00e1 la identificaci\u00f3n.')
  }

  const nextItem: CatalogItem = current ? { ...structuredClone(current), ...manual } : manual
  for (const [field] of optionalFields) {
    if (draft[field] === undefined) delete nextItem[field]
  }
  return baseline.snapshot === null
    ? [...catalog, nextItem]
    : catalog.map((item) => item.id === baseline.id ? nextItem : item)
}
