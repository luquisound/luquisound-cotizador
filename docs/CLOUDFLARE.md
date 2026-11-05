# Cloudflare Host and Activation

## Delivery status and scope

The selected host is Cloudflare Workers Free with D1 Free for the two intended
users. A shared user-chosen password is derived in the browser with native
WebCrypto and its resulting credential is verified by the server. Successful login
creates a remembered browser session for 30 days. Google and Cloudflare Zero
Trust are not required. The Worker serves the existing Vite build and same-origin
board, catalogue and exchange-rate APIs only after verifying its signed session.
Shared-board product behavior remains in
[QUOTATION-BOARD.md](QUOTATION-BOARD.md).

The shared board and chosen-password login are operational. Reviewed code and the
version-3 secret were deployed together, preserving all four existing secret
names. Earlier generated-password/PIN rollout evidence and the chosen-password
acceptance are recorded separately below. Earlier verified PIN checkpoint
on November 4, 2026:

- The Cloudflare account is connected through OAuth, and `luquisound.com` uses
  an active Free DNS zone after the user's separate domain purchase.
- D1 `luquisound-quotation-board` exists with migrations `0001` through `0003`
  applied remotely.
- The Worker is published at `cotizador.luquisound.com` with PIN/session
  authentication and board gates set to `shared` / `true`. The earlier initial
  deployment returned 503 while authentication was unconfigured.
- The private catalogue credential has been configured and its source validated;
  no private price, source path or credential belongs in this runbook.
- The initial authentication used the shared server-verified PIN. Its private
  Worker secret and private handoff file have been provisioned outside source.
  Live checks returned 401 for an incorrect PIN and 303 plus the signed cookie
  for the correct PIN. The cookie has Secure/HttpOnly/SameSite=Strict and a
  30-day lifetime; authenticated assets returned 200.
- Authenticated private catalogue and exchange-rate requests returned 200, with
  the exchange-rate cache backed by D1.
- Two distinct real sessions, including one native form login in Chromium,
  saved/opened a partial quotation, replaced it at revision 2, replayed its exact
  command, rejected a stale command with 409 and saved a copy with its category
  preserved. These checks used synthetic acceptance data, not customer quotations.
- The previously activated Zero Trust Free setup is unused by the selected host.
  It is not a dependency. Any cancellation is handled by the account owner in
  the provider UI; this work does not perform billing changes.

The earlier generated-password deployment on November 4, 2026 used Worker version
`68c60a57-10a2-414e-b4e9-c6efc7f94db7`. Live checks confirmed native Chromium form
login 303 and app document 200; the old PIN and a captured old session returned
401. A new session read the board successfully, with its existing entry content,
revision and board epoch unchanged. Catalogue and exchange-rate reads returned
200, the catalogue retained 1,739 items, and anonymous API access returned 401.
All four existing secret names were retained; the only replaced value was the
auth secret. No D1 migration, quotation write, new resource, paid plan or Vercel
configuration change was part of that rotation.

All 957 tests, typecheck, warning-denying lint, production build and the Worker
dry run passed. Chromium inspected the login at 390 x 844 and 1440 x 1000 without
horizontal overflow. A private exact-value scan of 219 source/build text files
found no password, signer key or verifier matches. No real credential was printed
or committed. Physical Android/iPhone acceptance remains separate.

The chosen-password deployment on November 4, 2026 (Buenos Aires) uses Worker
version `e6ae4f40-29d8-4404-b706-7b575122018b`. Native Chrome sign-in accepted the
user's 11-character password; a synthetic incorrect password returned 401. The
actual browser POST contained only the derived credential, with no plain
password. The session retained Secure/HttpOnly/SameSite=Strict and its 30-day
lifetime, survived reload, and logout cleared the cookie and returned to login.
Disabling JavaScript blocked login. No JavaScript exceptions were observed.

Authenticated board, catalogue and exchange-rate reads returned 200; the board
retained its existing entry and the catalogue contained 1,739 items. Anonymous
board access returned 401. Private before/after comparisons confirmed byte-identical
D1 metadata, entries, categories and history rows. No quotation write, D1
migration, new resource, paid plan or Vercel/supplier-pipeline change was made.

