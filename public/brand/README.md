# Luquisound logo assets

The original official full horizontal logo remains unchanged as
`luquisound-horizontal.svg` (SHA-256
`5282b542fb0aaa4943dded3e04448b6e9d743d06378ca2d770626016278b3386`).

`luquisound-horizontal-black.svg` is the approved black derivative for custom
quotation headers. It keeps the original foreground letter and waveform paths,
removes the external multicolour shadow, and subtracts the speaker cutouts as
vector geometry. Letter counters remain transparent. Its viewBox remains
3469.76 by 393.05; there is no raster tracing or opaque background.

The responsive preview and PNG renderer both load this derivative using the
resource configured in `src/features/quotation/graphic.ts`. Existing fixed
quotation graphics are separate assets and retain their dark headers.
