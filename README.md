# Luquisound Cotizador

Mobile-first graphic quotation editor for Luquisound, built with Vite, React,
strict TypeScript and Tailwind CSS. V1 includes editable manual concepts, a private
common catalogue, optional personal products, ARS/USD calculations, recovery of one
current quotation, a named local quotation library and deterministic PNG sharing.
Fixed budgets and reusable templates remain in Figma.

The app opens on the quotation. Catalogue management, reviewed bulk entry, saved
quotations and New have always-visible buttons below the template and contact
footer, including when the quotation is empty. Product behavior,
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
| `src/server/` | Instaler extraction, observation, candidate and conditional publication |
| `src/styles/` | Global styling |
| `api/` | Same-origin catalogue, exchange-rate and observation endpoints |
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
selected quotation amounts and saved quotations. Protected stock becomes stale
after seven days without a newer recorded reading; a download does not establish
that the supplier's formulas or stock refreshed.

The natural automatic cycle and supplier changes remain separate acceptance
work. The planned review for **October 23, 2026 at 09:30 Buenos Aires** is not a
verified execution or result. Use the observation and publication runbooks for
point-in-time evidence; do not infer current live configuration from defaults,
source code or a historical checkpoint.

## Data and deployment boundaries

Current recovery, the personal catalogue and the named quotation library use
separate browser-local stores. Their private backups are separate workflows.
They do not provide cross-device history, accounts or synchronized manual prices.
Browser data can be lost with a device, origin or storage reset; keep private
backups. The legacy workspace key is never rewritten or deleted.

Supplier prices, observations, private policy, customer quotations and secrets
must never enter source, fixtures, logs or the browser bundle. The common catalogue
requires private Blob configuration and Vercel Authentication for All Deployments;
protecting a deployment does not make the repository private.

Git publication, deployment and live configuration changes require explicit
authorization. A push to a connected production branch or linking a Vercel project
can trigger deployment. `vercel.json` uses the existing Vite build (`npm ci`,
`npm run build`, output `dist`). DolarAPI needs no additional environment variables;
server-only catalogue and observer settings are covered by their runbooks and
`.env.example`.

Kits and other supplier worksheets, inventory/reservations, invoicing, CRM, AI,
quotation synchronization and a general backend remain outside this stage.
