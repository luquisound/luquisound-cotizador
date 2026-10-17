# Luquisound Quotation App

## Objective

Provide a mobile-first, editable graphic quotation for the Luquisound workshop.
The quotation template is the primary interface: tap its title or a row to edit
it using touch-friendly controls. Lucas's target device is an iPhone; Android is
also part of hands-on acceptance.
Fixed budgets and reusable templates remain in Figma. This app edits one current
custom quotation and can explicitly save named snapshots in this browser.

## V1 scope

- Editable title, optional subtitle, and manual quotation rows. Existing notes
  remain in recovered quotations and images; the details form edits only title
  and subtitle. Exchange-rate information stays beside the totals.
- Equipment and installation/accessory sections with optional audio categories,
  multiple concepts per category, and arbitrary work.
- Private common catalogue loaded automatically on each device when configured,
  plus optional personal entries; every selected description and price remains
  editable. A field may be left blank without requiring a catalogue selection.
- Explicit quantity, unit price, ARS or USD currency per row, pending price, and
  included-without-charge state.
- Reviewed bulk addition from one code or name per line, with explicit resolution
  of ambiguous matches, repeated products, quantities and sections.
- ARS and USD totals using a rate saved with the quotation. Automatic-mode
  quotations refresh DolarAPI blue sale hourly; saved snapshots retain their rate.
- Recovery of the current quotation, a separate persistent catalogue, and an
  explicitly saved local quotation library with open and duplicate actions.
  Catalogue and quotation-library JSON backup/import are separate workflows.
- PNG image with only the graphic quotation, plus browser file sharing or download.

Without the configured common catalogue service, a new browser starts empty.
No supplier information, historical quotations,
customer details, costs, or commercial prices are published in source or bundle.
Tests use synthetic data only. Internal cost and suggested catalogue price are
not substituted for the actual sale price of a quotation.

## Graphic contract

Custom quotations use a yellow #FFDA00 header with the original multicolour
full horizontal logo, dark title and optional subtitle, and a dark
separator. Labels, empty-title hints, and keyboard focus also remain dark for
contrast. The responsive preview and PNG renderer share their palette and logo
resource through `graphic.ts`. Preserve the white body with two sections,
right-aligned amounts, totals, and dark contact footer. The approved public contact
footer is 11 7358-1958 and @luquisound.ok. Fixed quotations remain in Figma with
their existing dark headers; this app change does not modify those assets.

PNG width is 1080 pixels. Height grows with content; long descriptions wrap and
blank details do not reserve a line. Controls, pending validation, and editing
hints never appear in the image. The approved brand guide provides Pliant Bold
Expanded (700, real width axis 125%) for titles and totals, and Barlow Regular
(400) for body text. A licensed static Pliant instance at those exact axes and
the original Barlow Regular are self-hosted; this does not
identify the condensed font in older private quotation examples. PNG preparation
requires both actual faces to load and reports an error when they are unavailable.
The source quotation examples remain private and are not copied into the repo.
The displayed/exported title preserves the entered text. No decorative plus sign
is inserted; a plus sign explicitly typed as part of the title is retained.

## Optional audio categories

The two quotation sections offer the following category order, with Spanish
labels in the interface:

| Equipment | Installation and accessories |
| --- | --- |
| Amplifier / DSP | Cables and accessories |
| Additional amplifier | Connector / harness |
| Subwoofer | Rings / 3D adapters |
| Speakers or component sets | Labour |

Each category is optional and supports several independently editable concepts,
including separate front and rear speakers with their own prices and currencies.
Each section also provides a repeatable action to add a free-form concept.
Category names are editor hints, never prefilled commercial descriptions.
Unused suggestions create no quotation rows, pending prices, totals, image
content, or recoverable content. Compatible legacy blank rows also remain inert.

Opening a category or adding another concept starts a temporary draft. Applying
it adds the row; cancelling, closing, or pressing Escape discards it without
changing the quotation or invalidating a prepared image. Applying an entirely
empty new draft adds nothing. Saving a new row rechecks the 1000-row limit.
Existing rows can be edited, classified or reclassified within their section,
or changed to a free-form concept. Removing the final item from a category
restores its empty suggestion. Applied changes invalidate a prepared image.

