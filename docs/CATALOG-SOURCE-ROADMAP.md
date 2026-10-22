# Supplier source status and roadmap

## Implemented components

The private common catalogue uses the existing import schema and protected
`GET /api/catalog` endpoint. The Instaler integration has separate offline review,
observation and publication components; access, authentication and the publisher
are implemented rather than future design choices.

| Component | Implemented responsibility | Reference |
| --- | --- | --- |
| Offline review | Read a supplied XLSX, retain cached evidence and compare a supplied local baseline; write a private review report only | [Snapshot preparation](INSTALER-SNAPSHOT-PREPARATION.md) |
| Daily observation | Workshop Apps Script downloads the existing Drive XLSX and uploads it to the authenticated Vercel observer; private evidence and daily guards remain independent of publication | [Observation runbook](INSTALER-OBSERVATION.md) |
| Catalogue publication | Build a complete `Precios` candidate using reviewed private correspondences, compare the active catalogue and write conditionally with private recovery versions | [Publication runbook](INSTALER-CATALOG-PUBLICATION.md) |
| Browser loading | Load the protected catalogue on entry and once per daily cycle while preserving manual prices and quotation snapshots | [Shared catalogue](SHARED-CATALOG.md) |

The standalone sender uses the workshop's Google authorization and Drive download
route. The observer's only mode remains `observe`; publication has its own explicit
server setting. Google owns the single daily 08:00-09:00 Buenos Aires trigger.
No direct browser access to Google Sheets, public Google web app, service account
or additional periodic job is required by this path. Disabled code defaults do
not describe the current live configuration.

The command-line review remains available independently. Running it does not
activate a service, download from Drive or publish its output. Its partial review
report is not a catalogue import document.

## Contracts and failure boundaries

Use [the import contract](CATALOG-IMPORT.md) as the schema reference for stock,
reviewed list prices, supplier/SKU identity, `refreshSuppliers`, `readAt`, source
replacement and private row provenance. The
[publication runbook](INSTALER-CATALOG-PUBLICATION.md) defines the private policy,
absent-product blocks, concurrent writes, last-valid recovery and explicit restore.
These contracts preserve the following boundaries:

- Source identity uses supplier and SKU, never name similarity or row position.
  Duplicates and ambiguous text need reviewed evidence; no arbitrary row wins.
- Only `Precios` is in scope. Its ARS retail list amount is before supplier discount
  with VAT already included; no discount, surcharge, margin or extra VAT is added.
- Missing, decimal, zero and negative stock remain distinct. Failed or partial
  reads preserve the valid catalogue, without synthesizing zero or deleting known
  identities. Publication keeps absent products explicitly blocked.
- Reading time is separate from supplier freshness. Cached formulas are not
  recalculated; a successful download does not establish a commercial validity
  date or current stock. Protected stock carrying a reading time expires after
  seven days without a newer successful reading, including historical stock.
- Availability can block selection or image delivery while selected amounts,
  currencies, original provenance and saved quotations remain unchanged. Manual
  independent concepts remain separate. There are no reservations or deductions.

Business account details, source identifiers, correspondences, source checksums,
workbooks and detailed reports belong in authorized private storage or the external
project library. Never bundle or commit commercial data or credentials. Do not
follow private formula links or extract browser cookies/tokens. A change of source
or access method requires its own authorization and validation.

## Pending operational acceptance

Implemented behavior, configured services and naturally observed operation are
separate evidence. Consult the dated checkpoint in the observation runbook and
recheck live state before any operational change; a local test or prior deployment
does not prove that a later scheduled cycle ran.

The planned **October 23, 2026 at 09:30 Buenos Aires** review remains pending. It
must independently establish the next natural execution and its outcome; its
scheduling and success are not established by this document. Do not clear daily
guards, force a Drive read or open the online workbook to manufacture acceptance.

Acceptance should inspect the natural reading, private candidate/publication
result and catalogue delivery, including unchanged supplier values. Supplier price
or stock changes may require later natural evidence; an unchanged workbook does
not establish that its formulas refreshed. Physical iPhone/Android image sharing
acceptance remains separate from browser emulation and local checks.

## Deferred scope

Kits, component completeness and `Precios Multimedia Completos` remain outside the
first integration. Native Sheets API reads, alternate identities and revised source
contracts are not prerequisites for the existing Drive XLSX route and should only
be considered under separately approved scope.

Quotation synchronization, accounts, synchronized manual prices, inventory,
reservations, invoicing and CRM remain outside V1. Future changes must preserve
private source boundaries, stable identity and the last valid catalogue, with
bounded verification and explicit authorization for external actions.
