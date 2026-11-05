# Luquisound Cotizador

Mobile-first graphic quotation editor for Luquisound, built with Vite, React,
strict TypeScript and Tailwind CSS. V1 includes editable manual concepts, a private
common catalogue, previously stored personal products, ARS/USD calculations, an
optional manual sale discount on selected equipment, free item reordering within
each section with a combined restore/undo control,
recovery of one current quotation and deterministic PNG sharing. The source also
implements an opt-in private shared quotation board for the two intended users,
adapted to Cloudflare Workers Free and D1 Free for two users. The selected sign-in
uses a shared user-chosen password, browser-side PBKDF2 derivation, server-side
verification of the derived credential and a remembered browser session for
30 days. Google and Cloudflare Zero Trust are not
required. The shared board is operational at
[cotizador.luquisound.com](https://cotizador.luquisound.com); physical-device
acceptance remains separate. Existing fixed
budgets in Figma are not imported automatically. The earlier generated-password
transition passed live sign-in and old PIN/session rejection without changing
saved quotations. The later user-chosen password rotation is operational, with
native browser sign-in, remembered session and unchanged board data verified;
see the host runbook for evidence and acceptance limits.

The app opens on the quotation. Save to board, Board, reviewed bulk entry and
New have always-visible buttons below the template and contact
footer, including when the quotation is empty. Shared saving supports complete
or partial quotations, optional categories, and explicit replace/save-as-new
choices. Product behavior,
pricing rules and graphic requirements belong in [PRODUCTO.md](docs/PRODUCTO.md).

## Local setup

Use Node.js 22.x, at least 22.12, and npm with the committed `package-lock.json`.
The full test suite and offline supplier command also require Python 3.10+ with
its standard library; Python is not required by the deployed receiver.
From the repository root:

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. For a phone on the same trusted Wi-Fi network:

```sh
npm run dev -- --host 0.0.0.0
```

Keep the computer running and reachable. Check narrow screens and touch controls;
browser emulation and Android checks do not establish physical iPhone acceptance.
Server configuration is documented separately; a browser-only local session does
not establish that the protected catalogue or exchange-rate endpoints work.

The editor uses the configured private board API. Vite alone does not enable
that service. The earlier in-memory design prototype has been retired. See
[the board runbook](docs/QUOTATION-BOARD.md) for the implemented contract,
access gates and operational status. [CLOUDFLARE.md](docs/CLOUDFLARE.md) covers the
selected Free-plan host, required account/access settings and local Worker checks.

## Checks and production preview

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run preview
```

`typecheck` checks application and test TypeScript. `lint` runs Oxlint with warnings
denied. `test` runs the Node.js suite; XLSX reader fixtures also require Python
3.10+ with its standard library. `build` checks TypeScript and creates `dist/`;
run it before the local `preview` server.

[GitHub Actions](.github/workflows/ci.yml) runs `npm ci`, typecheck, lint, tests and
build on pushes to `main` and pull requests, with read-only repository permissions.
Passing local checks does not establish publication, deployment or live acceptance.
The workflow also deploys automatically to Cloudflare after successful checks
on pushes to `main`. Deployment requires the dedicated Actions secret
described in [CLOUDFLARE.md](docs/CLOUDFLARE.md#automatic-deployment-from-github).

The offline supplier review is an explicit separate command:

```sh
npm run prepare:instaler -- --xlsx ../private/source.xlsx --current-catalog ../private/catalog.json --output ../private/review.json
```

Use an existing private directory outside Git and a new output filename. See the
[offline preparation guide](docs/INSTALER-SNAPSHOT-PREPARATION.md) for limits,
Python selection and the review report contract.

`scripts/read-instaler-xlsx.py` remains the offline extractor used by that command
and reader parity tests. The automated receiver uses the separate Node reader in
`src/server/instaler-xlsx.ts`; it does not invoke Python.

## Repository structure

| Path | Responsibility |
| --- | --- |
| `src/main.tsx`, `src/app/` | Application entry and composition |
| `src/features/quotation/` | Quotation UI, calculations, catalogue, storage and export |
| `src/features/quotation-board/` | Shared-board UI, contracts, client and recovery |
| `src/server/` | Private board storage/recovery and Instaler extraction, observation and publication |
| `cloudflare/` | Protected Worker entry and local/remote-target D1 migration source |
| `src/styles/` | Global styling |
| `api/` | Existing protected Vercel catalogue and supplier endpoints |
| `apps-script/instaler-observation/` | Private workshop sender source; excluded from the browser build |
| `scripts/` | Offline supplier snapshot review and XLSX reader |
| `public/brand/`, `public/fonts/` | Official brand assets and licensed fonts |
| `tests/` | Synthetic behavior and integration tests |
| `docs/` | Product contracts and operational runbooks |

`docs/project-context.local.md`, when present, routes the paired external document
library. It is machine-local and must never be committed. Original source files,
private reports and commercial data stay in that library or authorized private
storage, outside the public repository and client bundle.

## Documentation map

| Read | For |
| --- | --- |
| [AGENTS.md](AGENTS.md) | Repository instructions and authorization boundaries |
| [PRODUCTO.md](docs/PRODUCTO.md) | UI, calculation, persistence and product scope |
| [QUOTATION-BOARD.md](docs/QUOTATION-BOARD.md) | Implemented shared board, activation gates and private recovery |
| [CLOUDFLARE.md](docs/CLOUDFLARE.md) | Workers Free/D1 host, shared password/session protection and rollout status |
| [CATALOG-IMPORT.md](docs/CATALOG-IMPORT.md) | Private JSON schema, identity, merge and source metadata |
| [SHARED-CATALOG.md](docs/SHARED-CATALOG.md) | Protected endpoint, server configuration and browser loading |
| [CATALOG-SOURCE-ROADMAP.md](docs/CATALOG-SOURCE-ROADMAP.md) | Implemented supplier components, pending acceptance and deferred scope |
| [INSTALER-SNAPSHOT-PREPARATION.md](docs/INSTALER-SNAPSHOT-PREPARATION.md) | Offline CLI, cached XLSX evidence and partial review |
| [INSTALER-OBSERVATION.md](docs/INSTALER-OBSERVATION.md) | Apps Script sender, receiver, daily guard and observation checkpoint |
| [INSTALER-CATALOG-PUBLICATION.md](docs/INSTALER-CATALOG-PUBLICATION.md) | Private correspondences, publication, recovery and acceptance |
| [EXCHANGE-RATE.md](docs/EXCHANGE-RATE.md) | Independent DolarAPI behavior and frozen saved rates |
| [Font provenance](public/fonts/README.md) | Self-hosted fonts and licenses |

## Implemented integration and pending acceptance

The workshop's Apps Script reads the existing supplier XLSX through Drive and
uploads it to the protected Vercel observer. The observer remains in `observe`
mode; a separate explicitly enabled publisher can consume its committed evidence,
validate a complete `Precios` candidate and conditionally update private Blob.
Google owns the single daily 08:00-09:00 Buenos Aires trigger. No Vercel cron,
public Google web app or direct browser access to the supplier is required.

The app loads the configured catalogue on entry and once per daily cycle at
09:00 Buenos Aires while visible and online. Returning or reconnecting checks
whether that cycle is due. There is no catalogue refresh/retry button. Failed
reads preserve the last valid data. Catalogue refresh preserves manual prices,
selected quotation amounts. Protected stock becomes stale
after seven days without a newer recorded reading; a download does not establish
that the supplier's formulas or stock refreshed.

The natural automatic cycle and supplier changes remain separate acceptance
work. The planned review for **October 23, 2026 at 09:30 Buenos Aires** is not a
verified execution or result. Use the observation and publication runbooks for
point-in-time evidence; do not infer current live configuration from defaults,
source code or a historical checkpoint.

## Data and deployment boundaries

Current recovery and the catalogue cache use separate browser-local stores.
The personal catalogue manager and its file import/backup controls are not
available. Existing local products and prices remain selectable; their data and
the common-catalogue cache are preserved without deletion or migration.
The shared board is separate from browser recovery and the former local quotation
library. When explicitly enabled on the protected Cloudflare host, it stores
named quotation snapshots privately in D1 for cross-device opening, replacement
or saving as another entry. Working source context and the exact pending save
command recover with
the current quotation in one local record. Reload never posts a pending save;
an explicit retry resolves it before creating another version. Previously stored
quotation-library bytes and the legacy workspace key remain untouched. Browser
data can be lost with a device, origin or storage reset. Moving to a new host does
not migrate the old origin's local recovery or catalogue cache; preserve that
origin and its data. Manual catalogue-price synchronization, quotation-history
import/export and a quotation connection to
Sheets or Drive are not implemented.

Supplier prices, observations, private policy, customer quotations and secrets
must never enter source, fixtures, logs or the browser bundle. The Cloudflare host
requires a valid server-signed browser session before serving app assets or APIs.
Only the password login form and its submission are public. The selected hostname is
`cotizador.luquisound.com`;
workers.dev and preview URLs remain disabled. The existing Vercel
catalogue/observer/publication
deployment keeps its own private Blob configuration and All Deployments
protection; the Cloudflare host reads the private catalogue through its
server-only credential and existing validation rules. Protecting either host
does not make the repository private.

Git publication, deployment and live configuration changes require explicit
authorization. A push to a connected production branch or linking a Vercel project
can trigger deployment. `vercel.json` uses the existing Vite build (`npm ci`,
`npm run build`, output `dist`). DolarAPI needs no additional environment variables;
server-only settings are covered by their runbooks, the legacy `.env.example`
and Cloudflare `.dev.vars.example`. Blank examples keep the board disabled and
its authentication-review gate false; the verified canonical deployment uses
`shared` mode and a true review gate. D1 and the private
`COTIZADOR_PIN_AUTH_SECRET` configuration must be present before activation.
All assets and alternate URLs remain protected or disabled. The current
custom-domain Worker uses server password/session authentication, with D1
created and migrations `0001` through `0003` applied. The private catalogue source
has been configured and validated. The earlier PIN secret/private handoff were
provisioned, and their live authentication, catalogue/exchange-rate reads and
cross-session partial-save/open/replace/copy/conflict checks passed. The later
password rotation and live acceptance also passed, preserving the existing board
data and catalogue. The credential and signer JSON stay outside the repository
and client bundle. Physical
Android/iPhone acceptance remains pending. Workers Free and D1 Free are the selected app
plans; quota exhaustion must block work instead of enabling a paid upgrade. The
unused Zero Trust setup is not a dependency, and any account-owner cancellation
is handled separately in the provider UI. The prior
Vercel/Blob board adapter remains disabled compatibility code, not the selected
deployment. The Apps Script/Vercel supplier pipeline remains independent.
Existing Vercel Hobby/Blob Free quotas were also checked to block excess usage;
this does not resolve commercial-plan eligibility under Vercel's terms. Only the
separate domain registration/renewal cost is authorized, with no paid upgrade or
add-on.

Kits and other supplier worksheets, inventory/reservations, invoicing, CRM, AI,
simultaneous document editing, manual-price synchronization and a general backend
remain outside this stage. Category rename/delete, entry deletion and automatic
Figma imports are not implemented. The next bounded work is user/Lucas acceptance
on their actual devices while preserving the selected Free plans and existing data.
