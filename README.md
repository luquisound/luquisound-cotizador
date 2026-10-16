# Luquisound Cotizador

Mobile-first web app foundation for personalized automotive audio quotations at
Luquisound. The current screen displays "Cotizador Luquisound" with provisional
black, white, and yellow (`#FFDA00`) styling.

This stage provides the application shell only. The quotation editor,
calculations, catalogue, saving, and PNG export are future work. See
[the product scope](docs/PRODUCTO.md).

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
npm run build
npm run preview
```

- `typecheck`: TypeScript project checks.
- `lint`: Oxlint with warnings treated as errors.
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
    home/
      HomePage.tsx
  styles/
    global.css
docs/
  PRODUCTO.md
AGENTS.md
vercel.json
```

React and strict TypeScript provide the UI foundation. Tailwind CSS is connected
through its Vite plugin. Add shared components, hooks, utilities, types, or assets
when a concrete feature needs them.

`docs/project-context.local.md` is ignored machine-local routing context for the
paired document library. Keep external source documents and original assets in
that library; do not commit the local routing file.

## Future GitHub and Vercel setup

The repository is initialized locally. Creating a remote, staging, committing,
pushing, publishing, or deploying requires separate user authorization.

After authorization, create or select the intended GitHub repository, review the
files, make the approved commit, and publish it to that remote. Then import the
repository into Vercel using:

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
Review the deployment behavior for later pushes when connecting GitHub.

## Handoff to Dot and Codex

Read `AGENTS.md`, this README, `docs/PRODUCTO.md`, and the local project context
before planning the next bounded feature. Confirm the source quotations and
visual identity before building the editor. Historical prices are reference
material, never approved current prices.

Official references: [Vite](https://vite.dev/guide/),
[Tailwind with Vite](https://tailwindcss.com/docs/installation/using-vite), and
[Vercel's Vite guide](https://vercel.com/docs/frameworks/frontend/vite).
