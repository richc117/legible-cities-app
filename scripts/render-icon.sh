#!/usr/bin/env bash
# The app icon: the mark on the sepia ground, rasterised once to
# build/icon.png at 1024px (electron-builder derives .icns and .ico). The
# PNG is committed so CI needs no rasteriser; run this after editing
# src/renderer/src/icons/mark.svg. Needs rsvg-convert (librsvg).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
mark=$(sed -e 's/^<svg[^>]*>//' -e 's#</svg>$##' src/renderer/src/icons/mark.svg)
tmp=$(mktemp -t legible-cities-icon.XXXXXX.svg)
cat > "$tmp" <<SVG
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" rx="224" fill="#f7efe1"/>
  <g transform="translate(160 160) scale(29.333)" fill="none" stroke="#2d241d" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    $mark
  </g>
</svg>
SVG
rsvg-convert -w 1024 -h 1024 -o build/icon.png "$tmp"
rm -f "$tmp"
echo "build/icon.png written"
