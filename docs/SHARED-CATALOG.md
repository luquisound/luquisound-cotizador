# Private common catalogue

## Behavior

The app requests `GET /api/catalog` from the same origin on startup and once per
daily cycle at 09:00 Buenos Aires while visible and online. Return, focus and
reconnection check that daily cycle; there is no refresh/retry button. Every new
device receives the configured common product catalogue without a file picker.
The endpoint is read-only. The app does not upload quotations or manual price
edits, and those edits are not synchronized between devices.
The personal catalogue manager and manual file import/backup controls are not
mounted. Product selection stays in the row editor and reviewed bulk entry;
existing local products, approved prices and cache remain available.

Common records need a complete, unique supplier and SKU key. Merging is atomic:
local identities, approved prices (including zero), currencies, personal entries,
and current quotation row values are preserved. Common metadata, reviewed list
prices, stock observations, selection policies and historical references can be
updated. By default, entries absent from the common file remain
in the local catalogue. Conflicts or limits retain the previous local catalogue
until the next daily cycle. Missing configuration retains local selection and
independent manual quotation entry, without a manual file import UI.

A reviewed private JSON can opt into `replaceSourceDocuments`, using the same
[explicit source replacement contract](CATALOG-IMPORT.md#explicit-source-replacement)
as the compatible import helpers. Only entries with primary source documents
exactly listed in that manifest can be removed, and only when their supplier/SKU
key is absent from the incoming items. Retained in-scope products replace old metadata and historical
references while keeping local IDs, approved prices and currencies. Source-less
manual entries and unrelated primary sources are outside the removal scope.
Incomplete or ambiguous scoped keys block the entire replacement. Empty items
retire entries only with an explicit valid source scope; an ordinary empty file
changes nothing. Removal-only updates are saved normally.

Local copies and approved prices use `luquisound.catalog.v1`, independently of
the single current quotation's recovery snapshot. Compatible catalogue JSON
backup helpers retain IDs, approved prices and provenance; an old workspace
backup parser extracts only its catalogue and never restores quotations.
These formats have no import/export controls in the current UI.
The legacy `luquisound.workspace.v1` storage key remains untouched.
An explicit `refreshSuppliers` scope replaces source-owned stock, reviewed list
price, policy and block fields, including omitted values, without deleting absent
entries or touching manual amounts. The Instaler publisher supplies blocked
records for absent products and private reviewed correspondences. Its reading
metadata expires protected stock after seven days without a successful reading;
it never asserts supplier freshness. See
[publication and recovery](INSTALER-CATALOG-PUBLICATION.md).
Startup fetch failures allow continued work with that copy. Loading the common
catalogue never approves an ordinary historical reference. A reviewed source can
explicitly provide a retail list price before supplier discount with provenance
and a provisional flag. A local manual price takes precedence. The source's
commercial date stays unknown when not stated; fetching or importing never
invents it. No automatic 20% deduction or cost-derived sale price is applied.

## Private source and configuration

The endpoint can carry validated stock, reviewed list prices, availability policy,
explicit selection blocks, and source kind/version/checksum in the existing
private JSON schema. Protected product selection is active: positive eligible
stock and a valid price are required. Historical-positive policy remains
provisional, while fresh-positive requires an unexpired current observation.
Zero, negative, unknown, stale or future stock and explicit blocks prevent
selection. The product picker can show excluded entries for review, and
independent manual concepts remain available. A common update can block image
delivery for an existing row without changing that row's saved amount, currency or private
original source trace. Stock quantities and source details never appear in
customer images; provisional usage adds only an availability warning.

No spreadsheet connector, source credentials, polling job or live-stock guarantee
is enabled by those fields alone. The Instaler integration uses the existing
private Apps Script upload and a separately enabled conditional publisher to
produce this reviewed catalogue. Other supplier integrations remain outside the
current scope. See [publication and recovery](INSTALER-CATALOG-PUBLICATION.md)
and the [source integration map](CATALOG-SOURCE-ROADMAP.md).

Store the reviewed import JSON in a **private** Vercel Blob store. Never add it to
the checkout, `public/`, the Vite bundle, fixtures, or build artifacts. The existing
personal-import schema is reused; the shared transport is limited to 4 MiB to
stay below Vercel's 4.5 MB function response limit.

Configure these variables for the server only, without a `VITE_` prefix:

| Variable | Purpose |
| --- | --- |
| `CATALOG_BLOB_URL` | Fixed HTTPS URL of the private JSON blob. |
| `BLOB_READ_WRITE_TOKEN` | Server credential for the private store. |

An entirely unconfigured source returns 404. Partial or invalid configuration
returns a generic error. The server does not accept a client-provided source,
follow upstream redirects, expose credentials, or log catalogue contents.
Responses disable browser and CDN caching. The server uses a consistent private
Blob read so a newly published source is available on the next app startup.

## Access boundary

Vercel Authentication must protect **All Deployments**, including production
aliases, generated URLs, and previews. `Standard Protection` is insufficient for
private catalogue data because it can leave production domains public.

This is a platform access boundary, not application-owned authentication. The
handler cannot infer an authenticated visitor from a cookie name or an arbitrary
header. Disabling Vercel protection would expose an enabled endpoint. Disable its
source configuration before removing protection. Do not create a public exception
for `/api/catalog`, add CORS wildcard access, or publish a direct readable blob.

Keep production Blob credentials out of unreviewed preview branches. Review any
existing bypass configuration and ensure intended users can authenticate from
their devices without granting public access.

## Activation and acceptance

Activation changes external storage, credentials, and the production deployment.
It requires explicit authorization after the code and local checks are reviewed.

1. Confirm the intended Vercel team and project. Inspect authentication scope and
   public exceptions. Check anonymous requests against the canonical URL,
   generated deployment URL, and `/api/catalog` before enabling credentials.
2. Create a private Blob store and connect only the authorized environments.
   Upload the reviewed private JSON with `access: private` and content type
   `application/json`, keeping the repository
   untouched. Preserve the original file and record the uploaded source checksum
   privately. Do not overwrite a previous source without reviewing the change.
3. Configure the two server variables above. Never paste a token into a terminal
   command argument, source, client environment, logs, or a public issue.
4. Publish the reviewed implementation, then verify anonymous API requests remain
   blocked and an authorized session receives the valid catalogue.
5. Open two fresh authorized browser profiles. Both must receive the catalogue
   without importing a file. Confirm reload, manual-price preservation,
   existing catalogue cache and product preservation, reviewed list/manual-price
   precedence, stock-only updates, blocked-product handling, private row trace
   and continued local use when the source is temporarily unavailable.
6. Verify the intended access and automatic load on Android and Lucas's iPhone.

Local Vite development and preview serve the frontend only. Full local checks
can use a temporary HTTP harness with the real handler and a synthetic private
source; private production data must not be copied into the Vite output. Local
success does not establish that the production service is activated.

## Official references

- [Private Blob storage](https://vercel.com/docs/vercel-blob/private-storage)
- [Consistent private reads](https://vercel.com/changelog/vercel-blob-now-supports-consistent-reads-on-private-storage)
- [Node.js Functions](https://vercel.com/docs/functions/runtimes/node-js)
- [Vercel Authentication](https://vercel.com/docs/deployment-protection/methods-to-protect-deployments/vercel-authentication)
