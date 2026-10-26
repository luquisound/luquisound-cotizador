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
Read-only common catalogue, DolarAPI blue-sale lookup, private daily Instaler
observation and a separately enabled conditional catalogue publisher are the
authorized server-side features. The publisher consumes existing validated
observations and private correspondences; it adds no supplier access or schedule.
See `docs/INSTALER-CATALOG-PUBLICATION.md` for its publication and recovery contract;
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

- Start directly with the yellow quotation header, without leading workspace
  whitespace, a global historical-source banner or a general pending-data
  disclaimer. Retain contextual validation and image-delivery guards. Keep private
  source metadata and stock rules in their existing internal workflows. Place bulk
  entry, saved quotations, catalogue management and New in always-visible buttons
  below the template and contact footer, including when the quotation is empty.
  Keep history and save controls inside those secondary workflows.
- Keep the full modal for equipment and custom rows focused on "Producto", unit
  price (service price for cables and labour) with its ARS or USD label, and
  "Agregar" or "Guardar". Combine SKU, brand
  and name search with independent manual entry; catalogue selection requires an explicit result
  choice, never typing, blur or save. Avoid an initial catalogue accordion.
  Selecting a catalogue product with a nonblank SKU copies its approved commercial
  title and starts with an empty detail. Keep model, variant and unit/pair/set
  presentation in that title. Users may add a detail explicitly. Entries without
  a SKU retain their maintained detail. Apply this only at selection; never prune
  or migrate existing, imported, recovered or saved quotation text.
  Keep variable quantity, detail, quotation category, currency, included state, private
  provenance and removal in "Mas opciones", with active values summarized while
  closed. Opening or closing it must preserve the draft. Retain pending and
  invalid draft saving, price states, source and stock rules; Cancel leaves the
  quotation unchanged.
- Treat the four installation slots as optional direct concepts: "Cables y
  accesorios", "Ficha bypass estereo", "Aros adaptadores 3D" and "Mano de obra de
  instalacion". Prefill only a temporary draft name and focus/select its unit
  price; hide product search and category selection. Keep variable quantity, detail,
  currency, included state and removal in "Mas opciones", except adapter size
  and quantity belong in the main form. New adapter rows require an explicit
  6.5-inch (ARS 25,000/unit) or 8-inch (ARS 35,000/unit) choice. A newly opened
  harness draft starts at the approved ARS 70,000 unit price, even from a USD
  quotation; its price remains editable and stored quantities are preserved.
  These are the approved direct-concept presets. Apply the harness preset only on new-draft
  creation, preserving existing, reclassified, imported and recovered amounts,
  currencies and pending states. Keep adapter quantity independent and price editable.
  The primary harness control opens "Editar precio" with editable price and
  currency, without an inclusion checkbox or an "Editar datos" link. Its yellow
  primary action is "Activar ficha" when initially inactive or absent, or
  "Desactivar ficha" when initially active; the white secondary action is
  "Cancelar", with no separate save action. An absent or inactive harness uses
  the same full-width "+ Ficha bypass estereo" action and dashed separator as
  other empty concepts, without an amount, detail or status. Its new modal draft
  starts inactive at ARS 70,000 without creating or charging a row. Only an active
  harness displays its actual amount in the template. Submitting activates or
  deactivates it and applies price and currency together; price or currency edits
  never change selection. Cancel or Escape discards all draft changes.
  Deactivation excludes it from totals and PNG while retaining its saved price
  and fields. Keep the modal action available while inactive.
  Persist explicit selection in `harnessSelection.enabled`. Older harness rows
  without that metadata remain active with their original values; never add,
  disable or reset them during reading or recovery.
  Size choice copies amount and ARS together; reopening must preserve saved
  overrides. Legacy generic adapters may remain unspecified; never infer size
  from price. Never automatically include a concept. Preserve IDs `cables`,
  `harness`, `adapters`
  and `labor`, all existing rows and recognized old manual names without renaming.
  Direct editing requires the matching category, an exact recognized name or
  approved adapter variant, and no provenance; custom and catalogue rows retain
  the full editor and source guards.
  Equipment and adapters retain a named add action below their current items.
  Cables and labour accept one concept for new entries or reclassification,
  preserving all existing duplicate rows. Harness suggestions are offered once,
  without blocking another manually classified harness. Installation omits
  standalone category headings; declared adapter variants share a product
  heading and retain independently editable rows, amounts and provenance.
  Accumulate new adapters only with an explicit matching identity, size,
  presentation and commercial snapshot, preserving native rounded amounts.
  Keep adapters with currency-conversion references separate so restoring their
  original currency preserves each individually rounded source amount.
  Never infer metadata or merge recovered rows. Direct presets use units;
  custom and catalogue variants can explicitly use units, pairs or sets.
  "Otro concepto" keeps independent manual/catalogue entry available.
