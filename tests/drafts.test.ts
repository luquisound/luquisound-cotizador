import assert from 'node:assert/strict'
import test from 'node:test'
import { createQuotation, createWorkspace, duplicateQuotation, ensureBlankQuotation, hasQuotationContent, prepareWorkspaceForStorage } from '../src/features/quotation/model.ts'
import type { Quotation, Workspace } from '../src/features/quotation/model.ts'
import { loadWorkspace, parseWorkspace, saveWorkspace, serializeWorkspace } from '../src/features/quotation/persistence.ts'
import type { StorageAdapter } from '../src/features/quotation/persistence.ts'
import { AUDIO_CATEGORIES } from '../src/features/quotation/audio-categories.ts'

function createEmptyWorkspace(): Workspace {
  return { version: 1, activeQuotationId: null, quotations: [], catalog: [] }
}

test('audio classification alone remains blank and does not create recoverable draft content', () => {
  for (const category of AUDIO_CATEGORIES) {
    const quotation = createQuotation()
    quotation.rows[0] = { ...quotation.rows[0]!, section: category.section, audioCategory: category.id }
    assert.equal(hasQuotationContent(quotation), false)
    const workspace: Workspace = { version: 1, activeQuotationId: quotation.id, quotations: [quotation], catalog: [] }
    assert.deepEqual(prepareWorkspaceForStorage(workspace, new Set()), createEmptyWorkspace())
    quotation.rows[0].concept = 'Synthetic unfinished item'
    assert.equal(hasQuotationContent(quotation), true)
    assert.deepEqual(prepareWorkspaceForStorage(workspace, new Set()), workspace)
  }
})

test('default titles, blank copy titles and placeholder rows have no quotation content', () => {
  for (const title of ['', '   ', 'PRESUPUESTO', ' presupuesto ', 'Presupuesto (copia)', ' PRESUPUESTO (COPIA) (copia) ']) {
    const quotation = createQuotation()
    quotation.title = title
    quotation.currency = 'USD'
    quotation.createdAt = '2026-01-01T00:00:00.000Z'
    quotation.updatedAt = '2026-10-16T00:00:00.000Z'
    assert.equal(hasQuotationContent(quotation), false, title)
  }
  const quotation = createQuotation()
  quotation.rows = []
  assert.equal(hasQuotationContent(quotation), false)
  const copy = duplicateQuotation(duplicateQuotation(createQuotation()))
  assert.equal(hasQuotationContent(copy), false)
})

test('custom titles, subtitles and notes count as content while whitespace does not', () => {
  const blank = createQuotation()
  blank.subtitle = ' \n '
  blank.notes = '\t '
  assert.equal(hasQuotationContent(blank), false)
  for (const quotation of [
    { ...blank, title: 'Proyecto de prueba' },
    { ...blank, title: 'Proyecto de prueba (copia)' },
    { ...blank, subtitle: 'Detalle de prueba' },
    { ...blank, notes: 'Trabajo por revisar' },
  ]) assert.equal(hasQuotationContent(quotation), true)
})

test('incomplete concepts, descriptions and invalid raw inputs remain meaningful drafts', () => {
  for (const fields of [
    { concept: 'Trabajo pendiente' }, { detail: 'Detalle sin concepto' },
    { unitPrice: 'precio a revisar' }, { unitPrice: '0' }, { unitPrice: '0,00' },
    { quantity: '2' }, { quantity: '' }, { quantity: '0' }, { quantity: 'cantidad a revisar' },
  ]) {
    const quotation = createQuotation()
    quotation.rows[0] = { ...quotation.rows[0]!, ...fields }
    assert.equal(hasQuotationContent(quotation), true, JSON.stringify(fields))
    assert.equal(quotation.rows[0]!.priceState, 'pending')
  }
  const included = createQuotation()
  included.rows[0]!.priceState = 'included'
  assert.equal(hasQuotationContent(included), true)
})

test('repeated new actions reuse the active blank quotation without growing the workspace', () => {
  const original = createEmptyWorkspace()
  const workspace = ensureBlankQuotation(original)
  const activeId = workspace.activeQuotationId
  let next = workspace
  for (let index = 0; index < 100; index += 1) next = ensureBlankQuotation(next)
  assert.equal(next.quotations.length, 1)
  assert.equal(next.activeQuotationId, activeId)
  assert.equal(next, workspace)
  assert.deepEqual(original, createEmptyWorkspace())
})

test('a blank active quotation is reused even if a legacy blank is also present', () => {
  const first = createQuotation()
  const active = createQuotation()
  const workspace: Workspace = { version: 1, activeQuotationId: active.id, quotations: [first, active], catalog: [] }
  const before = structuredClone(workspace)
  assert.equal(ensureBlankQuotation(workspace), workspace)
  assert.deepEqual(workspace, before)
})

test('new selects another existing blank without changing meaningful work or removing legacy blanks', () => {
  const meaningful = createQuotation()
  meaningful.rows[0]!.concept = 'Trabajo de prueba'
  const blank = duplicateQuotation(createQuotation())
  const anotherBlank = createQuotation()
  const workspace: Workspace = { version: 1, activeQuotationId: meaningful.id, quotations: [meaningful, blank, anotherBlank], catalog: [] }
  const before = structuredClone(workspace)
  const next = ensureBlankQuotation(workspace)
  assert.equal(next.activeQuotationId, blank.id)
  assert.equal(next.quotations.length, 3)
  assert.deepEqual(next.quotations, before.quotations)
  assert.deepEqual(workspace, before)
})

