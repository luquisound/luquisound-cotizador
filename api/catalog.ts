import { parseCatalogImport } from '../src/features/quotation/catalog.ts'
import { getCatalogAvailabilityPolicy } from '../src/features/quotation/catalog-stock.ts'
import {
  SHARED_CATALOG_MAX_BYTES, validateSharedCatalogDocument,
} from '../src/features/quotation/shared-catalog.ts'
import { INSTALER_CATALOG_LAST_VALID_PATH } from '../src/server/instaler-catalog-store.ts'

export interface CatalogServerConfig {
  url?: string
  token?: string
  recoverLastValid?: boolean
}

const UNAVAILABLE_MESSAGE = JSON.stringify({ error: 'No se pudo cargar el catálogo compartido.' })
const RECOVERY_SELECTION_BLOCK = 'El catálogo fue recuperado. Confirmá una actualización válida antes de seleccionar este producto.'
const PRIVATE_BLOB_HOST = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.private\.blob\.vercel-storage\.com$/i

function jsonResponse(body: string, status: number, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'CDN-Cache-Control': 'no-store',
      'Vercel-CDN-Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    },
  })
}

function privateBlobUrl(value: string): URL {
  const authority = /^https:\/\/([^/?#]+)\//i.exec(value)?.[1]
  const url = new URL(value)
  if (
    value !== value.trim() || !authority || !PRIVATE_BLOB_HOST.test(authority)
    || url.protocol !== 'https:' || url.username || url.password || url.port
    || !PRIVATE_BLOB_HOST.test(url.hostname) || value.includes('#') || value.includes('?')
    || !/\/[^/]+\.json$/i.test(url.pathname)
  ) throw new Error('Invalid catalogue configuration.')
  url.searchParams.set('cache', '0')
  return url
}

async function readCatalog(response: Response, signal: AbortSignal): Promise<string> {
  const declaredLength = response.headers.get('content-length')
  if (declaredLength !== null && Number(declaredLength) > SHARED_CATALOG_MAX_BYTES) {
    await response.body?.cancel()
    throw new Error('Catalogue limit exceeded.')
  }
  if (!response.body) throw new Error('Missing catalogue body.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let size = 0
  let value = ''
  let onAbort: (() => void) | undefined
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new Error('Catalogue read timed out.'))
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    while (true) {
      const chunk = await Promise.race([reader.read(), aborted])
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > SHARED_CATALOG_MAX_BYTES) throw new Error('Catalogue limit exceeded.')
      value += decoder.decode(chunk.value, { stream: true })
    }
    return value + decoder.decode()
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    throw error
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort)
    reader.releaseLock()
  }
}

async function fetchCatalog(url: URL, token: string, fetcher: typeof fetch, recovery = false): Promise<string> {
  const signal = AbortSignal.timeout(10000)
  const upstream = await fetcher(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    redirect: 'error', cache: 'no-store', signal,
  })
  if (upstream.status !== 200 || upstream.redirected
    || upstream.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    await upstream.body?.cancel()
    throw new Error('Catalogue unavailable.')
  }
  const document = parseCatalogImport(await readCatalog(upstream, signal))
  signal.throwIfAborted()
  validateSharedCatalogDocument(document)
  if (recovery) {
    // A previous positive observation cannot restore availability after a newer block.
    document.items = document.items.map((item) => getCatalogAvailabilityPolicy(item) === undefined
      ? item : { ...item, selectionBlock: RECOVERY_SELECTION_BLOCK })
  }
  const body = JSON.stringify(document)
  if (new TextEncoder().encode(body).byteLength > SHARED_CATALOG_MAX_BYTES) {
    throw new Error('Catalogue limit exceeded.')
  }
  return body
}

export async function serveCatalog(
  request: Request, config: CatalogServerConfig, fetcher: typeof fetch = fetch,
): Promise<Response> {
  if (request.method !== 'GET') return jsonResponse(UNAVAILABLE_MESSAGE, 405, { Allow: 'GET' })
  if (config.url === undefined && config.token === undefined) return jsonResponse(UNAVAILABLE_MESSAGE, 404)
  let url: URL
  let backupUrl: URL | undefined
  try {
    if (!config.url || !config.token || !/^[a-z0-9\-._~+/]+=*$/i.test(config.token)) {
      return jsonResponse(UNAVAILABLE_MESSAGE, 503)
    }
    url = privateBlobUrl(config.url)
    if (config.recoverLastValid === true) {
      if (decodeURIComponent(url.pathname).replace(/^\/+/, '') === INSTALER_CATALOG_LAST_VALID_PATH) {
        return jsonResponse(UNAVAILABLE_MESSAGE, 503)
      }
      backupUrl = privateBlobUrl(`${url.origin}/${INSTALER_CATALOG_LAST_VALID_PATH}`)
    }
  } catch {
    return jsonResponse(UNAVAILABLE_MESSAGE, 503)
  }
  try {
    return jsonResponse(await fetchCatalog(url, config.token, fetcher), 200)
  } catch {
    if (backupUrl) {
      try {
        return jsonResponse(await fetchCatalog(backupUrl, config.token, fetcher, true), 200, {
          'X-Luquisound-Catalog-Recovery': 'last-valid',
        })
      }
      catch { /* A failed recovery leaves the browser's existing catalogue available. */ }
    }
    return jsonResponse(UNAVAILABLE_MESSAGE, 502)
  }
}

export default {
  fetch(request: Request): Promise<Response> {
    // Vercel Authentication must protect every deployment before these are set.
    return serveCatalog(request, {
      url: process.env.CATALOG_BLOB_URL,
      token: process.env.BLOB_READ_WRITE_TOKEN,
      recoverLastValid: process.env.INSTALER_CATALOG_MODE === 'publish',
    })
  },
}
