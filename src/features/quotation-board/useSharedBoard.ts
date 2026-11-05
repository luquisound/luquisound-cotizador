import { useCallback, useEffect, useRef, useState } from 'react'
import { calculateQuotation } from '../quotation/calculation.ts'
import { BoardClientError, createBoardClient } from './board-client.ts'
import type { BoardEntry } from './board-types.ts'
import type { BoardDetailResponse, BoardEntrySummary, BoardListResponse, BoardSaveCommand, BoardSaveResponse } from './shared-board-types.ts'

interface DetailRequest {
  epoch: string | null
  controller: AbortController
  promise: Promise<BoardDetailResponse>
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function abortError(): DOMException {
  return new DOMException('La solicitud del tablero fue cancelada.', 'AbortError')
}

function summary(entry: BoardEntry): BoardEntrySummary {
  return {
    id: entry.id, name: entry.name, categoryId: entry.categoryId, revision: entry.revision,
    updatedAt: entry.updatedAt, title: entry.quotation.title, subtitle: entry.quotation.subtitle,
    pending: !calculateQuotation(entry.quotation).canExport,
  }
}

export function useSharedBoard({ enabled }: { enabled: boolean }) {
  const [client] = useState(() => createBoardClient())
  const [list, setList] = useState<BoardListResponse | null>(null)
  const [entries, setEntries] = useState<ReadonlyMap<string, BoardEntry>>(() => new Map())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewErrors, setPreviewErrors] = useState<ReadonlySet<string>>(() => new Set())
  const [loadingEntries, setLoadingEntries] = useState<ReadonlySet<string>>(() => new Set())
  const mounted = useRef(false)
  const listRef = useRef<BoardListResponse | null>(null)
  const entriesRef = useRef(new Map<string, BoardEntry>())
  const cacheEpoch = useRef<string | null>(null)
  const detailRequests = useRef(new Map<string, DetailRequest>())
  const saveRequests = useRef(new Set<AbortController>())
  const listRequest = useRef<{ controller: AbortController; promise: Promise<BoardListResponse | null> } | null>(null)
  const listSequence = useRef(0)
  const mutationSequence = useRef(0)

  const publishEntries = useCallback(() => {
    if (mounted.current) setEntries(new Map(entriesRef.current))
  }, [])

  const publishLoadingEntries = useCallback(() => {
    if (mounted.current) setLoadingEntries(new Set(detailRequests.current.keys()))
  }, [])

  const invalidateListRequest = useCallback(() => {
    listSequence.current += 1
    listRequest.current?.controller.abort()
    listRequest.current = null
    if (mounted.current) setLoading(false)
  }, [])

  const applyList = useCallback((received: BoardListResponse) => {
    const previous = listRef.current
    if (previous?.epoch === received.epoch && previous.revision > received.revision) return previous
    if (cacheEpoch.current !== received.epoch) {
      cacheEpoch.current = received.epoch
      entriesRef.current.clear()
      for (const request of detailRequests.current.values()) {
        if (request.epoch !== null && request.epoch !== received.epoch) request.controller.abort()
      }
      if (mounted.current) setPreviewErrors(new Set())
    }
    const next = {
      ...received,
      entries: received.entries.map((item) => {
        const cached = entriesRef.current.get(item.id)
        return cached && cached.revision > item.revision ? summary(cached) : item
      }),
    }
    const revisions = new Map(next.entries.map((item) => [item.id, item.revision]))
    for (const [id, cached] of entriesRef.current) {
      if (revisions.get(id) !== cached.revision) entriesRef.current.delete(id)
    }
    listRef.current = next
    if (mounted.current) setList(next)
    publishEntries()
    return next
  }, [publishEntries])

  const refresh = useCallback((): Promise<BoardListResponse | null> => {
    if (listRequest.current) return listRequest.current.promise
    if (!mounted.current) return Promise.resolve(null)
    const controller = new AbortController()
    const sequence = ++listSequence.current
    const mutation = mutationSequence.current
    setLoading(true)
    setError(null)
    const promise = client.listBoard(controller.signal).then((received) => {
      if (!mounted.current || controller.signal.aborted || sequence !== listSequence.current
        || mutation !== mutationSequence.current) return listRef.current
      return applyList(received)
    }).catch((cause: unknown) => {
      if (mounted.current && !isAbort(cause) && sequence === listSequence.current) {
        setError(cause instanceof BoardClientError ? cause.message : 'No se pudo cargar el tablero. Tu presupuesto se conserva.')
      }
      return null
    }).finally(() => {
      if (listRequest.current?.controller === controller) listRequest.current = null
      if (mounted.current && sequence === listSequence.current) setLoading(false)
    })
    listRequest.current = { controller, promise }
    return promise
  }, [applyList, client])

