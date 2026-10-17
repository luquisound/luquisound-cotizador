# Repository Instructions

## Purpose and scope

This repository contains the technical foundation of Luquisound's mobile-first
quotation app. Dot coordinates later development through Codex. Read `README.md`,
`docs/PRODUCTO.md`, and, when present, `docs/project-context.local.md` before
non-trivial work. The local context routes external sources and is never staged
or committed; listed paths do not expand authorization.

The current V1 includes an editable graphic quotation template, manual rows,
an optional personal catalogue, a private common catalogue loaded through a
read-only endpoint, reviewed bulk entry, calculations, recovery of one current
quotation, a browser-local named quotation library, separate private catalogue
and quotation backups, and deterministic PNG download or file sharing. Fixed
budgets and templates remain in Figma. The local library supports explicit save,
open and duplicate; it is not a backend or cross-device quotation history.
Read-only common catalogue and DolarAPI blue-sale lookup are the
authorized server-side features;
quotation and manual-price synchronization, accounts, Supabase, AI, CRM,
inventory management, invoicing, and a general backend remain outside this stage.

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

- Keep the graphic quotation as the initial focus. Place bulk entry, saved
  quotations, catalogue management and New behind the single discreet "Opciones"
  secondary menu. Do not restore a prominent action toolbar or expose history
  and save controls on entry; these capabilities remain available inside their
  secondary workflows.
- Start with narrow-screen layouts and touch controls. Use semantic HTML,
  accessible names, visible keyboard focus, and sufficient contrast.
- Support safe-area insets where needed and avoid horizontal overflow. Verify
  responsive changes at mobile and desktop widths.
- Lucas's target device is an iPhone; initial hands-on testing uses Android.
  Report which devices or browsers were actually verified.
- The provisional palette is black, white, and `#FFDA00`. Do not invent a logo,
  commercial prices, product data, or final brand rules.

## Product and pricing rules

- Historical quotations and unapproved price references are not current approved
  commercial prices. A reviewed private source may explicitly supply a retail
  list price before supplier discount, with its own provenance and provisional
  flag. Never infer that approval from a cost, reference, filename or import date;
  never invent a missing commercial date or apply a supplier discount.
- Keep internal cost, suggested price, and actual sale price distinct.
- Preserve the difference between a missing amount and an explicit zero.
- Represent an included, no-charge concept explicitly; do not infer it from a
  blank amount or collapse it into an ordinary zero-priced row.
- V1 uses an explicit ARS or USD currency per row, safe integer cents, and
  quantity times unit price rounded half up in each row's currency. Sum native
  ARS and USD subtotals separately. A positive ARS-per-USD rate is saved per
  quotation; each total adds its native subtotal to one conversion of the other
  subtotal, rounded half up to cents. Never convert rows or derive one total from
  the other. Legacy rows without a currency inherit `quotation.currency`; new
  rows store an explicit currency. Catalogue selections copy approved amounts
  and currencies together; source-only currency defaults never approve prices.
  An automatic-mode quotation uses DolarAPI blue sale,
  refreshing hourly while active and after reload if due,
  independently of local-storage failures or saving pauses. Preserve source/date
  metadata and recovered values until an automatic lookup succeeds. Explicitly
  saving, opening or duplicating a library entry freezes its amounts, currencies
  and rate. Only the confirmed current-dollar action resumes automatic lookup;
  it never changes the saved library entry. Discounts
  and automatic margins are not implemented. See `docs/PRODUCTO.md` for the full
  calculation contract and remaining decisions.
- Preserve the approved graphic composition and official brand assets. Private
  source quotations and commercial data must never enter the public repository
  or client bundle, including when deployment access is restricted.
- Keep the current quotation recovery and persistent catalogue separate. New
  replaces only the current quotation after confirmation when it has meaningful
  content or an unreadable recovery record. The named quotation library has its
  own storage key and backup envelope; save only on explicit actions, compare
  stored bytes before writes, and preserve unreadable bytes and pending in-memory
  changes on failure. Title, rate or notes alone do not create a new archive.
  Catalogue backups preserve approved prices, IDs, and provenance;
  their importer restores only the catalogue from an old workspace backup after
  confirmation.
  The separate quotation-library importer extracts only quotations after preview
  and confirmation, preserving the open quotation and catalogue.
  Never rewrite or delete the legacy `luquisound.workspace.v1` storage key.
- Respect availability policies at selection, bulk application and image delivery.
  Protected products require valid prices and positive eligible stock; historical
  positive observations remain provisional. Explicit blocks, zero, negative,
  unknown, stale or future observations do not become manual stock overrides.
  Independent manual concepts remain available. Preserve row provenance and
  original selected prices when users edit sale amounts or currencies; private
  source metadata never belongs in customer descriptions or image output.

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
