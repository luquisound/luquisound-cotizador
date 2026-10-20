# Private catalogue import contract

The application imports a privately supplied JSON document into the personal
browser catalogue. The JSON file, extracted source material, and commercial data
must remain outside the public repository and client bundle. This document uses
synthetic examples only. No network request or price lookup is part of import.

Manual file import is available inside "Opciones" > "Mi catalogo"; it does not
add a prominent control to the quotation's initial view.
This document describes manual file import. The same schema also supplies the
automatic common catalogue through a protected endpoint. That service requires
complete, unique supplier and SKU keys and applies common updates automatically
while preserving local sale prices. See [shared catalogue setup](SHARED-CATALOG.md).
This `luquisound.catalog` source format is distinct from lossless catalogue
backups in the existing Workspace v1 envelope. Source imports never supply
manually approved sale prices or persistent item IDs. An explicitly reviewed
retail list price is a separate optional field, not an inferred historical reference.

## Version 1 document

```json
{
  "format": "luquisound.catalog",
  "version": 1,
  "items": [
    {
      "supplier": "Synthetic Supplier",
      "sku": "TEST-001",
      "brand": "Example Brand",
      "name": "Example speaker",
      "description": "Synthetic description",
      "category": "Audio",
      "section": "equipment",
      "unit": "pair",
      "presentation": "Two units",
      "source": {
        "document": "synthetic-source.xlsx",
        "sheet": "Example sheet",
        "row": 12,
        "date": null
      },
      "referencePrices": [
        {
          "amount": "15.123456",
          "currency": "USD",
          "role": "list",
          "date": null,
          "historical": true
        }
      ]
    }
  ]
}
```

`name` and `section` are required. `name` must contain non-whitespace text;
`section` is exactly `equipment` or `extras`. Supplier, SKU, brand, description,
and category may be omitted and default to empty strings. Optional `unit` and
`presentation` describe factual units or packaging, without inferring quantity
or the price basis. Strings are trimmed, not converted to numbers. In particular,
SKU leading zeroes and punctuation remain intact.

Both catalogue views derive category filters from imported `category` values and
combine the selected category with text search. Labels normalize surrounding or
repeated whitespace and keys ignore case; stored metadata is preserved. Empty or
missing categories have a separate "Sin clasificar" option. "Todas" shows every
available category. These controls never require a catalogue choice for manual
quotation concepts and do not introduce a hardcoded commercial taxonomy.

A catalogue item's `section` is a suggestion for ordering choices. Products can
be chosen in either quotation section; choosing a cable or accessory preserves
the row's selected section. Each row has its own editable ARS or USD currency;
selecting an approved price copies its amount and currency together, including
an explicit zero. Unrestricted manual entries may be selected with a pending
price; protected source entries require both an eligible price and stock.

`source` may be omitted when provenance is unavailable. If supplied, it requires
a nonempty document name and an explicit `date`: a valid month in `YYYY-MM`
form, a valid calendar date in `YYYY-MM-DD` form, or `null` when unknown. Optional
`page` and `row` are positive integers no greater than 1000000. Optional `sheet`
identifies a spreadsheet tab. Optional `kind` is `snapshot` or `sheets`; `version`
is a nonempty string of up to 200 characters; `checksum` is a lowercase 64-digit
SHA-256 string. These fields record provenance only, not freshness or approval.
A file creation, extraction, or import date is never substituted for commercial
validity. Month-only precision remains literal; no day is invented for display or
storage. Provenance stays separate from the customer-visible description.
The item source describes its current imported product record. Each price
reference can also carry its own optional `source`, using the same source schema.
When a new import reference has no source of its own, the parser copies the
explicit source of that imported item, if available. An explicit reference source
takes precedence. Without either source, provenance remains unknown; existing
historical references are never retroactively attributed to the current item.
The UI must use the reference's own source when showing price provenance.

`referencePrices` defaults to an empty array. Each reference requires:

