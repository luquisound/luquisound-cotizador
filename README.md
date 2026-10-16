# Luquisound Cotizador

Mobile-first graphic quotation editor for Luquisound. V1 provides manual concepts
and editable prices, an optional personal catalogue, automatic totals, local
drafts and JSON backups, plus PNG download and file sharing.

The app starts with a blank quotation and an empty catalogue. No customer data,
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
- `test`: Node.js tests for calculations, persistence, and export/share helpers.
- `build`: TypeScript checks followed by a Vite production build in `dist/`.
- `preview`: Local preview of the existing production build.

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

Drafts and personal catalogue entries stay in localStorage in the current browser
and origin. They are not synchronized, encrypted by the app, or sent to a server.
Clearing browser data, private browsing, device loss, or changing the app origin
can make them unavailable. Download a JSON backup from "Mas opciones" and keep
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

Prepare an image after completing pending rows, then download or share it. File
sharing depends on browser support and requires the user's action. Unsupported
browsers download the PNG; cancelling sharing does not send or download anything.
The app cannot confirm delivery to a recipient.

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

These build settings are prepared in `vercel.json`. No environment variables or
backend services are required at this stage. Importing or linking a Vercel
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
