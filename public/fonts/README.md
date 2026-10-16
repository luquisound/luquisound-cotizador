# Self-hosted brand fonts

The approved brand guide specifies Pliant Bold Expanded for display titles and
Barlow Regular for body text. This identifies the brand families; it does not
claim that the condensed type in older quotation references used Pliant.

Both original font files were downloaded from the official Google Fonts
repository on 2026-10-16. They are unmodified and distributed with their original
copyright notices and SIL Open Font License 1.1 files. No font is requested from
Google Fonts or another third-party service at runtime.

The runtime Pliant file is a separately named static derivative of the original
variable font, generated with the exact 700/125 axes. It keeps the original
copyright and OFL metadata and is covered by `pliant/OFL.txt`. That license names
no Reserved Font Names. The derivative name distinguishes this application
instance from the original font; it implies no endorsement by its authors.

| Local file | Official source | Bytes |
| --- | --- | ---: |
| `pliant/Pliant-Variable.ttf` | [Original Pliant variable TTF](https://raw.githubusercontent.com/google/fonts/main/ofl/pliant/Pliant%5Bwdth,wght%5D.ttf) | 300140 |
| `pliant/LuquisoundPliant-BoldExpanded.ttf` | Static derivative generated from that original, as documented below | 148104 |
| `pliant/OFL.txt` | [Pliant OFL](https://raw.githubusercontent.com/google/fonts/main/ofl/pliant/OFL.txt) | 4386 |
| `barlow/Barlow-Regular.ttf` | [Original Barlow Regular TTF](https://raw.githubusercontent.com/google/fonts/main/ofl/barlow/Barlow-Regular.ttf) | 104068 |
| `barlow/OFL.txt` | [Barlow OFL](https://raw.githubusercontent.com/google/fonts/main/ofl/barlow/OFL.txt) | 4377 |

## Font selection

The original Pliant contains `wght` 100-900 and `wdth` 100-125 axes. Both are fully
instantiated into the static runtime file: weight 700 and width 125. Its actual
outlines are already Bold Expanded; selecting them does not depend on variable
font state or Canvas variation support. The CSS family alias is
`Luquisound Pliant Static Expanded`, with weight 700 and stretch 125%.
There is no letter scaling or synthetic expansion.

A cold WebKit Canvas export drew thin outlines when using the variable font,
despite correct text advances and loaded face descriptors. Width measurements
alone did not detect the problem. The static derivative avoids that variation
selection discrepancy; verify both rasterized glyphs and metrics when changing
the font pipeline.

`Luquisound Barlow` selects the original Regular 400 face. Body text and controls
use weight 400; emphasis comes from placement, size, and color. Font synthesis is
disabled in the document. The quotation title and totals use Pliant 700/125%.

The editor may display a system fallback while local fonts load. PNG preparation
explicitly loads both declared faces and reports failure or timeout rather than
measuring and exporting with fallback fonts. The original files remain available
unchanged for license and reproduction checks.

## Reproducing the static Pliant instance

Generated using Python and FontTools 4.63.0, without subsetting or outline
scaling. From the repository root, run:

```sh
python -m fontTools.varLib.instancer public/fonts/pliant/Pliant-Variable.ttf wght=700 wdth=125 --static --update-name-table --no-recalc-timestamp -o public/fonts/pliant/LuquisoundPliant-BoldExpanded.ttf
```

Then run this Python code to give the derivative distinct family and PostScript
names. Preserve all copyright, licensing, and author records:

```python
from fontTools.ttLib import TTFont

path = "public/fonts/pliant/LuquisoundPliant-BoldExpanded.ttf"
font = TTFont(path, recalcTimestamp=False)
names = {
    1: "Luquisound Pliant Static Expanded",
    2: "Bold",
    3: "1.000;Luquisound;LuquisoundPliantStatic-BoldExpanded",
    4: "Luquisound Pliant Static Bold Expanded",
    6: "LuquisoundPliantStatic-BoldExpanded",
    16: "Luquisound Pliant Static",
    17: "Bold Expanded",
}
for entry in list(font["name"].names):
    if entry.nameID in names:
        font["name"].setName(
            names[entry.nameID], entry.nameID,
            entry.platformID, entry.platEncID, entry.langID,
        )
font.save(path)
assert "fvar" not in font and "gvar" not in font
assert font["OS/2"].usWeightClass == 700
assert font["OS/2"].usWidthClass == 7
```

## SHA-256

```text
11cb215c4380f2e7e4cb40e38cf799cba36faf89dae69a688eb7cca6f30f0915  pliant/Pliant-Variable.ttf
d45716343c4de789a580cfebab62c80a0eadace8361745e747eb80e295dee3b6  pliant/LuquisoundPliant-BoldExpanded.ttf
b20d21c35b3cf632caee80c7aad2c74a2a405a70544acc561cce4a60238874ee  pliant/OFL.txt
95aa02c7c43096e0dd44d787ba6216864a67157e402adab59b35572e0c1577ea  barlow/Barlow-Regular.ttf
186d750eb496a4c17a76385f82be6aea2ac1cf2de074a811d63786cf374ea73f  barlow/OFL.txt
```
