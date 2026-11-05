# Shared Quotation Board

## Status and current delivery

The normal application now implements a private shared quotation board: the
editor's Save to board and Board actions call `/api/quotation-board` when its
separate protected-host configuration is enabled. Cloudflare Workers Free with
D1 Free and a shared user-chosen password with browser PBKDF2 derivation and
server verification is the selected host.
Successful login creates a signed, remembered browser session for 30 days;
Google and Cloudflare Zero Trust are not required.
The canonical Worker is operational with verified password/session protection
and the shared board enabled. The earlier generated-password transition revoked
the PIN and sessions without changing saved quotations. Chosen-password deployment
acceptance is recorded separately in the host runbook. D1 migrations `0001` through `0003` and
private catalogue configuration are complete. Earlier live checks used
two distinct sessions to save/open a partial, replace it, replay its exact save,
reject a stale revision and save a copy without changing its category. See
[CLOUDFLARE.md](CLOUDFLARE.md) for the verified infrastructure checkpoint,
configured private catalogue and remaining physical-device acceptance.

The earlier in-memory design prototype has been retired. The normal editor uses
the real private board; Vite alone does not run that service. No synthetic
quotation examples are part of the application.

The visual reference is the supplied Figma-board screenshot: category sections
and quotation miniatures. The quotation itself retains the existing approved
yellow header, official assets, fonts and calculation rules.

## Agreed product contract

- One private board is shared by the two intended users, with equal editing
  rights. Templates and partial quotations use the same entry format.
- Each entry has an immutable ID, required internal name, optional category,
  revision, server timestamps and a full quotation snapshot.
- Internal names may repeat and are independent of customer-visible titles.
  Neither a matching name nor a category selects an entry for replacement.
- A category is a single optional grouping, independent of row audio categories.
  Names are trimmed, up to 80 characters, and unique ignoring case and repeated
  spaces. Internal entry names are trimmed and limited to 120 characters.
- A first save offers creation and cancellation. Saving an opened entry offers
  replacement, creation of a new entry, and cancellation, keeping name/category
  editable for both save actions. New categories can be created inline.
- Replacement updates only the source entry, including name and category.
  Saving as new preserves the source and links subsequent saves to the new entry.
- Cancellation changes neither the board nor the working quotation. Failed saves
  preserve the working quotation and its previous source association.
- Partial quotation saving is independent of PNG delivery validation. Pending,
  invalid, zero-priced and explicitly included states remain distinct.
- Selecting an entry opens an independent editable copy with its customer title
  intact. All row references, visual order and discount selection remain coherent.
- Entering or leaving the board does not discard the working quotation. Selecting
  another entry or starting new with unsaved changes offers save-and-continue,
  continue-without-saving, or cancellation. A cancelled or failed preceding save
  must not open the requested destination.
- Search covers internal name, customer title and subtitle. Category sections
  sort alphabetically; uncategorized entries appear last. Entries sort by their
  latest update, newest first.
- The board preserves search/category filters during editor navigation. Controls
  remain keyboard accessible and at least 48 CSS pixels high on touch screens.

## Data preservation

Snapshots retain all quotation fields: native prices/currencies, quantities,
discounts, row/block order, price states, notes, provenance, conversion anchors,
factory-equipment origins, fixed-service origins, bypass selection and adapter
variants. Opening prepares an editable copy without modifying the saved entry.
Opened snapshots and confirmed shared saves retain a frozen exchange rate and
its source/date. The existing explicit dollar-update action can resume automatic
lookup. No board action refreshes sale prices or approves stock.
Current availability guards continue to apply to customer image delivery.

The former local quotation library is never read, uploaded or migrated by the
shared board. Its `luquisound.quotation-library.v1` bytes and the legacy workspace
key remain untouched. Catalogue products, approved prices and cache stay separate.
Current recovery retains its existing key and compatible quotation parser; it
validates and writes the working quotation, board context and exact pending save
command together. Context includes source entry ID, revision, epoch, name,
category and the saved-content baseline. Timestamp-only changes do not count as
unsaved commercial edits. Corrupt or conflicting local records are preserved.

An unresolved save command includes its stable operation/entry IDs, expected
revision, epoch, submitted name/category and exact quotation snapshot. Reloading
recovers that command but never automatically issues its POST. An explicit retry
resubmits the same command so the server can confirm a previously committed
result or report a conflict before another version is submitted. Fields for that
unresolved command remain protected while its outcome is uncertain. Working edits
made after submission remain separate and must not be reported as already saved.
A confirmed remote save remains durable even if local recovery subsequently fails.
Changing the application origin does not migrate those browser records; preserve
the old origin and its data instead of replaying commands against a fresh board.

