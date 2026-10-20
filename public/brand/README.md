# Luquisound logo asset

The original official full horizontal logo is used without recolouring as
`luquisound-horizontal.svg` (SHA-256
`5282b542fb0aaa4943dded3e04448b6e9d743d06378ca2d770626016278b3386`).
Its original black #010000 outlines separate the white #FEFEFE and yellow
#FED903 shapes on the quotation's #FFDA00 header.

The responsive preview and PNG renderer both load this original SVG using the
resource configured in `src/features/quotation/graphic.ts`. Existing fixed
quotation graphics are separate assets and retain their dark headers.

## Favicon

The official `MONOGRAMA.svg` (source SHA-256
`cf6cc7bd4a72f1f74ebf126d09c9f35f8dc0d741bfd91a62600305ecf829c784`)
is adapted as `/favicon.svg`. Its seven paths and original colours are preserved,
centred on a square #010000 background with padding for small browser icons.

`/favicon.ico` contains 16, 32 and 48 pixel versions, and
`/apple-touch-icon.png` is 180 pixels square. Both are rendered from the same
favicon SVG. The HTML head declares all three assets.
