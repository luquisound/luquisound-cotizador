# Luquisound Cotizador

Mobile-first graphic quotation editor for Luquisound. V1 provides manual concepts
and editable prices, an optional personal catalogue, automatic ARS/USD totals,
recovery of one current quotation, a named browser-local quotation library,
separate private backups, reviewed bulk entry, and deterministic PNG file sharing.
Fixed budgets and templates remain in Figma; this app builds a custom quotation.

The app starts with a blank quotation and loads the private common catalogue
automatically when its protected endpoint is configured. Local catalogue prices
and the current quotation are preserved. Without that service, a new browser
starts with an empty catalogue and can still import a private file. No customer data,
supplier lists, historical quotations, or commercial prices are bundled. See
[the product scope and calculation rules](docs/PRODUCTO.md).

## Requirements

- Node.js 22.x, version 22.12 or newer.
- npm. Use the committed `package-lock.json` and keep npm as the package manager.

## Local development

From the repository root:

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. For an initial Android or iPhone check on
the same trusted Wi-Fi network:

```sh
npm run dev -- --host 0.0.0.0
```

Open Vite's printed network URL on the phone. The computer must remain running
and reachable on that network. Validate narrow screens and touch interactions;
Android testing does not replace eventual iPhone verification.

## Checks and production preview

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run preview
```

- `typecheck`: TypeScript application and test checks.
- `lint`: Oxlint with warnings treated as errors.
- `test`: Node.js tests for calculations, persistence, catalogue loading/API, and
  export/share helpers.
- `build`: TypeScript checks followed by a Vite production build in `dist/`.
- `preview`: Local preview of the existing production build.

GitHub Actions runs the same checks and a clean `npm ci` on pushes to `main` and
pull requests. The workflow uses read-only repository permissions.

Run `build` before `preview`. The preview server is for local verification.

## Structure

```text
src/
  main.tsx
  app/
    App.tsx
  features/
    quotation/
      QuotationApp.tsx
      QuotationPreview.tsx
      QuotationDialogs.tsx
      model.ts
      calculation.ts
      persistence.ts
      bulk-entry.ts
      catalog-stock.ts
      row-provenance.ts
      quotation-library.ts
      useQuotationLibrary.ts
      export.ts
  styles/
    global.css
docs/
  PRODUCTO.md
public/brand/
api/
  catalog.ts
