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
- Equipment groups and optional direct installation concepts, preserving multiple
  existing rows per category and arbitrary work.
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

The initial view starts directly with the yellow quotation header, without
leading workspace space or a global historical-source banner. Private source
metadata and stock rules remain in their existing internal workflows.
Do not show a general pending-data disclaimer. Keep contextual field validation
and the existing guards that prevent image delivery with incomplete data.
Custom quotations use a yellow #FFDA00 header with the original multicolour
full horizontal logo, dark title and optional subtitle, and a dark
separator. Labels, empty-title hints, and keyboard focus also remain dark for
contrast. The responsive preview and PNG renderer share their palette and logo
resource through `graphic.ts`. Preserve the white body with two sections,
right-aligned amounts, totals, and dark contact footer. The approved public contact
footer is 11 7358-1958 and @luquisound.ok. Fixed quotations remain in Figma with
their existing dark headers; this app change does not modify those assets.

Visible currency labels use `$` for Argentine pesos and lowercase `usd` for
US dollars throughout the editor, catalogue, quotation preview and PNG, including
the exchange-rate legend (`1 usd = X $`). Stored currency identifiers, backups,
source metadata and calculation keys remain `ARS` and `USD`. Numeric price inputs
use a separate amount-only formatter, independent of the displayed label length.

Except for the primary harness control described below, each row has separate
edit buttons: its description opens the full row editor;
its amount opens "Editar precio" with one unit-price or service-price field, an
ARS/USD selector, and Save/Cancel actions. An explicit currency change converts the
draft amount using the quotation's saved rate and the conversion rules below,
including the persisted reference that prevents repeated-switch rounding drift.
Blank stays blank and native zero needs no rate; nonzero amounts require a valid
rate. A failed conversion keeps the draft amount and currency intact with an error;
the user can still save those retained values. Save applies price and currency;
the harness activation/deactivation action also applies selection. Cancel or
Escape discards all modal changes.
The template amount remains quantity times unit price.
Other row fields and provenance stay unchanged; fixed services use quantity one
and the service amount described below. Manual price inputs accept up to 15
characters, including separators. The Argentine money grammar, two-decimal and
safe-cent checks still apply. Overlong edits fail without truncating historical
or imported values. Blank means pending;
zero is priced, except an already included row stays included at zero. A positive
price makes an included row charged. Invalid nonblank input blocks saving in
this dedicated editor; Cancel discards its draft.

The full modal for equipment and other custom rows starts with "Producto", a
unit-price field labelled with the row's ARS or USD currency, and "Agregar" or
"Guardar". The product field combines SKU, brand and name search with independent
manual entry, without an initial
catalogue accordion. Only an explicit result choice selects a catalogue product;
typing, blur or saving never applies a match automatically. Selection preserves
the row's identity, section and quotation category while copying the
selected product's approved price, currency and private provenance together.
Quantity is preserved for variable-quantity rows; cables and labour use one.

For a product with a nonblank SKU, individual and bulk selection copy only the
approved commercial title into the row and start with an empty detail. Model,
variant, size and unit/pair/set presentation that identify the sale must remain
in the approved title. For Instaler selections, remove standalone occurrences of
that same SKU from the copied title, including code-only parentheses or brackets.
Matching ignores letter case but preserves accents, punctuation and code identity;
never remove a substring from a longer model or code. Keep the original title if
removal would leave no descriptive text. The source catalogue and private SKU
remain unchanged and searchable. Supplier specifications remain catalogue/private source
information; they are not automatically customer text. Users may add a detail
explicitly afterward. Entries without a SKU retain their maintained detail.
The row editor's catalogue suggestions and bulk-review candidates use the same
cleaned title, displaying the separate SKU for identification. Search still uses
the original catalogue data; typing a code alone never selects or cleans a row.
Only explicit selection copies the prepared title into a quotation. Reading,
recovery, imports, refresh and opening saved quotations never shorten or clear
their existing concept or detail.

The full row editor uses a bottom sheet on narrow screens and a centered dialog
on desktop. It uses plain white fields, inline currency labels and two adjacent
price inputs, without nested price panels or decorative badges. A single fixed
footer contains Delete, Cancel and Save in visual and keyboard order; new drafts
show only Cancel and Add. Delete remains outside "Mas opciones", requires
confirmation and removes only the open row. Fields scroll independently from the
heading and footer. Adapter "Guardar y agregar otra medida" remains available
inside "Mas opciones".

