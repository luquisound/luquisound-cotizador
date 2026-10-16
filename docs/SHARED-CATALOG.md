# Private common catalogue

## Behavior

The app requests `GET /api/catalog` from the same origin on startup. Every new
device receives the configured common product catalogue without a file picker.
The endpoint is read-only. The app does not upload quotations or manual price
edits, and those edits are not synchronized between devices.

Common records need a complete, unique supplier and SKU key. Merging is atomic:
local identities, approved prices (including zero), currencies, personal entries,
and quotation snapshots are preserved. Common metadata and historical references
can be updated. Conflicts or limits retain the previous local catalogue and show
a retry action. Missing configuration retains manual file import and local use.

Local copies are kept in browser storage and included in private JSON backups.
Startup fetch failures allow continued work with that copy. Loading the common
catalogue never grants historical references the status of approved sale prices.

## Private source and configuration

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
   without importing a file. Confirm reload, manual-price preservation, backup
   recovery, and continued local use when the source is temporarily unavailable.
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