All 966 tests, typecheck, warning-denying lint, production build and the Worker
dry run passed. Chrome inspected the login at 390 x 844 and 1440 x 1000 without
horizontal overflow; the input was 56 pixels high and the submit button 52 pixels.
A private exact-value scan of 217 source/build text files found no chosen
password, derived credential, signer key or verifier matches.

The fresh signer key invalidates earlier sessions under the tested rotation
contract. An actual old session cookie and the previous private password file
were unavailable in this session, so their live rejection was not retested for
this deployment. Physical Android/iPhone acceptance remains separate.

The selected route is `cotizador.luquisound.com`; workers.dev and previews are
disabled. The root domain can separately host a public landing page without
making the app public. Domain registration/renewal is the user's separate cost.
Only domain registration/renewal is an authorized cost. No paid upgrade or extra
add-on is authorized; retain Workers Free and D1 Free with provider quota blocks.

## Independent systems

| Component | New host behavior |
| --- | --- |
| Frontend | `cloudflare/worker.ts` serves `dist` through `ASSETS` only after server-signed session verification. Only the login form/submission is public. |
| Shared board | Normalized D1 tables through `QUOTATION_BOARD_DB`; the frontend keeps the same API contract. |
| Private common catalogue | Reads the existing private Blob using server-only `CATALOG_BLOB_URL` and `BLOB_READ_WRITE_TOKEN`; preserves existing parsing, limits and availability guards. |
| Blue-dollar lookup | Existing DolarAPI behavior with a small replaceable D1 cache record. |
| Supplier automation | Existing Apps Script, Vercel observer and conditional publisher remain separate and unchanged. The Worker exposes no supplier-ingress endpoint. |
| Retired alternatives | The unused Access verifier and Vercel/Blob board adapter have been removed from source. No Blob board store was provisioned. |

The existing Vercel Hobby/Blob Free quota behavior was checked to block excess
usage, but commercial-plan eligibility under Vercel's terms remains unresolved.
The independent Vercel/Blob/Apps Script pipeline's current protection, credentials,
schedules and publication/recovery contracts must remain intact. The Worker
catalogue read does not run a supplier update or replace that pipeline.

## Automatic deployment from GitHub

The CI workflow deploys the existing Worker after a push to `main`
passes dependency installation, typecheck, lint, tests, the Vite build and the
Worker bundle dry run. Pull requests run those checks without deploying.
Main-branch runs are serialized without cancelling an active deployment.

Activation requires an Actions repository secret named `CLOUDFLARE_API_TOKEN`
in `luquisound/luquisound-cotizador`. Create a dedicated custom Cloudflare API
token with `Account > Workers Scripts > Edit`, restricted through
`Account Resources > Include > Specific account` to the existing Luquisound
account. The current deployment retains the existing custom domain and explicit
D1 database ID; it needs no D1, KV, R2 or zone-edit permission. A future change to
the domain attachment requires a separate permission review. The current custom
domain does not support restricting the token to an individual Worker resource.
Save the token directly in GitHub Settings > Secrets and variables > Actions;
never paste it into chat or commit it.
Use the existing account ID from `wrangler.jsonc`. Do not store a local Wrangler
OAuth token, the app password, session signer or catalogue credentials in Actions.

The deployment uses the lockfile-installed Wrangler with `--strict`, retaining
existing Worker secrets and the configured authentication gates, D1 binding,
custom domain, disabled workers.dev/preview routes and Free plans. It does not
apply D1 migrations or run supplier publication. A failed check or missing token
blocks deployment instead of publishing an unchecked version.

The workflow requires its commit on `main` and the repository secret configured.
Verify the first successful Actions run and the canonical host before reporting
activation. Subsequent authorized pushes to `main` update that host automatically;
Vercel remains an independent system.

### Repository security controls

The active `Protect main` ruleset prevents deletion and non-fast-forward updates
of `refs/heads/main`. It has no bypass actors, required pull requests or required
status checks, so normal direct pushes remain available. Dependabot Alerts are
enabled; automated dependency updates are not enabled by this change.