Dialogs follow the visible viewport when the software keyboard opens or closes,
including browsers that keep their layout viewport unchanged. The full editor
keeps its heading and actions above the keyboard while its fields scroll.
Viewport changes preserve the current draft and focus; pinch zoom retains normal
document sizing and panning.

Variable-quantity rows in the full editor offer linked unit-price and total-price
inputs in the row currency. Editing the unit price or quantity recalculates the
total. Editing the total divides it by the positive quantity and rounds the unit
price half up to cents using integer arithmetic. The entered total stays editable
until blur; then the field shows the actual rounded line amount, with a visible
adjustment note when it differs from the requested total. Only quantity and unit
price are stored; preview and PNG keep the same existing line calculation.
Blank total clears the unit price to pending. Invalid total edits require correction
or clearing before saving and never replace the last valid unit price. Both manual
money inputs retain the 15-character limit; generated text is never truncated.
Quantity, size, currency, category, catalogue, included-state and factory-mode changes
discard a temporary total draft and recalculate it from the active row. Total edits
use the same manual-price path, preserving provenance and resetting the currency
conversion reference. Factory and included locks apply to both price inputs;
fixed services keep their single service amount.

"Mas opciones" contains variable quantity, optional detail, quotation category, currency,
included-without-charge state and private provenance.
Its closed summary reflects the active variable quantity, category, currency,
detail presence and included state. Opening or closing it does not reset values.
The full editor retains pending and invalid drafts; editing only a description
does not approve a pending amount or change an included state. Cancel leaves the
quotation unchanged. Pricing, source, availability and image-output rules remain
the same.

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

Equipment keeps optional groups. Installation uses optional direct concepts in
the corresponding stored category order:

| Equipment | Installation and accessories |
| --- | --- |
| Amplifier / DSP | Cables and accessories |
| Additional amplifier | Stereo bypass connector |
| Subwoofer | 3D adapter rings |
| Speakers or component sets | Installation labour |

Equipment categories support several independently editable concepts, including
separate front and rear speakers, and do not prefill commercial descriptions.
The four direct installation concepts use these stable IDs and names:

| Stored ID | New concept | Recognized old manual name |
| --- | --- | --- |
| `cables` | Cables y accesorios | Cables y accesorios |
| `harness` | Ficha bypass estereo | Ficha / arnes |
| `adapters` | Aros adaptadores 3D | Aros / adaptadores 3D |
| `labor` | Mano de obra de instalacion | Mano de obra |

An unused installation concept can open a temporary draft with that name and quantity
one. The primary harness control opens "Editar precio" as described below. Cables and
labour start with a pending price in the quotation's default
currency. A new harness draft starts with the approved ARS 70,000 unit price,
including in a quotation whose default currency is USD; its amount remains editable
and stored quantities are preserved. This harness preset applies only when
creating a new draft.
It never overwrites existing or recovered harnesses, imported prices, manual
overrides, currencies, included states or pending prices, and is not applied by
reclassification. Except new adapters,
which first focus size selection, its modal focuses and selects the unit-price
input without product search, catalogue or category
selection. In the full editor for independently classified harness rows,
"Mas opciones" retains quantity, detail, currency and explicit included state.
Existing-row removal stays in the visible full-editor footer. No detail, supplier
data or included state is supplied automatically.

The primary harness control opens "Editar precio" with editable price and currency,
without an inclusion checkbox or an "Editar datos" link. Its yellow primary action
is "Activar ficha" when initially inactive or absent, or "Desactivar ficha" when
initially active. The white secondary action is "Cancelar"; there is no separate
save action. The modal remains available while inactive. An absent or inactive
harness uses the same full-width "+ Ficha bypass estereo" action and dashed
separator as the other empty concepts, without an amount, detail or status subtitle.
If no row exists, its modal draft starts inactive at ARS 70,000. Saved rows retain
their fields and editable price. Only an active harness displays its actual amount
in the template. Merely displaying or opening it creates no stored row, total or
PNG content. Submitting applies the explicit activation/deactivation, draft price
and currency atomically. Editing price or currency never changes selection.
Cancel or Escape discards all draft changes. Explicit selection remains stored
as `harnessSelection.enabled`. An active harness participates normally; an inactive
harness retains its saved price and fields for later reuse but does not participate
in totals or image output. Existing harnesses without that metadata remain active
with their historical values. Activation/deactivation preserves price, currency
and conversion references unless explicitly edited in the modal. Exclusion remains
independent of the included-without-charge price state.
With no active rows, both displayed totals are zero even before an exchange rate
is available. This does not make an empty quotation eligible for image output.

