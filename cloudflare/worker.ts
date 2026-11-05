import { serveCatalog } from '../api/catalog.ts'
import { createPinAuth } from '../src/server/pin-auth.ts'
import { renderPinLoginPage } from '../src/server/pin-login-page.ts'
import { serveCloudflareQuotationBoard } from '../src/server/cloudflare-board.ts'
import type { D1BoardDatabase } from '../src/server/cloudflare-board-store.ts'
import { createCloudflareExchangeCache } from '../src/server/cloudflare-exchange-cache.ts'
import { createExchangeRateHandler } from '../src/server/exchange-rate-handler.ts'

export interface CloudflareWorkerEnv {
  ASSETS: { fetch(request: Request): Promise<Response> }
  QUOTATION_BOARD_DB?: D1BoardDatabase
  QUOTATION_BOARD_MODE?: string
  QUOTATION_BOARD_ACCESS_REVIEWED?: string
  COTIZADOR_PIN_AUTH_SECRET?: string
  CATALOG_BLOB_URL?: string
  BLOB_READ_WRITE_TOKEN?: string
  INSTALER_CATALOG_MODE?: string
}

interface WorkerDependencies {
  now?: () => number
  fetcher?: typeof fetch
}

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status, headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}

function privateResponse(response: Response): Response {
  const result = new Response(response.body, response)
  result.headers.set('Cache-Control', 'private, no-store')
  result.headers.set('CDN-Cache-Control', 'no-store')
  result.headers.set('X-Content-Type-Options', 'nosniff')
  return result
}

function redirectTo(path: string, cookie?: string): Response {
  return new Response(null, { status: 303, headers: { Location: path, ...(cookie ? { 'Set-Cookie': cookie } : {}) } })
}

function sameOriginPost(request: Request, url: URL): boolean {
  const site = request.headers.get('sec-fetch-site')
  return request.headers.get('origin') === url.origin && (site === null || site === 'same-origin' || site === 'none')
}

async function loginCredential(request: Request): Promise<unknown> {
  if (!/^application\/x-www-form-urlencoded(?:\s*;\s*charset\s*=\s*utf-8)?$/i.test(request.headers.get('content-type') ?? '')) {
    return null
  }
  const length = request.headers.get('content-length')
  if ((length !== null && (!/^\d+$/.test(length) || Number(length) > 1024)) || !request.body) return null
  const reader = request.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let bytes = 0
  let text = ''
  let timeout: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error('Login body timeout.')), 5000)
  })
  try {
    while (true) {
      const chunk = await Promise.race([reader.read(), deadline])
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > 1024) return null
      text += decoder.decode(chunk.value, { stream: true })
    }
    text += decoder.decode()
    if (length !== null && bytes !== Number(length)) return null
    const form = new URLSearchParams(text)
    return [...form.keys()].some((key) => key !== 'credential') || form.getAll('credential').length !== 1 ? null : form.get('credential')
  } catch { return null }
  finally {
    clearTimeout(timeout)
    void reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

export function createCloudflareWorker(dependencies: WorkerDependencies = {}) {
  const contexts = new WeakMap<CloudflareWorkerEnv, {
    auth: ReturnType<typeof createPinAuth>
    exchange?: (request: Request) => Promise<Response>
  }>()

  return {
    async fetch(request: Request, env: CloudflareWorkerEnv): Promise<Response> {
      try {
        let context = contexts.get(env)
        if (!context) {
          context = {
            auth: createPinAuth({ secret: env.COTIZADOR_PIN_AUTH_SECRET, database: env.QUOTATION_BOARD_DB, now: dependencies.now }),
            exchange: env.QUOTATION_BOARD_DB === undefined ? undefined : createExchangeRateHandler({
              cache: createCloudflareExchangeCache(env.QUOTATION_BOARD_DB), fetcher: dependencies.fetcher,
            }),
          }
          contexts.set(env, context)
        }
        const url = new URL(request.url)
        if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
          return privateResponse(jsonError(403, 'https-required'))
        }
        if (url.pathname === '/logout') {
          if (request.method !== 'POST') return privateResponse(jsonError(405, 'method'))
          if (!sameOriginPost(request, url)) return privateResponse(jsonError(403, 'origin'))
          return privateResponse(redirectTo('/login', context.auth.logoutCookie()))
        }
        if (url.pathname === '/login' && request.method === 'POST') {
          if (!sameOriginPost(request, url)) return privateResponse(jsonError(403, 'origin'))
          const result = await context.auth.login(await loginCredential(request), request.headers.get('cf-connecting-ip') ?? '')
          if (result.ok) return privateResponse(redirectTo('/', result.cookie))
          const page = renderPinLoginPage(result.status === 401 ? 'invalid' : result.status === 429 ? 'rate-limit' : 'unavailable', result.status,
            result.status === 503 ? undefined : context.auth.loginParameters())
          if (result.retryAfter !== undefined) page.headers.set('Retry-After', String(result.retryAfter))
          return privateResponse(page)
        }
        // Authenticate assets and data APIs before any private data or upstream call.
        const identity = await context.auth.verifySession(request)
        if (url.pathname === '/login') {
          if (request.method !== 'GET' && request.method !== 'HEAD') return privateResponse(jsonError(405, 'method'))
          if (identity.ok) return privateResponse(redirectTo('/'))
          return privateResponse(identity.status === 503 ? renderPinLoginPage('unavailable') : renderPinLoginPage(undefined, undefined, context.auth.loginParameters()))
        }
        if (!identity.ok) {
          const document = !url.pathname.startsWith('/api/') && request.method === 'GET'
            && (url.pathname === '/' || request.headers.get('accept')?.includes('text/html'))
          return privateResponse(identity.status === 401 && document ? redirectTo('/login') : jsonError(identity.status, 'access'))
        }
        let response: Response
        if (url.pathname === '/api/quotation-board') {
          response = env.QUOTATION_BOARD_MODE !== 'shared' || env.QUOTATION_BOARD_DB === undefined
            ? jsonError(404, 'disabled')
            : await serveCloudflareQuotationBoard(request, env.QUOTATION_BOARD_DB, {
              accessReviewed: env.QUOTATION_BOARD_ACCESS_REVIEWED === 'true',
            })
        } else if (url.pathname === '/api/exchange-rate') {
          response = context.exchange ? await context.exchange(request) : jsonError(503, 'storage')
        } else if (url.pathname === '/api/catalog') {
          response = await serveCatalog(request, {
            url: env.CATALOG_BLOB_URL, token: env.BLOB_READ_WRITE_TOKEN,
            recoverLastValid: env.INSTALER_CATALOG_MODE === 'publish',
          }, dependencies.fetcher)
        } else if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
          response = jsonError(404, 'not-found')
        } else if (request.method !== 'GET' && request.method !== 'HEAD') {
          response = jsonError(405, 'method')
          response.headers.set('Allow', 'GET, HEAD')
        } else {
          response = await env.ASSETS.fetch(request)
        }
        return privateResponse(response)
      } catch {
        return privateResponse(jsonError(503, 'unavailable'))
      }
    },
  }
}

export default createCloudflareWorker()
