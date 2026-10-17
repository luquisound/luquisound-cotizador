# DolarAPI blue sale rate

## Behavior

The open quotation requests `GET /api/exchange-rate` automatically. The server reads
only `venta` for `moneda: USD` and `casa: blue` from the fixed HTTPS endpoint
`https://dolarapi.com/v1/dolares/blue`. It never substitutes purchase, average,
official, or another provider's value. There are no client-provided source URLs,
API keys, or additional environment variables.

The value is stored as ARS per USD with the existing exact conversion rules.
`exchangeRateQuote` records the rate, DolarAPI source, blue market, sale side,
source update timestamp, and fetch timestamp. The source date is displayed in
America/Argentina/Buenos_Aires in the editor, preview, and exported PNG.

The selected quotation refreshes when its saved reference was fetched at least
one hour ago, or when it has no automatic reference. This includes saved
quotations, imported backups, and duplicates. A fresh saved reference is reused
until its fetch-hour boundary. There is no manual update or retry button.
Only the selected quotation changes; inactive snapshots stay stored until opened.
No update changes row prices, currencies, or quantities.
An in-flight response applies to the latest quotation state and cannot replace
another draft or overwrite local edits. Header edits preserve an updated rate.
Automatic updates can change the equivalent total and invalidate a prepared
image. Previously downloaded PNG files remain unchanged.

While the app is visible and online, schedule the next check at the saved
reference's fetch-hour boundary. Pause polling while hidden or offline; focus,
visibility, and reconnection events resume a due check. Closing the app does not
schedule server work. Requests are bounded and deduplicated within the active
quotation. Failures keep the saved rate and schedule an automatic retry after
one hour, when the app is active. Source timestamps may legitimately remain
unchanged even after a successful fetch.

Automatically attaching a rate alone does not save an otherwise blank proposal.
Legacy backups remain compatible. Manual rates remain labelled as manual without
an invented source/date until a successful automatic lookup replaces them. The
editor obtains replacement rates through DolarAPI rather than manual overrides.

## Validation and availability

The server validates positive finite sale values with at most six decimal places,
fixed market/currency, bounded JSON, valid dates, a maximum seven-day source age,
and no more than five minutes of future clock skew. Historical snapshots are
validated structurally, without applying network freshness rules to saved drafts.
Stored metadata must match the quotation rate.

Requests have bounded response sizes and timeouts and do not follow redirects.
Failures preserve the current quotation. Without a valid rate, a draft remains
editable and image preparation remains unavailable until an update succeeds.
Source timestamps older than 24 hours show a reminder to review the date; weekends
can legitimately retain an earlier reference. The app does not claim live trading
prices or guaranteed availability.

## Shared cache

`@vercel/functions` supplies Vercel Runtime Cache without provisioning a separate
database. A project-specific namespace and a one-hour TTL reduce upstream
requests across devices. The server refreshes on the next request after expiration;
there is no background hourly job. The browser reads this shared reference and
cannot bypass its TTL. Cached entries from the previous three-hour policy are
also checked against the new one-hour age limit. Responses to browsers and CDNs
use `private, no-store`.

Runtime Cache is regional and ephemeral. Concurrent requests in one instance are
coalesced; eviction, cold misses, and different regions can still produce additional
upstream requests. This is a cache policy, not a globally atomic rate limiter.
Cache failures fail closed instead of falling back to repeated uncached requests.
The existing Vercel Authentication deployment protection remains in place.

Local Vite development and preview only serve the frontend. Full local checks use
a temporary harness with the real handler, a fake cache, and synthetic rate data.
No private catalogue or production credentials are needed for those checks.

## References

- [DolarAPI blue endpoint and original DolarHoy source](https://dolarapi.com/docs/argentina/operations/get-dolar-blue)
- [DolarAPI usage and attribution](https://dolarapi.com/docs/uso)
- [DolarAPI informational service limitations](https://dolarapi.com/docs/legal)
- [Vercel Runtime Cache](https://vercel.com/docs/caching/runtime-cache)

DolarAPI recommends retaining a copy and querying a series every three hours.
The approved product requirement uses one hour with the shared cache; this is
an application policy, not a claim about the provider's source update frequency.
Displayed/exported rates cite DolarAPI as required by its data-use terms.
