import {
  BOARD_MAX_BYTES, BOARD_REQUEST_MAX_BYTES, quotationBaseline, readBoardDetailResponse,
  readBoardListResponse, readBoardSaveCommand, readBoardSaveResponse,
} from './board-contract.ts'
import type { BoardDetailResponse, BoardListResponse, BoardSaveCommand, BoardSaveResponse } from './shared-board-types.ts'

export type BoardClientErrorCode = 'unavailable' | 'access' | 'conflict' | 'not-found' | 'invalid' | 'network' | 'capacity'
  | 'category-exists' | 'category-missing'

const messages: Record<BoardClientErrorCode, string> = {
  unavailable: 'El tablero compartido no está disponible. Tu presupuesto se conserva.',
  access: 'Tu acceso al tablero venció o no está habilitado. Volvé a ingresar y reintentá.',
  conflict: 'El presupuesto cambió en el tablero. Tu edición se conserva; podés guardarla como nueva.',
  'not-found': 'Este presupuesto ya no está en el tablero. Tu edición se conserva.',
  invalid: 'No se pudo validar la respuesta del tablero. Tu presupuesto se conserva.',
  network: 'No se pudo conectar con el tablero. Tu presupuesto se conserva; reintentá cuando tengas conexión.',
  capacity: 'El presupuesto o el tablero supera el tamaño permitido. Tu edición se conserva.',
  'category-exists': 'Esa categoría ya existe. Seleccionala en la lista para guardar el presupuesto.',
  'category-missing': 'La categoría seleccionada ya no está disponible. Elegí otra categoría o Sin categoría.',
}

export class BoardClientError extends Error {
  readonly code: BoardClientErrorCode
  readonly mayHaveCommitted: boolean

  constructor(code: BoardClientErrorCode, mayHaveCommitted = false) {
    super(messages[code])
    this.name = 'BoardClientError'
    this.code = code
    this.mayHaveCommitted = mayHaveCommitted
  }
}

export interface BoardClient {
  listBoard(signal?: AbortSignal): Promise<BoardListResponse>
  getBoardEntry(entryId: string, signal?: AbortSignal): Promise<BoardDetailResponse>
  saveBoardEntry(command: BoardSaveCommand, signal?: AbortSignal): Promise<BoardSaveResponse>
}

function aborted(): DOMException {
  return new DOMException('La solicitud del tablero fue cancelada.', 'AbortError')
}

function statusError(status: number, detail: boolean, write: boolean): BoardClientError {
  if (status === 401 || status === 403) return new BoardClientError('access')
  if (status === 409 || status === 412) return new BoardClientError('conflict')
  if (status === 413) return new BoardClientError('capacity')
  if (status === 404) return new BoardClientError(detail ? 'not-found' : 'unavailable')
  if (status === 400 || status === 405 || status === 415 || status === 422) return new BoardClientError('invalid')
  return new BoardClientError('unavailable', write && (status < 400 || status >= 500))
}

function jsonContentType(response: Response): boolean {
  const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()
  return contentType === 'application/json' || /^application\/[a-z0-9.+-]+\+json$/.test(contentType ?? '')
}

async function responseJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const length = response.headers.get('content-length')
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > BOARD_MAX_BYTES)) {
    throw new BoardClientError('invalid')
  }
  if (!response.body) throw new BoardClientError('invalid')
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let text = ''
  let bytes = 0
  const cancel = () => { void reader.cancel().catch(() => undefined) }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    while (true) {
      if (signal.aborted) throw aborted()
      const chunk = await reader.read()
      if (signal.aborted) throw aborted()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > BOARD_MAX_BYTES) throw new BoardClientError('invalid')
      text += decoder.decode(chunk.value, { stream: true })
    }
    text += decoder.decode()
    return JSON.parse(text) as unknown
  } catch (error: unknown) {
    cancel()
    if (error instanceof BoardClientError || signal.aborted) throw error
    throw new BoardClientError('invalid')
  } finally {
    signal.removeEventListener('abort', cancel)
    reader.releaseLock()
  }
}

async function safeResponseError(response: Response, signal: AbortSignal, fallback: BoardClientError): Promise<BoardClientError> {
  if ((response.status !== 400 && response.status !== 409) || !jsonContentType(response)) return fallback
  try {
    const value = await responseJson(response, signal)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return fallback
    const code = (value as Record<string, unknown>).error
    if (code === 'limit' || code === 'too-large') return new BoardClientError('capacity')
    if (code === 'category-exists') return new BoardClientError('category-exists')
    if (code === 'category-missing') return new BoardClientError('category-missing')
  } catch (error: unknown) {
    if (signal.aborted) throw error
  }
  return fallback
}