test('new creates only one blank when every current quotation has content', () => {
  const workspace = createWorkspace()
  workspace.quotations[0]!.subtitle = 'Trabajo de prueba'
  const original = structuredClone(workspace)
  const next = ensureBlankQuotation(workspace)
  assert.equal(next.quotations.length, 2)
  assert.notEqual(next.activeQuotationId, workspace.activeQuotationId)
  assert.equal(hasQuotationContent(next.quotations[1]!), false)
  assert.deepEqual(ensureBlankQuotation(next), next)
  assert.deepEqual(workspace, original)
})

test('preparing a new blank for storage removes its phantom active ID without mutating memory', () => {
  const workspace = createWorkspace()
  const original = structuredClone(workspace)
  const prepared = prepareWorkspaceForStorage(workspace, new Set())
  assert.deepEqual(prepared, createEmptyWorkspace())
  assert.deepEqual(parseWorkspace(serializeWorkspace(prepared)), createEmptyWorkspace())
  assert.deepEqual(workspace, original)
  assert.equal(workspace.quotations.length, 1)
})

test('existing empty drafts are retained exactly while only new blanks are excluded', () => {
  const existing = createQuotation()
  const existingCopy = duplicateQuotation(existing)
  const newBlank = createQuotation()
  const quotations = [existing, existingCopy, newBlank]
  const workspace: Workspace = { version: 1, activeQuotationId: newBlank.id, quotations, catalog: [] }
  const persistedIds = new Set([existing.id, existingCopy.id])
  const original = structuredClone(workspace)
  const prepared = prepareWorkspaceForStorage(workspace, persistedIds)
  assert.deepEqual(prepared.quotations, [existing, existingCopy])
  assert.equal(prepared.activeQuotationId, existing.id)
  assert.deepEqual(workspace, original)
  assert.equal(persistedIds.size, 2)
  assert.deepEqual(parseWorkspace(serializeWorkspace(prepared)), prepared)
})

test('preparing storage preserves a retained active quotation and catalogue without inventing drafts', () => {
  const first = createQuotation()
  const active = createQuotation()
  const workspace: Workspace = { version: 1, activeQuotationId: active.id, quotations: [first, active], catalog: [] }
  const prepared = prepareWorkspaceForStorage(workspace, new Set([first.id, active.id]))
  assert.equal(prepared.activeQuotationId, active.id)
  const empty = createEmptyWorkspace()
  empty.catalog = [{ id: 'catalog-only', concept: 'Opción de prueba', detail: '', section: 'extras', currency: 'ARS', unitPrice: '' }]
  assert.deepEqual(prepareWorkspaceForStorage(empty, new Set()), empty)
  assert.deepEqual(parseWorkspace(serializeWorkspace(prepareWorkspaceForStorage(empty, new Set()))), empty)
})

test('new partial, zero, included and description-only drafts are preserved independently of persisted IDs', () => {
  const quotations: Quotation[] = []
  for (const fields of [
    { concept: 'Pendiente de precio' }, { detail: 'Solo detalle' },
    { unitPrice: '0', priceState: 'priced' as const },
    { priceState: 'included' as const }, { quantity: '2' },
  ]) {
    const quotation = createQuotation()
    quotation.rows[0] = { ...quotation.rows[0]!, ...fields }
    quotations.push(quotation)
  }
  const workspace: Workspace = { version: 1, activeQuotationId: quotations[4]!.id, quotations, catalog: [] }
  const prepared = prepareWorkspaceForStorage(workspace, new Set())
  assert.deepEqual(prepared, workspace)
  assert.deepEqual(parseWorkspace(serializeWorkspace(prepared)), workspace)
})

test('raw serialization preserves existing blank drafts and never applies autosave filtering implicitly', () => {
  const workspace = createWorkspace()
  workspace.quotations.push(duplicateQuotation(workspace.quotations[0]!))
  assert.deepEqual(parseWorkspace(serializeWorkspace(workspace)), workspace)
  assert.equal(prepareWorkspaceForStorage(workspace, new Set()).quotations.length, 0)
})

test('repeated clean reloads hydrate one memory blank and persist no phantom drafts', () => {
  let stored: string | null = null
  const storage: StorageAdapter = {
    getItem() { return stored },
    setItem(_key, text) { stored = text },
  }
  for (let index = 0; index < 20; index += 1) {
    const loaded = loadWorkspace(storage)
    assert.equal(loaded.error, null)
    assert.equal(loaded.stored, index > 0)
    const persistedIds = new Set(loaded.stored ? loaded.workspace.quotations.map((quotation) => quotation.id) : [])
    const memory = ensureBlankQuotation(loaded.workspace)
    assert.equal(memory.quotations.length, 1)
    const prepared = prepareWorkspaceForStorage(ensureBlankQuotation(memory), persistedIds)
    assert.deepEqual(prepared, createEmptyWorkspace())
    assert.equal(saveWorkspace(storage, prepared).ok, true)
    assert.deepEqual(parseWorkspace(stored ?? ''), createEmptyWorkspace())
  }
})
