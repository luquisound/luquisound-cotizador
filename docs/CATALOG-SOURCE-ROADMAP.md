# Private source snapshots and spreadsheet roadmap

## Current boundary

The current common catalogue remains a reviewed private JSON snapshot, served by
`GET /api/catalog`. A future supplier spreadsheet reader can produce that same
format. No spreadsheet URL, account, OAuth flow, network adapter, schedule or
credential is configured by this preparation. Access to the supplier sheet is
pending. Reviewed historical snapshots can supply explicit provisional retail
list prices and historical stock through this format, without pretending the
download date is the source's commercial date or a live stock check.

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

## Active snapshot contract

`stock` is an optional private product observation, independent of sale prices:

```json
"stock": {
  "quantity": 3,
  "checkedAt": null,
  "validUntil": null,
  "observation": "historical",
  "source": {
    "document": "synthetic-private-source.xlsx",
    "sheet": "Products",
    "row": 2,
    "date": null,
    "kind": "snapshot",
    "version": "synthetic-review-1"
  }
}
```

This example is synthetic, not a promise of current availability. Quantity is a
finite number with absolute value at most `Number.MAX_SAFE_INTEGER`, or explicit
`null` for unknown. Decimal quantities are preserved. Negative values remain an anomaly
and block protected selection. Missing `stock` also means no observation.
Strings, blanks, errors and unresolved formulas must not become zero. The source
adapter must validate unformatted decimal values without truncation or precision loss.
The adapter must report ambiguous supplier conventions before mapping them.

For a current observation, `checkedAt` and `validUntil` are canonical UTC instants
with milliseconds, and `validUntil` must be later than `checkedAt`. For a historical
observation, unknown instants remain `null`; known instants must be valid and an
expiry still requires an earlier observation instant. They describe freshness;
they do not replace the source's commercial date. No default validity period is
invented. Observation provenance is mandatory and can differ from the product's
or a historical price's provenance. The old Excel's stored stock and its import
date do not create a current observation.

The pure stock helpers distinguish quantity (`unknown`, zero, negative or positive)
from age (`unknown`, future, stale, fresh or historical), using explicit time.
Historical observations never become fresh simply because they were imported.
The optional low-stock classifier requires a positive threshold from its caller;
there is no inventory or replenishment policy.

The private source may also provide `listPrice` with a known currency, at most two
decimals, explicit `retail-list-before-discount` basis, provisional flag and its
own provenance. Historical list prices require review before that field exists;
ordinary `referencePrices` do not imply approval. Selection copies a manual price
first, otherwise that reviewed list price, before the supplier's 20% discount.
No discount or cost-derived price is calculated automatically. Source `date`
remains `null` when commercial validity is unknown. Optional kind, version and
checksum identify the reviewed snapshot privately, without supplying a date.

Import, common transport, recovery and private backups preserve an observation's
values and original timestamps. A supplied snapshot replaces the previous stock
snapshot instead of accumulating history. An ordinary additive import without
stock preserves the existing observation without refreshing it. An authoritative
source replacement uses exactly the incoming optional stock; omission clears an
obsolete snapshot. Local approved prices and current quotation rows are unchanged.

## Active availability boundary

Private catalogue inspection is a secondary workflow under "Opciones" >
"Mi catalogo". Bulk review is under the same menu; neither requires a prominent
toolbar over the graphic quotation.

`fresh-positive` permits a protected product only with positive fresh stock and
a valid sale amount. `historical-positive` also permits positive historical stock
provisionally, with the same price requirement. Explicit source conflicts can
set `selectionBlock` and take precedence. Zero, negative, unknown, stale or future
observations cannot qualify. The catalogue manager retains excluded entries and
shows textual quantity, age, source date and eligibility; independent manual
concepts remain available.

The picker, bulk application and open quotation recheck current eligibility,
including time boundaries, PNG preparation, download and sharing. A row keeps
its original values and private source trace even when its latest matching
catalogue snapshot blocks delivery. Provisional rows add a generic availability
warning to the customer image; private stock quantities and source details stay
outside it. There is no blanket manual override for an exact blocked product in
bulk entry.

## Deferred live-source activation

The offline `prepare:instaler` command reads a local XLSX without evaluating
formulas, prepares unformatted `Precios` A:E values and compares them with a
provided local catalogue. It has no network adapter, credentials, schedule or
publication path. Its private output is explicitly a partial-scope review,
not an import envelope or a verified live source. Source descriptions are not
imported; combined or overlong source text requires explicit name review. See
[snapshot preparation](INSTALER-SNAPSHOT-PREPARATION.md) for its mapping, validation
and remaining access/freshness boundaries. Existing deployment configuration and
the published snapshot are unchanged by this code.

The policy and UI above do not create a Sheets connection. Before activating one:

1. Verify authorized read-only access and the selected file/ranges, source keys,
   price basis, explicit commercial date, stock conventions and completeness.
2. Agree on observation validity and refresh/error handling. Do not stamp a
   historical export as a current observation or extend expiry on a failed read.
3. Review any source replacement atomically, including discontinued or ambiguous
   keys; preserve the prior snapshot on failed, partial or conflicting reads.
4. Verify new and previously populated browsers, stock-only changes, expiry,
   blocked rows, local manual prices, private backups and source failures.
5. Separately authorize source publication, credentials and deployment. Local
   implementation and tests do not establish production activation.

This is supplier availability, not reservations, internal inventory, stock
deduction or a promise of availability at sale time. Stock and supplier provenance
remain private and never appear in customer-facing quotation images.

## Official references

- [Google Sheets authorization scopes](https://developers.google.com/workspace/sheets/api/scopes)
- [Google Sheets value reads](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/get)
- [Service account identity](https://cloud.google.com/iam/docs/service-account-overview)
