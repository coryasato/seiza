"""Makes SeizaPlaceholder-Regular.woff2, the static placeholder shell's font.

Run once, by hand, when the subset or the source face changes; the output is
committed and nothing in the build runs this (the build has no Python).

    python3 -m venv /tmp/ft && /tmp/ft/bin/pip install fonttools brotli
    /tmp/ft/bin/python shared-web/fonts/make-placeholder-font.py

A subset of IBM Plex Sans Regular (the UI face GPUI draws with) to printable
ASCII plus the ellipsis, without hinting. Renamed "Seiza Placeholder": the
OFL reserves the name "Plex", and a subset is a modified version
(OFL.txt, conditions 3 and 4). The placeholder check
(`apps/<app>/perf/placeholder.ts`) fails if a placeholder uses a character
outside PLACEHOLDER_CHARS (`shared-web/src/placeholder.ts`); keep both lists
the same.
"""

from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

FONTS = Path(__file__).resolve().parent
SOURCE = FONTS / "IBMPlexSans-Regular.ttf"
OUTPUT = FONTS / "SeizaPlaceholder-Regular.woff2"
FAMILY = "Seiza Placeholder"
# Printable ASCII and "…" (U+2026).
UNICODES = list(range(0x20, 0x7F)) + [0x2026]

options = subset.Options()
options.flavor = "woff2"
options.hinting = False
options.desubroutinize = True
# Keep pyftsubset's default layout features (kerning among them), so the
# placeholder's text sets the way GPUI's does.
options.name_IDs = ["*"]
options.name_languages = ["*"]

font = TTFont(SOURCE)
subsetter = subset.Subsetter(options)
subsetter.populate(unicodes=UNICODES)
subsetter.subset(font)

names = font["name"]
copyright_notice = names.getDebugName(0)
license_notice = names.getDebugName(13)
license_url = names.getDebugName(14)
for record in list(names.names):
    if record.nameID not in (0, 13, 14):
        names.removeNames(nameID=record.nameID)
for name_id, value in [
    (1, FAMILY),
    (2, "Regular"),
    (3, f"{FAMILY} Regular; subset of IBM Plex Sans Regular"),
    (4, f"{FAMILY} Regular"),
    (6, FAMILY.replace(" ", "") + "-Regular"),
    (
        10,
        "A subset of IBM Plex Sans Regular for seiza's static placeholder "
        "shell, renamed as the OFL requires of a modified version.",
    ),
]:
    names.setName(value, name_id, 3, 1, 0x409)
assert copyright_notice and license_notice and license_url

subset.save_font(font, str(OUTPUT), options)
print(f"{OUTPUT.name}: {OUTPUT.stat().st_size} bytes")
