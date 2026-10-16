import {
  applyCatalogImport,
  buildCatalogImportPreview,
  parseCatalogImport,
  type CatalogImportDocument,
} from './catalog.ts'
import type { CatalogItem } from './model.ts'

export const SHARED_CATALOG_MAX_BYTES = 4 * 1024 * 1024

const LOAD_ERROR = 'No se pudo cargar el catálogo compartido. Podés seguir usando el catálogo guardado en este navegador.'

function validateKeys(document: CatalogImportDocument): void {
  const keys = new Set<string>()
  for (const item of document.items) {
    const supplier = item.supplier.trim().replace(/\s+/g, ' ').toLowerCase()
    const sku = item.sku.trim().replace(/\s+/g, ' ').toLowerCase()
    if (!supplier || !sku) {
      throw new Error('Cada producto del catálogo compartido necesita proveedor y código.')
    }
    const key = JSON.stringify([supplier, sku])
    if (keys.has(key)) {
      throw new Error('El catálogo compartido repite proveedor y código.')
    }
    keys.add(key)
  }
}

export function validateSharedCatalogDocument(document: CatalogImportDocument): void {
  validateKeys(parseCatalogImport(JSON.stringify(document)))
}

async function readCatalogResponse(response: Response, signal: AbortSignal): Promise<string> {
  const declaredLength = response.headers.get('content-length')
  if (declaredLength !== null && /^\d+$/.test(declaredLength)
    && Number(declaredLength) > SHARED_CATALOG_MAX_BYTES) throw new Error(LOAD_ERROR)
  if (!response.body) throw new Error(LOAD_ERROR)

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let byteLength = 0
  const cancel = () => { void reader.cancel().catch(() => undefined) }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    while (true) {
      signal.throwIfAborted()
      const { done, value } = await reader.read()
      signal.throwIfAborted()
      if (done) break
      byteLength += value.byteLength
      if (byteLength > SHARED_CATALOG_MAX_BYTES) {
        cancel()
        throw new Error(LOAD_ERROR)
      }
      chunks.push(value)
    }
  } finally {
    signal.removeEventListener('abort', cancel)
    reader.releaseLock()
  }

  const bytes = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

export async function loadSharedCatalog(
  signal: AbortSignal, fetcher: typeof fetch = fetch,
): Promise<CatalogImportDocument | null> {
  let response: Response | undefined
  try {
    signal.throwIfAborted()
    response = await fetcher('/api/catalog', {
      method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal,
    })
    signal.throwIfAborted()
    if (response.redirected) throw new Error(LOAD_ERROR)
    if (response.status === 404) return null
    if (!response.ok) throw new Error(LOAD_ERROR)
    const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()
    if (contentType !== 'application/json' && !/^application\/[a-z0-9.+-]+\+json$/.test(contentType ?? '')) {
      throw new Error(LOAD_ERROR)
    }
    const document = parseCatalogImport(await readCatalogResponse(response, signal))
    validateKeys(document)
    return document
  } catch {
    if (response?.body && !response.body.locked) void response.body.cancel().catch(() => undefined)
    if (signal.aborted) throw new DOMException('La carga del catálogo fue cancelada.', 'AbortError')
    throw new Error(LOAD_ERROR)
  }
}

export function mergeSharedCatalog(existing: CatalogItem[], document: CatalogImportDocument): CatalogItem[] {
  validateSharedCatalogDocument(document)
  const preview = buildCatalogImportPreview(existing, document)
  if (preview.conflicts.length > 0) {
    throw new Error('Hay productos en conflicto. El catálogo guardado no se modificó.')
  }
  const merged = applyCatalogImport(existing, preview, { allowUpdates: true })
  return preview.additions.length === 0 && preview.updates.length === 0 ? existing : merged
}