Optional `audioCategory` metadata is saved with a row and restored on reload,
alongside its identity, amounts, currency, and price state. Rows without that
metadata remain compatible; categories are never inferred from their wording
or a catalogue selection. Unknown values or categories incompatible with the
row's section are discarded without losing the row or its other fields.
Category metadata alone is not meaningful quotation content.

The preview and PNG use the table's category order within each section, keeping
the existing relative order of items in each category. Free-form and legacy
unclassified concepts appear after categorized items, preserving their own
relative order. Validation issue numbers refer to that order of nonempty
concepts. PNG output contains only entered concepts under the existing two
section headings; category labels, empty suggestions, and controls are omitted.

Quotation categories are independent of imported catalogue categories. Product
selection preserves the chosen quotation category and follows the existing
approved-price and currency rules. No category approves a price, infers an
included-without-charge item, or converts a row's currency. Pending prices,
explicit zero, and included states retain their distinct meanings.

## Calculation contract

- Money input follows Argentine separators: 1234,56 or 1.234,56. A dot groups
  thousands; a comma marks decimals. At most two monetary decimal places.
- Quantities must be positive, without thousands separators, with at most three
  decimals. Comma or dot is accepted as the quantity decimal separator.
- Represent prices and totals as safe integer cents. Compute quantity times
  unit price using integer arithmetic, round each line half up to the nearest
  cent in its own currency, then sum complete lines separately into ARS and USD
  subtotals. Use exact BigInt/integer-rational arithmetic and reject overflow
  before returning safe integer cents.
- Each row has an explicit ARS or USD currency and preserves its entered amount
  when that currency changes. New manual rows default to ARS. The retained
  `quotation.currency` field is only a legacy default: recovered rows without
  currency inherit it, and new rows in those quotations use that default.
  New and edited rows store their currency explicitly.
- The rate states how many ARS equal one USD, using Argentine separators, a
  positive value, and up to six decimal places. An automatic-mode quotation requests DolarAPI
  blue sale through the server automatically when its saved fetch reference is
  one hour old or absent. Save the value and source timestamp together. This
  includes recovering the current quotation after reload. Poll while visible and
  online and check again on return or reconnection, independently of persistence
  errors or saving pauses. Saving a named quotation freezes its current rate;
  opening or duplicating a saved snapshot also stays frozen, including after
  recovery on reload. "Actualizar dolar guardado" requires confirmation and
  resumes automatic lookup for the open copy, without modifying its saved entry
  or row prices. Recovered
  manual rates remain valid without invented provenance until
  a successful automatic lookup replaces them. See `EXCHANGE-RATE.md`.
- Convert each currency subtotal once, rounding half up to cents:
  `totalARS = arsSubtotal + halfUp(usdSubtotal * rate)` and
  `totalUSD = usdSubtotal + halfUp(arsSubtotal / rate)`. Never convert individual
  rows or derive one total from the other. Both totals and the explicit rate appear
  in the preview and exported image. An absent, invalid, zero, or overflowing rate
  blocks image preparation; a recovered quotation remains editable without an
  invented rate.
- A blank amount is pending, not zero. An explicit zero is valid. Included without
  charge is a separate state with a zero subtotal, labelled as included.
- Completely empty rows are omitted from export. A concept with a pending price,
  a missing concept with other content, an invalid quantity or amount, a blank
  title, no nonempty rows, or numeric overflow blocks final image generation.
- Incomplete current quotations can still be recovered. No discount, tax,
  supplier rounding, automatic margin, or inferred commercial rule is implemented.

## Local persistence and privacy

The editor has one current quotation. Its recovery snapshot uses localStorage
key `luquisound.current-quotation.v1`; the persistent catalogue and approved
prices use `luquisound.catalog.v1`. Explicitly saved quotations use the separate
`luquisound.quotation-library.v1` key. These stores are independent and belong to
the current browser and origin. A read-only server endpoint supplies the private
common catalogue on startup. There is no quotation upload, analytics, or
synchronization of locally approved prices.

