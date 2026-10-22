import type { CatalogImportDocument } from './catalog.ts'
import { loadSharedCatalog } from './shared-catalog.ts'

export type CatalogRefreshStatus = 'loading' | 'ready' | 'unavailable' | 'error'

interface CatalogRefreshOptions {
  isActive: () => boolean
  onCatalog: (document: CatalogImportDocument) => boolean
  onStatus: (status: CatalogRefreshStatus) => void
  loadCatalog?: (signal: AbortSignal) => Promise<CatalogImportDocument | null>
}

const DAY_MS = 24 * 60 * 60 * 1000
const REQUEST_TIMEOUT_MS = 15000
const localDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Argentina/Buenos_Aires',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})

function localTimestamp(now: number): number {
  const parts = localDate.formatToParts(now)
  const part = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((value) => value.type === type)?.value)
  return Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'))
}

function scheduledTime(localDay: number): number {
  const target = localDay + 9 * 60 * 60 * 1000
  let scheduled = target
  // Resolve the named time zone without relying on the device's zone or offset.
  for (let attempt = 0; attempt < 2; attempt++) scheduled += target - localTimestamp(scheduled)
  return scheduled
}

export function getCatalogRefreshCycle(now: number): { startedAt: number; nextAt: number } {
  const timestamp = localTimestamp(now)
  const day = Math.floor(timestamp / DAY_MS) * DAY_MS
  const today = scheduledTime(day)
  return now < today
    ? { startedAt: scheduledTime(day - DAY_MS), nextAt: today }
    : { startedAt: today, nextAt: scheduledTime(day + DAY_MS) }
}

export function startCatalogRefresh(options: CatalogRefreshOptions): { check: () => void; stop: () => void } {
  const { isActive, onCatalog, onStatus, loadCatalog = loadSharedCatalog } = options
  let attemptedCycle: number | undefined
  let stopped = false
  let controller: AbortController | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let requestTimeout: ReturnType<typeof setTimeout> | undefined

  function check() {
    clearTimeout(timer)
    if (stopped || controller || !isActive()) return
    const now = Date.now()
    const cycle = getCatalogRefreshCycle(now)
    if (attemptedCycle !== undefined && cycle.startedAt <= attemptedCycle) {
      timer = setTimeout(check, cycle.nextAt - now)
      return
    }
    // A failed attempt consumes this cycle too; focus must not become a retry loop.
    attemptedCycle = cycle.startedAt
    void refresh()
  }

  async function refresh() {
    const request = new AbortController()
    controller = request
    onStatus('loading')
    try {
      const timedOut = new Promise<never>((_, reject) => {
        requestTimeout = setTimeout(() => {
          request.abort()
          reject(new Error('Catalogue request timed out.'))
        }, REQUEST_TIMEOUT_MS)
      })
      const document = await Promise.race([loadCatalog(request.signal), timedOut])
      if (stopped || request.signal.aborted) return
      if (document === null) onStatus('unavailable')
      else onStatus(onCatalog(document) ? 'ready' : 'error')
    } catch {
      if (!stopped) onStatus('error')
    } finally {
      clearTimeout(requestTimeout)
      controller = null
      if (!stopped) check()
    }
  }

  check()
  return {
    check,
    stop() {
      stopped = true
      clearTimeout(timer)
      clearTimeout(requestTimeout)
      controller?.abort()
    },
  }
}