## Implemented screens and boundaries

- Category board with search, category counts/filter, empty search results,
  pending-state miniatures and an indication of the currently opened entry.
- Save form for first save and replacement/new-save decisions, optional category,
  inline category creation, validation, cancellation and Escape.
- Normal editor integration with the existing catalogue, row/header/price/discount
  editing, dollar refresh, availability checks and PNG delivery guards.
- Unsaved-change confirmation, contextual loading/storage/access errors,
  explicit retry and conflict handling that preserve the working draft.
- List/detail loading with runtime miniatures loaded as cards approach the
  viewport. Failed miniatures do not discard entries or prevent a later open.

Category rename/delete, entry deletion, automatic Figma import, continuous
coediting and a user-facing version-history/import/export interface are not
implemented in this block. Acceptance uses the real API flow; the earlier
synthetic design prototype has been retired.

## Private API and D1 storage contract

The selected host is `cloudflare/worker.ts`. After session verification, the same-origin
`/api/quotation-board` route accepts GET and POST only. GET without parameters
returns categories and entry summaries; GET with one validated `entryId` returns
a full snapshot. POST accepts a narrow save command with `new` or `replace` mode,
including optional inline category creation. It does not accept a client-provided
replacement of the whole board or an arbitrary storage path. Writes require JSON
and a matching request Origin; cross-origin requests are rejected.

Normalized D1 tables keep metadata/epoch, categories, current entries and bounded
prior-entry snapshots. A save uses a guarded atomic D1 batch: expected board/entry
versions, optional category creation, previous-entry archival and the new snapshot
are committed together. Independent-entry races can be retried while the target
entry version still matches; edits to the same entry or a changed epoch return
409 and preserve the draft. Stable operation IDs and exact command hashes resolve
lost responses without blind duplicates; a later incompatible edit conflicts.

Limits are 100 active entries, 100 categories, 120 characters per internal name,
80 characters per category, 256 KiB per serialized D1 entry, a 260 KiB save-request
envelope, and 5 MiB of active board data. The existing 1000-row quotation limit
still applies. Errors preserve the working copy; there is no active-entry eviction
or truncation. Miniatures render from loaded snapshots and are cached in memory
by entry revision; PNG/base64 images are not stored in D1 entries.

Credentials, real quotations and private source data never belong in source,
logs, client environment variables or the public bundle. API and asset responses
are private/no-store, and private catalogue reads preserve existing guards.

## Server password/session authentication and activation

Cloudflare Workers Free and D1 Free are selected for the two intended users. Only
the separate domain registration/renewal is an authorized cost, with the app at
`cotizador.luquisound.com`; no paid upgrade or add-on is authorized. Provider quota
blocks apply to Workers/D1 and were also checked on the existing Vercel Hobby/
Blob Free resources. Commercial-plan eligibility under Vercel's terms remains
unresolved. The unused Zero Trust setup is not part of the selected login flow.

The browser derives a credential from the shared chosen password with native
WebCrypto. The Worker verifies that credential on the server and issues a signed
`__Host-luquisound-session` cookie for 30 days,
with `HttpOnly`, `Secure`,
`SameSite=Strict` and `Path=/`. Only the login HTML/submission is public; app
assets and APIs require signature and expiry verification. Bounded D1 rate limits
run before checking the password; a D1 failure blocks login. Existing session checks
do not query D1. Missing/invalid secret configuration fails 503; arbitrary
identity headers/cookies or a frontend password comparison cannot authorize access.
Rotating the complete signer/password secret revokes all browser sessions. Logout
clears the current browser cookie only and does not erase local working data.
The two users share permissions, without per-person identity attribution. The
chosen password supports 11 to 128 Unicode code points, is case-sensitive and is
never trimmed or normalized. Control characters and unpaired surrogates are
rejected. PBKDF2-SHA256 uses 600,000 iterations, a random 16-byte
public salt and a 32-byte derived credential. Only its canonical base64url value
is submitted over HTTPS; it is password-equivalent and must never enter logs or
storage. The Worker checks its HMAC after bounded D1 throttling, keeping the slow
derivation out of the Free CPU budget. Raw passwords and legacy secret versions
are rejected. There is no password-setting UI.
Keep `run_worker_first: true`,
`workers_dev: false` and `preview_urls: false`.

