#!/usr/bin/env bash
# Pin the engine for development: one worktree of the engine at a tag, its
# own virtual environment, and one stable link that .env.local names once.
#
#   scripts/pin-engine.sh [--engine <path>] [--force] <tag>
#
# Where the engine repository is, from the first that applies:
#   --engine <path>
#   $LEGIBLE_ENGINE_REPO
#   ../OpenSchematicMaps, then ../legible-cities, beside this checkout
#
# What it does, in order, and nothing else:
#   1. refuses (exit 1, one sentence) when --engine is not the top of a git
#      repository, when the tag does not exist in it, when the tag is not
#      the engine tag in vendor/pins.json (unless --force), when
#      lc-engine-current beside this checkout is a real folder or file
#      instead of a link, or when uv is not installed;
#   2. makes lc-engine-<tag> beside the engine repository as a git worktree
#      at the tag (an existing one is reused only if it is a worktree of
#      that repository at that tag's commit, and is otherwise refused
#      untouched), runs `uv venv` and `uv pip install -e .` in it, links
#      the repository's data folder into it and, in a worktree made in this
#      run, makes out a real folder (a link there made one serve test fail);
#   3. checks that the worktree's own interpreter, run from inside the
#      worktree and isolated from the caller's folder, imports a schematic
#      that lives under the worktree and reports the version the pins name,
#      and refuses, leaving the link where it was, when it does not;
#   4. moves the link lc-engine-current, beside this checkout, to the
#      worktree (ln -sfn, which is not atomic). Name ../lc-engine-current
#      as LEGIBLE_ENGINE_CHECKOUT in .env.local once, and it never needs
#      another edit.
#
# It never commits, never pushes, never edits .env.local and never touches
# another worktree. It writes only the worktree (beside the engine
# repository, wherever --engine or LEGIBLE_ENGINE_REPO put that), what uv
# puts in it, and the link (beside this checkout). Argument arrays
# throughout, no eval. Needs bash, git, uv and node; runs on macOS and
# Linux. Windows is not supported here.

set -euo pipefail

die() {
  echo "pin-engine: $*" >&2
  exit 1
}

usage() {
  echo "usage: scripts/pin-engine.sh [--engine <path>] [--force] <tag>" >&2
  exit 2
}

engine_arg=""
force=0
tag=""
while [ $# -gt 0 ]; do
  case "$1" in
    --engine)
      [ $# -ge 2 ] || usage
      engine_arg="$2"
      shift 2
      ;;
    --force)
      force=1
      shift
      ;;
    -h | --help) usage ;;
    -*) usage ;;
    *)
      [ -z "$tag" ] || usage
      tag="$1"
      shift
      ;;
  esac
done
[ -n "$tag" ] || usage
case "$tag" in
  *[!A-Za-z0-9._-]* | -* | .*) die "'$tag' is not a tag name this script will use." ;;
esac

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)" || die "cannot find this checkout."
beside="$(dirname "$here")"

# Where the engine repository is.
if [ -n "$engine_arg" ]; then
  engine="$engine_arg"
  how="--engine"
elif [ -n "${LEGIBLE_ENGINE_REPO:-}" ]; then
  engine="$LEGIBLE_ENGINE_REPO"
  how="LEGIBLE_ENGINE_REPO"
elif [ -d "$beside/OpenSchematicMaps" ]; then
  engine="$beside/OpenSchematicMaps"
  how="beside this checkout"
elif [ -d "$beside/legible-cities" ]; then
  engine="$beside/legible-cities"
  how="beside this checkout"
else
  die "no engine repository: pass --engine <path>, set LEGIBLE_ENGINE_REPO, or put it beside this checkout as OpenSchematicMaps or legible-cities."
fi
[ -d "$engine" ] || die "the engine repository '$engine' is not a folder."
engine="$(cd "$engine" && pwd -P)" || die "$engine cannot be entered."
top="$(git -C "$engine" rev-parse --show-toplevel 2> /dev/null)" || die "'$engine' is not a git repository."
top="$(cd "$top" && pwd -P)" || die "$top cannot be entered."
[ "$top" = "$engine" ] || die "'$engine' is inside a repository but is not its top; name the top ($top)."
echo "engine repository: $engine ($how)"

# Refusals, before anything is written.
git -C "$engine" rev-parse --verify --quiet "refs/tags/$tag^{commit}" > /dev/null \
  || die "the engine repository has no tag '$tag'."