  const loadEntry = useCallback((entryId: string): Promise<BoardDetailResponse> => {
    const epoch = listRef.current?.epoch ?? cacheEpoch.current
    const cached = entriesRef.current.get(entryId)
    const expected = listRef.current?.entries.find((entry) => entry.id === entryId)
    if (cached && epoch !== null && cacheEpoch.current === epoch && expected?.revision === cached.revision) {
      return Promise.resolve({ epoch, entry: cached })
    }
    const existing = detailRequests.current.get(entryId)
    if (existing && existing.epoch === epoch && !existing.controller.signal.aborted) return existing.promise
    existing?.controller.abort()
    const controller = new AbortController()
    if (mounted.current) setPreviewErrors((previous) => {
      const next = new Set(previous)
      next.delete(entryId)
      return next
    })
    const promise = client.getBoardEntry(entryId, controller.signal).then((received) => {
      if (!mounted.current || controller.signal.aborted) throw abortError()
      const currentEpoch = listRef.current?.epoch ?? cacheEpoch.current
      if ((epoch !== null && received.epoch !== epoch) || (currentEpoch !== null && received.epoch !== currentEpoch)) {
        throw new BoardClientError('conflict')
      }
      const latest = entriesRef.current.get(entryId)
      if (cacheEpoch.current === received.epoch && latest && latest.revision > received.entry.revision) {
        return { epoch: received.epoch, entry: latest }
      }
      const currentSummary = listRef.current?.entries.find((entry) => entry.id === entryId)
      if (currentSummary && currentSummary.revision > received.entry.revision) throw new BoardClientError('conflict')
      cacheEpoch.current = received.epoch
      entriesRef.current.set(entryId, received.entry)
      const currentList = listRef.current
      if (currentList?.epoch === received.epoch && currentSummary && currentSummary.revision < received.entry.revision) {
        const next = { ...currentList, entries: currentList.entries.map((entry) => entry.id === entryId ? summary(received.entry) : entry) }
        listRef.current = next
        setList(next)
      }
      publishEntries()
      return received
    }).catch((cause: unknown) => {
      if (mounted.current && !isAbort(cause)) setPreviewErrors((previous) => new Set(previous).add(entryId))
      throw cause
    }).finally(() => {
      if (detailRequests.current.get(entryId)?.controller === controller) detailRequests.current.delete(entryId)
      publishLoadingEntries()
    })
    detailRequests.current.set(entryId, { epoch, controller, promise })
    publishLoadingEntries()
    return promise
  }, [client, publishEntries, publishLoadingEntries])

  const save = useCallback(async (command: BoardSaveCommand): Promise<BoardSaveResponse> => {
    const submitted = structuredClone(command)
    const controller = new AbortController()
    saveRequests.current.add(controller)
    mutationSequence.current += 1
    invalidateListRequest()
    try {
      const received = await client.saveBoardEntry(submitted, controller.signal)
      if (!mounted.current || controller.signal.aborted) throw abortError()
      const currentList = listRef.current
      const cached = entriesRef.current.get(received.entry.id)
      const latestSummary = currentList?.entries.find((entry) => entry.id === received.entry.id)
      if ((currentList !== null && currentList.epoch !== received.epoch)
        || (cacheEpoch.current === received.epoch && cached && cached.revision > received.entry.revision)
        || (latestSummary && latestSummary.revision > received.entry.revision)) {
        throw new BoardClientError('conflict')
      }
      mutationSequence.current += 1
      invalidateListRequest()
      if (cacheEpoch.current !== received.epoch) entriesRef.current.clear()
      cacheEpoch.current = received.epoch
      entriesRef.current.set(received.entry.id, received.entry)
      publishEntries()
      if (currentList?.epoch === received.epoch) {
        const categories = submitted.newCategoryName && received.entry.categoryId !== null
          && !currentList.categories.some((category) => category.id === received.entry.categoryId)
          ? [...currentList.categories, { id: received.entry.categoryId, name: submitted.newCategoryName.trim() }]
          : currentList.categories
        const next = {
          ...currentList, categories,
          entries: [summary(received.entry), ...currentList.entries.filter((entry) => entry.id !== received.entry.id)],
        }
        listRef.current = next
        setList(next)
      }
      setPreviewErrors((previous) => {
        const next = new Set(previous)
        next.delete(received.entry.id)
        return next
      })
      setError(null)
      // Confirmation is durable even if this follow-up list read fails.
      void refresh()
      return received
    } finally {
      saveRequests.current.delete(controller)
    }
  }, [client, invalidateListRequest, publishEntries, refresh])

  useEffect(() => {
    mounted.current = true
    const details = detailRequests.current
    const saves = saveRequests.current
    return () => {
      mounted.current = false
      listSequence.current += 1
      listRequest.current?.controller.abort()
      listRequest.current = null
      for (const request of details.values()) request.controller.abort()
      details.clear()
      for (const controller of saves) controller.abort()
      saves.clear()
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    void refresh()
    const check = () => {
      if (document.visibilityState !== 'hidden' && navigator.onLine) void refresh()
    }
    window.addEventListener('focus', check)
    window.addEventListener('online', check)
    document.addEventListener('visibilitychange', check)
    return () => {
      window.removeEventListener('focus', check)
      window.removeEventListener('online', check)
      document.removeEventListener('visibilitychange', check)
    }
  }, [enabled, refresh])

  return { list, entries, loading, error, refresh, loadEntry, save, previewErrors, loadingEntries }
}