The header contains the brand and editable quotation details. A single discreet
"Opciones" menu contains bulk entry, "Presupuestos guardados", "Mi catalogo" and
"Nuevo presupuesto" as secondary actions. The menu starts collapsed; history and
save controls are accessed inside their workflow, not displayed on entry.
"Nuevo presupuesto" replaces only the
current quotation, confirming before content or an unreadable recovery record is
replaced. It preserves the catalogue, approved prices and legacy workspace key.
"Presupuestos guardados" lists named snapshots with their save dates, offers
explicit save, open and duplicate actions, and manages its own private backup.
There is no backend quotation history or automatic archive of every edit.
Downloading or sharing a PNG leaves the quotation open. Reusable templates and
fixed budgets are managed in Figma.

Automatic loading combines the common catalogue with the latest local state by
supplier and SKU. It updates common metadata and historical references while
preserving approved prices, currencies, identities, personal entries, and the
current quotation's row values. A private source can explicitly replace a named
document scope: imported entries absent from that replacement are retired, and
retained entries receive its authoritative metadata and references. Manual
entries without source provenance and entries outside that scope are preserved.
Source replacement never edits the current quotation. Invalid keys, conflicts,
limits, and network failures leave local data unchanged and show a retry action. A paused or
unreadable catalogue store is never overwritten by the common catalogue.
See `SHARED-CATALOG.md` for activation.

An untouched blank proposal remains in memory. Default headings, currency, and
placeholder rows and an automatically attached rate do not create recoverable
content. Partial concepts with pending prices are meaningful, and recovery keeps
the current quotation and row identities. Replacing the current quotation does
not automatically archive it; explicitly saved library entries remain intact.

When `luquisound.catalog.v1` is absent, the app may seed its catalogue from a
validated legacy `luquisound.workspace.v1`. It does not reopen old quotations.
The legacy key is never rewritten or deleted, including during import.
Invalid legacy data is not used as a catalogue source.

This is individual browser storage, not shared or access-controlled cloud storage.
Browser clearing, private mode, device loss, or origin changes can remove access.
The app does not encrypt local data. Backups can contain private business data
and must be stored privately; no backup belongs in the public repository.

Catalogue backups preserve approved prices, currencies, item IDs, metadata, and
provenance without loss. They use the existing Workspace v1 envelope with
`quotations: []` and `activeQuotationId: null`. Import replaces the catalogue
after confirmation. A compatible old full-workspace backup contributes only its
catalogue; no quotation is restored and the current quotation is unchanged. This
lossless backup path is distinct from the `luquisound.catalog` private source format,
which merges source records without importing manually approved sale amounts.

JSON validation checks schema, version, identities, dates, field lengths, and a
5 MiB limit; unknown properties are discarded. Corrupt stored data is not
overwritten automatically. An unreadable current recovery record remains intact.
Resetting an unreadable catalogue or resuming paused saving requires an explicit
user action. Save failures remain visible and isolated to their store.
Changes from another tab pause saving for
the affected store to avoid silently overwriting its work. Current recovery and
catalogue writes also compare their expected stored bytes again immediately
before writing, covering conflicts detected before a delayed storage event;
this is optimistic protection rather than a transactional cross-tab database.
Hourly automatic-mode exchange-rate updates remain active. Limits are 1000 rows
in the current quotation and 2000
catalogue entries. The legacy parser still validates up to 500 quotations in an
old backup before extracting a catalogue. The separate library importer can
extract old quotations after review, without importing that file's catalogue.
Canvas export is limited to 16 million pixels with an explicit error
rather than truncation when exceeded.

Selecting a catalogue entry copies its valid manual price first, otherwise its
explicit reviewed list price, and the corresponding currency together, including
an explicit zero. Without either price, one
unambiguous explicit currency across its source references supplies the row
default without copying any amount; missing or conflicting reference currencies
fall back to the catalogue entry's currency. Editing or removing that entry later
does not change the current quotation's row prices or currencies. A catalogue
refresh can still invalidate a protected product's availability and block image
delivery until that row is reviewed.

