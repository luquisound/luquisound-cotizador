import type { ExchangeRateCache } from './exchange-rate-handler.ts'
import type { D1BoardDatabase } from './cloudflare-board-store.ts'

/** A single replaceable public-rate record shares the board's free D1 binding. */
export function createCloudflareExchangeCache(database: D1BoardDatabase): ExchangeRateCache {
  return {
    async get(key) {
      if (key !== 'blue-venta') throw new Error('Invalid exchange cache key.')
      const result = await database.prepare('SELECT quote_json FROM exchange_rate_cache WHERE id = 1')
        .all<{ quote_json: string }>()
      if (!result.success || result.results.length > 1) throw new Error('Exchange cache read failed.')
      const row = result.results[0] ?? null
      return row === null ? null : JSON.parse(row.quote_json) as unknown
    },
    async set(key, value) {
      if (key !== 'blue-venta') throw new Error('Invalid exchange cache key.')
      const result = await database.prepare(
        'INSERT INTO exchange_rate_cache (id, quote_json) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET quote_json = excluded.quote_json',
      ).bind(JSON.stringify(value)).all()
      if (!result.success) throw new Error('Exchange cache write failed.')
    },
  }
}
