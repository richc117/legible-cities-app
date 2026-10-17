#!/usr/bin/env bash
# Fetch the pinned python-build-standalone runtime for one target, verify it
# against the checksum in vendor/pins.json, unpack it, add the licence texts
# it owes, install the locked packages of vendor/python-requirements.txt by
# their hashes and the engine at its pinned commit beside them, strip what a
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

read -r release asset want schema_want engine_tag engine_version engine_commit \
  requirements_want pip_version pip_sha256 <<EOP
$("$host_py" - "$pins" "$target" <<'PY'
import json, sys
pins, target = sys.argv[1], sys.argv[2]
p = json.load(open(pins))
d = p["python"]
t = d["targets"].get(target)
if not t:
    sys.exit(f"no pin for target {target}; known: {', '.join(d['targets'])}")
e = p["engine"]
# write, not print: a Windows Python ends a printed line in \r\n, and the
# \r would become part of the last field read below.
sys.stdout.write(" ".join([d["release"], t["asset"], t["sha256"], e["schema_sha256"],
    e["tag"], e["version"], e["commit"], d["requirements"]["sha256"],
    d["pip"]["version"], d["pip"]["sha256"]]))
PY
)
EOP
[ -n "${pip_sha256:-}" ] || { echo "could not read the pins for $target" >&2; exit 1; }

# The engine at the pinned commit and the locked packages the pins name
# (issue 434), both refused before anything is fetched. The engine's wheel is
# built from the working tree, so a change in it, or a file in it git does
# not track, would ship: the checkout must be clean as well as at the commit.
requirements=vendor/python-requirements.txt
[ -f "$requirements" ] || {
  echo "no $requirements; scripts/lock-python.sh writes it from the engine's uv.lock" >&2; exit 1; }
requirements_got=$(sha256 "$requirements")
if [ "$requirements_got" != "$requirements_want" ]; then
  echo "$requirements is not the manifest vendor/pins.json names" >&2
  echo "  python.requirements.sha256 $requirements_want" >&2
  echo "  $requirements $requirements_got" >&2
  echo "Regenerate it with scripts/lock-python.sh and move the pin with it." >&2
  exit 1
fi
engine_head=$(git -C "$engine" rev-parse HEAD 2>/dev/null) || {
  echo "$engine is not a git checkout, so its commit cannot be held to engine.commit" >&2; exit 1; }
if [ "$engine_head" != "$engine_commit" ]; then
  echo "the engine checkout is not the pinned commit" >&2
  echo "  engine.commit $engine_commit ($engine_tag)" >&2
  echo "  checked out   $engine_head" >&2
  exit 1
fi
engine_changes=$(git -C "$engine" status --porcelain)
if [ -n "$engine_changes" ]; then
  echo "the engine checkout at $engine_commit has changes, which its wheel would carry:" >&2
  printf '%s\n' "$engine_changes" | head -n 20 >&2
  exit 1
fi
echo "engine $engine_tag at $engine_commit; $requirements $requirements_got"

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
# Only the two members are kept: the rest of the archive is the build's own
# tree and objects. It is decompressed to a file for a moment all the same,
# and why is in the script that does it (issue 319). That script also refuses
# an archive without the two.
ZSTD_BIN="$zstd_bin" bash scripts/vendor-python-licences.sh "$work/$full_asset" "$work/full"
rm -f "$work/$full_asset"
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

# The packages, locked (issue 434). Until then pip resolved the engine's
# minimums on the day, any later version and any major allowed, nothing
# hashed, and upgraded itself to whatever was newest. Now every package is in
# vendor/python-requirements.txt at one version with the sha256 of each file
# it may come from, exported from the engine's own uv.lock at the pinned tag
# (scripts/lock-python.sh), and --require-hashes makes pip refuse a file
# whose hash is not listed and a requirement that is not pinned and hashed,
# dependencies included, so nothing outside the file is resolved.
# --only-binary :all: so nothing is compiled on the runner: a package with no
# wheel for the target fails the build rather than building from source with
# whatever compiler the image has.
#
# pip first, at python.pip's version, from a requirement written here with
# the pinned wheel's hash. The asset of the pinned release already carries
# that version, so pip changes nothing and the asset's checksum covers it; at
# another release pip fetches the pinned wheel and checks it.
export PIP_DISABLE_PIP_VERSION_CHECK=1
printf 'pip==%s --hash=sha256:%s\n' "$pip_version" "$pip_sha256" > "$work/pip.txt"
"$py" -m pip install --quiet --require-hashes --only-binary :all: -r "$(absolute "$work")/pip.txt"
"$py" -m pip install --quiet --require-hashes --only-binary :all: -r "$requirements"

# The engine itself is a source tree, which --only-binary refuses, so its
# wheel is built first (pure Python, through its hatchling backend, which pip
# fetches into an isolated build environment and which does not ship) and
# installed from the file with --no-deps: its dependencies are the
# manifest's, already in place. `pip check` then holds every installed
# package's requirements, the engine's included, to what is installed, so a
# manifest the engine has outgrown fails here and not at the first import.
mkdir -p "$work/wheels"
"$py" -m pip wheel --quiet --no-deps -w "$(absolute "$work/wheels")" "$engine"
wheel=$(cd "$work/wheels" && ls openschematicmaps-*.whl)
"$py" -m pip install --quiet --no-deps --only-binary :all: "$(absolute "$work/wheels")/$wheel"
"$py" -m pip check
echo "installed, as pip freeze reports it:"
"$py" -m pip list --format=freeze | tr -d '\r' | sed 's/^/  /'

# What this runtime was built from that only this script knows: the
# engine's commit as checked out and the hash of the manifest it installed.
# scripts/check-vendored.mjs holds both to the pins, and the packages the
# runtime carries to the manifest and python.pip, here and again at
# packaging, where the record travels with the runtime.
# shellcheck disable=SC2016 # "$comment" is the record's key, not a variable
printf '{\n  "$comment": "Written by scripts/vendor-python.sh: what this runtime was built from. scripts/check-vendored.mjs holds it to vendor/pins.json.",\n  "engine": { "tag": "%s", "version": "%s", "commit": "%s" },\n  "requirements_sha256": "%s"\n}\n' \
  "$engine_tag" "$engine_version" "$engine_head" "$requirements_got" > "$stage/python/vendor-record.json"
"$node_bin" scripts/check-vendored.mjs "$target" --packages "$(absolute "$stage/python")"

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