- Cables and labour are fixed services, identified by `extras` and the stable
  `cables` or `labor` category ID, including custom and catalogue rows. Keep
  quantity exactly `1`, hide quantity controls and summaries, and edit one service
  amount. Harnesses, adapters and equipment retain their quantity behavior.
  Prepare only working copies of older services: preserve their rounded native
  line amounts and raw quantity, price, state and currency in `fixedServiceOrigin`.
  Invalid or pending conversions remain pending for explicit review; never repair
  them by silently assigning a valid price. Keep included services distinct from
  priced zero. Readers and backups preserve archived data without conversion;
  opening or duplicating a saved quotation prepares its editable copy only.
- Equipment classified as `speakers` (including component sets) or `subwoofer`
  offers an explicit factory-equipment checkbox. It uses the corresponding factory
  description and a priced zero, preserving quantity and private provenance.
  Disable product, detail, price and included editing while active. Currency can
  change explicitly between ARS and USD while the active amount stays zero.
  Turning it off restores the exact prior fields and conversion anchor, including
  incomplete drafts, without changing the stored original currency or price.
  Store the original fields in validated `factoryEquipment` metadata; never infer
  the mode from a description or zero. Factory equipment is already in the vehicle
  and does not require supplier availability. Restoring a sale row restores its
  normal source guards. Customer images contain only the active factory text and
  amount, without the stored original product or metadata.
- Start with narrow-screen layouts and touch controls. Use semantic HTML,
  accessible names, visible keyboard focus, and sufficient contrast.
  Add controls use their full row width and a minimum 48-pixel touch target
  without overlapping adjacent editing controls.
- The shared "Editar precio" modal offers an ARS/USD selector using the open
  quotation's saved rate and existing exact conversion helper. At the same saved rate,
  retain its conversion reference across currency and bypass-selection changes; a manual price edit
  resets the base. Blank stays blank and native zero needs no rate. Failed conversion
  leaves price and currency intact with contextual feedback. Save commits price
  and currency; the harness activation/deactivation action also commits selection.
  Cancel or Escape discards the modal draft.
  Price edits and currency changes must never select or deselect the bypass.
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
- Manual price inputs accept at most 15 characters, counting separators. Keep
  Argentine money parsing, two decimal places and safe-cent limits independent
  from that input bound. Reject overlong edits without truncation or changing
  stored values; preserve compatible historical and imported data when reading it.
- Preserve the difference between a missing amount and an explicit zero.
- Represent an included, no-charge concept explicitly; do not infer it from a
  blank amount or collapse it into an ordinary zero-priced row.
  An inactive harness is separate from an included, no-charge row.
- V1 uses an explicit ARS or USD currency per row, safe integer cents, and
  quantity times unit price rounded half up in each row's currency. Sum native
  ARS and USD subtotals separately. A positive ARS-per-USD rate is saved per
  quotation; each total adds its native subtotal to one conversion of the other
  subtotal, rounded half up to cents. Total calculation never converts individual
  rows or derives one total from the other. Legacy rows without a currency inherit
  `quotation.currency`; new rows store an explicit currency. Catalogue selections copy approved amounts
  and currencies together; source-only currency defaults never approve prices.
  An explicit row-currency edit converts its entered unit amount using the open
  quotation's saved `exchangeRate`: divide ARS by the ARS-per-USD rate for USD,
  multiply USD by that rate for ARS, and round half up to cents with BigInt/rational
  arithmetic. Preserve quantity and price state. Blank stays blank and explicit
  zero stays zero without requiring a rate; a positive base rounded to zero keeps
  its conversion reference and requires a valid matching rate to restore it.
  Nonzero conversion requires a valid
  rate or leaves the draft unchanged with an error. This edit never fetches a rate.
  Persist validated `currencyConversionOrigin` on quotation rows to avoid drift
  when switching back at the same rate with an untouched amount. Manual price,
  adapter-size and catalogue-selection actions reset that base. Factory mode
  preserves the prior row anchor without using it for the active zero; restoring
  the original product makes its prior price, currency and anchor consistent again.
  Format converted input within 15 characters, preferring grouped Argentine notation, then
  ungrouped notation; otherwise reject without truncation or partial changes.
  Personal-catalogue currency editing uses the same open quotation rate only for
  its manual sale price, with a temporary editor anchor and no catalogue-schema
  addition. Never convert source list prices, historical references or the
  catalogue's commercial source amounts automatically. Reading old data, opening
  a quote or changing its saved rate does not convert entered row prices.
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
