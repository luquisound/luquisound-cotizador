# Luquisound Quotation App

## Objective

Provide Lucas with a mobile-first web app for preparing personalized automotive
audio quotations for the Luquisound workshop. His primary device is an iPhone;
initial hands-on testing will use Android.

The intended product is an editable graphic quotation template with a consistent
Luquisound identity, based on the workshop's existing quotations. Those source
documents and the final visual template still require review and approval.

This repository starts with a technical foundation. Dot will coordinate later
development through Codex using the repository instructions and agreed scope.

## Current stage

- Vite, React, TypeScript, and Tailwind CSS.
- A responsive initial screen displaying "Cotizador Luquisound".
- Provisional black, white, and yellow (`#FFDA00`) styling.
- A simple folder structure, local development commands, lint, and production
  build configuration.
- Git initialization and ignore rules, without remote publication.
- Deployment instructions for Vercel, without creating a deployment.
- No backend or quotation editor.

The initial screen does not create, calculate, save, or export quotations. Its
purpose is to verify the application shell and provide a clean starting point.

## Future capabilities

Implement these in separately agreed stages:

1. Review the current quotation examples and approve the fixed visual identity
   and graphic template.
2. Edit quotation titles and rows; add manual concepts and personalized amounts.
3. Calculate totals automatically using explicitly agreed pricing rules.
4. Optionally select products from a catalogue while preserving manual entry.
5. Save and reopen quotations using a storage approach chosen for the required
   persistence and device usage.
6. Export the approved graphic quotation as PNG and verify the result on mobile.

## Pricing and data rules

- Historical prices are reference material only. Never treat them as current
  commercial prices or prefill them as approved values.
- Keep internal cost, suggested price, and actual sale price distinct. Do not
  silently substitute one for another.
- Distinguish a missing amount from an explicit zero. A blank amount must not
  become zero through an implicit default.
- Represent an included, no-charge concept explicitly so its meaning survives
  editing and export.
- Confirm how quantities, rounding, discounts, and totals work before building
  calculation behavior.
- Do not invent logos, product information, or commercial prices.

## Mobile experience

Design the editor and export flow for touch and narrow screens from the start.
Validate Android during the first tests and iPhone before accepting a real
quotation workflow. Editing controls must remain practical without compromising
the fixed graphic template's legibility.

## Open decisions

- Approved source quotations, logo assets, fonts, layout, and final brand rules.
- Quotation fields, row types, currency, number formatting, and calculation rules.
- Which internal fields may appear in a customer-facing export.
- Catalogue source, if a catalogue is needed.
- Saving, recovery, retention, and any need to use multiple devices.
- PNG dimensions, export quality, and mobile download or sharing behavior.

## Boundaries

Supabase, AI, CRM, inventory management, and invoicing are outside the authorized
scope. Do not add them as part of this foundation. A backend is not included.
Publishing a repository or deploying the application requires explicit user
authorization.

External source documents and original assets belong in the paired document
library identified by `docs/project-context.local.md`. That local routing file
is unversioned; it does not authorize changes to external resources.
