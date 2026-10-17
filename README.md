# Luquisound Cotizador

Mobile-first graphic quotation editor for Luquisound. V1 provides manual concepts
and editable prices, an optional personal catalogue, automatic ARS/USD totals, local
drafts and JSON backups, plus PNG download and file sharing.

The app starts with a blank quotation and loads the private common catalogue
automatically when its protected endpoint is configured. Local catalogue prices
and quotations are preserved. Without that service, a new browser starts with
an empty catalogue and can still import a private file. No customer data,
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

## Data and backups

Drafts, approved sale prices, and the local catalogue copy stay in localStorage in
the current browser and origin. They are not uploaded, synchronized between
devices, or encrypted by the app. The common product catalogue is fetched from a
private server endpoint on startup; it is available without manually importing
on each device once that service is activated.
Clearing browser data, private browsing, device loss, or changing the app origin
can make them unavailable. Download a JSON backup from "Opciones" and keep
it privately. Import replaces the current workspace after confirmation.

An untouched quotation stays in memory and is not saved as a draft. Repeated
"Nuevo" or duplicating an empty quotation reuses that blank proposal. A partial
concept with a pending price is meaningful content and is saved with the same
quotation ID. Existing empty drafts are preserved; removing them requires the
visible cleanup action and confirmation.

Corrupt stored data is not automatically overwritten. Failed saves show an error.
Concurrent changes from another tab pause saving until the user resolves them.
Catalogue selections copy values into a quotation; later catalogue edits preserve
the quotation's stored prices.

The compact "Opciones" menu groups duplication, "Mi catalogo", backups, and
draft cleanup. Expand "Dolar del presupuesto" to inspect the automatic rate.
Catalogue status and local-storage guidance are in the menu;
storage and service failures remain visible beside the editor.

Import a private catalogue JSON from "Mi catalogo" after reviewing its summary.
Manual file import remains available alongside automatic common catalogue loading.
Filter by product category and search by SKU, brand, or name at the same time.
Categories come from imported data; "Todas" clears the filter and "Sin clasificar"
groups entries without a category. Manual concepts remain available.
New imported products have no approved sale price;
historical references remain separate. Reimporting matches supplier and SKU,
preserving existing manually approved prices and quotation snapshots. See the
[private import contract](docs/CATALOG-IMPORT.md). Keep catalogue files private.

Each quotation has one currency for its concepts. The open quotation automatically
uses the DolarAPI blue sale rate through a same-origin server endpoint.
Both totals, the rate, its source, and the source date appear in the preview and
PNG. Rates refresh hourly while the app is visible and online. Reopening a saved
quotation or duplicate, returning to the app, and reconnecting check whether its
saved reference is due. Fresh references are reused until their fetch-hour boundary;
inactive quotations retain their snapshots. There is no manual update button.
A lookup failure keeps the existing rate and retries automatically after one hour
when active; a draft without a rate stays editable but cannot export yet.
Legacy manual rates remain labelled without invented source dates until a
successful automatic lookup replaces them. Automatic updates can change the
equivalent total and invalidate a prepared image; downloaded files remain unchanged.
Automatic rates alone do not create saved blank drafts. See
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
