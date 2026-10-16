# Repository Instructions

## Purpose and scope

This repository contains the technical foundation of Luquisound's mobile-first
quotation app. Dot coordinates later development through Codex. Read `README.md`,
`docs/PRODUCTO.md`, and, when present, `docs/project-context.local.md` before
non-trivial work. The local context routes external sources and is never staged
or committed; listed paths do not expand authorization.

The current V1 includes an editable graphic quotation template, manual rows,
optional personal catalogue, calculations, local drafts, backups, and PNG
download or file sharing. Implement future features only within the next agreed
scope. Supabase, AI, CRM, inventory management, invoicing, and a backend remain
outside this stage.

## Technical conventions

- Use Vite, React, strict TypeScript, and Tailwind CSS through
  `@tailwindcss/vite`. Keep the existing toolchain and configuration.
- Use Node.js 22.x, at least 22.12, and npm with `package-lock.json`. Use `npm ci`
  for reproducible installation from the lockfile.
- Keep code, identifiers, filenames, comments, and technical documentation in
  English/ASCII. Product-facing text is Spanish and may use required Unicode.
- Use small function components and explicit TypeScript types at data boundaries.
  Avoid `any`, implicit coercion, speculative abstractions, and unnecessary deps.
- Keep application composition in `src/app/`, feature UI in `src/features/`, and
  global styling in `src/styles/`. `src/main.tsx` is the entry point.
- Add shared `components`, `hooks`, `lib`, `types`, or `assets` directories only
  when real feature code requires them. Do not scaffold empty architecture.
- Keep the smallest maintainable change. Avoid unrelated formatting, renames,
  dependency upgrades, or configuration changes.

## UI conventions

- Start with narrow-screen layouts and touch controls. Use semantic HTML,
  accessible names, visible keyboard focus, and sufficient contrast.
- Support safe-area insets where needed and avoid horizontal overflow. Verify
  responsive changes at mobile and desktop widths.
- Lucas's target device is an iPhone; initial hands-on testing uses Android.
  Report which devices or browsers were actually verified.
- The provisional palette is black, white, and `#FFDA00`. Do not invent a logo,
  commercial prices, product data, or final brand rules.

## Product and pricing rules

- Historical quotations and prices are reference material only. Do not publish
  or prefill their values as current approved commercial prices.
- Keep internal cost, suggested price, and actual sale price distinct.
- Preserve the difference between a missing amount and an explicit zero.
- Represent an included, no-charge concept explicitly; do not infer it from a
  blank amount or collapse it into an ordinary zero-priced row.
- V1 uses one explicit currency for quotation rows (ARS or USD), safe integer
  cents, and quantity times unit price rounded half up per row. A manual positive
  ARS-per-USD rate is saved per quotation and converts only the final total, with
  half-up rounding to cents. Never infer or fetch a rate. Discounts
  and automatic margins are not implemented. See `docs/PRODUCTO.md` for the full
  calculation contract and remaining decisions.
- Preserve the approved graphic composition and official brand assets. Private
  source quotations and commercial data must never enter the public repository
  or client bundle, including when deployment access is restricted.

## Git, local files, and external effects

- Inspect `git status --short` and relevant diffs before editing and before
  handoff. Preserve unrelated tracked and untracked work.
- Do not stage, commit, mutate Git history or configuration, create remotes, or
  push unless explicitly requested. Never discard or overwrite other work.
- Keep secrets, local environment files, dependency folders, build output, and
  `docs/project-context.local.md` untracked. Never stage the local context file,
  even when making an otherwise authorized commit.
- Use OS temporary storage for disposable diagnostics; use `.agent-tmp/` only
  when repository-relative scratch space is needed. Remove only temporary files
  attributable to the current task. Do not use `.codex*` as scratch space.
- Ask before broadening scope or performing destructive, irreversible, or
  external actions. Publishing, deployment, permission/security changes, and
  credentials require explicit authorization. A prior explicit authorization
  remains valid within its stated scope.
- `vercel.json` prepares the Vite build. Do not link, import, or deploy a Vercel
  project without authorization; linking or importing can trigger deployment.

## Verification and handoff

- Discover existing scripts before changing tooling. Run focused checks first;
  `npm run typecheck` checks TypeScript, `npm run lint` runs Oxlint with warnings
  denied, and `npm run build` checks TypeScript and creates the production build.
- For foundation changes, run lint and build. For visible changes, also verify
  the affected responsive UI in a browser when available. Do not add tests that
  merely mirror trivial markup; introduce meaningful behavior tests when needed.
- Review the final diff for scope and encoding changes. Distinguish existing
  failures from regressions and report any blocked or unrun checks accurately.
- State what changed, what was verified, and remaining limitations. A passing
  local build does not establish GitHub publication or Vercel deployment.
- For Dot handoffs, identify the next bounded task and unresolved product
  decisions. Do not start future work merely because it appears in the roadmap.
