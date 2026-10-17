# Luquisound Cotizador

Mobile-first graphic quotation editor for Luquisound. V1 provides manual concepts
and editable prices, an optional personal catalogue, automatic ARS/USD totals,
recovery of one current quotation, private catalogue backups, and PNG file sharing.
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

The main screen opens directly on the editable quotation, with "Catalogo" and
"Nuevo" integrated into its header and exchange-rate details beside the totals.
On mobile, the sheet fills the screen width. Image export controls remain fixed
at the bottom and are excluded from the PNG along with other editing controls.
There is no quotation list, saved-status label, duplicate, delete, or
quotation-backup control. "Nuevo" asks for confirmation when the current
quotation has meaningful content, then replaces it with a blank one. Downloading
or sharing a PNG leaves the current quotation open.

The current quotation is recovered across reloads from
`luquisound.current-quotation.v1`. The persistent catalogue and approved sale
prices use the separate `luquisound.catalog.v1` key. New quotations never clear
the catalogue. An untouched blank quotation and automatic rate updates alone
do not create recoverable content; a partial concept with a pending price does.

When the new catalogue key is absent, a valid legacy `luquisound.workspace.v1`
may seed its catalogue. Legacy quotations are not reopened, and the old key is
never rewritten or deleted. Corrupt stored data is not automatically overwritten.
An unreadable current recovery record remains intact until confirmed replacement
with "Nuevo". A catalogue reset or resuming paused saving requires an explicit
user action. Save failures remain visible; changes from another tab pause saving
for the affected store to avoid overwriting that tab's work. Failures in one
store do not disable the other, and exchange-rate updates continue independently.

All local data belongs to the current browser and origin. It is not uploaded,
synchronized between devices, or encrypted by the app. Clearing browser data,
private browsing, device loss, or an origin change can make it unavailable.
The private common catalogue is fetched on startup when configured.

Catalogue controls provide private JSON backup and import. Backups preserve IDs,
approved prices, currencies, and provenance in the existing Workspace v1 envelope
with `quotations: []` and `activeQuotationId: null`. After confirmation, backup
import replaces the catalogue. A compatible old full-workspace backup contributes
only its catalogue; it never restores quotation history or replaces the open
quotation. Keep these files private and outside the public repository.

Import a private catalogue JSON from "Mi catalogo" after reviewing its summary.
Manual file import remains available alongside automatic common catalogue loading.
Filter by product category and search by SKU, brand, or name at the same time.
Categories come from imported data; "Todas" clears the filter and "Sin clasificar"
groups entries without a category. Manual concepts remain available.
New imported products have no approved sale price;
historical references remain separate. Reimporting matches supplier and SKU,
preserving existing manually approved prices and the current quotation's row
values. A reviewed source-replacement file can also retire imported entries from
its explicit document scope, while preserving manual entries and retained sale
prices. Replacement previews show the removals before confirmation. See the
[private import contract](docs/CATALOG-IMPORT.md).
Keep catalogue files private.

The optional stock observation contract is prepared for a future private
spreadsheet source. No Sheets connection or availability filtering is active;
the approved Excel snapshot remains unchanged. See the
[source preparation and activation boundaries](docs/CATALOG-SOURCE-ROADMAP.md).

Each quotation has one currency for its concepts. The open quotation automatically
uses the DolarAPI blue sale rate through a same-origin server endpoint.
Both totals, the rate, its source, and the source date appear in the preview and
PNG. Rates refresh hourly while the app is visible and online. Reloading the
current quotation, returning to the app, and reconnecting check whether its
saved reference is due. Fresh references are reused until their fetch-hour boundary.
There is no manual update button.
A lookup failure keeps the existing rate and retries automatically after one hour
when active; a quotation without a rate stays editable but cannot export yet.
Recovered manual rates remain labelled without invented source dates until a
successful automatic lookup replaces them. Automatic updates can change the
equivalent total and invalidate a prepared image; downloaded files remain unchanged.
Automatic updates continue when local saving is unavailable or paused. See
[exchange-rate behavior](docs/EXCHANGE-RATE.md).
Changing the concepts' currency preserves the entered prices after confirmation.

Prepare an image after completing pending rows, then download or share it. File
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
Historical prices are reference material, never approved current prices.

Official references: [Vite](https://vite.dev/guide/),
[Tailwind with Vite](https://tailwindcss.com/docs/installation/using-vite), and
[Vercel's Vite guide](https://vercel.com/docs/frameworks/frontend/vite).