## Saved quotation library

Open "Opciones" > "Presupuestos guardados" to access the library. Saving is an
explicit action with a trimmed name and save date. A duplicate name
requires confirmation before replacing its entry. The library allows up to 100
entries in a 5 MiB envelope; limits reject the action instead of deleting older
records. A new archive requires a row with concept, detail, price or an explicit
included state. Partial concepts are allowed; title, subtitle, notes, rate,
quantity or category alone are insufficient. Existing compatible records remain
preserved when read or imported.

Snapshots deep-copy rows, prices, currencies, source trace and the rate. Opening
and duplicating create separate quote and row identities; subsequent edits do
not alter the saved entry. The duplicate receives a copy title and fresh creation
date. Opening either action confirms before replacing current content. Freezing
the rate does not reserve stock or bypass availability checks.

The library writes only after explicit save, import or resume actions. Each write
compares the expected stored bytes with the latest localStorage value. A concurrent
tab change pauses saving without discarding the visible version. A failed save is
not reported as persisted: its pending version stays in memory for a private
backup. A failed import preserves the preceding visible and stored library.
Unreadable initial bytes remain intact and can be downloaded exactly as a
recovery file; this download is not a validated normal backup. Explicit resume
confirms that the visible library will replace the stored version.

The library backup uses its own `luquisound.quotation-library` version-1 envelope
and includes only saved quotations, not the catalogue. A normal backup can include
pending in-memory saves. Import validates and previews names and dates before
confirmation, then replaces only the library. A compatible legacy Workspace v1
file supplies only its quotations through this workflow; meaningful records above
the 100-entry limit are rejected rather than truncated. No path changes or clears
the legacy storage key. Backups contain private prices and row provenance, require
private storage, and are not synchronization between devices.

The repository remains public even when deployment access is restricted. Never
commit supplier lists, discounts, internal costs, customers, real quotations, or
secrets. Deployment protection and access for intended users must be checked
separately; the application does not add a frontend PIN or claim one is security.

## Optional private catalogue

No catalogue data is embedded in the public application. Product selection stays
in the row editor; catalogue management is available through "Opciones" > "Mi catalogo"
and from a storage-error notice. A configured private endpoint loads the common catalogue automatically.
A private JSON file can also be imported after a summary and explicit confirmation.
The catalogue combines a category filter with SKU, brand, and name search, ranks
exact SKU matches first, and limits rendered
results for mobile use. Both the catalogue editor and quotation product picker
derive category options from their available data. "Todas" clears the filter;
missing categories appear as "Sin clasificar". No provider taxonomy or automatic
category assignment is bundled. Manual concepts remain independent. Import
matches normalized supplier and SKU, preserves approved manual prices, and does
not change the current quotation's row values. Conflicts and records without a
complete key are reported before applying changes. See `CATALOG-IMPORT.md` for
the schema.

Catalogue sections suggest the ordering of choices. Equipment and extras can
both choose a product, including cables imported as equipment; the quotation row
keeps its selected section. Selected prices retain their own currencies.

Imported products start without a manually approved sale price. Supplier cost,
unapproved historical list/sale references, missing currency, zero, and unknown
dates remain distinct.
Only an explicitly confirmed list/sale reference with a known ARS or USD currency
and at most two decimals may be copied into an editable price. Confirmation copies
the reference amount and currency together. Costs and unknown roles/currencies
require manual pricing. Provenance remains in the private
catalogue UI and backup, never in customer-facing descriptions or images.

A reviewed private source can additionally supply an explicit `listPrice`, with
known ARS or USD currency, at most two decimals, `retail-list-before-discount`
basis, provenance and a provisional flag. This is distinct from a historical
reference; it is not inferred from one. A manual catalogue amount takes precedence.
Provisional historical list prices are labelled as such, before the supplier's
20% discount, and never presented as verified current prices. No discount or
cost-to-sale conversion is applied automatically. Unknown commercial dates remain
unknown, regardless of file creation, extraction or import dates.

