import assert from 'node:assert/strict'
import test from 'node:test'
import { createQuotation, type Quotation } from '../src/features/quotation/model.ts'
import type { StorageAdapter } from '../src/features/quotation/persistence.ts'
import {
  createQuotationLibrary, LIBRARY_STORAGE_KEY, parseQuotationLibrary,
  saveQuotationToLibrary, serializeQuotationLibrary,
} from '../src/features/quotation/quotation-library.ts'
import { createQuotationLibraryController } from '../src/features/quotation/useQuotationLibrary.ts'

function quotation(): Quotation {
  const next = createQuotation()
  next.rows[0]!.concept = 'Synthetic work'
  next.rows[0]!.unitPrice = '12,50'
  next.rows[0]!.priceState = 'priced'
  next.exchangeRate = '1.250'
  return next
}

function adapter(initial: string | null = null): StorageAdapter & { values: Map<string, string>; writes: string[]; quota: boolean } {
  const values = new Map<string, string>(initial === null ? [] : [[LIBRARY_STORAGE_KEY, initial]])
  const result = {
    values, writes: [] as string[], quota: false,
    getItem(key: string) { return values.get(key) ?? null },
    setItem(key: string, value: string) {
      if (result.quota) throw new Error('quota')
      result.writes.push(key)
      values.set(key, value)
    },
  }
  return result
}

test('the library controller writes only on explicit save and opens frozen independent entries', async () => {
  const store = adapter()
  const controller = createQuotationLibraryController(store)
  let notifications = 0
  const stop = controller.subscribe(() => { notifications++ })
  controller.checkExternalChange()
  assert.deepEqual(store.writes, [])
  assert.equal(controller.actions.saveCurrent(quotation(), 'Saved'), true)
  const snapshot = controller.getSnapshot()
  assert.equal(snapshot.paused, false)
  assert.equal(snapshot.error, null)
  assert.equal(notifications, 1)
  assert.deepEqual(store.writes, [LIBRARY_STORAGE_KEY])
  const entry = snapshot.library.entries[0]!
  const opened = controller.actions.openEntry(entry.id)!
  assert.equal(opened.exchangeRateMode, 'frozen')
  assert.notEqual(opened.id, entry.quotation.id)
  assert.notEqual(opened.rows[0]!.id, entry.quotation.rows[0]!.id)
  opened.rows[0]!.concept = 'Changed after opening'
  assert.equal(controller.getSnapshot().library.entries[0]!.quotation.rows[0]!.concept, 'Synthetic work')
  const backup = controller.actions.createBackup()
  assert.equal(parseQuotationLibrary(await backup.file.text()).entries.length, 1)
  stop()
})

test('a failed save keeps the new snapshot in memory for backup and pauses further writes', async () => {
  const original = serializeQuotationLibrary(createQuotationLibrary())
  const store = adapter(original)
  const controller = createQuotationLibraryController(store)
  store.quota = true
  assert.equal(controller.actions.saveCurrent(quotation(), 'Pending local save'), false)
  assert.equal(store.values.get(LIBRARY_STORAGE_KEY), original)
  assert.equal(controller.getSnapshot().library.entries[0]!.name, 'Pending local save')
  assert.equal(controller.getSnapshot().paused, true)
  const backup = controller.actions.createBackup()
  assert.match(backup.message, /todavía no se guardaron/)
  assert.equal(parseQuotationLibrary(await backup.file.text()).entries[0]!.name, 'Pending local save')
  assert.equal(controller.actions.saveCurrent(quotation(), 'Blocked while paused'), false)
  assert.equal(controller.getSnapshot().library.entries.length, 1)
  store.quota = false
  controller.actions.resumeSaving()
  assert.equal(controller.getSnapshot().paused, false)
  assert.equal(parseQuotationLibrary(store.values.get(LIBRARY_STORAGE_KEY)!).entries[0]!.name, 'Pending local save')
})

test('external storage changes preserve the visible library until explicit resume', () => {
  const store = adapter()
  const controller = createQuotationLibraryController(store)
  controller.actions.saveCurrent(quotation(), 'Local saved')
  const remote = saveQuotationToLibrary(createQuotationLibrary(), quotation(), 'Other tab')
  const remoteRaw = serializeQuotationLibrary(remote)
  store.values.set(LIBRARY_STORAGE_KEY, remoteRaw)
  controller.checkExternalChange()
  assert.equal(controller.getSnapshot().paused, true)
  assert.equal(controller.getSnapshot().library.entries[0]!.name, 'Local saved')
  assert.equal(controller.actions.saveCurrent(quotation(), 'No automatic overwrite'), false)
  assert.equal(store.values.get(LIBRARY_STORAGE_KEY), remoteRaw)
  controller.actions.resumeSaving()
  assert.equal(controller.getSnapshot().paused, false)
  assert.equal(parseQuotationLibrary(store.values.get(LIBRARY_STORAGE_KEY)!).entries[0]!.name, 'Local saved')
})

