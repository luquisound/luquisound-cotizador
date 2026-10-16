# Private catalogue import contract

The application imports a privately supplied JSON document into the personal
browser catalogue. The JSON file, extracted source material, and commercial data
must remain outside the public repository and client bundle. This document uses
synthetic examples only. No network request or price lookup is part of import.

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

`source` may be omitted when provenance is unavailable. If supplied, it requires
a nonempty document name and an explicit `date`: a valid month in `YYYY-MM`
form, a valid calendar date in `YYYY-MM-DD` form, or `null` when unknown. Optional
`page` and `row` are positive integers no greater than 1000000. Optional `sheet`
identifies a spreadsheet tab.
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
an empty editable `unitPrice`; their current-price currency placeholder is ARS.
Reference currencies remain independent. Import never copies cost, list, or
historical sale values into a quotation sale price, calculates margins, rounds
supplier prices, or changes existing quotation snapshots.

## Validation and limits

`parseCatalogImport(text)` validates an unknown JSON value and returns only known
fields. UTF-8 BOM is accepted. Malformed input produces a safe Spanish error
without echoing document content or private paths. Unsupported format/version,
invalid dates, invalid currencies, nonhistorical prices, and malformed fields
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
| referencePrices | 50 per item, including retained history |

These bounds align with catalogue and row limits. Before saving the resulting
workspace, the integration must also run the workspace serializer: the complete
workspace, including all quotations, still has a separate 5 MiB limit and
globally unique identities. Failure must leave the current workspace unchanged.

## Preview, matching and confirmation

`buildCatalogImportPreview(existing, document)` returns additions, proposed
updates, unchanged entries, conflicts, a summary, and a baseline snapshot.
The UI must show this preview and obtain confirmation before applying changes.
`summary` contains `received`, `additions`, `updates`, `unchanged`, `conflicts`,
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
reimports are idempotent. Existing entries absent from the file are preserved.

The baseline snapshot rejects application if the catalogue changed after its
preview opened. Application enforces the combined item and byte limits before
returning a result. It does not mutate the input catalogue, previews, quotations,
or browser storage. New IDs are generated locally, never accepted from the file.

## Integration and search

`CatalogEntry` extends the existing catalogue type with optional supplier, SKU,
brand, category, unit, presentation, source, and reference price metadata. The
workspace model and persistence whitelist must preserve and validate these
fields; earlier version-1 backups without them must continue to load. Catalogue
import merges only catalogue data. Workspace-backup import remains a separate,
explicit replacement operation.

`queryCatalog(items, query)` searches supplier, SKU, brand, name, description,
and category. It ignores case and accent marks; all whitespace-separated query
terms must match. It preserves catalogue order and does not sort or mutate the
input. The UI should show an appropriately bounded set of results and allow
manual or blank fields without requiring a product selection.
