import { EXCHANGE_QUOTE_CACHE_TTL_MS, loadBlueDollarQuote, type BlueDollarQuote } from './exchange-quote.ts'

export interface ExchangeRefreshState {
  loading: boolean
  error: string | null
}

interface ExchangeRefreshOptions {
  initialQuote?: BlueDollarQuote
  isActive: () => boolean
  onQuote: (quote: BlueDollarQuote) => boolean
  onState: (state: ExchangeRefreshState) => void
  loadQuote?: (signal: AbortSignal) => Promise<BlueDollarQuote>
}

const REQUEST_TIMEOUT_MS = 12000
const LOAD_ERROR = 'No se pudo consultar el dólar. Se conserva la última cotización y se reintentará automáticamente.'

function refreshAt(quote: BlueDollarQuote | undefined, now: number): number {
  const fetchedAt = quote ? Date.parse(quote.fetchedAt) : NaN
  return Number.isFinite(fetchedAt) && fetchedAt <= now ? fetchedAt + EXCHANGE_QUOTE_CACHE_TTL_MS : now
}

export function startExchangeRateRefresh(options: ExchangeRefreshOptions): { check: () => void; stop: () => void } {
  const { isActive, onQuote, onState, loadQuote = loadBlueDollarQuote } = options
  let nextCheckAt = refreshAt(options.initialQuote, Date.now())
  let stopped = false
  let controller: AbortController | null = null
  let timer: ReturnType<typeof setTimeout> | undefined

  function check() {
    clearTimeout(timer)
    if (stopped || controller || !isActive()) return
    const delay = nextCheckAt - Date.now()
    if (delay > 0) {
      timer = setTimeout(check, delay)
      return
    }
    void refresh()
  }

  async function refresh() {
    const request = new AbortController()
    controller = request
    onState({ loading: true, error: null })
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      const timedOut = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          request.abort()
          reject(new Error(LOAD_ERROR))
        }, REQUEST_TIMEOUT_MS)
      })
      const quote = await Promise.race([loadQuote(request.signal), timedOut])
      if (stopped || request.signal.aborted) return
      if (!onQuote(quote)) throw new Error('Unable to apply the exchange rate.')
      // A stale or malformed fetch timestamp must not create an immediate request loop.
      nextCheckAt = Math.max(Date.now() + 60000, refreshAt(quote, Date.now()))
      onState({ loading: false, error: null })
    } catch {
      if (stopped) return
      nextCheckAt = Date.now() + EXCHANGE_QUOTE_CACHE_TTL_MS
      onState({ loading: false, error: LOAD_ERROR })
    } finally {
      clearTimeout(timeout)
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
      controller?.abort()
    },
  }
}
