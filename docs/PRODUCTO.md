# Luquisound Quotation App

## Objective

Provide a mobile-first, editable graphic quotation for the Luquisound workshop.
The quotation template is the primary interface: tap its title or a row to edit
it using touch-friendly controls. Lucas's target device is an iPhone; Android is
also part of hands-on acceptance.

## V1 scope

- Editable title, optional subtitle, notes, and manual quotation rows.
- Equipment and installation/accessory sections, including arbitrary work.
- Private common catalogue loaded automatically on each device when configured,
  plus optional personal entries; every selected description and price remains
  editable. A field may be left blank without requiring a catalogue selection.
- Explicit quantity, unit price, pending price, and included-without-charge state.
- Automatic ARS and USD totals using a saved rate per quotation, with automatic
  DolarAPI blue sale lookup for new quotations and explicit updates for saved ones.
- Local drafts, duplicate, reopen, and explicit JSON backup/import.
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
  positive value, and up to six decimal places. New quotations request DolarAPI
  blue sale through the server. Save the value and source timestamp together.
  Stored quotations, imported backups, and duplicates keep their snapshots;
  only an explicit update replaces their rate. Legacy manual rates remain valid
  without inventing provenance. See `EXCHANGE-RATE.md` for lookup and failure rules.
- Sum the rounded base lines first. Convert that final total once using exact
  integer/rational arithmetic, rounding the equivalent half up to cents. Preserve
  the base total exactly. Both ARS and USD totals and the explicit rate appear in
  the preview and exported image. An absent, invalid, zero, or overflowing rate
  blocks image preparation; legacy drafts remain editable without an invented rate.
- A blank amount is pending, not zero. An explicit zero is valid. Included without
  charge is a separate state with a zero subtotal, labelled as included.
- Completely empty rows are omitted from export. A concept with a pending price,
  a missing concept with other content, an invalid quantity or amount, a blank
  title, no nonempty rows, or numeric overflow blocks final image generation.
- Incomplete drafts can still be saved. No discount, tax, supplier rounding,
  automatic margin, or inferred commercial rule is implemented.

## Local persistence and privacy

The versioned workspace contains quotation snapshots, the personal catalogue,
and the active draft. Persistence is isolated behind an adapter in persistence.ts
so a later authorized storage decision does not require rewriting the editor.
The implementation stores quotation snapshots, approved prices, and a local
catalogue copy in localStorage in the current browser and origin. A read-only
server endpoint supplies the private common catalogue on startup. There is no
quotation upload, analytics, or synchronization of locally approved prices.

Automatic loading combines the common catalogue with the latest local state by
supplier and SKU. It updates common metadata and historical references while
preserving approved prices, currencies, identities, personal entries, and quotation
snapshots. Invalid keys, conflicts, limits, and network failures leave local data
unchanged and show a retry action. A paused or unreadable workspace is never
overwritten by the common catalogue. See `SHARED-CATALOG.md` for activation.

An untouched blank proposal remains in memory. Default headings, currency, and
placeholder rows and an automatically attached rate do not create persistent drafts. New and duplicate actions reuse
a blank proposal while it remains empty. Partial concepts with pending prices
are saved, and repeated saves keep the current quotation ID. A stored workspace
may contain no quotations and a null active quotation ID; the editor then opens
one blank proposal in memory without persisting it. Existing empty quotations
are retained, with a visible, confirmed cleanup action rather than silent removal.

This is individual browser storage, not shared or access-controlled cloud storage.
Browser clearing, private mode, device loss, or origin changes can remove access.
The app does not encrypt local data. Backups can contain private business data
and must be stored privately; no backup belongs in the public repository.

JSON import validates schema, version, identities, dates, field lengths, and a
5 MB limit; unknown properties are discarded. Import replaces the workspace only
after confirmation. Corrupt stored data is not overwritten automatically. Save
failures remain visible. Changes from another tab pause saving to avoid silently
overwriting its work. Limits are 500 drafts, 1000 rows per draft, and 2000 catalogue
entries; supported canvas export is limited to 16 million pixels with an explicit
error rather than truncation when exceeded.

Duplicating creates fresh quotation and row identities. Selecting a catalogue
entry copies its current values into a row. Editing or removing that entry later
does not change existing quotation prices or their duplicates.

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
not change quotation snapshots. Conflicts and records without a complete key are
reported before applying changes. See `CATALOG-IMPORT.md` for the schema.

Catalogue sections suggest the ordering of choices. Equipment and extras can
both choose a product, including cables imported as equipment; the quotation row
keeps its selected section. Currency restrictions still apply to approved prices.

Imported products start without an approved sale price. Supplier cost, historical
list/sale reference, missing currency, zero, and unknown dates remain distinct.
Only an explicitly confirmed list/sale reference in the quotation currency with
at most two decimals may be copied into an editable price. Costs and unknown
roles/currencies require manual pricing. Provenance remains in the private
catalogue UI and backup, never in customer-facing descriptions or images.

## Image download and sharing

Complete the quotation, prepare a PNG, then choose download or share. The share
action uses an already prepared File directly from a user gesture. If file
sharing is unavailable, download is the fallback. Cancellation preserves the
prepared image without sending or downloading it. Repeated sharing remains
possible. Opening or closing a share sheet does not establish recipient delivery.

## Verification and remaining acceptance

Run typecheck, lint, calculation/persistence/export tests, and build. Check mobile
and desktop layouts, long text, many rows, pending/zero/included states, decimal
input, invalid values, duplication, reload, backups, and share cancellation.
Browser emulation is useful evidence but does not replace physical Android and
iPhone checks for PNG saving, Web Share, WhatsApp, and deployment access.

Remaining acceptance includes activation of the private catalogue service, backup
retention, approval of historical reference use, and physical-device checks.
Shared quotation storage, synchronized manual prices, accounts, CRM, inventory,
invoicing, AI, and automatic commercial rules remain outside V1.
Publishing requires the final authorized review; local checks
do not establish remote publication or production deployment.