| Setting | Required behavior |
| --- | --- |
| `COTIZADOR_PIN_AUTH_SECRET` | Historical name retained. Private server-only JSON: version 3, random signer key, public salt and `passwordSignature`. Never a plain password or frontend variable. |
| `QUOTATION_BOARD_MODE` | Blank examples use `disabled`; the reviewed canonical deployment uses `shared`. |
| `QUOTATION_BOARD_ACCESS_REVIEWED` | Blank examples use `false`; the verified canonical deployment uses `true`. This operational gate is not visitor identity. |
| `QUOTATION_BOARD_DB` | Migrated D1 binding from Wrangler configuration, not a string variable. |

Prepare the secret using the reviewed private operator script described in
[CLOUDFLARE.md](CLOUDFLARE.md), deploy reviewed code and the new secret atomically,
and read the chosen password from a private file outside Git. Editing that file
alone does not change deployed access. Keep the real password, derived credential,
signer JSON and session tokens out of chat, source and
logs. The active host needs no Google account, email allowlist or Access
issuer/Audience values. The unused Access verifier has been retired.

[CLOUDFLARE.md](CLOUDFLARE.md) is the activation runbook and contains the required
current rollout status, exact local checks and Free-plan limits. Publication,
resource creation, remote migrations, secrets, permissions and deployment remain
within explicit authorization for the reviewable result. Verify password sign-in and
remembered sessions in two independent browser profiles before board activation;
both users' device acceptance remains a separate check. Keep the existing Free
plans; no paid upgrade or identity-provider setup is part of
this rollout.

The normal host also ports the private catalogue read and DolarAPI endpoint with
a small D1 cache. It does not expose supplier ingestion or move the independent
Apps Script/Vercel observation/publication pipeline. Preserve that deployment's
existing All Deployments protection and private credentials.

Moving to a new origin does not migrate existing browser recovery, catalogue
cache or unresolved commands. Preserve the old origin and stored bytes. There
is no automatic legacy-library upload or cross-origin pending-command replay.

## Bounded D1 snapshots and operator recovery

Each replacement archives the preceding entry inside the same transaction.
D1 retains the latest 50 prior entry snapshots globally, pruning older internal
snapshots through its retention trigger. These are not 50 whole-board backups,
a complete audit history or a user-facing restore feature. Active entries are
not evicted and no cleanup schedule is added.

A private operator export is required before reviewed migration/recovery work;
validate it and test the proposed recovery in an isolated local copy. Exports
contain private business data and stay outside the public repository. There is
no public restore API or automatic Blob-board import.

D1's Free-plan Time Travel window is a provider feature, not an epoch-safe
application restore. Do not restore a live database blindly: disable writes,
preserve the current export, review the target, and prepare a separately reviewed
operator recovery with a fresh epoch and verified metadata/counts/revisions.
Outstanding old commands must conflict after reopening writes while their working
quotations remain available for review. No automated D1 full-board restoration
is claimed. The private `invalidateD1BoardEpoch` helper guards the epoch/revision
change after a separately reviewed restore; it does not restore the data itself.
The detailed boundary is in [CLOUDFLARE.md](CLOUDFLARE.md).

## Retired alternatives

The unused Cloudflare Access verifier, Vercel/Blob board adapter and its exclusive
recovery helper have been removed from source. No Blob board store was
provisioned. The two-device client/recovery flow tests now run against the D1
handler and real SQL migration, retaining conflict, retry and category coverage.
Only the Cloudflare password/session and D1 board implementation remains.

The private Blob used by the common catalogue and supplier pipeline is separate
and must be preserved. Retiring the board adapter does not retire that storage,
Vercel's protected supplier receiver or the existing Apps Script trigger.

## Remaining acceptance and next bounded work

The earlier deployed PIN/session and cross-session board checks passed after the
applied auth migration and private secret provisioning. The later password
transition passed live native-form sign-in, old PIN/session rejection and
preservation of existing board data and catalogue access. Complete user/Lucas
acceptance on their actual devices using the Cloudflare runbook.
Keep the existing supplier integration and both origins' local data intact.

Coverage must retain new/replace/category/copy behavior, partials, title and row
references, atomic current-context/pending-command recovery, response-loss retries,
409 conflicts, server password/session verification before assets/APIs, bounded capacities
and snapshots. Physical Android/iPhone acceptance
remains separate from browser emulation. Category rename/delete, entry deletion,
automatic Figma import, paid services and new supplier schedules are not part of
this migration.