pins="$here/vendor/pins.json"
[ -f "$pins" ] || die "vendor/pins.json is missing."
command -v node > /dev/null 2>&1 || die "node is not installed; it reads vendor/pins.json."
pinned_tag="$(node -e 'const e = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).engine; process.stdout.write(String(e.tag))' "$pins")"
pinned_version="$(node -e 'const e = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).engine; process.stdout.write(String(e.version))' "$pins")"
if [ "$tag" != "$pinned_tag" ]; then
  if [ "$force" -eq 1 ]; then
    echo "note: $tag is not the pinned tag $pinned_tag; going on because of --force."
  else
    die "$tag is not the engine tag in vendor/pins.json ($pinned_tag); pass --force to pin it anyway."
  fi
fi

link="$beside/lc-engine-current"
if [ -e "$link" ] && [ ! -L "$link" ]; then
  die "$link exists and is not a link; move it away first."
fi

command -v uv > /dev/null 2>&1 || die "uv is not installed; see https://docs.astral.sh/uv/ ."

# The worktree, beside the engine repository.
wt="$(dirname "$engine")/lc-engine-$tag"
made=0
if [ -e "$wt" ] || [ -L "$wt" ]; then
  want="$(git -C "$engine" rev-parse "refs/tags/$tag^{commit}")"
  have="$(git -C "$wt" rev-parse HEAD 2> /dev/null)" \
    || die "$wt exists and is not a git worktree; move it away first."
  common="$(cd "$wt" && cd "$(git rev-parse --git-common-dir)" && pwd -P)" \
    || die "$wt exists and its git folder cannot be read; move it away first."
  engine_common="$(cd "$engine" && cd "$(git rev-parse --git-common-dir)" && pwd -P)" \
    || die "the git folder of $engine cannot be read."
  [ "$common" = "$engine_common" ] \
    || die "$wt exists but is not a worktree of $engine; move it away first."
  [ "$have" = "$want" ] \
    || die "$wt exists but is at $have, not at $tag ($want); move it away first."
  echo "worktree: $wt exists at $tag; reused."
else
  git -C "$engine" worktree add --detach "$wt" "refs/tags/$tag" \
    || die "git could not make the worktree $wt at $tag."
  made=1
  echo "worktree: made $wt at $tag."
fi
wt="$(cd "$wt" && pwd -P)" || die "$wt cannot be entered."

# Its environment.
if [ -x "$wt/.venv/bin/python" ]; then
  echo "venv: present."
else
  (cd "$wt" && uv venv) || die "uv venv failed in $wt."
fi
(cd "$wt" && uv pip install --python "$wt/.venv/bin/python" -e .) \
  || die "uv pip install -e . failed in $wt."

# data is a link to the repository's own; out is a real folder.
if [ -d "$engine/data" ]; then
  if [ ! -e "$wt/data" ] && [ ! -L "$wt/data" ]; then
    ln -s "../$(basename "$engine")/data" "$wt/data"
  fi
else
  echo "note: $engine/data does not exist, so there is nothing to link as data."
fi
if [ -L "$wt/out" ]; then
  if [ "$made" -eq 1 ]; then
    rm "$wt/out"
    mkdir "$wt/out"
  else
    echo "note: $wt/out is a link and the worktree is not new, so it is left alone."
  fi
else
  mkdir -p "$wt/out"
fi

# The version the interpreter reports.
# Run inside the worktree and isolated (-I), so a schematic folder in the
# caller's directory cannot be the one that answers.
reported="$(cd "$wt" && "$wt/.venv/bin/python" -I -c 'import os, schematic; print(os.path.realpath(schematic.__file__)); print(schematic.__version__)' 2> /dev/null)" \
  || die "$wt/.venv/bin/python cannot import schematic; the link was not moved."
where="$(printf '%s\n' "$reported" | sed -n 1p)"
actual="$(printf '%s\n' "$reported" | sed -n 2p)"
case "$where" in
  "$wt"/*) ;;
  *) die "schematic was imported from $where, not from $wt; the link was not moved." ;;
esac
if [ "$actual" != "$pinned_version" ]; then
  if [ "$force" -eq 1 ]; then
    echo "note: schematic reports $actual; vendor/pins.json names $pinned_version."
  else
    die "schematic reports $actual but vendor/pins.json names $pinned_version; the link was not moved."
  fi
fi

# The one stable link, relative when it can be.
if [ "$(dirname "$wt")" = "$beside" ]; then
  target="lc-engine-$tag"
else
  target="$wt"
fi
ln -sfn "$target" "$link"
echo "link: $link -> $target"
echo "schematic $actual at $tag; .env.local names ../lc-engine-current once and needs no other edit."
