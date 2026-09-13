#!/usr/bin/env bash
# Fetch the pinned python-build-standalone runtime for one target, verify it
# against the checksum in vendor/pins.json, unpack it, add the licence texts
# it owes, install the engine with its declared dependencies, strip what a
# sidecar never runs, and prove the result starts the sidecar the app runs.
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
# The licence texts (issue 108, ADR-042): the install_only asset carries
# CPython's LICENSE.txt and nothing for the libraries linked into the
# interpreter and its extension modules. The same build's `full` archive
# does, in `licenses/`, with PYTHON.json naming which text each extension
# owes. Both are taken from it into python/ and checked against the pins'
# lists by scripts/check-vendored.mjs --licences, beside CPython's own
# Doc/license.rst, whose incorporated-software notices LICENSE.txt lacks.
# The full archive is .tar.zst, so this needs a `zstd` on PATH, and Node
# for the check.
#
# See docs/adr/020-sidecar-packaging.md for why this and not PyInstaller.
set -euo pipefail

target=${1:-}
engine=${2:-}
outdir=${3:-vendor/python}
[ -n "$target" ] && [ -n "$engine" ] || {
  echo "usage: $0 <target> <engine-path> [outdir]" >&2; exit 2; }
[ -d "$engine" ] || { echo "no engine checkout at $engine" >&2; exit 2; }

# absolute <dir>: the directory's absolute path in the form the target's own
# Python can read. `pwd -W` is Git Bash's Windows form (D:/a/...); elsewhere
# it is not an option and plain pwd answers.
absolute() { (cd "$1" && { pwd -W 2>/dev/null || pwd; }); }

# Resolved before the cd below, so a relative engine path means relative to
# where the script was called.
engine=$(absolute "$engine")

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
stage=
trap 'rm -rf "$work" ${stage:+"$stage"}' EXIT

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

# Everything is built in a staging folder and moved to <outdir>/<target> only
# once the schema check below has passed, so a failed run never leaves a
# broken runtime at the path the gate, the upload and a developer read. The
# staging folder sits beside the destination rather than under $work so the
# move is a rename on one filesystem: on the Windows runner the temporary
# folder is on C: and the workspace on D:.
dest="$outdir/$target"
mkdir -p "$outdir"
stage=$(mktemp -d "$outdir/.staging-$target.XXXXXX")
tar xzf "$work/$asset" -C "$stage"
case "$target" in
  win-*) py="$stage/python/python.exe" ;;   # install_only puts it at the root on Windows
  *)     py="$stage/python/bin/python3" ;;
esac
[ -f "$py" ] || { echo "no interpreter at $py in $asset" >&2; exit 1; }

# The licence texts, before anything slow: a disagreement fails here.
where="$(uname -s)${RUNNER_OS:+, runner $RUNNER_OS}${ImageOS:+ ($ImageOS)}"
zstd_bin=$(command -v zstd || command -v zstd.exe || true)
[ -n "$zstd_bin" ] || {
  echo "no zstd on PATH on $where: the full archive for $target is .tar.zst and nothing else here reads it" >&2
  exit 1; }
node_bin=$(command -v node || command -v node.exe || true)
[ -n "$node_bin" ] || {
  echo "no node on PATH on $where: scripts/check-vendored.mjs checks the licence texts" >&2
  exit 1; }
echo "zstd: $zstd_bin ($("$zstd_bin" --version 2>&1 | head -1 | tr -d '\r'))"

read -r full_asset full_want notices_url notices_want notices_file <<EOP
$("$host_py" - "$pins" "$target" <<'PY'
import json, sys
p = json.load(open(sys.argv[1]))["python"]
full = p["targets"][sys.argv[2]]["full"]
notices = p["licence_texts"]["cpython_incorporated"]
sys.stdout.write(" ".join([full["asset"], full["sha256"], notices["url"], notices["sha256"], notices["file"]]))
PY
)
EOP
[ -n "${notices_file:-}" ] || { echo "could not read the licence texts' pins for $target" >&2; exit 1; }

