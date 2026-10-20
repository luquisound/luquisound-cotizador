# Instaler snapshot preparation

## Implemented local boundary

The offline command now reads a supplied XLSX, prepares a partial snapshot review
and compares it with a supplied local catalogue JSON. It writes a new private
review report only. It never changes the XLSX, catalogue, browser data or remote
storage. Nothing calls it from the application or an API route. It needs Node.js
22 and Python 3.10+ with the standard library; no extra packages are installed.

From the repository root, with an existing private directory outside Git:

```sh
npm run prepare:instaler -- --xlsx ../private/source.xlsx --current-catalog ../private/catalog.json --output ../private/review.json
```

Use `--python <executable>` when Python is not available as `python` on Windows or
`python3` elsewhere. The output must be new and outside every Git worktree; existing
files are never overwritten. Standard output contains aggregate counts and the
source checksum, not names, amounts or stock quantities. The private JSON contains
commercial source evidence and must remain private. There is no publish flag.

`scripts/read-instaler-xlsx.py` resolves workbook relationships and shared/inline
strings, reads only cached values, and retains original numeric lexemes, formulas,
formula attributes and cell formats in A:L as evidence. It never evaluates formulas
or follows links/connections. Missing formula caches stay unknown. ZIP/XML/JSON
size limits, path checks, duplicate-part checks and DTD rejection bound the reader.
File size is limited to 8 MiB, a part to 16 MiB, expanded parts to 64 MiB and reader
output to 16 MiB; the complete private review is limited to 32 MiB.

`prepareInstalerSnapshot` in `src/server/instaler-snapshot.ts` is the pure preparation
step for extracted A:E values. It does not download files, read Google Sheets,
use a browser session, request access, authenticate, schedule work or publish data.

The input contains a private source document label, optional reviewed version and
SHA-256 checksum, a positive `headerRow`, `headers`, and ordered `rows`. Each row
has its original positive `row` number and a `values` array. A reviewer or future
extractor can mark `incompleteKit: true`; omission does not establish kit completeness.
Input values must be unformatted numbers or dot-decimal strings, never display
strings with currency symbols, thousands separators or locale-dependent commas.
An eventual XLSX reader should preserve raw numeric lexemes where possible so
precision loss can be detected before conversion.

The canonical headers normalize to SKU, DESCRIPCION, PRECIO, STOCK and CATEGORIA.
The reviewed supplier layout instead has Instaler in B and PRECIO, STOCK, PRODUCTO
in C:E; A1 can contain the supplier exchange rate and is never imported into a
product or quotation. The original headers are retained. Accents and letter case
are normalized for headers;
supplier/SKU identity follows the existing whitespace/case normalization. Header
drift, invalid row positions, an empty result, invalid source metadata or limits
cause an error rather than an empty successful result. Limits are 10,000 extracted
rows and the existing 2,000 unique catalogue items.

## Reviewed commercial mapping

| Column | Meaning | Preparation |
| --- | --- | --- |
| A | SKU | Preserve explicit supplier/SKU identity; never manufacture a key. |
| B | Source product text | Import no description. Mixed text requires name review, with the observed SKU only as a blocked review placeholder. |
| C | Retail list amount | ARS, VAT already included, before supplier discount. Preserve amount; do not add VAT or apply the 20% discount. |
| D | Stock | Preserve decimal sign and value. Zero and unknown remain distinct. |
| E | Category | Preserve supplied category; missing category stays empty. |

Brand, unit and sale presentation are not inferred from SKU or source text. Explicit
UNIDAD and PRESENTACION columns in F:L may supply their unchanged text; errors are
blocked and no unit conversion occurs. Other
columns, supplier exchange rates, payment terms, quantity discounts, brand tabs
and multimedia-kit sheets are outside this preparer's scope. In particular,
`Precios` alone cannot establish complete workbook coverage or kit availability.

Prices require exact safe cents accepted by the existing catalogue parser.
Negative, malformed, overly precise and unsafe amounts receive a blocking issue;
they are not rounded or converted. Decimal stock requires a finite number within
the safe magnitude bound and a normalized decimal roundtrip without truncation,
underflow or precision loss. Formula text, spreadsheet errors, nonnumeric values
and ambiguous formatted strings are blocked rather than converted into zero.

An exact `DISCONTINUADOS` marker in B with A blank blocks all following product
rows conservatively; unexpected C/D/E values also generate a review issue.
A category explicitly equal to that marker
also blocks its row. Duplicate normalized SKUs produce one blocked identity and
an issue containing every conflicting row number; no duplicate wins eligibility.
Explicitly incomplete kits remain blocked even when their observed component
stock is positive. Missing-key and other unclassified rows are reported and
cannot silently contribute an invented product.

## Names and descriptions