tests/
AGENTS.md
vercel.json
```

React and strict TypeScript provide the UI foundation. Tailwind CSS is connected
through its Vite plugin. Add shared components, hooks, utilities, types, or assets
when a concrete feature needs them.

`docs/project-context.local.md` is ignored machine-local routing context for the
paired document library. Keep external source documents and original assets in
that library; do not commit the local routing file.

## Current quotation and catalogue data

The main screen opens directly on the editable quotation, with the brand and
editable title in a yellow header with dark text and the original multicolour
horizontal logo. The header starts at the top of the workspace without leading
space or a global historical-source banner; private source and stock metadata
remain in the catalogue and row workflows.
There is no general pending-data banner. Per-field feedback and image validation
still preserve incomplete, zero-priced and included concepts as distinct states.
The preview and PNG share the same palette and logo resource. Fixed quotations
in Figma retain their dark headers. Exchange-rate details stay beside the totals.
"Datos del presupuesto" edits only the title and optional subtitle.
Previously stored notes are retained in recovery and PNG output.

Each row has separate edit buttons: its description opens the full row editor;
its amount opens "Editar precio" with one unit-price or service-price field, fixed row currency,
and Save/Cancel actions. The template amount remains quantity times unit price.
Other row fields and provenance stay unchanged; cables and labour use quantity
one and a service amount as described below. Manual price inputs allow 15
characters, including separators, while retaining the money-format and safe-cent
checks. Overlong edits are rejected without truncating stored data. Blank means pending;
zero is priced, except an already included row stays included at zero. A positive
price makes an included row charged. Invalid nonblank input blocks saving in
this dedicated editor; Cancel discards its draft.

The full editor for equipment and other custom concepts starts with "Producto",
the unit price labelled ARS or USD, and "Agregar" or "Guardar". "Producto"
searches by SKU, brand or name and also accepts an independent manual concept.
Choosing a catalogue result is explicit;
typing or leaving the field never selects one silently. There is no initial
catalogue accordion. "Mas opciones" contains variable quantity, optional detail, quotation
category, currency, included-without-charge state, private provenance and removal.
Its closed summary shows the active variable quantity, category, currency, detail presence
and included state. Opening or closing these options preserves the draft.
The full editor still saves pending or invalid drafts for later completion;
editing only a description preserves its price state. Cancel discards all modal
changes. This presentation preserves pricing, source and availability rules.

Speakers/component sets and subwoofers offer an explicit factory-equipment
checkbox. It shows "Parlantes de fabrica" or "Subwoofer de fabrica" with a priced
zero and retains the equipment quantity. Product, detail, price and included
editing are disabled while active. Its currency remains editable; either ARS or
USD keeps the active zero without changing the original product snapshot.
Turning it off restores the exact prior fields and conversion anchor, including
the original price, currency and any pending or invalid draft. The original
product and source remain private; the PNG uses only the active factory description and
amount. Supplier availability does not apply to equipment already in the vehicle;
restoring the sale row restores its normal source checks. Old wording or a zero
price never enables this mode automatically.

On mobile, the sheet fills the screen width. Tablet and desktop layouts use a
compact header and readable row sizes; wide screens place totals beside the
concepts and expand the workspace up to 1680 pixels. Image export controls remain
fixed at the bottom and are excluded from the PNG along with other editing controls.
Below the template and its contact footer, one discreet "Opciones" menu contains
"Pegar codigos o nombres", "Presupuestos guardados", "Mi catalogo" and
"Nuevo presupuesto" as secondary actions.
These actions stay collapsed on entry so the graphic quotation remains the
focus; history and save controls appear only inside the saved-quotation workflow.
"Nuevo presupuesto" starts a blank current quotation after confirmation when it
would replace content or an unreadable recovery record; the catalogue, its prices
and the saved quotation library are preserved. "Presupuestos guardados" explicitly
saves named snapshots and can open or duplicate them.
Downloading or sharing a PNG leaves the current quotation open.

Equipment keeps optional amplifier/DSP, additional amplifier, subwoofer and
speaker groups, including several independent rows in one group. Installation
offers four optional direct concepts: "Cables y accesorios", "Ficha bypass
estereo", "Aros adaptadores 3D" and "Mano de obra de instalacion". The primary
harness amount opens the price and selection modal described below. Opening another
unused concept prefills its name in a temporary draft and focuses its unit
price. It supplies no included state. Cancel leaves the quotation
and any prepared image unchanged; unused concepts never enter the PNG.

New "Aros adaptadores 3D" rows require an explicit size choice: 6.5 inches uses
the user-approved ARS 25,000 unit price; 8 inches uses ARS 35,000 per unit.
New rows show size and quantity in the main form; quantity is not forced to a
pair and the unit price remains editable. Choosing a size copies its price and
ARS currency together with the variant identity, preserving quantity. Reopening preserves saved
amounts and overrides. Existing rows show their current measure and offer
"Guardar y agregar otra medida" to save edits before opening a separate addition.
Correcting the current row's size is available in "Mas opciones".
Legacy generic adapter rows can keep an unspecified size; their size is never
inferred from price. A new "Ficha bypass estereo" draft starts at the approved
ARS 70,000 unit price, including when the quotation defaults to USD. The amount
and quantity remain editable. Existing and recovered harnesses, reclassification
and imported prices retain their values, currencies and pending states. Cables
and labour start with a blank pending service price.

The primary harness amount opens "Editar precio", with its editable price and
explicit inclusion checkbox together in that modal. The main template has no
harness checkbox. A blank quotation shows a virtual ARS 70,000 suggestion without
creating or charging a row; its modal starts unchecked. Save applies the price
and selection together, while Cancel discards both. Checking includes the harness;
unchecking excludes it from totals and the PNG while retaining its saved price
and other fields. The price action remains available while the harness is inactive.
Older harness rows without explicit checkbox metadata remain active with their
original amounts. The checkbox does not mark a harness as included without charge.

The direct editor hides product search and category selection. "Mas opciones"
retains harness quantity, detail, currency, included
state and existing-row removal.
Its price input stays editable when included: zero preserves included, blank
means pending and a positive amount becomes priced. Opening and saving without
editing preserves an included row's stored amount. Custom concepts and all rows
with catalogue provenance retain the full editor and source/stock rules.

Cables and installation labour use one editable service amount and quantity one,
with no quantity control or quantity summary. The rule follows their quotation
category IDs, including custom wording and catalogue selections. Adapters,
harnesses and equipment retain their normal quantities. Older service rows are
prepared in the working copy with their rounded native line amount preserved;
their original fields remain in private metadata. Invalid or pending data still
requires a price review. Reading backups or archived quotations leaves their raw
values intact; opening or duplicating an archive prepares only the editable copy.

Equipment and adapters keep a named add action below their current items.
Structured adapter variants share one visual block with a quantity, size and
sale-presentation breakdown. Every variant retains its own editable row, price,
currency and provenance. Selecting an existing variant reuses its identity for
an addition; matching commercial values accumulate only when rounding remains
unchanged. Rows with currency-conversion references stay separate to preserve their original
rounded amounts when switching back.
Direct size selections identify the approved unit preset explicitly;
custom and catalogue variants also declare their presentation. Units, pairs and
sets are never converted into one another. Older adapter rows are not inferred
or merged; their size and presentation can be declared explicitly when desired.

Installation omits standalone category headings. Cables and labour use one
concept for new entries or reclassification, preserving every existing row.
The harness suggestion is offered once without blocking another manually
classified harness. "Otro concepto" remains a secondary manual/catalogue action. Category
IDs and ordering remain compatible; recognized old manual names open directly
without being renamed on recovery or save. Equipment, unclassified rows and
custom wording retain their behavior. Add controls have full-width touch targets
at least 48 pixels high. PNG output uses the same variant presentation and
excludes unused concepts and editor controls. Catalogue categories remain independent; selecting a
concept supplies no price except the approved new harness and adapter presets. See
[the optional audio row contract](docs/PRODUCTO.md#optional-audio-categories).

The current quotation is recovered across reloads from
`luquisound.current-quotation.v1`. The persistent catalogue and approved sale
prices use the separate `luquisound.catalog.v1` key. Catalogue persistence remains
independent from quotation recovery. An untouched blank quotation and automatic
rate updates alone do not create recoverable content; a partial concept with a
pending price does.

When the new catalogue key is absent, a valid legacy `luquisound.workspace.v1`
may seed its catalogue. Legacy quotations are not reopened, and the old key is
never rewritten or deleted. Corrupt stored data is not automatically overwritten.
An unreadable current recovery record remains intact. A catalogue reset or
resuming paused saving requires an explicit user action. Save failures remain
visible; changes from another tab pause saving for the affected store to avoid
overwriting that tab's work. Current recovery and catalogue writes also compare
their expected raw value immediately before writing, so a delayed storage event
does not silently overwrite an already detected external change. These optimistic
checks are not a transactional cross-tab database. Failures in one
store do not disable the others. Automatic-mode exchange-rate updates continue
independently.

The saved quotation library uses `luquisound.quotation-library.v1`, independently
of current recovery and catalogue storage. Saving records a name and date, makes
a deep snapshot and freezes the rate; opening or duplicating retains its amounts,
currencies and saved rate without fetching a replacement. New quote and row IDs
keep edits separate from the saved entry. Same-name replacement requires explicit
confirmation. Partial concepts can be archived, but title, notes, rate or quantity
alone cannot create a new entry. The limits are 100 entries and 5 MiB.

The library writes only after explicit actions and compares expected stored bytes
before each write. Concurrent-tab changes pause its writes without discarding the
visible library. A failed save remains visible in memory for a private backup and
is not reported as persisted. Corrupt stored bytes are not overwritten silently;
their recovery download preserves the original text. Resuming saving explicitly
replaces the stored library with the visible version. Keep both versions privately
before confirming that action when necessary.

The library's own JSON backup contains saved quotations and their private row
provenance, not the catalogue. Import first validates and previews the entries,
then asks before replacing the library. It leaves the open quotation and catalogue
unchanged. Its separate legacy-backup importer can extract quotations from an old
workspace file without touching the legacy storage key. Catalogue-backup import
continues to extract only catalogue data.

All local data belongs to the current browser and origin. It is not uploaded,
synchronized between devices, or encrypted by the app. Clearing browser data,
private browsing, device loss, or an origin change can make it unavailable.
The private common catalogue is fetched on startup when configured.

Catalogue management is available from "Opciones" > "Mi catalogo" and from a storage-error
notice, with private JSON backup and import. Product selection stays in the row editor. Backups
preserve IDs, approved prices, currencies, and provenance in the existing
Workspace v1 envelope with `quotations: []` and `activeQuotationId: null`.
After confirmation, backup
import replaces the catalogue. A compatible old full-workspace backup contributes
only its catalogue; it never restores quotation history or replaces the open
quotation. Keep these files private and outside the public repository.

Import a private catalogue JSON from "Opciones" > "Mi catalogo" after reviewing its summary.
Manual file import remains available alongside automatic common catalogue loading.
Filter by product category and search by SKU, brand, or name at the same time.
Categories come from imported data; "Todas" clears the filter and "Sin clasificar"
groups entries without a category. Manual concepts remain available.
New imported products have no manually approved sale price. A reviewed private
source may explicitly provide a retail `listPrice` before supplier discount;
ordinary historical references remain separate. Reimporting matches supplier and SKU,
preserving existing manually approved prices and the current quotation's row
values. A reviewed source-replacement file can also retire imported entries from
its explicit document scope, while preserving manual entries and retained sale
prices. Replacement previews show the removals before confirmation. See the
[private import contract](docs/CATALOG-IMPORT.md).
Keep catalogue files private.

The picker ranks exact SKU matches first and combines text with category filters.
"Opciones" > "Pegar codigos o nombres" reviews up to 50 lines, one code or name per line.
A unique exact code or name can be proposed automatically; partial or ambiguous
matches require a choice. Review quantity and section for each line, skip it, or
create an independent manual concept. Repeated queries or products require
confirmation. No fuzzy match, pasted price or supplier discount is applied.
The whole selection is revalidated against the current catalogue and availability
before any rows are added; a changed source requires a new review.

Availability policies are active for protected catalogue products. They require a
valid manual or reviewed list price and positive eligible stock. `fresh-positive`
requires an unexpired current observation; `historical-positive` can use a positive
historical record provisionally. Zero, negative, unknown, stale and future stock,
and explicitly blocked products cannot be selected. The catalogue manager still
can show those entries through "Mostrar no habilitados", with text explaining the
reason. Independent manual concepts
remain available. Stock is checked again as time passes, before bulk application,
and before preparing, downloading or sharing an image. Existing row prices are
never replaced by a catalogue refresh. A newly blocked row must be reviewed before
export. Provisional images include "Disponibilidad a confirmar."
No Sheets connector or live-stock promise is implemented. See the
[source preparation and activation boundaries](docs/CATALOG-SOURCE-ROADMAP.md).
The offline [snapshot review command](docs/INSTALER-SNAPSHOT-PREPARATION.md) reads
a supplied XLSX, preserves cached values/formulas as private evidence, validates
decimal stock and compares a local catalogue baseline. It imports no source
description; ambiguous combined names require review. It has no Google connection,
schedule or publication path and does not change the published catalogue.

Each row has its own editable ARS or USD currency. New manual rows default to ARS;
legacy quotations retain their previous currency as the row default. A catalogue
selection copies its manual price first, otherwise an explicitly reviewed list
price, and its currency together, including zero. Provisional historical list
prices remain labelled as such and are used before the supplier discount;
there is no automatic 20% deduction.
Without an approved price, a single explicit source currency can preselect the
row currency without approving or copying historical amounts.
Rounded row amounts are summed separately by currency. Each displayed total adds
its native subtotal to one conversion of the other subtotal; neither total is
derived from the other. An automatic-mode quotation uses the DolarAPI blue
sale rate through a same-origin server endpoint.
Both totals, the rate, its source, and the source date appear in the preview and
PNG. Rates refresh hourly while the app is visible and online. Reloading the
automatic-mode current quotation, returning to the app, and reconnecting check whether its
saved reference is due. Fresh references are reused until their fetch-hour boundary.
Saved library snapshots stay frozen even after reload. "Actualizar dolar guardado"
asks for confirmation before switching the open copy back to automatic lookup;
it preserves row prices and the saved library entry. Converted totals can change.
A lookup failure keeps the existing rate and retries automatically after one hour
when active; a quotation without a rate stays editable but cannot export yet.
Recovered manual rates remain labelled without invented source dates until a
successful automatic lookup replaces them. Automatic updates can change converted
contributions to both totals and invalidate a prepared image; downloaded files
remain unchanged.
Automatic-mode updates continue when local saving is unavailable or paused. See
[exchange-rate behavior](docs/EXCHANGE-RATE.md).
Explicitly changing a row's currency converts its entered unit amount with the
open quotation's saved rate: ARS to USD divides by the rate; USD to ARS multiplies
by it. Conversion rounds half up to cents with exact integer arithmetic and
preserves quantity and price state. Blank stays blank and zero stays zero without
a rate. A positive base that rounded to zero retains its conversion reference and
needs a valid matching rate to restore that amount. A nonzero amount requires a
valid saved rate; otherwise the draft stays
unchanged and shows an error. The currency action does not request a new rate.
A validated `currencyConversionOrigin` travels with the row through recovery,
backups and saved copies, preventing rounding drift when switching back at the
same rate with an untouched amount. Manual price edits, adapter-size choices and
catalogue selections reset that base. Converted input prefers grouped Argentine
notation, falls back to ungrouped notation within 15 characters, and rejects an
amount that still does not fit. It never truncates a number.

The personal-catalogue editor also converts its manual sale price on an explicit
currency change using the open quotation's rate. Its round-trip anchor lasts only
for that editor session; it adds no persisted catalogue metadata. Reviewed source
list prices and historical references retain their original amounts and
currencies. Catalogue selection still copies an approved amount and its currency
together. Recovery, opening saved quotations and rate refreshes do not convert
stored row prices automatically.

Selecting a catalogue product snapshots its private source, stock, price basis,
original amount and currency into the row. The row editor shows that provenance
and marks later manual amount, currency or included-state changes. Editing a row
does not change the catalogue. Source names, identifiers, checksums and stock
quantities are excluded from customer-facing image text.

Prepare an image after completing pending rows and availability review, then
download or share the same deterministic Canvas-generated PNG. No image model
generates or rewrites quotation text or prices. Editing the quotation, changing
its rate, or invalidating its availability requires preparing the image again.
Logo and font loading have bounded failures. File
sharing depends on browser support and requires the user's action. Unsupported
browsers download the PNG; cancelling sharing does not send or download anything.
The app cannot confirm delivery to a recipient.

The approved Pliant Bold Expanded and Barlow Regular fonts are self-hosted with
their OFL licenses. PNG preparation loads both faces explicitly and reports a
failure instead of exporting fallback typography. See [font provenance](public/fonts/README.md).

## GitHub and Vercel

The code repository is public. Never commit private business data, secrets, local
backups, or original customer quotations. Deployment access restrictions are
configured separately in Vercel and must be verified against each relevant URL;
they do not make repository contents private. No client-side PIN is provided.

Git publication and deployment require explicit authorization. A push to a
Git-connected production branch can deploy automatically. Review the complete
diff and verification evidence before publishing. The prepared build settings are:

| Setting | Value |
| --- | --- |
| Root directory | `.` |
| Framework preset | Vite |
| Install command | `npm ci` |
| Build command | `npm run build` |
| Output directory | `dist` |

These build settings are prepared in `vercel.json`. DolarAPI lookup needs no
additional environment variables. Automatic common catalogue loading requires a private
Blob source and server-only configuration; see [shared catalogue setup](docs/SHARED-CATALOG.md).
Activation also requires Vercel Authentication for All Deployments, with no
public exception for the API. Importing or linking a Vercel
project can trigger a deployment; perform those steps only after authorization.
Review automatic deployment behavior before pushing changes.

## Handoff to Dot and Codex

Read `AGENTS.md`, this README, `docs/PRODUCTO.md`, and the local project context
before planning the next bounded feature. Preserve the approved visual
composition and keep commercial source material outside the public repository.
Unapproved historical references are never approved current prices. Explicitly
reviewed historical list prices remain provisional and retain their provenance.

Official references: [Vite](https://vite.dev/guide/),
[Tailwind with Vite](https://tailwindcss.com/docs/installation/using-vite), and
[Vercel's Vite guide](https://vercel.com/docs/frameworks/frontend/vite).
