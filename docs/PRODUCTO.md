# Luquisound Quotation App

## Objective

Provide a mobile-first, editable graphic quotation for the Luquisound workshop.
The quotation template is the primary interface: tap its title or a row to edit
it using touch-friendly controls. Lucas's target device is an iPhone; Android is
also part of hands-on acceptance.
Fixed budgets and reusable templates remain in Figma. This app creates one
current custom quotation, rather than managing a quotation archive.

## V1 scope

- Editable title, optional subtitle, notes, and manual quotation rows.
- Equipment and installation/accessory sections, including arbitrary work.
- Private common catalogue loaded automatically on each device when configured,
  plus optional personal entries; every selected description and price remains
  editable. A field may be left blank without requiring a catalogue selection.
- Explicit quantity, unit price, pending price, and included-without-charge state.
- Automatic ARS and USD totals using a rate saved with the current quotation,
  with hourly DolarAPI blue sale refresh, including after recovery on reload.
- Recovery of the current quotation only, with a separate persistent catalogue
  and private catalogue JSON backup/import. No history, duplicate, or delete UI.
- PNG image with only the graphic quotation, plus browser file sharing or download.

Without the configured common catalogue service, a new browser starts empty.
No supplier information, historical quotations,
customer details, costs, or commercial prices are published in source or bundle.
Tests use synthetic data only. Internal cost and suggested catalogue price are
not substituted for the actual sale price of a quotation.

## Graphic contract

Preserve the approved composition: dark header with the official full horizontal
logo, a single title area with yellow accent, optional subtitle, white body with
two sections, right-aligned amounts, total, and dark contact footer. Use the
official yellow #FFDA00. The approved public contact footer is 11 7358-1958 and
@luquisound.ok.

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

## Calculation contract

- Money input follows Argentine separators: 1234,56 or 1.234,56. A dot groups
  thousands; a comma marks decimals. At most two monetary decimal places.
- Quantities must be positive, without thousands separators, with at most three
  decimals. Comma or dot is accepted as the quantity decimal separator.
- Represent prices and totals as safe integer cents. Compute quantity times
  unit price using integer arithmetic, round each line half up to the nearest
  cent, then sum the rounded complete lines.
- One explicit currency applies to every row of a quotation. Changing that base
  currency requires confirmation and preserves the entered row values.
- The rate states how many ARS equal one USD, using Argentine separators, a
  positive value, and up to six decimal places. The open quotation requests DolarAPI
  blue sale through the server automatically when its saved fetch reference is
  one hour old or absent. Save the value and source timestamp together. This
  includes recovering the current quotation after reload. Poll while visible and
  online and check again on return or reconnection, independently of persistence
  errors or saving pauses. No manual refresh control is provided. Recovered
  manual rates remain valid without invented provenance until
  a successful automatic lookup replaces them. See `EXCHANGE-RATE.md`.
- Sum the rounded base lines first. Convert that final total once using exact
  integer/rational arithmetic, rounding the equivalent half up to cents. Preserve
  the base total exactly. Both ARS and USD totals and the explicit rate appear in
  the preview and exported image. An absent, invalid, zero, or overflowing rate
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
prices use `luquisound.catalog.v1`. These stores are independent and belong to
the current browser and origin. A read-only server endpoint supplies the private
common catalogue on startup. There is no quotation upload, analytics, or
synchronization of locally approved prices.

"Nuevo" replaces the current quotation, asking for confirmation when it has
meaningful content. It never clears the catalogue. There is no quotation history,
selector, duplicate, delete, or quotation-backup workflow, and no saved-status
label in the main interface. Downloading or sharing a PNG leaves the quotation
open. Reusable templates and fixed budgets are managed in Figma.

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
the current quotation and row identities. No earlier quotation is retained when
the current one is replaced.

When `luquisound.catalog.v1` is absent, the app may seed its catalogue from a
validated legacy `luquisound.workspace.v1`. It does not reopen old quotations.
The legacy key is never rewritten or deleted, including on "Nuevo" or import.
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
which merges product references without approving commercial prices.

JSON validation checks schema, version, identities, dates, field lengths, and a
5 MiB limit; unknown properties are discarded. Corrupt stored data is not
overwritten automatically. An unreadable current recovery record remains until
the user confirms its replacement with "Nuevo". Resetting an unreadable catalogue
or resuming paused saving requires an explicit user action. Save failures remain
visible and isolated to their store. Changes from another tab pause saving for
the affected store to avoid silently overwriting its work; hourly exchange-rate
updates remain active. Limits are 1000 rows in the current quotation and 2000
catalogue entries. The legacy parser still validates up to 500 quotations in an
old backup before its catalogue is extracted; this is compatibility, not history
support. Canvas export is limited to 16 million pixels with an explicit error
rather than truncation when exceeded.

Selecting a catalogue entry copies its current values into a row. Editing or
removing that entry later does not change the current quotation's row prices.

The repository remains public even when deployment access is restricted. Never
commit supplier lists, discounts, internal costs, customers, real quotations, or
secrets. Deployment protection and access for intended users must be checked
separately; the application does not add a frontend PIN or claim one is security.

## Optional private catalogue

No catalogue data is embedded in the public application. A configured private
endpoint loads the common catalogue automatically. A private JSON file can also
be imported after a summary and explicit confirmation. The catalogue
combines a category filter with SKU, brand, and name search and limits rendered
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
keeps its selected section. Currency restrictions still apply to approved prices.

Imported products start without an approved sale price. Supplier cost, historical
list/sale reference, missing currency, zero, and unknown dates remain distinct.
Only an explicitly confirmed list/sale reference in the quotation currency with
at most two decimals may be copied into an editable price. Costs and unknown
roles/currencies require manual pricing. Provenance remains in the private
catalogue UI and backup, never in customer-facing descriptions or images.

Future supplier availability has an optional stock snapshot contract with explicit
quantity, observation validity and private provenance. This preparation does not
connect a spreadsheet, import historical Excel stock or change product choices.
After read-only source access and a freshness policy are validated, fresh zero
stock will be excluded from new catalogue selections. Low-stock thresholds and
presentation remain undecided. Manual concepts, approved sale prices and existing
quotation rows remain independent. See `CATALOG-SOURCE-ROADMAP.md`.

## Image download and sharing

Complete the quotation, prepare a PNG, then choose download or share. The share
action uses an already prepared File directly from a user gesture. If file
sharing is unavailable, download is the fallback. Cancellation preserves the
prepared image without sending or downloading it. Repeated sharing remains
possible. Opening or closing a share sheet does not establish recipient delivery.
Downloading or sharing does not clear or replace the current quotation.

## Verification and remaining acceptance

Run typecheck, lint, calculation/persistence/export tests, and build. Check mobile
and desktop layouts, long text, many rows, pending/zero/included states, decimal
input, invalid values, confirmed replacement with "Nuevo", current-quotation
recovery, catalogue backups, legacy catalogue extraction, and share cancellation.
Browser emulation is useful evidence but does not replace physical Android and
iPhone checks for PNG saving, Web Share, WhatsApp, and deployment access.

Remaining acceptance includes activation of the private catalogue service, backup
retention, approval of historical reference use, and physical-device checks.
Shared quotation storage, synchronized manual prices, accounts, CRM, inventory,
invoicing, AI, and automatic commercial rules remain outside V1.
Publishing requires the final authorized review; local checks
do not establish remote publication or production deployment.
