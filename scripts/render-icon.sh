#!/usr/bin/env bash
# The packaged app's icon: the brand master rasterised to build/icon.png at
# 1024px, which electron-builder derives .icns and .ico from. The PNG is
# committed so CI needs no rasteriser; run this after changing the master.
# Needs rsvg-convert (librsvg).
#
# The source is the brand art, not the in-app mark: assets/brand/ holds the
# icon at every size on both grounds, and src/renderer/src/icons/mark.svg is
# the interface's copy, drawn from theme tokens that librsvg cannot resolve.
# A6-05's packaging step points electron-builder at assets/brand/ directly
# (issue 140), after which this script and build/icon.png both go.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
rsvg-convert -w 1024 -h 1024 \
  -o build/icon.png assets/brand/icon/legible-cities-icon.svg
echo "build/icon.png written from assets/brand/icon/legible-cities-icon.svg"