The independent CodeQL workflow scans JavaScript/TypeScript on pushes, pull
requests, a weekly schedule and manual dispatch. It uses `security-extended`,
SHA-pinned actions and job-scoped `security-events: write`. Findings are alerts,
not deployment gates; neither Cloudflare CI nor Vercel waits for this workflow.
The known transitive Zod advisory GHSA-mrhx-c7xc-m3w5 remains deferred by explicit
decision, with no dependency override or lockfile change.

The repository's default Actions token remains read-only and cannot approve pull
request reviews. Secret scanning and push protection are enabled. The deployment
token is exposed only to the existing deployment step on a push to `main`, with
checkout credentials disabled. The connected Cloudflare OAuth session cannot
inspect API token policies; the documented account-wide Workers edit scope is
not proof of the actual saved token's scope and remains a review limitation.

## HTTPS and DNSSEC

The `luquisound.com` zone requires TLS 1.2 or newer and retains TLS 1.3. This applies
to the landing, `www` and cotizador hostnames without a paid certificate add-on.
The Worker sends `Strict-Transport-Security: max-age=604800` on HTTPS responses,
including login, redirects, protected assets/APIs and errors. It does not opt
into `includeSubDomains` or preload, and excludes HTTP and loopback development.
The landing retains its separate HSTS policy. A later increase of the cotizador's
seven-day duration is a separate reviewed rollout after normal-use acceptance.

