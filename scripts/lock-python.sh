#!/usr/bin/env bash
# Write vendor/python-requirements.txt: every Python package the bundled
# runtime carries besides the engine and pip, exported from the engine's own
# uv.lock at the tag vendor/pins.json pins, each at one version with the
# sha256 of every file it may be installed from (issue 434).
#
#   scripts/lock-python.sh <engine-checkout>
#   scripts/lock-python.sh ../lc-engine-current
#
# scripts/vendor-python.sh installs from that file with pip's --require-hashes
# and nothing else resolved, and scripts/check-vendored.mjs refuses a runtime
# whose packages differ from it, and the file itself when its sha256 is not
# python.requirements.sha256 in the pins. So moving the engine pin is: move
# engine.tag, .version and .commit, run this against a clean checkout at the
# new tag, and move python.requirements.sha256 to the hash it prints.
#
# It refuses, before writing anything, a checkout that is not a git checkout,
# that has changes, that is not at the pinned tag, or whose tag is not the
# pinned commit: the lock read from any of those is not the one that ships.
# It needs uv (https://docs.astral.sh/uv/) at python.requirements.uv.version,
# which reads the lock as it is (--frozen) and resolves nothing, and refuses
# any other uv: the python job installs that version by its hash and runs the
# same export at engine.commit, refusing a file whose body differs, and
# another uv may write the same lock differently. Node, which this
# repository's tools already need, reads the pins and takes the hash.
set -euo pipefail

engine=${1:-}
[ -n "$engine" ] || { echo "usage: $0 <engine-checkout>" >&2; exit 2; }
[ -d "$engine" ] || { echo "no engine checkout at $engine" >&2; exit 2; }

root=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
pins="$root/vendor/pins.json"
out="$root/vendor/python-requirements.txt"

refuse() { echo "refused: the engine checkout at $engine $1" >&2; exit 1; }

read -r repo tag commit pinned uv_pinned <<EOP
$(node -e '
  const pins = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))
  const requirements = pins.python.requirements
  const values = [pins.engine.repo, pins.engine.tag, pins.engine.commit, requirements.sha256, requirements.uv.version]
  if (values.some((value) => typeof value !== "string" || /\s/.test(value) || value === "")) process.exit(1)
  process.stdout.write(values.join(" "))
' "$pins")
EOP
[ -n "${uv_pinned:-}" ] || {
  echo "could not read engine.repo, .tag, .commit, python.requirements.sha256 and .uv.version from $pins" >&2; exit 1; }

command -v uv >/dev/null 2>&1 || {
  echo "no uv on PATH; install uv $uv_pinned, as \`pip install uv==$uv_pinned\` does" >&2; exit 1; }
uv_found=$(uv --version | awk '{ print $2 }')
if [ "$uv_found" != "$uv_pinned" ]; then
  echo "uv $uv_found is on PATH, and the manifest is written by uv $uv_pinned (python.requirements.uv.version)," >&2
  echo "the version the python job proves it with: install that one, as \`pip install uv==$uv_pinned\` does," >&2
  echo "or move the pin with the hashes of the new version's wheels." >&2
  exit 1
fi

git -C "$engine" rev-parse --git-dir >/dev/null 2>&1 || refuse "is not a git checkout"
# Untracked files count: hatchling packages what is in the tree, and a lock
# or a pyproject.toml that is not the tag's is the case this guards.
changes=$(git -C "$engine" status --porcelain)
if [ -n "$changes" ]; then
  printf '%s\n' "$changes" | head -n 20 >&2
  refuse "has changes; the lock is read from a clean checkout of $tag"
fi
tagged=$(git -C "$engine" rev-parse -q --verify "refs/tags/$tag^{commit}") ||
  refuse "has no tag $tag"
head=$(git -C "$engine" rev-parse HEAD)
[ "$head" = "$tagged" ] || refuse "is at $head, not at $tag ($tagged)"
[ "$tagged" = "$commit" ] ||
  refuse "has $tag at $tagged, and vendor/pins.json pins engine.commit $commit: move the pin, or fetch the tag again"

# Written beside the file and moved over it whole, so a failed export leaves
# the committed one as it was.
tmp=$(mktemp "$out.XXXXXX")
trap 'rm -f "$tmp"' EXIT
{
  cat <<HEADER
# Every Python package the bundled runtime carries besides the engine and
# pip: the engine's own uv.lock at the tag vendor/pins.json pins, exported
# with each package at one version and the sha256 of every file it may be
# installed from. scripts/vendor-python.sh installs it with
# \`pip install --require-hashes --only-binary :all:\`, and
# scripts/check-vendored.mjs refuses a runtime whose packages differ from it,
# and this file when its sha256 is not python.requirements.sha256 in
# vendor/pins.json.
#
#   engine  $repo
#   tag     $tag
#   commit  $commit
#   uv      $uv_pinned
#
# Written by scripts/lock-python.sh; never edited by hand. To regenerate it,
# from a clean checkout of the engine at the pinned tag:
#
#   scripts/lock-python.sh <engine-checkout>
#
# which runs the uv command below there and prints this file's sha256, which
# python.requirements.sha256 then takes.
#
HEADER
  (cd "$engine" && uv export --frozen --no-dev --hashes --no-emit-project)
} > "$tmp"
grep -qE '^[A-Za-z0-9][A-Za-z0-9._-]*==' "$tmp" || { echo "uv exported no package from $engine" >&2; exit 1; }
# mktemp makes the file readable by its owner alone; the committed one is not.
chmod 644 "$tmp"
mv "$tmp" "$out"
trap - EXIT

got=$(node -e '
  const bytes = require("fs").readFileSync(process.argv[1])
  process.stdout.write(require("crypto").createHash("sha256").update(bytes).digest("hex"))
' "$out")
echo "wrote vendor/python-requirements.txt from $tag ($commit)"
echo "sha256 $got"
if [ "$got" = "$pinned" ]; then
  echo "python.requirements.sha256 in vendor/pins.json already names it"
else
  echo "python.requirements.sha256 in vendor/pins.json is $pinned: move it to $got"
fi
