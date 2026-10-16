import { parseCatalogImport } from '../src/features/quotation/catalog.ts'
import {
  SHARED_CATALOG_MAX_BYTES, validateSharedCatalogDocument,
} from '../src/features/quotation/shared-catalog.ts'

export interface CatalogServerConfig {
  url?: string
  token?: string
}

const UNAVAILABLE_MESSAGE = JSON.stringify({ error: 'No se pudo cargar el catálogo compartido.' })
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

async function readCatalog(response: Response): Promise<string> {
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
  try {
    while (true) {
      const chunk = await reader.read()
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
    reader.releaseLock()
  }
}

export async function serveCatalog(
  request: Request, config: CatalogServerConfig, fetcher: typeof fetch = fetch,
): Promise<Response> {
  if (request.method !== 'GET') return jsonResponse(UNAVAILABLE_MESSAGE, 405, { Allow: 'GET' })
  if (config.url === undefined && config.token === undefined) return jsonResponse(UNAVAILABLE_MESSAGE, 404)
  let url: URL
  try {
    if (!config.url || !config.token || !/^[a-z0-9\-._~+/]+=*$/i.test(config.token)) {
      return jsonResponse(UNAVAILABLE_MESSAGE, 503)
    }
    url = privateBlobUrl(config.url)
  } catch {
    return jsonResponse(UNAVAILABLE_MESSAGE, 503)
  }
  try {
    const upstream = await fetcher(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${config.token}`, Accept: 'application/json' },
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    })
    if (upstream.status !== 200 || upstream.redirected
      || upstream.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      await upstream.body?.cancel()
      return jsonResponse(UNAVAILABLE_MESSAGE, 502)
    }
    const document = parseCatalogImport(await readCatalog(upstream))
    validateSharedCatalogDocument(document)
    const body = JSON.stringify(document)
    if (new TextEncoder().encode(body).byteLength > SHARED_CATALOG_MAX_BYTES) {
      return jsonResponse(UNAVAILABLE_MESSAGE, 502)
    }
    return jsonResponse(body, 200)
  } catch {
    return jsonResponse(UNAVAILABLE_MESSAGE, 502)
  }
}

export default {
  fetch(request: Request): Promise<Response> {
    // Vercel Authentication must protect every deployment before these are set.
    return serveCatalog(request, {
      url: process.env.CATALOG_BLOB_URL,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    })
  },
}