Cables and labour are fixed services: an `extras` row classified by the exact
`cables` or `labor` ID always uses the canonical quantity string `1` and one
editable service amount. This applies to direct, custom and catalogue rows.
Neither editor shows a quantity control or quantity summary for these services.
Harnesses, adapters and equipment retain their existing quantity behavior.
Names alone do not classify a service; bulk entry remains unclassified until an
explicit category choice.

Preparing a working copy of an older service preserves its rounded native line
amount. For example, a synthetic quantity two at unit price 100 becomes quantity
one at service price 200 in the same currency. `fixedServiceOrigin` version 1
retains the exact original quantity, unit price, price state and currency, plus a
`requiresPriceReview` flag. Preparation is idempotent and preserves row identity
and private catalogue provenance. Pending prices, invalid quantities or prices,
and overflowing charged amounts become a pending service price requiring an
explicit edit; no amount is invented or approved. An included service with valid
quantity remains included at zero, retaining its previous amount in the origin
when it cannot be represented as a valid service price. Review-only drafts remain
meaningful recoverable content and block image delivery.

Persistence readers and backup/library import preserve raw historical rows and
validated origin metadata without converting them. The current editable copy is
prepared after recovery and on opening or duplicating a library entry; saved
entries and source backups remain intact. New or edited service rows must have
quantity exactly `1` when applied. Existing duplicate rows remain independent.

New adapter rows require an explicit choice between two user-approved variants:

| Adapter size | Editable initial unit price |
| --- | --- |
| 6.5 inches | ARS 25,000 |
| 8 inches | ARS 35,000 |

New adapter rows show size and quantity in the main form. Quantity remains
independent; there is no forced pair or total-price preset. Explicit size selection copies
the corresponding unit amount, ARS currency, concept and variant identity
together while preserving quantity. The user can edit that amount. Reopening a
row never reapplies a preset or replaces a saved amount/currency. The selected variant is retained in
the approved concept wording. Legacy generic adapter rows may keep an unspecified
size and their original name; never infer a variant from price or quantity.
Existing rows show their measure and offer "Guardar y agregar otra medida";
this saves current edits and opens a new temporary row without replacing the
existing one. Correcting the current variant's size is a separate field in
"Mas opciones". The new direct form has one size selector, with no variant-reuse
selector. The new harness uses its separate approved preset; cables and labour
start without a commercial price.

The direct price input remains enabled for included rows. Entering zero keeps
included, clearing it means pending and a positive amount becomes priced. Saving
without a price edit preserves the stored amount and state, even if an included
row retains a previous nonzero amount. Toggling included and back without a price
edit restores the previous pending/priced state. Invalid drafts remain editable
and cannot produce a final image.

Direct editing applies only to an `extras` row with one of those category IDs,
no provenance and an exact canonical, adapter-variant or recognized old name.
Recovery and save never rename old concepts. Custom wording, unclassified manual rows and any
catalogue provenance retain the full editor; source prices, original amounts
and availability policies are preserved. No classification is inferred from text.

Equipment and adapters retain their named add action below current entries.
Cables and labour accept one concept for new entries or reclassification; an
occupied category directs the user to edit it. Existing repeated concepts in
those categories remain editable and are never merged or removed automatically.
The harness suggestion disappears when occupied, but another harness can still
be classified manually. Installation omits standalone category headings, while
declared adapter variants use a common product heading. "Otro concepto" remains
a secondary repeatable action for manual or catalogue entry. Add controls fill
their own row width with a minimum 48-pixel height without covering neighbouring
rows or price controls. Unused suggestions create no quotation rows, prices,
totals, image content or recoverable content; legacy blank rows remain inert.

Opening a category or adding another concept starts a temporary draft. Applying
it adds the row; cancelling, closing, or pressing Escape discards it without
changing the quotation or invalidating a prepared image. Applying an entirely
empty new draft adds nothing. Saving a new row rechecks the 1000-row limit.
Custom rows can still be classified or reclassified within their section, or
changed to a free-form concept. Removing the final item restores its empty
suggestion. Applied changes invalidate a prepared image.