- `amount`: `null` for a missing value, or a nonnegative decimal string using a
  dot, no grouping, no exponent, at most 18 integer and 6 fractional digits.
  Zero is explicit (`"0"`); an empty string is invalid.
- `currency`: `ARS`, `USD`, or `null` if the source does not identify it.
- `role`: `cost`, `list`, `sale`, or `unknown`, preserving what the source states.
- `date`: a valid `YYYY-MM` month, `YYYY-MM-DD` calendar date, or explicit `null`.
- `historical`: exactly `true`, including any historical sale price.

An optional reference-level `source` is accepted without changing version 1.
Files with only item-level source remain compatible and are normalized as above.

No reference is an approved current price. New catalogue entries always receive
an empty editable `unitPrice`; their manual-price currency placeholder is ARS.
Reference currencies remain independent. Import never copies cost, list, or
historical sale reference values into a quotation sale price, calculates margins, rounds
supplier prices, or changes the current quotation's row values.

When selecting an entry without an approved price, a single explicit ARS or USD
currency across its source references supplies the row's currency default. If
references have no explicit currency or conflict, use the catalogue entry's
currency instead. This default never copies or approves a historical amount.
An eligible list/sale reference with a known currency and at most two decimals
requires explicit confirmation before copying its amount and currency together
into an editable row. Cost and unknown-role references cannot supply a price.

## Explicit reviewed list price

A reviewed private source may add `listPrice` without changing version 1:

```json
"listPrice": {
  "amount": "125.50",
  "currency": "USD",
  "basis": "retail-list-before-discount",
  "provisional": true,
  "source": {
    "document": "synthetic-reviewed-source.xlsx",
    "date": null,
    "kind": "snapshot",
    "version": "synthetic-review-1"
  }
}
```

This example is synthetic. The amount is a nonnegative dot-decimal string with
at most two decimals, a known ARS or USD currency, the exact basis above, a boolean
provisional flag and required source. An amount must fit the application's safe
money range. Missing currency, cost, supplier discount and unreviewed historical
references do not infer this field. Commercial dates remain explicit or `null`.

Selection uses a valid nonempty manual `unitPrice` first, including zero; otherwise
it copies the reviewed list amount and currency together. A provisional list is
labelled historical and remains a price before supplier discount. It is not a
verified current price; no automatic 20% deduction, margin or source rounding is
applied. List metadata is preserved separately from local manual prices during
merges, scoped replacement, recovery and private backups. Current quotation row
values never refresh from a catalogue price change.

## Optional stock observations

An item may include `stock` without changing schema version 1. It contains
`quantity` (a finite number with absolute value at most `Number.MAX_SAFE_INTEGER`,
including decimals, or explicit `null`), observation timestamps and its own
required `source` using the same provenance schema. Negative values are preserved
as a source anomaly and cannot qualify for selection. For current observations,
`checkedAt` and `validUntil` are canonical UTC millisecond timestamps, with a
positive validity interval. Optional `observation` can explicitly be `current`.
For `observation: "historical"`, either timestamp may be `null`; known timestamps
remain literal and a known expiry requires an earlier known observation date.
Missing
stock does not mean zero, and imports never infer availability from price,
historical Excel columns, file dates or import time.

Stock-only changes participate in matching and updates. A supplied observation
replaces the previous observation; an ordinary additive update with stock omitted
preserves the prior observation without extending its validity. An explicit
authoritative source replacement uses the incoming optional stock exactly, so
omission clears old stock. Copies and backups preserve nested provenance and
timestamps. Stock does not alter approved prices or current quotation row amounts.

The active classifier distinguishes quantity from age. No observation, unknown
quantity, negative quantity, zero, stale or future observations are not eligible
under a protected availability policy. A positive `historical` record is not a
fresh observation even if it was imported today.

## Selection policy and private row trace

Optional `availabilityPolicy` is `fresh-positive` or `historical-positive`.
The former requires positive fresh stock; the latter also permits positive
historical stock provisionally. Both require a valid manual or reviewed list
price. An optional nonempty `selectionBlock` of up to 500 characters always
prevents selection, including when stock and price would otherwise qualify.
Existing protected legacy entries keep the compatibility policy enforced in
`getCatalogAvailabilityPolicy`; omitting a field is not a stock bypass.

