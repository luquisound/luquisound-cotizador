# Instaler catalogue publication

## Scope and schedule

The existing workshop Apps Script remains the only scheduler. Its daily
08:00-09:00 Buenos Aires trigger reads the existing XLSX once and sends the same
observation upload. The observer still accepts only `observe` and retains its
private baseline independently of publication. No new Drive read, trigger,
permission, public endpoint or infrastructure is required.

After a successful observation is committed, the receiver may invoke a separate
publisher when the server-only `INSTALER_CATALOG_MODE` is exactly `publish`.
Missing or `disabled` leaves catalogue publication off. A failed reading, busy
lease or already-attempted day never invokes the publisher. Publication errors
preserve the committed observation and return a non-success response so the
existing Apps Script reports delivery failure. There is no automatic retry.

The app loads the common catalogue on entry and checks once per daily cycle at
09:00 Buenos Aires, after the supplier-reading window. It waits while hidden or
offline; return, focus and reconnection only check whether that daily cycle is
due. A failed load consumes the cycle and preserves the previous local copy.
There is no refresh/retry button or hourly catalogue polling. DolarAPI retains
its independent exchange-rate behavior.

## Private correspondences

`instaler-catalog/policy.json` resides in the same private Blob store as the
catalogue. Its schema is `luquisound.instaler-catalog-policy`, version 1. It holds
reviewed names, exact source text, exclusions and duplicate resolutions. Never
bundle or commit that document, the supplier workbook, observation tables or
production catalogue. Tests contain synthetic examples only.

- Identity is normalized supplier plus SKU. Names, prices and worksheet positions
  never manufacture an identity. Normalization preserves punctuation and zeros.
- Name mappings require the exact original B text and SKU. A changed source text
  invalidates the mapping; no fuzzy matching or automatic abbreviation applies.
- Identical duplicates can consolidate only under the explicit policy. Reviewed
  nonidentical duplicates require the exact multiset of original B texts and
  matching C price, D stock, unit and presentation. Different categories require
  an approved category. Divergence blocks the identity without choosing a row,
  price or stock winner. There is no stock aggregation.
- Non-product exclusions require exact SKU/text evidence. Other reviewed rows
  without a SKU use an exact A:E fingerprint. Unreviewed malformed identities
  fail the candidate instead of being interpreted as product removals. The
  `DISCONTINUADOS` marker is never ignored and blocks following products.
- Complete names and explicit unit/pair/set wording are preserved. The app never
  converts a commercial pair or set into physical units. General presentation
  must remain clear in the approved product name; structured adapter variants
  retain their separate existing contract.

Only `Precios` is published. C is the ARS retail list price before supplier
discount, with VAT already included. No discount, 20% surcharge, margin,
additional VAT or supplier-dollar conversion applies. Decimal stock is retained;
zero, negative, missing and invalid observations remain distinct. Missing or
invalid supplier prices and stock cannot silently reuse previous commercial
values. Explicit zero remains a valid amount, separate from missing or included.

Known absent products remain as blocked records with their original identity,
unknown stock and historical price references. They are not deleted or assigned
stock zero. This prevents an old quotation's positive provenance from becoming
the availability fallback. Reappearance clears only the source-owned block after
the new observation and its correspondence pass validation.

## Reading age and supplier freshness

`CatalogSource.readAt` records the source reading used by the published record.
It is canonical UTC and survives catalogue backups, current recovery, provenance
and the saved quotation library. The source commercial date remains unknown and
stock remains historical with `checkedAt: null`; downloading does not prove that
supplier formulas or stock refreshed. `supplierFreshnessEstablished` stays false.

Protected stock carrying `readAt` becomes stale at seven days without a newer
successful reading; future or invalid reading dates do not qualify. Skipping one
or several daily runs does not erase the last valid catalogue. Old data without
this optional field remains readable. Independent manual concepts stay separate.
New selections and existing image-delivery guards evaluate availability without
changing any saved amount, currency or original provenance.

A later successful read updates this transport-age evidence even if prices are
unchanged. Repeating the same reading and effective candidate is a no-op. New
checksums, row shifts and Drive versions alone do not approve commercial changes.

## Candidate and local merge

`buildInstalerCatalogCandidate` builds a complete, deterministic document against
the exact active catalogue and policy. It validates the existing parser, complete
unique keys, 2,000 items and 4 MiB. Every successful observation is evaluated,
including `unchanged`: the observer's commercial deltas deliberately exclude
ambiguous duplicates and are not sufficient to decide publication.

The document explicitly declares `refreshSuppliers`. For matching entries in that
scope, stock, list price, availability policy and source block replace previous
values, including omissions. This scope never deletes absent entries. Local IDs,
approved manual prices including zero, currencies and manually retained details
are preserved. Other providers and personal entries retain their existing rules.
`replaceSourceDocuments` remains a separate legacy import contract.

No refresh writes quotation rows, selected prices, conversion anchors, the saved
rate or the quotation library. Open catalogue editors retain their draft and
conflict checks. Bulk review requires a new review if its catalogue changed.

## Conditional writes and recovery

`createInstalerCatalogStore` uses the existing catalogue URL and token; it does
not fall back to the observer's credential. Reads request `Accept-Encoding:
identity`, bypass caches and validate strong ETag, byte length, UTF-8 and JSON.
The active object must already exist and be a fully valid catalogue.

Before publication, the exact previous bytes are archived privately under
`instaler-catalog/versions/<sha256>.json`, without overwrite. A stable private
`instaler-catalog/last-valid.json` backup is updated with conditional writes and
checks against the active version. The active candidate uses a single `ifMatch`
write. A conflict never triggers an unconditional retry. The publisher checks
the resulting bytes; an ambiguous write response is verified before any further
action. A policy change during preparation aborts the publication.

In publish mode, `/api/catalog` can serve the stable last-valid backup if the
active read or validation fails. Both paths use the same full validation and
limits. Recovered protected products are explicitly blocked, so an older positive
stock cannot undo a later zero, absence or conflict. The browser rejects older
Instaler readings after it has seen a newer one. Failure of both returns a
generic error and preserves browser data.
Deployment protection remains required for every route and deployment.

`restoreInstalerCatalog` restores reviewed backup bytes only with the ETag of the
active version the operator inspected. It archives the current version first.
Restoration cannot overwrite a later publication. Restoration is an explicit
operation, never an automatic replay of stale prices.
For an invalid active JSON document, explicit recovery inspects its transport
ETag and preserves its bytes in a private immutable quarantine before the CAS.
Missing objects or invalid transport still fail closed; no empty catalogue is
manufactured.

## Activation and acceptance

1. Validate the private policy and a candidate against the actual existing
   observation and active catalogue. Save review evidence privately. Do not force
   another Drive read or clear either daily guard.
2. Deploy compatible readers and publisher code to the existing protected
   project. Keep the observation in `observe`; upload the reviewed private policy
   and enable the separate publication setting only within the approved scope.
3. A controlled first publication may consume the already stored validated
   baseline through `publishInstalerCatalog`; no new supplier download is needed.
   Preserve the exact active backup and verify the readback and protected API.
4. Verify the next naturally scheduled cycle independently. Do not equate an
   implemented daily path with evidence that Google's trigger ran or that the
   supplier updated its source. The planned October 23 review remains separate.
5. Run typecheck, lint, all tests and build. Browser-check mobile and desktop,
   absence of refresh buttons, manual-price preservation, seven-day expiry,
   frozen quotations and unavailable-service behavior. Emulator results do not
   establish physical iPhone or Android sharing acceptance.