Optional `audioCategory` metadata is saved with a row and restored on reload,
alongside its identity, amounts, currency, and price state. Rows without that
metadata remain compatible; categories are never inferred from their wording
or a catalogue selection. Unknown values or categories incompatible with the
row's section are discarded without losing the row or its other fields.
Category metadata alone is not meaningful quotation content.

### Factory equipment

Equipment classified as `speakers` (including component sets) or `subwoofer` can
explicitly enable the factory-equipment checkbox. The active description is
"Parlantes de fabrica" or "Subwoofer de fabrica", with empty detail and an
ordinary priced zero. Quantity remains unchanged; this is distinct from the
included-without-charge state. Product, detail, price and included editing are
disabled while the mode is active. Currency remains editable between ARS and USD;
the active zero stays zero without requiring a rate or changing the original
snapshot. Turning it off, or changing to another category, restores the exact
previous fields and conversion anchor before applying that change.
Pending, invalid and included originals remain distinguishable.

Private `factoryEquipment` version-1 metadata stores the eligible category and
the original concept, detail, unit price, price state and currency. The row keeps
any prior conversion anchor unchanged while factory mode is active. It preserves
the raw text, quantity, row identity and existing catalogue provenance. Recovery,
backups and library copies validate and retain that metadata; no factory mode is
inferred from a legacy name or zero price. The active state is validated against
its canonical description, zero amount, priced state and valid ARS or USD currency;
the active currency need not equal the stored original currency. Supplier
availability does not apply while the row represents equipment already in the vehicle; restoring
the original sale row restores the normal source checks. The catalogue itself is
unchanged. Preview and PNG show only the active factory description and zero,
without the retained original product, detail, source or mode metadata.

### Adapter variants

Adapter rows can optionally declare an explicit product identity, a positive
diameter in inches with up to three decimal places, and a sale presentation
(unit, pair or set). The quantity and unit price refer to that presentation;
the app never converts a pair or set into individual physical units. Size accepts
comma or dot decimal input and is stored canonically with a comma. A completed
variant may use the generic "Aros adaptadores 3D" concept when no description was
entered. Merely opening or cancelling its editor still creates nothing.

Selecting an existing adapter variant for a new addition copies its identity
and editable commercial snapshot, while the entered quantity is the amount to
add. Explicit direct size selection supplies the stable approved preset identity
and a unit presentation, preserving the editable amount rules above. Variant
reuse remains available in the full editor; the direct form identifies its
approved variant through the size selector. A catalogue selection copies the
product ID as a quotation-local reference;
the size and presentation must still be declared explicitly. Future catalogue
updates never change these quotation values. Manual variants receive their own
identity; matching words alone do not identify the same product.

Only a new adapter addition can accumulate into a unique existing variant with
the same identity, size, presentation, concept, detail, currency, price state,
unit price and provenance snapshot. Pending or invalid amounts do not accumulate. Quantities are
added using exact integer thousandths, retaining the existing row ID. The
native rounded amount must equal the sum of the two original line amounts;
otherwise both rows remain separate. Overflow rejects the change.
Rows with a currency-conversion reference never accumulate automatically: each
must retain its own source amount and original line rounding when switching back.
The 1000-row limit applies to the resulting rows, allowing an exact accumulation at the
limit. Editing, recovering or reloading rows never triggers accumulation.

Declared variants share a visual "Aros adaptadores 3D" block with their size,
quantity, presentation and meaningful descriptions. Every source row remains
independently editable and removable. ARS and USD summaries stay separate;
pending, explicit zero and included states remain distinct. Summary amounts
sum already-rounded source line amounts without calculating a common price or
converting currencies. In the PNG the same breakdown is plain text, without
editing controls. Text wraps and increases the image height rather than clipping.

Optional variant metadata is validated and recovered alongside its row. Missing,
invalid or incompatible metadata is omitted without losing the original row.
Legacy adapter descriptions are never parsed to guess their size or identity;
they remain independent until explicitly classified in the editor. No group
record or new storage key is introduced, and catalogue backups remain separate.

The preview and PNG use the table's category order within each section, keeping
the existing relative order of items in each category. Free-form and legacy
unclassified concepts appear after categorized items, preserving their own
relative order. Validation issue numbers refer to that order of nonempty
concepts. PNG output contains entered concepts and declared adapter groups under
the existing two section headings; unused category labels, empty suggestions,
and controls are omitted.

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
  Cables and labour in the editable quotation always use quantity one and an
  editable service price; other categories keep variable quantities.
