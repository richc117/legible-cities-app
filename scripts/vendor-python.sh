#!/usr/bin/env bash
# Fetch the pinned python-build-standalone runtime for one target, verify it
# against the checksum in vendor/pins.json, unpack it, install the engine and
# its runtime dependencies, and strip what a sidecar never runs.
#
#   scripts/vendor-python.sh <target> <engine-path> [outdir]
#   scripts/vendor-python.sh darwin-arm64 ../legible-cities vendor/python
#
# Why the checksum is ours rather than upstream's: python-build-standalone
# publishes no checksum manifest and no per-asset .sha256 file. The hash in
# pins.json was computed on first download; every later build is checked
# against it, so a silently changed asset fails the build instead of shipping.
#
# See docs/adr/020-sidecar-packaging.md for why this and not PyInstaller.
set -euo pipefail

target=${1:-}
engine=${2:-}
outdir=${3:-vendor/python}
[ -n "$target" ] && [ -n "$engine" ] || {
  echo "usage: $0 <target> <engine-path> [outdir]" >&2; exit 2; }

root=$(git rev-parse --show-toplevel)
cd "$root"
pins=vendor/pins.json

read -r release asset want <<EOF
$(python3 - "$pins" "$target" <<'PY'
import json, sys
pins, target = sys.argv[1], sys.argv[2]
d = json.load(open(pins))["python"]
t = d["targets"].get(target)
if not t:
    sys.exit(f"no pin for target {target}; known: {', '.join(d['targets'])}")
print(d["release"], t["asset"], t["sha256"])
PY
)
EOF

url="https://github.com/astral-sh/python-build-standalone/releases/download/$release/$asset"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

echo "fetching $asset"
curl -fsSL -o "$work/$asset" "$url"

got=$(shasum -a 256 "$work/$asset" | cut -d' ' -f1)
if [ "$got" != "$want" ]; then
  echo "checksum mismatch for $asset" >&2
  echo "  expected $want" >&2
  echo "  got      $got" >&2
  echo "The pinned asset changed. Do not update the pin without reading why." >&2
  exit 1
fi
echo "checksum ok"

dest="$outdir/$target"
rm -rf "$dest"
mkdir -p "$dest"
tar xzf "$work/$asset" -C "$dest"
py="$dest/python/bin/python3"
[ -x "$py" ] || py="$dest/python/python.exe"   # Windows layout

# The engine without its own dependency resolution, then the runtime set the
# sidecar actually needs. --no-deps on purpose: the engine's metadata still
# lists notebook and plotting packages that a sidecar never imports, and
# installing them would triple the size. Revisit when E02 lands.
"$py" -m pip install --quiet --upgrade pip
"$py" -m pip install --quiet pandas requests
"$py" -m pip install --quiet --no-deps "$engine"

# Strip what never runs in a sidecar. Measured at 78 MB and 4184 files on
# macOS arm64; see the spike report.
find "$dest" -type d -name '__pycache__' -prune -exec rm -rf {} + 2>/dev/null || true
find "$dest" -type d \( -name 'tests' -o -name 'test' -o -name 'idle_test' \) -prune -exec rm -rf {} + 2>/dev/null || true
find "$dest" -type d \( -name 'idlelib' -o -name 'tkinter' -o -name 'turtledemo' \) -prune -exec rm -rf {} + 2>/dev/null || true
find "$dest" -name '*.pyc' -delete 2>/dev/null || true

"$py" -c "import schematic, pandas, requests" || {
  echo "the stripped runtime cannot import what the sidecar needs" >&2; exit 1; }

printf 'vendored %s: %s, %s files\n' "$target" \
  "$(du -sh "$dest" | cut -f1)" "$(find "$dest" -type f | wc -l | tr -d ' ')"
