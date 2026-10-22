# Instaler daily observation

## Implemented scope

A private standalone Apps Script owned by the workshop reads one existing supplier
XLSX through Drive API and posts it to the protected Vercel receiver. Google
manages the script's authorization. Vercel stores no Google client secret or
refresh token. No public Google web app, informational site or Vercel cron is needed.

Both sides default to disabled in code and `.env.example`. Deployments, account
authorization, live secrets and trigger installation are separate operations.
The implementation never modifies the Excel.

The observer validates, compares and stores private evidence from `Precios`.
Its only supported mode remains `observe`. A separate publisher can now consume
the committed reading when `INSTALER_CATALOG_MODE=publish` is explicitly enabled;
see [catalogue publication](INSTALER-CATALOG-PUBLICATION.md). Personal prices and
quotation amounts remain unchanged. Kits from other worksheets remain outside
this stage. The checkpoint below predates that separate publication capability.

## Operational checkpoint: 2026-10-21

- The production receiver is deployed in `observe` mode behind the existing
  Vercel Authentication protection and a dedicated automation bypass. The active
  `/api/catalog` response was verified byte-identical before and after activation.
- The workshop's standalone Apps Script uses its default Cloud project and the
  declared read-only Drive and external-request scopes. One real manual execution
  downloaded the existing XLSX with its workshop browser tab closed, delivered it
  to the receiver and recorded a private `baseline` observation.
- The saved baseline was read back through the actual Blob adapter and validated
  by the production state parser. The adapter now explicitly requests an identity
  response to preserve byte lengths and the strong ETag needed by conditional writes.
- Exactly one workshop-owned time-driven trigger was verified for
  `observeInstalerDaily`, using Head, daily in the **08:00-09:00 Buenos Aires**
  window with immediate failure notifications. The script and receiver remain in
  `observe` mode, with catalogue publication unavailable.
- The manual reading belongs to UTC date `2026-10-22`. The scheduled execution on
  October 22 therefore skips another source attempt. The next eligible morning
  reading is October 23, 08:00-09:00 Buenos Aires, unless another attempt consumes
  that UTC date first. Do not clear the guards to force a reading.
- The first automatic execution and natural supplier price/stock changes remain
  unverified. A one-time review request for October 23 at 09:30 Buenos Aires was
  handed to Dot by the owner; its scheduling and outcome are not verified here.

The observer still cannot publish the catalogue. The source values, source ID,
account binding, credentials, private baseline and catalogue fingerprints remain
outside this repository. These are point-in-time operational checks; recheck live
state before changing configuration or declaring scheduled acceptance.

## Implementation and data flow

- `apps-script/instaler-observation/Code.gs`: standalone sender using built-in
  Apps Script services and Drive REST API. No extra packages or local runtime.
- `apps-script/instaler-observation/appsscript.json`: V8, Buenos Aires timezone,
  `drive.readonly` and `script.external_request` only. Its Drive v3 advanced-service
  declaration enables Drive API automatically in the default Cloud project,
  including for the sender's REST requests, without manual Cloud setup.
- `src/server/instaler-source.ts` and `instaler-upload.ts`: bounded upload contract.
- `api/instaler-observation.ts`: Production-only authenticated POST receiver,
  reusing the Node XLSX reader, preparer, comparator and private Blob adapter.

The script is versioned with the quotation app but excluded from its browser
build. It has no public web entrypoints, provider permission request, spreadsheet
writes, file conversion or trigger installer. Manage the single daily trigger in
Google's editor; do not attach a script to the supplier file.

`observeInstalerDaily` checks exact `observe` mode and configuration, takes a
script lock and records its attempted UTC date **before** Drive access. Each UTC
date has at most one source attempt, including failures. It checks the effective
Drive account through `about.user.emailAddress`, reads metadata, downloads XLSX
bytes, then reads metadata again. File ID, XLSX MIME, download permission,
size/MD5 and stable metadata are required. Google tokens go only to fixed Google
API URLs. Neither the script nor the reader recalculates formulas or follows
external links or `IMPORTRANGE` sources.

A success JSON envelope carries metadata, actual source read time and Base64
bytes. A classified Google/read failure sends a small failure envelope instead.
There are no automatic retries or recursive error reports. Requests use HTTPS,
do not follow redirects and never log raw upstream responses, tokens or source
values. A login HTML response or redirect from Vercel is not a successful delivery.