- Represent prices and totals as safe integer cents. Compute quantity times
  unit price using integer arithmetic, round each line half up to the nearest
  cent in its own currency, then sum complete lines separately into ARS and USD
  subtotals. Use exact BigInt/integer-rational arithmetic and reject overflow
  before returning safe integer cents.
- Each row has an explicit ARS or USD currency. An explicit currency edit converts
  the entered unit amount using the open quotation's saved `exchangeRate`:
  `USD = ARS / rate` and `ARS = USD * rate`. Use exact BigInt/rational arithmetic,
  round half up to cents, and preserve quantity, price state and source provenance.
  Blank stays blank and explicit zero stays zero without requiring a rate. A zero
  rounded from a positive conversion retains its base and needs a valid matching
  rate to restore that positive amount; it is not a new explicit zero. For a
  nonzero amount, an absent, invalid or overflowing rate blocks the change with
  an error and leaves both amount and currency unchanged. This action does not
  fetch or invent a rate, approve a pending price or convert historical rows on
  recovery. New manual rows default to ARS. The retained
  `quotation.currency` field is only a legacy default: recovered rows without
  currency inherit it, and new rows in those quotations use that default.
  New and edited rows store their currency explicitly.
- Validated private `currencyConversionOrigin` metadata retains a conversion base
  on a quotation row. Switching back with the same numerical rate and an
  untouched amount uses that base to prevent accumulated cent rounding. Recovery,
  backups, opening and duplication preserve the anchor with the row. Manual
  price edits, adapter-size choices and explicit catalogue selection reset it;
  quantity changes do not convert the unit amount. A factory row may change its
  active zero currency without using or replacing its retained paid-price anchor.
  Disabling factory mode restores the original product's price and currency,
  consistent again with that prior row anchor.
- Converted price text must fit the 15-character input limit. Prefer grouped
  Argentine notation; if grouping does not fit, use an ungrouped amount with the
  same comma decimal separator. If neither representation fits, reject the
  conversion without truncation, partial changes or a different amount.
- The personal-catalogue editor applies the same explicit conversion to its
  manual sale price using the open quotation rate passed by the app. It retains
  a round-trip anchor only within that editor session and does not persist a new
  catalogue field. Supplier list prices, costs and historical reference amounts
  retain their source currency and are not converted by this action. Selecting
  a catalogue product still copies its approved price and currency together.
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
  `totalUSD = usdSubtotal + halfUp(arsSubtotal / rate)`. This total calculation never
  converts individual row amounts or derives one total from the other. Explicit
  row-currency editing is the separate unit-amount operation described above.
  Both totals and the explicit rate appear
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
common catalogue on startup and after the daily 08:00-09:00 Buenos Aires source
window, with a 09:00 daily app cycle while visible and online. There is no refresh
button or hourly catalogue polling. There is no quotation upload, analytics, or
synchronization of locally approved prices.

The header contains the brand and editable quotation details. Below the template
and contact footer, a single discreet "Opciones" menu contains bulk entry,
"Presupuestos guardados", "Mi catalogo" and "Nuevo presupuesto" as secondary
actions. The menu starts collapsed; history and save controls are accessed inside
their workflow, not displayed on entry.
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
limits, and network failures leave local data unchanged until the next daily cycle. A paused or
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
quantity or category alone are insufficient. A preserved fixed-service draft
requiring price review remains meaningful archive content. Existing compatible records remain
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
An explicit source `readAt` records transport evidence separately from supplier
freshness. Protected observations carrying this field become stale seven days
after that reading, or remain invalid if its timestamp is future or malformed.
Daily failures preserve the previous catalogue and all quotation amounts. No
download invents a supplier commercial date or a fresh stock observation.

The picker, bulk review and open quotation check availability again as time passes
and before image preparation or delivery. The latest matching catalogue snapshot
is authoritative for availability but never replaces a row's prices. A blocked
existing row remains editable and saved, but blocks image export. Historical
source details remain in the private catalogue and row provenance workflows;
there is no global historical-source banner above the template. Provisional
availability still adds only "Disponibilidad a confirmar." to the customer image,
without exposing stock quantities or source details.
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