echo "fetching $full_asset, for its licence texts"
curl -fsSL -o "$work/$full_asset" "https://github.com/astral-sh/python-build-standalone/releases/download/$release/$full_asset"
got=$(sha256 "$work/$full_asset")
if [ "$got" != "$full_want" ]; then
  echo "checksum mismatch for $full_asset" >&2
  echo "  expected $full_want" >&2
  echo "  got      $got" >&2
  echo "The pinned full archive changed. Read why before moving python.targets.$target.full." >&2
  exit 1
fi
mkdir -p "$work/full"
# Only the two members: the rest of the archive is the build's own tree
# and objects, and is never written to disk.
"$zstd_bin" -dc "$work/$full_asset" | tar -xf - -C "$work/full" python/PYTHON.json python/licenses
rm -f "$work/$full_asset"
if [ ! -f "$work/full/python/PYTHON.json" ] || [ ! -d "$work/full/python/licenses" ]; then
  echo "$full_asset has no python/PYTHON.json or python/licenses/" >&2
  exit 1
fi
rm -rf "$stage/python/licenses"
cp -R "$work/full/python/licenses" "$stage/python/licenses"
cp "$work/full/python/PYTHON.json" "$stage/python/PYTHON.json"

curl -fsSL -o "$work/$notices_file" "$notices_url"
got=$(sha256 "$work/$notices_file")
if [ "$got" != "$notices_want" ]; then
  echo "checksum mismatch for CPython's $notices_file ($notices_url)" >&2
  echo "  expected $notices_want" >&2
  echo "  got      $got" >&2
  exit 1
fi
cp "$work/$notices_file" "$stage/python/licenses/$notices_file"

"$node_bin" scripts/check-vendored.mjs "$target" --licences "$(absolute "$stage/python")"

# The engine with the dependencies it declares, which since E02 are exactly
# what the sidecar imports (pandas, python-lsp-jsonrpc, requests); nothing is
# named here, so the engine's pyproject.toml stays the one list.
#
# --only-binary :all: so nothing is compiled on the runner: a dependency with
# no wheel for the target fails the build rather than building from source
# with whatever compiler the image has. The engine itself is a source tree,
# which that flag refuses, so its wheel is built first (pure Python, through
# its hatchling backend) and installed from the file.
#
# This is not a lock: the engine's minimums allow any later version, majors
# included, and nothing is hashed. The freeze below records what each run
# shipped; see the spike report's "Still open".
"$py" -m pip install --quiet --upgrade pip
mkdir -p "$work/wheels"
"$py" -m pip wheel --quiet --no-deps -w "$(absolute "$work/wheels")" "$engine"
wheel=$(cd "$work/wheels" && ls openschematicmaps-*.whl)
"$py" -m pip install --quiet --only-binary :all: "$(absolute "$work/wheels")/$wheel"
echo "installed, as pip freeze reports it:"
"$py" -m pip list --format=freeze | tr -d '\r' | sed 's/^/  /'

# Strip what never runs in a sidecar. Measured at 78 MB and 4184 files on
# macOS arm64; see the spike report. The .pdb files are Windows' debug
# symbols, 86 MB of the Windows asset, and absent on macOS.
find "$stage" -type d -name '__pycache__' -prune -exec rm -rf {} + 2>/dev/null || true
find "$stage" -type d \( -name 'tests' -o -name 'test' -o -name 'idle_test' \) -prune -exec rm -rf {} + 2>/dev/null || true
find "$stage" -type d \( -name 'idlelib' -o -name 'tkinter' -o -name 'turtledemo' \) -prune -exec rm -rf {} + 2>/dev/null || true
find "$stage" \( -name '*.pyc' -o -name '*.pdb' \) -type f -delete 2>/dev/null || true

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

# Only now is the old runtime removed and the new one put in its place.
rm -rf "$dest"
mv "$stage" "$dest"
stage=

printf 'vendored %s: %s, %s files\n' "$target" \
  "$(du -sh "$dest" | cut -f1)" "$(find "$dest" -type f | wc -l | tr -d ' ')"
