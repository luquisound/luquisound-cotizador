import { useEffect, useState, useSyncExternalStore } from 'react'
import type { Quotation } from './model.ts'
import type { StorageAdapter } from './persistence.ts'
import {
  createQuotationLibrary, LIBRARY_STORAGE_KEY, loadQuotationLibrary, openLibraryQuotation,
  parseQuotationLibrary, saveQuotationLibrary, saveQuotationToLibrary, serializeQuotationLibrary,
  type QuotationLibrary,
} from './quotation-library.ts'

interface LibrarySnapshot {
  library: QuotationLibrary
  error: string | null
  paused: boolean
}

export interface QuotationLibraryActions {
  saveCurrent: (quotation: Quotation, name: string, replaceId?: string) => boolean
  openEntry: (id: string, duplicate?: boolean) => Quotation | null
  importLibrary: (library: QuotationLibrary) => boolean
  resumeSaving: () => void
  createBackup: () => { file: File; message: string }
}

const UNAVAILABLE_MESSAGE = 'No se pudo acceder al historial de este navegador. Los datos anteriores no se modificaron.'
const PAUSED_MESSAGE = 'El guardado del historial está pausado. Descargá un respaldo antes de habilitarlo.'
const CONFLICT_MESSAGE = 'Otra pestaña cambió el historial. Se pausó el guardado para conservar ambas versiones. Descargá un respaldo antes de continuar.'

/** One local history session. Only explicit user actions write its storage key. */
export function createQuotationLibraryController(storage: StorageAdapter | null): {
  getSnapshot: () => LibrarySnapshot
  subscribe: (listener: () => void) => () => void
  checkExternalChange: () => void
  actions: QuotationLibraryActions
} {
  const initial = storage === null ? {
    library: createQuotationLibrary(), raw: null, error: UNAVAILABLE_MESSAGE, stored: false,
  } : loadQuotationLibrary(storage)
  let snapshot: LibrarySnapshot = { library: initial.library, error: initial.error, paused: initial.error !== null }
  let raw = initial.raw
  let allowed = initial.error === null
  let unreadableRaw = initial.error !== null ? initial.raw : null
  const listeners = new Set<() => void>()

  function publish(library: QuotationLibrary, error: string | null, paused: boolean) {
    if (snapshot.library === library && snapshot.error === error && snapshot.paused === paused) return
    snapshot = { library, error, paused }
    for (const listener of listeners) listener()
  }

  function persist(next: QuotationLibrary, options: { expectedRaw?: string | null; overwriteInvalid?: boolean; keepPending?: boolean } = {}): boolean {
    const result = storage === null
      ? { ok: false, error: UNAVAILABLE_MESSAGE, raw, conflict: false }
      : saveQuotationLibrary(storage, next, {
        expectedRaw: options.expectedRaw === undefined ? raw : options.expectedRaw,
        overwriteInvalid: options.overwriteInvalid,
      })
    if (result.ok) {
      raw = result.raw
      unreadableRaw = null
      allowed = true
      publish(next, null, false)
      return true
    }
    allowed = false
    publish(options.keepPending ? next : snapshot.library, result.error, true)
    return false
  }

  const actions: QuotationLibraryActions = {
    saveCurrent(quotation, name, replaceId) {
      if (!allowed) { publish(snapshot.library, snapshot.error ?? PAUSED_MESSAGE, true); return false }
      try {
        const next = saveQuotationToLibrary(snapshot.library, quotation, name, { replaceEntryId: replaceId })
        return persist(next, { keepPending: true })
      } catch (error) {
        publish(snapshot.library, error instanceof Error ? error.message : 'No se pudo preparar el presupuesto para guardarlo.', snapshot.paused)
        return false
      }
    },
    openEntry(id, duplicate = false) {
      const entry = snapshot.library.entries.find((candidate) => candidate.id === id)
      if (!entry) { publish(snapshot.library, 'Ese presupuesto ya no está en el historial visible.', snapshot.paused); return null }
      try { return openLibraryQuotation(entry, { duplicate }) }
      catch (error) {
        publish(snapshot.library, error instanceof Error ? error.message : 'No se pudo abrir el presupuesto guardado.', snapshot.paused)
        return null
      }
    },
    importLibrary(library) {
      try {
        const next = parseQuotationLibrary(serializeQuotationLibrary(library))
        return persist(next, { overwriteInvalid: true })
      } catch (error) {
        publish(snapshot.library, error instanceof Error ? error.message : 'No se pudo importar el historial. El anterior se conserva.', snapshot.paused)
        return false
      }
    },
    resumeSaving() {
      if (storage === null) { publish(snapshot.library, UNAVAILABLE_MESSAGE, true); return }
      try {
        const actual = storage.getItem(LIBRARY_STORAGE_KEY)
        persist(snapshot.library, { expectedRaw: actual, overwriteInvalid: true })
      } catch { allowed = false; publish(snapshot.library, UNAVAILABLE_MESSAGE, true) }
    },
    createBackup() {
      const date = new Date().toISOString().slice(0, 10)
      if (unreadableRaw !== null) {
        return {
          file: new File([unreadableRaw], `luquisound-historial-datos-a-recuperar-${date}.json`, { type: 'application/json' }),
          message: 'Copia de recuperación preparada con los datos originales que no pudieron leerse. No es un respaldo validado; conservala antes de reemplazarlos.',
        }
      }
      return {
        file: new File([serializeQuotationLibrary(snapshot.library)], `luquisound-historial-respaldo-${date}.json`, { type: 'application/json' }),
        message: snapshot.paused
          ? 'Respaldo de los presupuestos visibles preparado. Incluye los cambios de esta pestaña que todavía no se guardaron en este navegador.'
          : 'Respaldo del historial preparado. Guardalo en un lugar privado.',
      }
    },
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    checkExternalChange() {
      if (storage === null) return
      try {
        if (storage.getItem(LIBRARY_STORAGE_KEY) !== raw) { allowed = false; publish(snapshot.library, CONFLICT_MESSAGE, true) }
      } catch { allowed = false; publish(snapshot.library, UNAVAILABLE_MESSAGE, true) }
    },
    actions,
  }
}

export function useQuotationLibrary(): LibrarySnapshot & QuotationLibraryActions {
  const [controller] = useState(() => {
    try { return createQuotationLibraryController(window.localStorage) }
    catch { return createQuotationLibraryController(null) }
  })
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  useEffect(() => {
    function storageChanged(event: StorageEvent) {
      if (event.key === LIBRARY_STORAGE_KEY || event.key === null) controller.checkExternalChange()
    }
    window.addEventListener('storage', storageChanged)
    controller.checkExternalChange()
    return () => window.removeEventListener('storage', storageChanged)
  }, [controller])
  return { ...snapshot, ...controller.actions }
}