The XLSX upload limit is **3 MiB**. Base64 expansion plus JSON remains below
Vercel's 4.5 MB Function body limit; the receiver caps JSON at 4,300,000 bytes.
The separate offline reader's 8 MiB limit does not enlarge the upload limit.
An oversized source fails closed; do not add chunking/staging without review.

## Receiver and retained contracts

The receiver requires `VERCEL_ENV=production`, exact mode `observe`, POST, JSON,
no query parameters and a matching Bearer ingest secret. It validates the fixed
file/account binding and a canonical source read timestamp no more than ten
minutes before receipt and never in the future. The engine also rejects readings
older than its latest successful snapshot. Receipt time does not replace source
read time. Invalid authentication/envelopes are rejected before Blob access.

After acquiring the existing lease, source bytes must have canonical Base64,
valid metadata, matching size/MD5 and valid cached `Precios` values. Authenticated
source-content failures record a failed attempt while preserving the last valid
baseline. Failure envelopes do not invent an empty successful table.

The mapping remains A=SKU, B=source text, C=ARS retail list price before supplier
discount with VAT already included, D=stock, E=category. No discount, margin,
currency conversion or extra VAT is applied. Decimal, negative, zero and missing
stock remain distinct. Identities duplicated in either observation are excluded
from commercial deltas; no arbitrary duplicate is selected.

The existing private object `instaler-observation/state.json` retains two
successful tables, fourteen received attempts and the latest meaningful
difference. Conditional ETag writes and a 180-second lease prevent stale or
concurrent overwrites. A recorded attempt, including failure, blocks another
processing attempt that UTC date. Sender guards prevent repeat downloads;
receiver guards prevent repeat processing. An abandoned lease can expire without
discarding the baseline. The version-1 state and historical failure codes remain
compatible and bound to one file/account.

## Configuration after review

Keep all values outside Git, browser code, chat and `VITE_` variables. Configure
Production only. The repository contains no usable secrets or source IDs.

| Vercel variable | Purpose |
| --- | --- |
| `INSTALER_OBSERVATION_MODE` | Missing/`disabled`, or exactly `observe` after approval |
| `INSTALER_OBSERVATION_INGEST_SECRET` | Shared random secret: 32-256 ASCII letters, digits, `_` or `-` |
| `INSTALER_GOOGLE_EXPECTED_EMAIL` | Workshop account with existing access |
| `INSTALER_DRIVE_FILE_ID` | Reviewed existing XLSX ID |
| `INSTALER_OBSERVATION_BLOB_READ_WRITE_TOKEN` | Explicit token for private observation storage |

The observation token has no fallback to the catalogue token. It may target the
same private store after review; its adapter only accesses the fixed observation
path and rejects collision with `CATALOG_BLOB_URL`. Keep the active catalogue URL
and access settings unchanged.

| Apps Script script property | Purpose |
| --- | --- |
| `INSTALER_OBSERVATION_MODE` | Missing/`disabled`, or exactly `observe` after approval |
| `INSTALER_OBSERVATION_URL` | Exactly `https://ls-cotizador.vercel.app/api/instaler-observation` |
| `INSTALER_GOOGLE_EXPECTED_EMAIL` | Same workshop account as Vercel |
| `INSTALER_DRIVE_FILE_ID` | Same XLSX ID as Vercel |
| `INSTALER_OBSERVATION_INGEST_SECRET` | Same receiver secret as Vercel |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | Dedicated bypass from this Vercel project's protection settings |

The sender maintains `INSTALER_LAST_ATTEMPT_UTC` itself. Do not clear it or reset
Blob state just to force another supplier request. A changed destination or source
requires review; the exact receiver URL allowlist prevents sending credentials to
an arbitrary configured host.

Keep Vercel Authentication for All Deployments. Its automation bypass is
project-wide, not route-scoped; protect it accordingly. The receiver additionally
requires its separate ingest secret. A generic secret or old `CRON_SECRET` does
not itself pass deployment protection. No public API exception is needed. Actual
protected delivery still requires live acceptance after an authorized deployment.

## Setup and acceptance procedure

The checkpoint above records the configured environment. The steps below are a
reference for controlled setup or recovery; reuse its existing project and trigger
instead of creating duplicates. Local checks do not execute these external steps.

1. Review the diff and checks, then authorize deployment and external setup.
   Check Git-triggered deployment behavior before any push to `main`.
2. In the workshop account create a private standalone Apps Script. Copy the
   reviewed `.gs` and manifest, keeping its **default** Google Cloud project.
   Save the complete manifest, including `dependencies.enabledAdvancedServices`;
   this enables Drive API in that default project. Do not link the previous custom
   Testing project or deploy a public web app.
