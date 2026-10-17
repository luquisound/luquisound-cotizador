# Private spreadsheet source preparation

## Current boundary

The current common catalogue remains a reviewed private JSON snapshot, served by
`GET /api/catalog`. A future supplier spreadsheet reader can produce that same
format. No spreadsheet URL, account, OAuth flow, network adapter, schedule or
credential is configured by this preparation. Access to the supplier sheet is
pending; the existing Excel and private catalogue remain the working source.

Business account details, the private sheet URL and the selected source checksum
belong in the external project library, never in this public repository or client
bundle. Do not discover or follow private links embedded in exported formulas.

## Future read path

The proposed path is a server-side, read-only spreadsheet adapter, followed by
validation and review of a complete private catalogue snapshot. Publishing that
snapshot reuses the existing private storage and protected same-origin endpoint.
The browser does not request Google Sheets directly. Supplier access does not
introduce application accounts or quotation synchronization.

Confirm the designated workshop identity can read the intended spreadsheet before
configuring an integration. The authentication choice remains open: a workshop
OAuth authorization and a separately shared service identity are different access
paths. Access granted to a person's Google account does not automatically grant a
service account access. Do not reuse another person's session or credentials.
For the OAuth path, evaluate the Sheets read-only scope; its scope applies at
spreadsheet level, not to one tab. Restrict the adapter to the explicitly selected
file and bounded ranges regardless of the granted scope.

After access is available, first compare a read-only sample with the approved
snapshot and confirm headers, formulas, units and duplicate-key handling. Sheets
API value reads can request calculated unformatted values. Do not assume the
local export's sheet layout is the remote contract. Match supplier and SKU rather
than fixed row positions, and retain the observed sheet/row as provenance.

Authentication errors, rate limits, malformed data and incomplete reads must not
publish an empty catalogue or remove products. Keep the last reviewed snapshot;
do not synthesize zero stock or extend an old observation's validity on failure.
Refresh cadence, retry policy and atomic publication are implementation decisions
for the activation task. No new periodic job is part of this preparation.

## Prepared stock contract

`stock` is an optional private product observation, independent of sale prices:

```json
"stock": {
  "quantity": 0,
  "checkedAt": "2026-10-17T10:00:00.000Z",
  "validUntil": "2026-10-17T10:15:00.000Z",
  "source": {
    "document": "Synthetic private supplier sheet",
    "sheet": "Products",
    "row": 2,
    "date": null
  }
}
```

The example interval is synthetic, not a chosen refresh cadence or production
TTL. Quantity is a nonnegative safe integer or explicit `null` for unknown.
Missing `stock` also means no observation. Strings, blanks, errors, negative
numbers, fractions and unresolved formulas must not be coerced into zero.
The adapter must report ambiguous supplier conventions before mapping them.

`checkedAt` and `validUntil` are canonical UTC instants with milliseconds, and
`validUntil` must be later than `checkedAt`. They describe observation freshness;
they do not replace the source's commercial date. No default validity period is
invented. Observation provenance is mandatory and can differ from the product's
or a historical price's provenance. The old Excel's stored stock and its import
date do not create a current observation.

The pure `classifyCatalogStock` helper distinguishes `unknown`, `stale`,
`out-of-stock`, `low` and `available`, using an explicit current time. Only a
currently valid explicit zero is `out-of-stock`. Future-dated observations are
unknown; expired observations are stale, including expired zeros. A positive
low-stock threshold must be supplied by the caller; no threshold is selected.

Import, common transport, recovery and private backups preserve an observation's
values and original timestamps. A supplied snapshot replaces the previous stock
snapshot instead of accumulating history. An ordinary additive import without
stock preserves the existing observation without refreshing it. An authoritative
source replacement uses exactly the incoming optional stock; omission clears an
obsolete snapshot. Local approved prices and current quotation rows are unchanged.

## Deferred activation

Stock classification is currently disconnected from the product picker and UI.
This preparation does not hide products, show availability colors or import stock
from the approved Excel. Once the remote source is validated, activation must:

1. Exclude currently verified zero stock from catalogue choices for new rows.
   Keep the product available for private catalogue management and preserve rows
   already copied into a quotation. Manual products and arbitrary work remain.
2. Define and implement the validity period and expiry updates while a picker
   stays open; a cached zero must not hide a product indefinitely after expiry.
3. Agree on the low-stock threshold and a subtle indicator with readable text;
   color alone must not carry the meaning. Positive stock otherwise behaves
   normally. Decide how unknown and stale availability are presented.
4. Validate changed, missing, duplicated and discontinued supplier keys; retain
   the existing quarantine for unresolved product configurations.
5. Verify fresh and previously populated browsers, stock-only updates, backup
   recovery, remote failures and current-quotation/manual-price preservation.

This is supplier availability, not reservations, internal inventory, stock
deduction or a promise of availability at sale time. Stock and supplier provenance
remain private and never appear in customer-facing quotation images.

## Official references

- [Google Sheets authorization scopes](https://developers.google.com/workspace/sheets/api/scopes)
- [Google Sheets value reads](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/get)
- [Service account identity](https://cloud.google.com/iam/docs/service-account-overview)
