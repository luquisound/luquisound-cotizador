import { useEffect, useState } from 'react'
import { getAvailabilityRefreshDelay } from './quotation-availability.ts'
import type { CatalogItem, QuotationRow } from './model.ts'

const emptyRows: readonly QuotationRow[] = []
export function useCatalogClock(catalog: readonly CatalogItem[], rows: readonly QuotationRow[] = emptyRows): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    let timer: ReturnType<typeof window.setTimeout> | undefined
    const refresh = (): void => {
      const current = Date.now()
      setNow(current)
      if (timer !== undefined) window.clearTimeout(timer)
      timer = window.setTimeout(refresh, getAvailabilityRefreshDelay(catalog, rows, current))
    }
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') refresh()
    }
    refresh()
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      if (timer !== undefined) window.clearTimeout(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [catalog, rows])
  return now
}
