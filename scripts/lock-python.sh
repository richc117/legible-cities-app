#!/usr/bin/env bash
# Write vendor/python-requirements.txt: every Python package the bundled
# runtime carries besides the engine and pip, exported from the engine's own
# uv.lock at the tag vendor/pins.json pins, each at one version with the
# sha256 of every file it may be installed from (issue 434).
#
#   scripts/lock-python.sh <engine-checkout>
#   scripts/lock-python.sh ../lc-engine-v0.18.0
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
# It needs uv (https://docs.astral.sh/uv/), which reads the lock as it is
# (--frozen) and resolves nothing, and Node, which this repository's tools
# already need, to read the pins and take the hash.
set -euo pipefail

engine=${1:-}
[ -n "$engine" ] || { echo "usage: $0 <engine-checkout>" >&2; exit 2; }
[ -d "$engine" ] || { echo "no engine checkout at $engine" >&2; exit 2; }

root=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
pins="$root/vendor/pins.json"
out="$root/vendor/python-requirements.txt"

refuse() { echo "refused: the engine checkout at $engine $1" >&2; exit 1; }

read -r repo tag commit pinned <<EOP
$(node -e '
  const pins = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))
  const values = [pins.engine.repo, pins.engine.tag, pins.engine.commit, pins.python.requirements.sha256]
  if (values.some((value) => typeof value !== "string" || /\s/.test(value) || value === "")) process.exit(1)
  process.stdout.write(values.join(" "))
' "$pins")
EOP
[ -n "${pinned:-}" ] || { echo "could not read engine.repo, .tag, .commit and python.requirements.sha256 from $pins" >&2; exit 1; }

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
command -v uv >/dev/null 2>&1 || { echo "no uv on PATH; see https://docs.astral.sh/uv/" >&2; exit 1; }

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