DNSSEC activation was requested on November 5, 2026. Cloudflare Registrar manages
the parent DS publication. A `pending` API status is not completed validation:
confirm the matching DS at `.com`, an active zone status and authenticated DNS
answers through independent validating resolvers. Publication can take one to
two days. Check resolution of the apex, `www` and cotizador before handoff.
For rollback, remove the parent DS first and keep zone signing active until its
TTL expires; stopping signing while a cached DS remains can cause SERVFAIL.
See [Cloudflare DNSSEC](https://developers.cloudflare.com/dns/dnssec/).

## Retire the legacy Vercel frontend

The authorized project-level redirect is live for `ls-cotizador` under team
`luquisound`. Route `f5b0ab88-9bee-46d7-af36-5f80004b7fb3` was promoted in version
`cea4db7d-ea6c-4f9e-8949-1227803297bd`. This changed routing without redeploying
the application or its supplier functions.

- Match GET/HEAD with `^/(?!api(?:/|$)|\.well-known(?:/|$)).*$` and
  `caseSensitive: false`. Preserve `/api`, `/api/**` and `/.well-known/**`.
- Return 307 with `Location: https://cotizador.luquisound.com/` and
  `Cache-Control: private, no-store`.
- Delete all request query parameters using the request-query delete transform
  with `target.key.pre` set to the empty string. A fixed destination alone does
  not strip queries; retain this transform to avoid forwarding Vercel
  sharing/bypass credentials to the new origin.
- Retain All Deployments SSO. Anonymous requests encounter Vercel login before
  project routing; authenticated visitors receive the redirect. Do not weaken
  API protection to bypass this ordering.

Live acceptance on `ls-cotizador.vercel.app` confirmed authenticated GET/HEAD `/`
return 307. GET `/index.html?marker` and `/old-page?marker` returned the fixed
destination without a query. A synthetic `_vercel_share` query-removal check also
passed in staging. The observer retained GET 405 with `Allow: POST`; POST without
ingress authentication returned 401 before writes. The catalogue returned 200
with 1,739 items and a byte-identical SHA256 digest before/after promotion.
Production deployment `dpl_JDPrKpD6QSsvjMeDyCm55v2CU54P` and All Deployments SSO
remained unchanged. Anonymous requests still encounter Vercel login first.

Cloudflare checks confirmed PIN login 303, board 200 with the existing saved
quotation preserved, and catalogue 200 with 1,739 items. No supplier observation
or publication was triggered for this routing test. Functions, Blob data,
secrets, billing and the existing schedule remain unchanged. Browser-local
quotation bytes must not be cleared or migrated by the redirect.

To roll back, disable only this route and promote the resulting routing version.
There is no prior routing-version baseline to restore; do not replace unrelated
rules, pause/delete the project or remove its private storage.

## Free-plan boundary

New app resources use Workers Free and D1 Free. Workers Free was verified active
on the selected account. No paid upgrade or add-on is authorized. The user's
separate domain purchase does not authorize additional paid services, and the
password flow requires no Access or Google subscription.
The relevant published limits, checked on November 4, 2026, are:

| Service | Free-plan allowance relevant to this app |
| --- | --- |
| Workers | 100,000 requests/day and 10 ms CPU per invocation. |
| D1 | 5 million rows read/day, 100,000 rows written/day and 5 GB total storage. |

These are account/provider quotas, not a guarantee of unlimited application use.
Every protected asset must pass through the Worker, so do not bypass verification
to reduce request usage. Keep routes fail-closed and monitor request, CPU and D1
usage. Reaching a quota must produce an error while retaining local work, not
trigger a paid upgrade. Workers/D1 Free quotas block excess work rather than
automatically upgrading the account. See [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/),
[Workers limits](https://developers.cloudflare.com/workers/platform/limits/),
[D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) and
[Cloudflare plans](https://www.cloudflare.com/plans/).

The independent Vercel Hobby/Blob resources retain their existing Free quota
blocks. No paid resource, automatic upgrade or add-on may be introduced to avoid
a quota error. These account checks do not establish commercial-plan eligibility
under Vercel's terms. The unused Zero Trust Free Base subscription was cancelled
by the owner during cleanup, as recorded below. It is not part of this login flow;
these checks do not imply a global account zero-charge guarantee.

## Shared password and remembered session

The selected login uses a shared user-chosen password of 11 to 128 Unicode code
points, checked exactly and case-sensitively without trimming or normalization.
`/login` serves the public HTML form and accepts its same-origin submission.
The app HTML, JavaScript, fonts, images and APIs require a valid signed session;
there are no public asset exceptions. Missing/invalid auth configuration fails
closed with 503. An arbitrary cookie, identity header or frontend password comparison
does not authorize access.

Native browser WebCrypto derives 32 bytes from the password using PBKDF2-HMAC-SHA256
with 600,000 iterations and a random 16-byte public salt, regenerated on rotation.
Only the canonical base64url derived credential is submitted over HTTPS. The
password input has no form name and is cleared before submission. A nonce-based
CSP permits only the supplied login script; unavailable JavaScript/WebCrypto
blocks login rather than falling back to raw-password submission. The slow KDF
runs in the browser instead of consuming the Worker's Free CPU allowance.

The server-only `COTIZADOR_PIN_AUTH_SECRET` name is retained for compatibility.
Its strict JSON schema contains `version: 3`, `key` (a random 32-byte HMAC signer
key), `salt` (the 16-byte public salt) and `passwordSignature` (a HMAC-SHA256
signature over `password:` followed by the canonical derived credential).
Binary fields use canonical base64url. Version-1 PIN and version-2 generated-password
secrets are rejected; the server accepts no raw-password fallback. The public
login parameters disclose only the salt and fixed iteration count, never the
signature or signer key. The derived credential is password-equivalent and must
not be cached, logged, placed in source or treated as a harmless hash.
The plain password, verifier JSON, derived credential and session tokens never
belong in source, frontend environment variables, logs or chat. Keep private
files outside the public repository; examples contain no real credentials.

A successful login sets `__Host-luquisound-session` with `HttpOnly`, `Secure`,
`SameSite=Strict`, `Path=/` and a 30-day lifetime. Session signatures and expiry
are verified without querying D1. Rotating the complete secret with a fresh key
and salt revokes all existing sessions. Logout clears only the current browser's
cookie; it does not globally revoke other browsers or erase local quotations.
Both users share permissions and the credential, so it does not provide
per-person identity or attribution.

Before checking a submitted derived credential, bounded D1 counters allow five login attempts per
15 minutes in each HMAC-derived IP bucket and 50 attempts per 15 minutes globally.
The IP space maps to 128 buckets rather than accumulating a row for each address;
raw IPs are not stored in these counters. D1 failure blocks login instead of
bypassing the counters. Valid remembered sessions need no D1 query for their
authentication check; board operations still depend on D1 availability. Login,
logout and app mutations keep their same-origin POST checks.
The login page uses a same-origin referrer policy so native form submission keeps
the Origin needed by those checks; cross-origin submissions remain rejected.

`wrangler.jsonc` uses `run_worker_first: true`, `workers_dev: false` and
`preview_urls: false`, routing the app only through `cotizador.luquisound.com`.
Keep those safety properties and add no public asset-path exception. Any future
alternate route needs explicit authorization and the same server-side session
verification before assets and APIs.

## Configuration

`wrangler.jsonc` defines `ASSETS` from `./dist` with SPA fallback and the
`QUOTATION_BOARD_DB` D1 binding. Account/database IDs in that configuration are
nonsecret routing identifiers. `cloudflare/migrations/0001_quotation_board.sql`
creates the board schema; `0002_exchange_rate_cache.sql` adds the rate cache.
Both were applied to the authorized database during this rollout. The bounded
login-attempt table from `0003_pin_auth.sql` has also been applied remotely.
Initial PIN/session acceptance and the later password transition passed on the
canonical host. The existing
`0003_pin_auth.sql` migration and `quotation_pin_limits` table retain their
historical names; the password transition does not migrate or reset D1 data.

| Setting | Required value or behavior |
| --- | --- |
| `COTIZADOR_PIN_AUTH_SECRET` | Historical name retained. Private server-side JSON containing version 3, random signer key, public salt and `passwordSignature`. Never a frontend variable or a plain password. |
| `QUOTATION_BOARD_MODE` | Blank examples retain `disabled`; the reviewed canonical deployment uses `shared`. |
| `QUOTATION_BOARD_ACCESS_REVIEWED` | Blank examples retain `false`; the verified canonical deployment uses `true`. It is an operational gate, not visitor identity. |
| `QUOTATION_BOARD_DB` | Migrated D1 binding, not a string environment variable. |
| `CATALOG_BLOB_URL` / `BLOB_READ_WRITE_TOKEN` | Optional private catalogue source and server-only credential; never `VITE_` variables. |
| `INSTALER_CATALOG_MODE` | Preserve the existing catalogue last-valid recovery setting; it does not enable publisher writes on this Worker. |

Set the secret privately in Worker configuration; never commit it or the actual
password in `wrangler.jsonc`, examples, source, chat, logs or screenshots. Local Wrangler
settings belong in ignored `.dev.vars`, using `.dev.vars.example` as a blank
template. `.env.example` documents only the independent Vercel catalogue and
supplier services. No Cloudflare board Blob token is needed. The unused Access
verifier and old board adapter have been retired; Access issuer/Audience/email
configuration is not part of this host.

## Private password preparation and rotation

The operator script retains its historical filename. It reads a user-prepared
private UTF-8 password file and prepares the new verifier locally. It does not
upload secrets or change a deployment:

```sh
node --experimental-strip-types scripts/provision-pin-auth.ts --password-file "C:/private/location/new-password.txt" --secrets-output "C:/private/location/cotizador-auth.json"
```

Replace the examples with reviewed absolute private paths outside Git. The source
contains only the chosen password. A UTF-8 BOM and one final CRLF/LF file terminator
may be removed; significant spaces remain unchanged. Reject control characters,
unpaired surrogates and values outside 11 to 128 Unicode code points. Do not trim
or normalize the credential. The script generates a fresh independent 32-byte
signer key and 16-byte salt, derives the same PBKDF2 credential, and writes the
version-3 deployment JSON exclusively without overwriting existing output.
The JSON contains only the `COTIZADOR_PIN_AUTH_SECRET` deployment binding with
its server verifier, public salt and signer key. The input file stays unchanged.
Editing a private password file alone does not change remote access; matched
code/secret deployment and verified sign-in are required.
Neither file belongs in the repository, client build or public artifact output.
The real password, derived credential and JSON must never be printed, passed as shell argument
values, included in command logs or pasted into chat. Paths are safe arguments.
On Windows verify file ACLs restrict access to the intended local user and
SYSTEM; a file mode alone does not establish that ACL.

After local checks and explicit deployment authorization, upload the reviewed
new code and the single new auth binding in one Worker version:

```sh
wrangler deploy --strict --secrets-file "C:/private/location/cotizador-auth.json"
```

Wrangler applies this JSON additively, preserving the other catalogue secrets.
Keep the existing D1 binding, board gates, custom domain and private asset/API
checks. Do not replace the secret before publishing the matching code, and do
not delete the old secret to force a provisioning command to run. JSON avoids
dotenv variable expansion. Configure local tests only through ignored
`.dev.vars`; blank examples retain disabled/false gates.

If the deployment response is uncertain, retain exactly the same candidate files
and inspect which credential/version is active before any retry. Do not generate
another verifier blindly or overwrite the candidate. Verify the new password,
old generated-password rejection, old-session rejection and the unchanged
board/catalogue before completing the handoff. Retire obsolete private credential
copies only after that
verification. Restoring an old signer key also restores its old sessions; prefer
fixing forward with the new credential rather than silently undoing revocation.
No rotation step resets D1 entries, login counters or browser-local quotations.
Remote updates remain within explicit authorization, with no billing or
identity-provider setup.

## Local checks without provisioning

Use the existing lockfile and Node/npm requirements from the README. Wrangler is
a development dependency used for local D1 and bundle validation.

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run check:cloudflare
npm run db:cloudflare:local
npm run dev:cloudflare
```

`check:cloudflare` performs a Wrangler deployment dry run into an OS temporary
directory, rejects legacy runtime dependencies in the Worker bundle, and removes
that task-owned output. It creates no cloud resource and publishes nothing.
`db:cloudflare:local` applies migrations only to local D1.
`dev:cloudflare` builds assets and starts local Wrangler. Disposable local D1 data
lives under `.agent-tmp/cloudflare`; it is not persistent project state or a
production backup and must not be committed.

Local Worker requests still require the configured server password/session flow. Without
configuration, a 503 response is expected, not a reason to add a bypass.
Synthetic handler/password/session/D1 tests establish local behavior without a real account.
The earlier in-memory design prototype has been retired. Vite alone serves the
frontend and does not establish authenticated Worker acceptance.

## Remaining setup and user acceptance

The account, Workers Free plan, custom domain, D1 database and private catalogue
source are established. The initial PIN rollout, reviewed board activation,
generated-password transition and version-3 chosen-password login passed their
recorded live checks, with the old-credential/session verification limit stated
above. No Google account, email allowlist, Access
application or issuer/Audience input is required.

Both intended users must be able to enter the shared password once and use the
remembered session from their own devices. Never request provider/mailbox
passwords, the real app credential or session/API tokens in chat. The user manages any
cancellation of the unused Zero Trust setup separately in the provider UI.

## Authorized password deployment sequence

1. Preserve the existing Free account, D1 database, applied migrations, board
   gates and custom-domain route. Review the password/session source and focused
   checks; do not recreate resources or change the supplier pipeline.
2. Read the chosen password privately and prepare an independent signer key,
   random public salt and version-3 secret JSON outside the repository without
   printing credentials. Confirm private ACLs.
   This authentication change requires no new D1 migration or counter reset.
3. Deploy reviewed code and `COTIZADOR_PIN_AUTH_SECRET` together using the private
   JSON secrets file. Keep `run_worker_first: true`, disabled workers.dev/previews,
   the existing shared-board gates and the other catalogue secrets.
4. Verify the correct password, remembered session and logout. Confirm the old
   generated password and previously issued cookies are rejected. Retain same-origin checks,
   bounded login attempts and fail-closed configuration/session handling.
5. Verify authenticated assets, private catalogue, DolarAPI and the existing
   board entries without changing saved quotations or supplier observations.
   Complete physical Android/iPhone acceptance separately; no additional Google
   trigger, publication setting or cleanup schedule is required.
6. Record the final version and checks, retain the chosen password privately, and
   retire the old local credential copy only after success. Remove disposable secret JSON and
   verification sessions when no longer needed. Keep the examples blank with
   disabled/false defaults and retain the reviewed Free plans.

If a new origin is used, the old browser recovery, catalogue cache and unresolved
commands stay with the old origin. Preserve it and its bytes; there is no
automatic cross-origin migration or legacy-library upload. A separately reviewed
transfer must not replay old unresolved commands against a fresh board epoch.

To disable, set board mode to `disabled` through a reviewed deployment while
retaining D1 data and password/session protection. Keep the old host protected as well.
Disabling a service is not authorization to delete either origin's local state,
active entries, D1 exports or private legacy data.

## Bounded history, export and recovery

D1 saves atomically apply the target revision check, category creation when
needed, prior-entry snapshot and updated entry. The database retains the latest
50 prior entry snapshots globally. Its retention trigger prunes older internal
snapshots; it does not delete active entries and adds no schedule. These are not
50 complete-board backups or a user-facing unlimited history.

Before a separately authorized database migration or recovery, make a private
operator D1 export to a reviewed location outside the public repository. Validate
the export and test the proposed import/recovery against an isolated local copy.
Exports contain private quotations and must not enter source, logs or screenshots.
There is no public restore API or automatic legacy Blob import.

Cloudflare documents seven days of Free-plan D1 Time Travel. That provider-level
feature is not an epoch-safe application restoration procedure. A live restore
can rewind entry revisions and revive old operation IDs. Disable writes, preserve
the current export, review the target, and use a separately reviewed recovery
that assigns a fresh board epoch and verifies metadata/counts/revisions before
reopening writes. Outstanding client commands must conflict with the new epoch;
preserve their working quotations for explicit review. The retired Blob recovery
helper was never a D1 restore command. No automated D1 full-board restoration is
claimed here. See
[D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/).

After the reviewed data restore, the private operator helper
`invalidateD1BoardEpoch(database, expectedEpoch, expectedRevision, newUuidV4Epoch)`
in `src/server/cloudflare-board-recovery.ts` conditionally rotates the restored
metadata epoch and advances its revision. It does not restore or validate the
full data set. Verify the resulting epoch/revision before reopening writes; if
its response is uncertain, read the metadata before any retry rather than
blindly choosing another epoch.

## Next bounded work

The shared-board rollout, earlier PIN acceptance and later password transition
are complete. Confirm user/Lucas acceptance on their actual devices; browser testing does not
establish physical Android/iPhone acceptance. Retain the selected Free plans and
existing supplier integration, product rules and old origin. Additional features,
paid resources, automatic Figma import and category/entry deletion remain outside
this migration.

## November 4, 2026 cleanup checkpoint

Before source cleanup, an access-restricted private directory outside Git received
a complete tracked/untracked source archive and manifest plus a remote D1 export.
The export imported successfully into in-memory SQLite and passed
`PRAGMA integrity_check`; it contains the existing board entry. No live board
write, schema migration, epoch change or browser-storage cleanup was performed.

Retired from source: the unused Access verifier, Vercel/Blob board adapter and
exclusive recovery/tests, the in-memory design prototype, and the Vercel
exchange-rate wrapper. Its only dependencies, `@vercel/functions` and
`@vercel/oidc`, were removed without adding packages or changing any remaining
package version. The two-device flow suite now runs against D1's handler and
real SQL migration, retaining conflicts/recovery and adding response-loss replay
and optional-category checks. Historical design/runtime evidence is retained.

All 922 remaining tests passed, without skips. Typecheck, warning-denying lint,
production build and the Worker dry run passed. The existing large-bundle warning
remains; no unrelated optimization was attempted. No Git publication or
Cloudflare deployment was needed. The separately authorized Vercel publication
is recorded below.

The owner completed the Teams Free Base cancellation in the Cloudflare billing
UI. The final subscribed-products screen showed only Workers Free as active;
Teams Free Base no longer appeared. The domain and its renewal/payment setup
were preserved. The owner also shut down the separate Google Cloud login project
`cotizador-luquisound` (number `995573809541`). Its confirmation shows the project
is off and scheduled for deletion after December 4, 2026. This was the separately
created login experiment; the supplier Apps Script project was not changed.
No paid upgrade or new service was added.

Read-only checks retained the existing Vercel All Deployments protection and
redirect route/version. Cloudflare still serves the chosen-password version
`e6ae4f40-29d8-4404-b706-7b575122018b`; no secret rotation was part of cleanup.
The temporary test share link on `ls-cotizador.vercel.app` was revoked without
regeneration. A readback confirmed its removal and the unchanged existing
user-scoped access. Other inspected project aliases had no shareable links;
deployment-level links were not enumerated by this interface. No project
automation-bypass credential was changed.
Physical Android/iPhone acceptance and a recent natural supplier-cycle review
remain separate. Preserve the independent Apps Script/Vercel/Blob supplier path.

### Reviewed Vercel publication

The owner explicitly authorized publishing cleanup to `luquisound/ls-cotizador`.
The CLI verified that existing project ID before creating a production build
with `--skip-domain` from an isolated 113-file source copy. The copy included no
private/local environment files, attachments, backups or credentials. The
connector does not expose the skip-domain option, so only this preparation used
the existing authenticated CLI; the connector promoted the reviewed deployment.

Deployment `dpl_B7KRRhqBQGcVocN3SKHwdJH2gxNL`
(`ls-cotizador-kwtroo7g3-luquisound.vercel.app`) reached READY. Before promotion,
its catalogue returned 200 with 1,739 items and identical response content to the
previous production deployment; the observer returned GET 405 with `Allow: POST`,
and the removed Vercel exchange-rate endpoint returned 404. The production alias
was then promoted to that exact deployment without rebuilding.

Post-promotion checks confirmed the same catalogue content/count, observer method
gate, removed rate endpoint and 307 redirect from a legacy page/query to
`https://cotizador.luquisound.com/` without query forwarding. All Deployments SSO
and routing version `cea4db7d-ea6c-4f9e-8949-1227803297bd` remained intact.
No supplier observation/publication or schedule was forced for acceptance.
Project credentials, Blob contents and Cloudflare/D1 configuration were retained.

The temporary explicit verification link on the new deployment was revoked
without regeneration. The production alias readback retained only its existing
user-scoped access. The earlier deployment
`dpl_JDPrKpD6QSsvjMeDyCm55v2CU54P` remains the rollback target if a separately
reviewed rollback is needed; do not remove the redirect or change supplier data.

The canonical Cloudflare login still returned 200 and anonymous board access
401 after the independent Vercel publication. The current auth, D1 store/recovery,
catalogue, supplier code, browser recovery and deployment configuration files
were checked unchanged against the pre-cleanup source archive.

### HTTP navigation redirect

The November 4, 2026 domain integration changes remote HTTP GET/HEAD requests
from a 403 response to a permanent 308 redirect to the same HTTPS URL, preserving
the path and query. Plaintext mutations remain rejected, and local development
hosts may still use HTTP. This does not change authentication or private data
access.

The prepared Worker bundle differed from the prior live bundle only by this
redirect. The content-only Cloudflare API update retained the existing static
assets, bindings, secrets, database and compatibility settings. Version
`d0d21704-2208-40b0-b5b0-368d081da002` serves the correction. Live checks confirmed
HTTP GET/HEAD 308, plaintext login POST 403, HTTPS login 200 and anonymous board
401. Focused Worker tests, typecheck, lint and production build passed.

Automatic command review rejected deleting the task-owned temporary deployment
copy and two temporary inspection files outside the repository. The owner removed
all three manually; subsequent read-only checks confirmed their absence and the
preserved source/D1 backups. The initial cleanup did not stage, commit or push.
The owner subsequently authorized Git publication to align the repository with
the reviewed deployment, preserving these changes and excluding private files.