export function createBoardClient(
  fetcher: typeof fetch = fetch, options: { timeoutMs?: number } = {},
): BoardClient {
  const timeoutMs = options.timeoutMs ?? 15000
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error('Invalid board request timeout.')

  async function request<T>(
    path: string, init: RequestInit, validate: (value: unknown) => T, detail: boolean, signal?: AbortSignal,
  ): Promise<T> {
    if (signal?.aborted) throw aborted()
    const write = init.method === 'POST'
    const controller = new AbortController()
    let timeout: ReturnType<typeof setTimeout> | undefined
    let timedOut = false
    let response: Response | undefined
    let rejectedResponse: BoardClientError | undefined
    let rejectInterrupted: (reason: Error) => void = () => undefined
    const interrupted = new Promise<never>((_resolve, reject) => { rejectInterrupted = reject })
    const onAbort = () => {
      controller.abort()
      rejectInterrupted(aborted())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
      rejectInterrupted(rejectedResponse ?? new BoardClientError('network', write))
    }, timeoutMs)
    async function perform(): Promise<T> {
      response = await fetcher(path, {
        ...init, credentials: 'same-origin', cache: 'no-store', redirect: 'manual', signal: controller.signal,
      })
      if (controller.signal.aborted) {
        void response.body?.cancel().catch(() => undefined)
        throw aborted()
      }
      if (response.redirected || response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
        throw new BoardClientError('access')
      }
      if (!response.ok) {
        rejectedResponse = statusError(response.status, detail, write)
        throw await safeResponseError(response, controller.signal, rejectedResponse)
      }
      const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()
      if (contentType === 'text/html') throw new BoardClientError('access')
      if (!jsonContentType(response)) {
        throw new BoardClientError('invalid')
      }
      const value = await responseJson(response, controller.signal)
      if (controller.signal.aborted) throw aborted()
      try { return validate(value) }
      catch { throw new BoardClientError('invalid') }
    }
    try {
      return await Promise.race([perform(), interrupted])
    } catch (error: unknown) {
      if (response?.body && !response.body.locked) void response.body.cancel().catch(() => undefined)
      if (signal?.aborted) throw aborted()
      if (timedOut) throw rejectedResponse ?? new BoardClientError('network', write)
      if (error instanceof BoardClientError) {
        if (write && response?.ok && error.code === 'invalid') throw new BoardClientError('invalid', true)
        throw error
      }
      throw new BoardClientError('network', write && rejectedResponse === undefined)
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', onAbort)
    }
  }

  return {
    listBoard(signal) {
      return request('/api/quotation-board', { method: 'GET', headers: { Accept: 'application/json' } }, readBoardListResponse, false, signal)
    },
    getBoardEntry(entryId, signal) {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(entryId)) return Promise.reject(new BoardClientError('invalid'))
      return request(`/api/quotation-board?${new URLSearchParams({ entryId })}`, {
        method: 'GET', headers: { Accept: 'application/json' },
      }, readBoardDetailResponse, true, signal).then((result) => {
        if (result.entry.id !== entryId) throw new BoardClientError('invalid')
        return result
      })
    },
    async saveBoardEntry(command, signal) {
      let submitted: BoardSaveCommand
      let body: string
      try {
        const copy = structuredClone(command)
        if (new TextEncoder().encode(JSON.stringify(copy)).byteLength > BOARD_REQUEST_MAX_BYTES) throw new BoardClientError('capacity')
        submitted = readBoardSaveCommand(copy)
        body = JSON.stringify(submitted)
        if (new TextEncoder().encode(body).byteLength > BOARD_REQUEST_MAX_BYTES) throw new BoardClientError('capacity')
      } catch (error: unknown) {
        if (error instanceof BoardClientError) throw error
        throw new BoardClientError('invalid')
      }
      const result = await request('/api/quotation-board', {
        method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body,
      }, readBoardSaveResponse, false, signal)
      const expectedRevision = submitted.mode === 'new' ? 1 : submitted.expectedRevision! + 1
      if (result.operationId !== submitted.operationId || result.epoch !== submitted.epoch
        || result.entry.id !== submitted.entryId || result.entry.revision !== expectedRevision
        || result.entry.name !== submitted.name
        || (submitted.newCategoryName === undefined ? result.entry.categoryId !== submitted.categoryId : result.entry.categoryId === null)
        || quotationBaseline(result.entry.quotation) !== quotationBaseline(submitted.quotation)) {
        throw new BoardClientError('invalid', true)
      }
      return result
    },
  }
}

const client = createBoardClient()
export const listBoard = client.listBoard
export const getBoardEntry = client.getBoardEntry
export const saveBoardEntry = client.saveBoardEntry