3. Configure both sides disabled, private Blob, ingest secret and dedicated
   Vercel automation bypass. The workshop authorizes read-only Drive and outbound
   HTTP. A Google unverified-app warning can appear for this own-use script;
   review the exact scopes/account. No supplier sharing request is needed.
4. After approval and deployment, enable both sides and run one deliberate
   observation. Confirm a private baseline, observation-only JSON response and
   protection against unauthorized requests. Catalogue and quotes stay unchanged.
5. Create **one time-driven trigger** for `observeInstalerDaily`, daily in the
   08:00-09:00 Buenos Aires window. It runs as its creator, the workshop account.
   No Vercel cron or second trigger. Google execution time is approximate.
6. Review later natural price and stock changes separately without first opening
   the Excel. Use existing Apps Script executions, aggregate Vercel logs and
   authenticated private Blob access; no custom dashboard/public snapshot is needed.

Google can require reauthorization after revocation or permission/policy changes.
The script does not reuse the Desktop client's Testing grant or promise perpetual
authorization. Failures before sending, network delivery and Vercel protection
failures may exist only in Apps Script's execution history. Blob history covers
received authenticated processing attempts; silence does not prove Google ran or
the source was unchanged. Source errors are reported when delivery is available.

Use a bounded initial observation window with a planned review. No detected change
is inconclusive without a known source change. `supplierFreshnessEstablished`
always remains `false`: a successful download, Drive modification time or checksum
does not establish formula refresh, every field's freshness or a commercial stock
date. Actual changes received without an open workshop browser are needed evidence.

Catalogue publication is implemented separately with private correspondences,
explicit blocked absent entries, conditional writes, recovery and a seven-day
reading-age limit. Its activation requires the reviewed private policy and an
existing valid catalogue; see `INSTALER-CATALOG-PUBLICATION.md`. The observation
mode itself still cannot be changed to `publish`. Kits remain deferred.

## Local verification

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

Tests execute the actual `.gs` in a mocked Node VM, mock Google/HTTP/Blob and use
synthetic XLSX data through the real Node reader, comparator and conditional
state writes. They cover disabled defaults, account/authentication failures,
failure reporting, daily guards, locks, age/order, formula caches, decimal/zero/
missing stock and preservation of the last valid evidence. Existing quotation,
catalogue and backup tests retain their established contracts. Python remains
necessary for offline reader/parity tests, not for the deployed receiver.

Local checks do not prove real Google consent, installed triggers, deployment
protection bypass, scheduled operation or supplier freshness.

## Cleanup inventory

The superseded local Desktop OAuth reader/helper and their dedicated tests,
prepared information pages and their runbook are retired by this adaptation.
The Vercel cron and client-ID/client-secret/refresh-token configuration names are
removed. Keep the offline preparer, Python parity reader, Node reader and private
reference evidence; they remain useful and do not duplicate the Google sender.

After real acceptance, review for separately authorized cleanup:

- Downloaded Desktop client JSON and any private grant JSON from the earlier
  experiment, after confirming ownership and other use.
- Any remaining old user grants, after checking ownership and other use. The
  owner reported removal of the earlier custom Testing project; the current
  script was verified to use its separate default Cloud project.
- Any old Vercel Google client/refresh-token or `CRON_SECRET` values used only by
  the replaced observer, if configured. Check shared use first.
- Disposable screenshots/test downloads, preserving original source files,
  intentional private evidence and unrelated attachments.

This repository contains no live credential, source workbook or private
observation. Keep live settings and evidence on the configured Google/Vercel
surfaces; cleanup requires its own reviewed scope.

## Official references

- [Managed Apps Script projects and consent](https://developers.google.com/apps-script/guides/cloud-platform-projects)
- [Enable Drive API through the Apps Script manifest](https://developers.google.com/apps-script/guides/services/advanced#enable_advanced_services)
- [Apps Script authorization](https://developers.google.com/apps-script/guides/services/authorization)
- [Drive download API and Apps Script example](https://developers.google.com/workspace/drive/api/guides/manage-downloads)
- [Time-driven triggers](https://developers.google.com/apps-script/guides/triggers/installable)
- [Apps Script unverified own-use authorization](https://developers.google.com/apps-script/guides/client-verification)
- [Vercel automation bypass](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation)
- [Vercel Function request limits](https://vercel.com/docs/functions/limitations)
- [Vercel Blob conditional writes](https://vercel.com/docs/vercel-blob/using-blob-sdk)