test('initial corrupt data exports the exact original text and remains untouched until explicit import', async () => {
  const corrupt = '  {invalid original bytes\n'
  const store = adapter(corrupt)
  const controller = createQuotationLibraryController(store)
  assert.equal(controller.getSnapshot().paused, true)
  assert.equal(controller.actions.saveCurrent(quotation(), 'Blocked'), false)
  const recovery = controller.actions.createBackup()
  assert.match(recovery.file.name, /datos-a-recuperar/)
  assert.equal(await recovery.file.text(), corrupt)
  assert.match(recovery.message, /No es un respaldo validado/)
  assert.equal(store.values.get(LIBRARY_STORAGE_KEY), corrupt)
  const incoming = saveQuotationToLibrary(createQuotationLibrary(), quotation(), 'Imported with confirmation')
  assert.equal(controller.actions.importLibrary(incoming), true)
  assert.equal(controller.getSnapshot().paused, false)
  assert.equal(controller.getSnapshot().library.entries[0]!.name, 'Imported with confirmation')
  assert.doesNotMatch(controller.actions.createBackup().file.name, /datos-a-recuperar/)
})

test('a storage clear is detected without discarding the visible snapshots', () => {
  const store = adapter()
  const controller = createQuotationLibraryController(store)
  controller.actions.saveCurrent(quotation(), 'Keep visible after clear')
  store.values.delete(LIBRARY_STORAGE_KEY)
  controller.checkExternalChange()
  assert.equal(controller.getSnapshot().paused, true)
  assert.equal(controller.getSnapshot().library.entries[0]!.name, 'Keep visible after clear')
  assert.equal(store.values.has(LIBRARY_STORAGE_KEY), false)
})

test('failed or invalid imports preserve the previous visible library and stored bytes', () => {
  const existing = saveQuotationToLibrary(createQuotationLibrary(), quotation(), 'Previous visible')
  const originalRaw = serializeQuotationLibrary(existing)
  const store = adapter(originalRaw)
  const controller = createQuotationLibraryController(store)
  const incoming = saveQuotationToLibrary(createQuotationLibrary(), quotation(), 'Incoming')
  store.quota = true
  assert.equal(controller.actions.importLibrary(incoming), false)
  assert.equal(store.values.get(LIBRARY_STORAGE_KEY), originalRaw)
  assert.equal(controller.getSnapshot().library.entries[0]!.name, 'Previous visible')
  const invalid = { ...createQuotationLibrary(), entries: [{ id: 'bad' }] } as unknown as ReturnType<typeof createQuotationLibrary>
  assert.equal(controller.actions.importLibrary(invalid), false)
  assert.equal(controller.getSnapshot().library.entries[0]!.name, 'Previous visible')
})

test('unavailable storage remains paused without attempting writes or legacy fallback', () => {
  let writes = 0
  const store: StorageAdapter = {
    getItem(key) { assert.equal(key, LIBRARY_STORAGE_KEY); throw new Error('denied') },
    setItem() { writes++ },
  }
  const controller = createQuotationLibraryController(store)
  assert.equal(controller.getSnapshot().paused, true)
  controller.actions.resumeSaving()
  assert.equal(controller.actions.saveCurrent(quotation(), 'Unavailable'), false)
  assert.equal(writes, 0)
  const absent = createQuotationLibraryController(null)
  assert.equal(absent.getSnapshot().paused, true)
  assert.equal(absent.actions.importLibrary(createQuotationLibrary()), false)
})

test('header-only and quantity-only saves fail validation without creating entries or pausing healthy storage', () => {
  const store = adapter()
  const controller = createQuotationLibraryController(store)
  const blank = createQuotation()
  blank.title = 'Only a title'
  blank.notes = 'Only notes'
  blank.rows[0]!.quantity = '2'
  assert.equal(controller.actions.saveCurrent(blank, 'Not a quotation'), false)
  assert.equal(controller.getSnapshot().library.entries.length, 0)
  assert.equal(controller.getSnapshot().paused, false)
  assert.deepEqual(store.writes, [])
  assert.equal(controller.actions.openEntry('missing'), null)
})