Entries without a policy remain independent manual concepts and may have a
pending price. Blocked source entries remain inspectable through the catalogue
manager's "Mostrar no habilitados" control;
they cannot become exact-match manual overrides during bulk entry. The UI shows
stock quantity, age, source commercial date and textual eligibility, never using
color alone. Timers recheck stock boundaries while the app is open. Selection,
bulk application, PNG preparation and delivery revalidate availability.

`rowFromCatalog` snapshots item identity, supplier/SKU, source, list price, stock,
policy, original amount and currency, and `priceBasis` (`manual`, `list`,
`provisional-list` or `pending`) into private row `provenance`. Edits retain this
trace and distinguish a manual price/currency/included-state override. A matching
current catalogue can update availability checks without changing row amounts.
An ineligible row is preserved but blocks final image delivery. Historical usage
adds a generic availability-to-confirm line to the PNG, with no source details,
SKU or stock quantity. See [source boundaries](CATALOG-SOURCE-ROADMAP.md).

## Validation and limits

`parseCatalogImport(text)` validates an unknown JSON value and returns only known
fields. UTF-8 BOM is accepted. Malformed input produces a safe Spanish error
without echoing document content or private paths. Unsupported format/version,
invalid dates, invalid currencies, nonhistorical reference prices, and malformed fields
are rejected rather than coerced.

| Field | Maximum length/count |
| --- | --- |
| UTF-8 document | 5 MiB |
| Imported items / resulting catalogue | 2000 |
| name | 500 characters |
| description | 2000 characters |
| supplier, brand, category, unit, presentation | 200 characters each |
| sku | 128 characters |
| source.document | 500 characters |
| source.sheet | 128 characters |
| source.version | 200 characters |
| source.checksum | Exactly 64 lowercase hexadecimal characters |
| selectionBlock | 500 characters |
| referencePrices | 50 per item, including retained history |
| replaceSourceDocuments | 1-50 unique document names, up to 500 characters each |

These bounds align with catalogue limits. Before saving the resulting catalogue,
the integration must also validate its Workspace v1 envelope with empty
`quotations` and a null `activeQuotationId`: it has a separate 5 MiB limit and
unique catalogue identities. Failure must leave the current catalogue and
quotation unchanged. The quotation recovery snapshot is stored separately.

## Preview, matching and confirmation

`buildCatalogImportPreview(existing, document)` returns additions, proposed
updates, removals, unchanged entries, conflicts, a summary, a `replacesSources`
flag, and a baseline snapshot.
The UI must show this preview and obtain confirmation before applying changes.
`summary` contains `received`, `additions`, `updates`, `removals`, `unchanged`, `conflicts`,
`duplicateRows`, and `withoutKey`. Conflict `itemIndexes` are zero-based indexes
in the original input; conflicts are counted as groups, not individual rows.

Matching requires both supplier and SKU. Key normalization trims and collapses
whitespace and ignores case; it preserves accents, punctuation, and leading
zeroes. Product names are never identity keys. Therefore two suppliers can use
the same SKU, and two different SKUs can share a name without being merged.

Exact repeated records in one file are counted once. The same normalized key
with different incoming data is a conflict; an already duplicated existing key
is also a conflict. Neither chooses an arbitrary winner. Conflicted records are
skipped; other unambiguous records can still be imported after review.

Without a complete supplier/SKU key, records are only added; they never update
an existing name match. Reimporting such records can add duplicates, so the UI
must display the `withoutKey` warning before confirmation. Exact repeats inside
the same file are still collapsed. A names-only catalogue is supported without
pretending the names prove product identity.

