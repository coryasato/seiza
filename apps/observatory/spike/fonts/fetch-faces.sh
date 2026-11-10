#!/bin/sh
# The 13 Noto faces the spike adds, into faces/ (gitignored): notofonts'
# unhinted Regular TTFs from main, so a later run may get newer builds.
set -e
cd "$(dirname "$0")" && mkdir -p faces
for pair in arabic:NotoSansArabic armenian:NotoSansArmenian bengali:NotoSansBengali devanagari:NotoSansDevanagari ethiopic:NotoSansEthiopic georgian:NotoSansGeorgian hebrew:NotoSansHebrew khmer:NotoSansKhmer lao:NotoSansLao myanmar:NotoSansMyanmar sinhala:NotoSansSinhala thai:NotoSansThai tibetan:NotoSerifTibetan; do
  fam=${pair#*:}
  curl -sfL -o "faces/$fam-Regular.ttf" "https://raw.githubusercontent.com/notofonts/notofonts.github.io/main/fonts/$fam/unhinted/ttf/$fam-Regular.ttf"
done
ls -l faces
