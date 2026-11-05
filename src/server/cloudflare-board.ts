import { readBoardSaveCommand } from '../features/quotation-board/board-contract.ts'
import type { BoardSaveCommand } from '../features/quotation-board/shared-board-types.ts'
import { createD1BoardRepository, D1_BOARD_ENTRY_MAX_BYTES, D1BoardError, type D1BoardDatabase } from './cloudflare-board-store.ts'

export const D1_BOARD_REQUEST_MAX_BYTES = D1_BOARD_ENTRY_MAX_BYTES + 4096

class RequestError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string) {
    super('Invalid shared board request.')
    this.status = status
    this.code = code
  }
}

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status, headers: {
      'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff', ...(status === 405 ? { Allow: 'GET, POST' } : {}),
    },
  })
}

async function readCommand(request: Request): Promise<BoardSaveCommand> {
  if (!/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?$/i.test(request.headers.get('content-type') ?? '')) throw new RequestError(415, 'media-type')
  const length = request.headers.get('content-length')
  if (length !== null && !/^\d+$/.test(length)) throw new RequestError(400, 'invalid')
  if (length !== null && Number(length) > D1_BOARD_REQUEST_MAX_BYTES) throw new RequestError(413, 'capacity')
  if (!request.body) throw new RequestError(400, 'invalid')
  const reader = request.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10000)])
  let byteCount = 0
  let text = ''
  let onAbort: (() => void) | undefined
  const interrupted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new RequestError(408, 'timeout'))
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    while (true) {
      const chunk = await Promise.race([reader.read(), interrupted])
      if (chunk.done) break
      byteCount += chunk.value.byteLength
      if (byteCount > D1_BOARD_REQUEST_MAX_BYTES) throw new RequestError(413, 'capacity')
      text += decoder.decode(chunk.value, { stream: true })
    }
    text += decoder.decode()
    if (length !== null && byteCount !== Number(length)) throw new RequestError(400, 'invalid')
    return readBoardSaveCommand(JSON.parse(text) as unknown)
  } catch (error) {
    void reader.cancel().catch(() => undefined)
    if (error instanceof RequestError) throw error
    throw new RequestError(400, 'invalid')
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort)
    reader.releaseLock()
  }
}

const messages: Record<D1BoardError['code'], string> = {
  conflict: 'El presupuesto o el tablero cambió. Conservá tu edición y revisá la versión actual.',
  storage: 'No se pudo acceder al tablero compartido. Conservá tu edición y volvé a intentar.',
  capacity: 'El presupuesto supera 256 KiB o el tablero alcanzó sus límites. Conservá tu edición.',
  'category-exists': 'Ya existe una categoría con ese nombre. Seleccionala para guardar el presupuesto.',
  'category-missing': 'La categoría seleccionada ya no está disponible. Elegí otra categoría.',
  'not-found': 'Este presupuesto ya no está disponible en el tablero.',
}

/** Internal handler: the Worker router must verify the signed browser session before calling it. */
export async function serveCloudflareQuotationBoard(
  request: Request, database: D1BoardDatabase, config: { accessReviewed: boolean },
  dependencies: { now?: () => Date; createId?: () => string } = {},
): Promise<Response> {
  if (config.accessReviewed !== true) return response({ error: 'disabled' }, 404)
  if (request.method !== 'GET' && request.method !== 'POST') return response({ error: 'method' }, 405)
  try {
    const url = new URL(request.url)
    const keys = [...url.searchParams.keys()]
    if (keys.some((key) => key !== 'entryId') || url.searchParams.getAll('entryId').length > 1
      || (request.method === 'POST' && keys.length > 0)) throw new RequestError(400, 'parameters')
    const entryId = url.searchParams.get('entryId')
    if (entryId !== null && !/^[A-Za-z0-9_-]{1,128}$/.test(entryId)) throw new RequestError(400, 'parameters')
    if (request.method === 'POST') {
      const site = request.headers.get('sec-fetch-site')
      if (request.headers.get('origin') !== url.origin || (site !== null && site !== 'same-origin' && site !== 'none')) throw new RequestError(403, 'origin')
    }
    const repository = createD1BoardRepository(database)
    if (request.method === 'GET') return response(entryId === null ? await repository.list() : await repository.detail(entryId))
    return response(await repository.save(await readCommand(request), (dependencies.now ?? (() => new Date()))(), dependencies.createId))
  } catch (error) {
    if (error instanceof RequestError) return response({ error: error.code, message: error.status === 413 ? messages.capacity : 'La solicitud del tablero no es válida. Tu presupuesto se conserva.' }, error.status)
    if (error instanceof D1BoardError) {
      const status = error.code === 'capacity' ? 413 : error.code === 'conflict' || error.code === 'category-missing' ? 409
        : error.code === 'category-exists' ? 400 : error.code === 'not-found' ? 404 : 503
      return response({ error: error.code, message: messages[error.code] }, status)
    }
    return response({ error: 'storage', message: messages.storage }, 503)
  }
}