`applyCatalogImport(existing, preview, { allowUpdates })` returns a new catalogue.
With `allowUpdates: false`, it adds new records and leaves proposed updates
untouched. With explicit update approval, it updates descriptions and metadata
while preserving each existing ID, approved `unitPrice`, and current-price
currency. Empty or omitted optional descriptions, brand, category, unit, and
presentation do not erase known values; use manual editing to clear those fields.
Nonempty imported values can update them after confirmation. Historical
references are accumulated without exact duplicates, including source in their
identity. Equal prices from different documents retain separate references and
their original provenance;
missing new provenance does not erase known provenance. Exceeding the reference
limit becomes a conflict, never silent history truncation. Identical keyed
reimports are idempotent. Without an explicit source replacement manifest,
existing entries absent from the file are preserved.

The baseline snapshot rejects application if the catalogue changed after its
preview opened. Application enforces the combined item and byte limits before
returning a result. It does not mutate the input catalogue, previews, quotations,
or browser storage. New IDs are generated locally, never accepted from the file.

## Explicit source replacement

A reviewed private document may include an optional `replaceSourceDocuments`
array to replace a known set of imported sources instead of only accumulating
their entries and historical references:

```json
"replaceSourceDocuments": ["synthetic-previous.pdf", "synthetic-current.xlsx"]
```

The array must contain 1-50 unique, nonempty strings of at most 500 characters.
Names are trimmed, then compared exactly against the existing entry's primary
`source.document`; matching is case-sensitive and does not use prefixes, supplier
names, paths, or reference-level provenance. List every known previous source
name that should be replaced, including aliases and the current source name if
that source is revised in place. Keep this manifest private alongside the data.

In this mode every incoming item requires primary source provenance and a
complete supplier/SKU key. Existing entries within the source scope are removed
only when their normalized key is absent from the incoming items. Retained
in-scope entries receive the incoming metadata and historical references as an
authoritative replacement, including empty optional metadata. Their local ID,
approved sale price (including zero or a pending price), and approved-price
currency remain intact. Historical references from superseded sources are not
accumulated for those entries. Entries outside the scope keep the normal additive
update rules. Source-less manual entries and unrelated primary sources are never
removed by the manifest; the current quotation and legacy storage remain unchanged.

An explicitly empty `items` array can retire all unambiguous keyed entries of the
listed sources. An empty or malformed manifest is rejected. In-scope existing
entries without complete keys or with ambiguous duplicate keys block replacement.
Incoming conflicts also block the entire operation, preserving the previous
catalogue. Unlike a normal additive import, replacement cannot skip conflicts or
apply additions only: `applyCatalogImport` requires `allowUpdates: true` and a
conflict-free preview. The import UI displays removals and confirms the complete
replacement together. Item and byte limits are checked after the scoped removals.

The same manifest is used by manual imports and the automatic common catalogue.
It adds no persistent ownership flags or new storage keys. Unattributed old entries
cannot safely be classified as imported and remain outside the removal scope.

## Integration and search

`CatalogEntry` extends the existing catalogue type with optional supplier, SKU,
brand, category, unit, presentation, source, references, reviewed list price,
stock and selection policy metadata. The
model and persistence whitelist must preserve and validate these fields; earlier
version-1 backups without them remain compatible catalogue sources. Source import
merges only catalogue data. Catalogue-backup import is a separate confirmed
replacement operation that preserves approved prices, IDs, currencies, and
provenance from the backup. It accepts the Workspace v1 envelope; compatible old
full-workspace backups contribute only their catalogue and never restore quotations.
New backups contain
`quotations: []` and `activeQuotationId: null`. Neither path changes the current
quotation or rewrites or deletes the legacy `luquisound.workspace.v1` storage key.

`queryCatalog(items, query)` searches supplier, SKU, brand, name, description,
and category. It ignores case and accent marks; all whitespace-separated query
terms must match. It preserves catalogue order and does not sort or mutate the
input. `queryCatalogRanked` adds stable exact-SKU priority for picker searches.
`resolveCatalogQuery` prefers exact SKU, then exact name, then text search; only
a unique eligible exact record is automatically proposed in bulk review.
Ambiguous or partial matches require a choice. The UI shows bounded results and allows
manual or blank fields without requiring a product selection.