The supplier's B column is the only general product text column in this layout;
it is not a separate trustworthy name/description pair. The preparer always emits
`description: ""`. It never copies technical specifications into that field.
Source updates using the existing additive merge preserve manually entered details,
approved prices, currencies and IDs. The comparison excludes descriptions from
proposed differences. Authoritative replacement remains outside this flow because
its omission semantics can clear manually retained fields.

Text containing a pipe separator, an Input/Output specification sequence, or more
than the catalogue's 500-character name limit is held in `nameReviews`, with its
complete source text and row. Its item remains blocked and uses the observed SKU
as a review placeholder; it is not an approved shortened name. Ordinary complete
names within the limit remain intact. Standalone section labels are retained
separately and never turned into products.

These are review triggers, not a semantic abbreviation algorithm. Taking only the
first pipe-delimited segment can collapse different models, so no such cut is
applied. Before activation choose either explicit per-SKU approved names or a
reviewed supplier-specific mapping that preserves distinguishing model/variant
tokens. Source evidence stays complete. Longer approved names should wrap in
selection, editing, preview and PNG output rather than shrink or silently truncate.

## Review, freshness and publication

Every result has `mode: "snapshot-review"`, `scope: "precios-only"` and
`reviewRequired: true`. It contains prepared `items` and row-level `issues`, but
**no catalogue import envelope**. An issue-free result still needs source and
coverage review. This distinction prevents a partial worksheet review from being
presented as a complete publication proposal.

`compareInstalerSnapshot` compares normalized supplier/SKU identities against a
provided catalogue import document. It separates additions, matches, field changes,
provenance-only changes, conflicting identities and absent existing products.
Prices are compared as exact cents; stock zero and unknown stay distinct. An absent
product is a review finding, never a deletion proposal. Other suppliers are outside
the comparison scope. A local baseline receives its own checksum and
`verifiedLive: false`: the command does not fetch production to establish currentness.

Prepared list prices are provisional. Stock always remains `historical`, with
`checkedAt: null` and `validUntil: null`; source commercial `date` stays `null`.
Reading, downloading or reprocessing an XLSX does not prove its formulas refreshed,
its provider replaced it, its stock is current or its commercial validity date.
A Drive modification label without complete date/history does not establish a
daily supplier update contract. Cached formula values are snapshot evidence.

Being able to view an XLSX in Google's editor does not establish a native Sheets
API contract. A server-side recurring read would need a supported data route and
separately authorized persistent access. Browser cookies or tokens must never be
extracted for that purpose. This preparation grants no access and creates no
credentials, conversions, source copies or permissions.

The future publisher must first resolve full coverage, duplicate conflicts,
missing data, discontinued products, component-level kit availability, source
scope and observation policy. Preserve the previous reviewed snapshot on failed
or partial reads. Keep explicit blocked entries for discontinued/absent known
SKUs until absence semantics are reviewed: removing a product currently allows
old quotation provenance to become the availability fallback. Do not silently
retire products or refresh old validity on failure.

After source review, the intended path remains a Vercel server read, complete
candidate validation/comparison, safe publication to private Blob, and the existing
protected `/api/catalog` endpoint. Daily scheduling, concurrency, atomic publication,
rollback and access configuration are not implemented here. No commercial source
data belongs in the public repository or client bundle.

## Compatibility and verification

The shared stock parser now accepts decimal `number` values across import, API,
catalogue persistence, backups, row provenance, current quotation recovery and
the quotation library. It still rejects coerced strings, nonfinite values and
unsafe magnitudes. The low-stock threshold remains an explicitly supplied positive
integer; there is no quantity reservation, stock deduction or requested-quantity
comparison. Older integer snapshots remain valid. Older app/server versions may
reject fractional snapshots, so deploy compatible readers before any separately
authorized data publication.

Synthetic tests exercise price/stock mapping, errors, precision, duplicate keys,
discontinued rows, explicit partial kits, preservation of timestamps and input
immutability. Decimal roundtrip tests cover the existing endpoint, merge,
backup/recovery and frozen quotation library without changing selected amounts,
currencies or IDs. These tests do not verify a real provider read or production
activation. Run typecheck, lint, all tests and build before handoff.

Reader fixtures are generated synthetically in temporary directories and require
Python on the test machine. Source XLSX data, detailed review reports, screenshots
and baseline catalogues remain outside Git. The offline command has been exercised
against a local workbook and a historical local baseline; this does not validate
the provider's refresh cadence or a live Google connection.

## Official references

- [Google Sheets API concepts](https://developers.google.com/workspace/sheets/api/guides/concepts)
- [Drive file download routes](https://developers.google.com/workspace/drive/api/guides/manage-downloads)
- [Drive file conversion](https://developers.google.com/workspace/drive/api/guides/manage-uploads#import_to_google_docs_types)
