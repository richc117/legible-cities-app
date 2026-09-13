#!/usr/bin/env bash
# Fetch the pinned python-build-standalone runtime for one target, verify it
# against the checksum in vendor/pins.json, unpack it, install the engine with
# its declared dependencies, strip what a sidecar never runs, and prove the
# result starts the sidecar the app runs.
#
#   scripts/vendor-python.sh <target> <engine-path> [outdir]
#   scripts/vendor-python.sh darwin-arm64 ../legible-cities vendor/python
#
# Targets are the keys of python.targets: darwin-arm64, darwin-x64, win-x64.
# On Windows it runs under Git Bash, so every tool it calls is one Git for
# Windows ships, and every hash is taken by Python rather than by shasum or
# sha256sum, neither of which all three runners are sure to have.
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
[ -d "$engine" ] || { echo "no engine checkout at $engine" >&2; exit 2; }

# The engine path is resolved before the cd below, so a relative one means
# relative to where the script was called. `pwd -W` is Git Bash's Windows
# form (D:/a/...), which the Windows interpreter's pip can read; elsewhere
# it is not an option and plain pwd answers.
engine=$(cd "$engine" && { pwd -W 2>/dev/null || pwd; })

root=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
cd "$root"
pins=vendor/pins.json

# A Python on the build machine, only to read the pins and take hashes. The
# Windows runner may have `python` and no working `python3`.
host_py=
for candidate in python3 python; do
  if "$candidate" -c 'import sys; sys.exit(sys.version_info < (3, 9))' >/dev/null 2>&1; then
    host_py=$candidate; break
  fi
done
[ -n "$host_py" ] || { echo "no Python 3.9 or later on PATH to read $pins" >&2; exit 2; }

# sha256 <file>: the hex digest, the same on every runner. The file arrives
# on stdin, so no POSIX path has to survive translation for a Windows Python,
# and it is written without a newline, which a Windows Python would end in \r.
sha256() {
  "$host_py" -c 'import hashlib, sys; sys.stdout.write(hashlib.sha256(sys.stdin.buffer.read()).hexdigest())' < "$1"
}

read -r release asset want schema_want <<EOP
$("$host_py" - "$pins" "$target" <<'PY'
import json, sys
pins, target = sys.argv[1], sys.argv[2]
p = json.load(open(pins))
d = p["python"]
t = d["targets"].get(target)
if not t:
    sys.exit(f"no pin for target {target}; known: {', '.join(d['targets'])}")
# write, not print: a Windows Python ends a printed line in \r\n, and the
# \r would become part of the last field read below.
sys.stdout.write(" ".join([d["release"], t["asset"], t["sha256"], p["engine"]["schema_sha256"]]))
PY
)
EOP
[ -n "${schema_want:-}" ] || { echo "could not read the pins for $target" >&2; exit 1; }

url="https://github.com/astral-sh/python-build-standalone/releases/download/$release/$asset"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

echo "fetching $asset"
curl -fsSL -o "$work/$asset" "$url"

got=$(sha256 "$work/$asset")
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
case "$target" in
  win-*) py="$dest/python/python.exe" ;;   # install_only puts it at the root on Windows
  *)     py="$dest/python/bin/python3" ;;
esac
[ -f "$py" ] || { echo "no interpreter at $py in $asset" >&2; exit 1; }

# The engine with the dependencies it declares, which since E02 are exactly
# what the sidecar imports (pandas, python-lsp-jsonrpc, requests); nothing is
# named here, so the engine's pyproject.toml stays the one list.
"$py" -m pip install --quiet --upgrade pip
"$py" -m pip install --quiet "$engine"

# Strip what never runs in a sidecar. Measured at 78 MB and 4184 files on
# macOS arm64; see the spike report. The .pdb files are Windows' debug
# symbols, 86 MB of the Windows asset, and absent on macOS.
find "$dest" -type d -name '__pycache__' -prune -exec rm -rf {} + 2>/dev/null || true
find "$dest" -type d \( -name 'tests' -o -name 'test' -o -name 'idle_test' \) -prune -exec rm -rf {} + 2>/dev/null || true
find "$dest" -type d \( -name 'idlelib' -o -name 'tkinter' -o -name 'turtledemo' \) -prune -exec rm -rf {} + 2>/dev/null || true
find "$dest" \( -name '*.pyc' -o -name '*.pdb' \) -type f -delete 2>/dev/null || true

# The check runs what the app runs, and writes no bytecode back into the
# runtime it has just stripped (the size below is what ships).
export PYTHONDONTWRITEBYTECODE=1
if ! "$py" -m schematic.serve --schema > "$work/schema.json"; then
  echo "the stripped runtime cannot start the sidecar: python -m schematic.serve --schema failed" >&2
  exit 1
fi

# The engine at the pinned tag writes the schema through text-mode stdout, so
# on Windows every line ends in \r\n and the hash would never match. Strip the
# carriage returns before hashing; this can go once the pin moves past the
# engine release carrying E19's follow-up (the schema written to
# sys.stdout.buffer). The check itself stays on every target.
tr -d '\r' < "$work/schema.json" > "$work/schema.lf.json"
schema_got=$(sha256 "$work/schema.lf.json")
if [ "$schema_got" != "$schema_want" ]; then
  echo "the vendored engine's schema is not the pinned one" >&2
  echo "  engine.schema_sha256 $schema_want" >&2
  echo "  vendored runtime     $schema_got" >&2
  exit 1
fi
echo "schema ok: $schema_got"

printf 'vendored %s: %s, %s files\n' "$target" \
  "$(du -sh "$dest" | cut -f1)" "$(find "$dest" -type f | wc -l | tr -d ' ')"