Catalogue selection snapshots the source document, optional kind/version/checksum,
supplier/SKU, stock, price basis, original amount and currency into private row
provenance. The row editor exposes it in a private details section and detects
manual amount, currency or included-state changes while retaining that original
trace. Source metadata never becomes customer description text. Manual changes
in the quotation do not edit the catalogue.

Optional stock snapshots and selection policies are active. `fresh-positive`
requires a positive unexpired observation; `historical-positive` also permits
positive historical stock provisionally. Both require a valid manual or reviewed
list price. Explicit selection blocks take precedence. Zero, negative, unknown,
stale or future stock cannot qualify. Entries remain visible in catalogue
management through "Mostrar no habilitados", with quantity, age, source date and
a textual eligibility reason;
independent manual concepts remain available. Historical records can have unknown
observation dates and never become fresh at import time.

The picker, bulk review and open quotation check availability again as time passes
and before image preparation or delivery. The latest matching catalogue snapshot
is authoritative for availability but never replaces a row's prices. A blocked
existing row remains editable and saved, but blocks image export. A historical
selection shows a provisional warning and adds only "Disponibilidad a confirmar."
to the customer image, without exposing stock quantities or source details.
This implements neither a Sheets connector nor stock reservations, deduction or
guaranteed availability. See `CATALOG-SOURCE-ROADMAP.md`.

## Reviewed bulk entry

"Opciones" > "Pegar codigos o nombres" accepts up to 50 nonempty lines of 500 characters each,
one product code or name per line. It does not parse pasted quantities or prices
from extra columns. A unique exact SKU is preferred to a name; a unique exact
name can also be proposed. Partial searches and ambiguous exact matches always
require a choice, even when only one eligible search candidate remains. No fuzzy
inference chooses an unseen product.

For each line choose a catalogue candidate, an independent manual concept when
allowed, or skip it. Review editable quantity and section before applying.
Repeated queries and different queries selecting the same product require an
explicit repeat confirmation. An exact blocked product cannot be reintroduced
as a manual override. A new manual concept retains a pending price.
All decisions, row limits, unchanged catalogue baseline and current availability
are checked together before adding any rows. Cancelling or failing review leaves
the current quotation unchanged.

## Image download and sharing

Complete the quotation and resolve validation and availability issues, prepare a
PNG, then choose download or share. The image is drawn deterministically from
the validated quote using Canvas, the official logo and loaded fonts; no AI image
generation rewrites text or amounts. The share
action uses an already prepared File directly from a user gesture. If file
sharing is unavailable, download is the fallback. Cancellation preserves the
prepared image without sending or downloading it. Repeated sharing remains
possible. Opening or closing a share sheet does not establish recipient delivery.
Downloading or sharing does not clear or replace the current quotation. Edits,
rate changes or invalidated availability make a prepared image unusable until
preparation succeeds again. Fonts and logo must load within bounded waits; failure
reports an error instead of exporting missing branding or fallback typography.

## Verification and remaining acceptance

Run typecheck, lint, calculation/persistence/export tests, and build. Check mobile
and desktop layouts, long text, many rows, pending/zero/included states, decimal
input, invalid values, current-quotation recovery, catalogue backups, legacy
catalogue extraction, library save/open/duplicate and frozen rates, concurrent-tab
conflicts, corrupt storage, failed saves, reviewed bulk matching, stock expiry,
manual row trace, and share cancellation.
Browser emulation is useful evidence but does not replace physical Android and
iPhone checks for PNG saving, Web Share, WhatsApp, and deployment access.

Remaining acceptance includes any separately authorized source publication and
deployment, private backup retention, live source access and freshness policy,
and physical-device checks. Local implementation does not establish activation
of external services.
Shared quotation storage, synchronized manual prices, accounts, CRM, inventory,
invoicing, AI, and automatic commercial rules remain outside V1.
Publishing requires the final authorized review; local checks
do not establish remote publication or production deployment.
