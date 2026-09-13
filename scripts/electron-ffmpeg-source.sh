#!/usr/bin/env bash
# The source of the FFmpeg library Electron ships inside the app, fetched
# from the pins and verified by git object id, packed into one reproducible
# archive (issue 109, ADR-043).
#
#   scripts/electron-ffmpeg-source.sh <outdir>
#
# Writes <outdir>/electron-ffmpeg-<electron version>-source.tar.xz, which the
# electron-ffmpeg-source job of .github/workflows/vendor.yml uploads and the
# release job attaches to each GitHub Release.
#
# Electron bundles Chromium's FFmpeg as a shared library (libffmpeg.dylib on
# macOS, ffmpeg.dll on Windows), LGPL-2.1-or-later. LGPL-2.1 section 4 asks
# whoever distributes it in object form to accompany it with the complete
# corresponding source, or to offer equivalent access to it from the same
# place, and section 0 says what that is: the source of every module, and the
# scripts that control its compilation. So the archive holds, under
# electron-ffmpeg-<version>-source/:
#
#   src/third_party/ffmpeg/  Chromium's FFmpeg at the commit Chromium's DEPS pins,
#                            with its BUILD.gn, ffmpeg_generated.gni and the
#                            generated configuration of every branding and target
#   src/third_party/opus/    libopus, linked statically into the library
#   src/media/ffmpeg/        the scripts that configure FFmpeg and generate the GN files
#   src/build/               Chromium's GN build configuration that BUILD.gn imports
#   electron/                Electron's FFmpeg patch and its release gn args
#   legible-cities/          copies of this script, the pins and the vendor workflow
#   BUILD.txt                what each part is and how the library was built
#
# Nothing is trusted for its bytes. googlesource's +archive tarballs are
# written at download time and differ from one fetch to the next, so each
# Chromium directory is unpacked and judged by the git tree id it makes,
# against the id the pins record; FFmpeg is fetched with git at its commit
# and judged the same way once exported; Electron's files by their blob ids.
# The tree ids are taken with core.autocrlf off and every attribute that could
# change a file's bytes unset, so a .gitattributes inside a tree cannot make
# the same files hash differently.
#
# Refuses, before anything is fetched, a package-lock.json that installs
# another Electron than the pins name, and then an Electron tag that no
# longer names the pinned commit, an Electron DEPS that names another
# Chromium, a Chromium tag that no longer names its pinned commit, and a
# Chromium DEPS that names another FFmpeg revision.
#
# Needs bash, git, curl, python3, base64, GNU tar and xz: the job runs on
# ubuntu-22.04. The archive is packed with names sorted, owner and group 0,
# modes normalised and every time the FFmpeg commit's, and compressed with
# one xz thread, so the same pins and the same copies make the same bytes on
# the same tar and xz.
#
# ELECTRON_FFMPEG_PINS names another pins file, and ELECTRON_FFMPEG_LOCK
# another package-lock.json, so a wrong pin can be tried without editing the
# committed files. ELECTRON_FFMPEG_WORK names a folder to work in and keep; by
# default the work is in a temporary folder removed at exit.
set -euo pipefail
umask 022

usage() {
  echo "usage: electron-ffmpeg-source.sh <outdir>" >&2
  exit 2
}
[ $# -eq 1 ] && [ -n "$1" ] || usage
outdir=$1

here=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
pins=${ELECTRON_FFMPEG_PINS:-$here/vendor/pins.json}
lock=${ELECTRON_FFMPEG_LOCK:-$here/package-lock.json}

fail() {
  echo "::error::$*" >&2
  exit 1
}

command -v python3 >/dev/null 2>&1 || fail "electron-ffmpeg-source.sh needs python3"

# pin <key>...: a value under electron_ffmpeg in the pins, one key per
# argument, since Electron's file names have dots in them; a missing one ends
# the run rather than passing a blank.
pin() {
  python3 - "$pins" "$@" <<'PY'
import json, sys
node = json.load(open(sys.argv[1], encoding="utf-8"))["electron_ffmpeg"]
for key in sys.argv[2:]:
    node = node[key]
if not isinstance(node, str) or node == "":
    raise SystemExit(f"electron_ffmpeg {sys.argv[2:]} is not a string in the pins")
print(node)
PY
}

# pin_keys <key>: the keys of an object under electron_ffmpeg, one per line.
pin_keys() {
  python3 - "$pins" "$1" <<'PY'
import json, sys
for key in json.load(open(sys.argv[1], encoding="utf-8"))["electron_ffmpeg"][sys.argv[2]]:
    print(key)
PY
}

electron_version=$(pin electron version)
electron_repo=$(pin electron repo)
electron_tag=$(pin electron tag)
electron_commit=$(pin electron commit)
chromium_version=$(pin chromium version)
chromium_repo=$(pin chromium repo)
chromium_tag=$(pin chromium tag)
chromium_commit=$(pin chromium commit)
ffmpeg_repo=$(pin ffmpeg repo)
ffmpeg_commit=$(pin ffmpeg commit)
ffmpeg_tree=$(pin ffmpeg tree)
ffmpeg_reports=$(pin ffmpeg reports)
licence=$(pin licence)

# The Electron npm installs, which is the Electron whose library the
# installers carry.
installed=$(python3 - "$lock" <<'PY'
import json, sys
print(json.load(open(sys.argv[1], encoding="utf-8"))["packages"]["node_modules/electron"]["version"])
PY
)
if [ "$installed" != "$electron_version" ]; then
  fail "package-lock.json installs Electron $installed, and vendor/pins.json's electron_ffmpeg is for Electron $electron_version: move the whole electron_ffmpeg block to Electron $installed (its tag and commit, the Chromium version and commit in its DEPS, the FFmpeg commit in Chromium's DEPS, and every tree and blob id), as its note says"
fi
echo "Electron $electron_version, as package-lock.json installs it"

for tool in git curl base64 tar xz; do
  command -v "$tool" >/dev/null 2>&1 || fail "electron-ffmpeg-source.sh needs $tool"
done
tar --version 2>/dev/null | head -1 | grep -q 'GNU tar' || fail "electron-ffmpeg-source.sh needs GNU tar, for --sort=name"

name="electron-ffmpeg-$electron_version-source"
archive="$name.tar.xz"

if [ -n "${ELECTRON_FFMPEG_WORK:-}" ]; then
  rm -rf "$ELECTRON_FFMPEG_WORK"
  mkdir -p "$ELECTRON_FFMPEG_WORK"
  work=$(cd "$ELECTRON_FFMPEG_WORK" && pwd)
else
  work=$(mktemp -d)
  trap 'rm -rf "$work"' EXIT
fi
# Every git command below runs outside any repository, the checkout's
# included: a worktree's .git names a folder another machine may not have.
mkdir -p "$outdir"
out=$(cd "$outdir" && pwd)
cd "$work"
root="$work/$name"
mkdir -p "$root/src/third_party" "$root/src/media" "$root/electron" "$root/legible-cities"

# Git is asked with no configuration but what is given here, so a person's
# global settings cannot change what a tree hashes to.
export GIT_CONFIG_NOSYSTEM=1
export GIT_CONFIG_GLOBAL=/dev/null
export GIT_TERMINAL_PROMPT=0
gitc() {
  git -c core.autocrlf=false -c core.eol=lf -c core.safecrlf=false -c core.filemode=true \
    -c core.symlinks=true -c core.ignorecase=false -c core.precomposeunicode=false \
    -c advice.detachedHead=false -c init.defaultBranch=main "$@"
}

# get <url> <file>: fetch with backoff. A 5xx, a 429 or a connection that
# fails is tried again, five times in all; anything else ends the run.
get() {
  local url=$1 file=$2 attempt code delay=5
  for attempt in 1 2 3 4 5; do
    code=$(curl -sS -L --connect-timeout 30 --max-time 900 -o "$file" -w '%{http_code}' "$url") || true
    [ -n "$code" ] || code=000
    case "$code" in
      200) return 0 ;;
      000 | 429 | 5??)
        echo "fetching $url answered $code (attempt $attempt of 5)" >&2
        if [ "$attempt" -lt 5 ]; then sleep "$delay"; delay=$((delay * 2)); fi
        ;;
      *) fail "fetching $url answered $code" ;;
    esac
  done
  fail "fetching $url failed five times, the last with $code"
}

# peeled <repo> <tag>: the commit a tag names on its remote, peeled through
# an annotated tag, or nothing when there is no such tag.
peeled() {
  local listing attempt
  for attempt in 1 2 3; do
    if listing=$(gitc ls-remote "$1" "refs/tags/$2" "refs/tags/$2^{}"); then
      awk -v tag="refs/tags/$2" '$2 == tag "^{}" { peeled = $1 } $2 == tag { plain = $1 }
        END { print (peeled != "" ? peeled : plain) }' <<< "$listing"
      return 0
    fi
    sleep $((attempt * 5))
  done
  fail "could not ask $1 for the tag $2"
}

# tree_id <dir>: the git tree id of a folder's files as they are, with no
# conversion. A .git inside would be taken for a submodule, so it is refused.
tree_id() {
  local dir=$1 gd
  if [ -n "$(find "$dir" -name .git -print -quit)" ]; then
    fail "$dir holds a .git, which a tree id would take for a submodule"
  fi
  gd=$(mktemp -d)
  gitc init --quiet --bare "$gd"
  printf '* -text -eol -crlf -ident -filter -working-tree-encoding\n' > "$gd/info/attributes"
  : > "$gd/info/exclude"
  gitc -C "$dir" --git-dir="$gd" --work-tree=. add --all --force .
  gitc -C "$dir" --git-dir="$gd" --work-tree=. write-tree
  rm -rf "$gd"
}

# The tags still name the pinned commits, and each DEPS names the next pin.
found=$(peeled "$electron_repo" "$electron_tag")
[ "$found" = "$electron_commit" ] || fail "Electron's tag $electron_tag names ${found:-nothing} on $electron_repo, and the pins say $electron_commit"
echo "Electron $electron_tag is commit $electron_commit"

raw="https://raw.githubusercontent.com/${electron_repo#https://github.com/}/$electron_commit"
get "$raw/DEPS" "$work/electron-DEPS"
found=$(python3 - "$work/electron-DEPS" <<'PY'
import re, sys
match = re.search(r"'chromium_version'\s*:\s*'([^']+)'", open(sys.argv[1], encoding="utf-8").read())
print(match.group(1) if match else "")
PY
)
[ "$found" = "$chromium_version" ] || fail "Electron's DEPS at $electron_commit names Chromium ${found:-no version}, and the pins say $chromium_version"
echo "Electron's DEPS names Chromium $chromium_version"

found=$(peeled "$chromium_repo" "$chromium_tag")
[ "$found" = "$chromium_commit" ] || fail "Chromium's tag $chromium_tag names ${found:-nothing} on $chromium_repo, and the pins say $chromium_commit"
echo "Chromium $chromium_tag is commit $chromium_commit"

get "$chromium_repo/+/$chromium_commit/DEPS?format=TEXT" "$work/chromium-DEPS.b64"
base64 -d < "$work/chromium-DEPS.b64" > "$work/chromium-DEPS" || fail "Chromium's DEPS at $chromium_commit did not decode"
found=$(python3 - "$work/chromium-DEPS" <<'PY'
import re, sys
match = re.search(r"'ffmpeg_revision'\s*:\s*'([0-9a-f]{40})'", open(sys.argv[1], encoding="utf-8").read())
print(match.group(1) if match else "")
PY
)
[ "$found" = "$ffmpeg_commit" ] || fail "Chromium's DEPS at $chromium_commit names FFmpeg revision ${found:-none}, and the pins say $ffmpeg_commit"
echo "Chromium's DEPS names FFmpeg $ffmpeg_commit"

# FFmpeg: one commit, fetched shallow; git checks every object it receives
# against its id. The commit's tree is checked, then the exported files'.
repo="$work/ffmpeg.git"
gitc init --quiet --bare "$repo"
printf '* -text -eol -crlf -ident -filter -working-tree-encoding -export-ignore -export-subst\n' > "$repo/info/attributes"
for attempt in 1 2 3; do
  if gitc --git-dir="$repo" fetch --quiet --depth 1 "$ffmpeg_repo" "$ffmpeg_commit"; then break; fi
  [ "$attempt" -lt 3 ] || fail "could not fetch FFmpeg $ffmpeg_commit from $ffmpeg_repo"
  sleep $((attempt * 10))
done
found=$(gitc --git-dir="$repo" rev-parse FETCH_HEAD)
[ "$found" = "$ffmpeg_commit" ] || fail "fetching $ffmpeg_commit from $ffmpeg_repo gave $found"
found=$(gitc --git-dir="$repo" rev-parse "$ffmpeg_commit^{tree}")
[ "$found" = "$ffmpeg_tree" ] || fail "FFmpeg $ffmpeg_commit has tree $found, and the pins say $ffmpeg_tree"
when=$(gitc --git-dir="$repo" log -1 --format=%ct "$ffmpeg_commit")
mkdir -p "$root/src/third_party/ffmpeg"
gitc --git-dir="$repo" archive --format=tar "$ffmpeg_commit" | tar -x -C "$root/src/third_party/ffmpeg"
found=$(tree_id "$root/src/third_party/ffmpeg")
[ "$found" = "$ffmpeg_tree" ] || fail "FFmpeg's exported files make tree $found, and the pins say $ffmpeg_tree"
version=$(grep -h '#define FFMPEG_VERSION ' "$root"/src/third_party/ffmpeg/chromium/config/Chrome/mac/*/libavutil/ffversion.h | sort -u)
[ "$version" = "#define FFMPEG_VERSION \"$ffmpeg_reports\"" ] || fail "FFmpeg's Chrome config says ${version:-no version}, and the pins say $ffmpeg_reports"
rm -rf "$repo"
echo "FFmpeg $ffmpeg_commit: tree $ffmpeg_tree, $(find "$root/src/third_party/ffmpeg" -type f | wc -l | tr -d ' ') files, reports $ffmpeg_reports"

# The Chromium directories, each unpacked from gitiles and judged by its tree.
while IFS= read -r path; do
  want=$(pin chromium_trees "$path" tree)
  file="$work/$(tr / - <<< "$path").tar.gz"
  get "$chromium_repo/+archive/$chromium_commit/$path.tar.gz" "$file"
  mkdir -p "$root/src/$path"
  tar -x -z -f "$file" -C "$root/src/$path"
  rm -f "$file"
  found=$(tree_id "$root/src/$path")
  [ "$found" = "$want" ] || fail "Chromium's $path at $chromium_commit makes tree $found, and the pins say $want"
  echo "src/$path: tree $want, $(find "$root/src/$path" -type f | wc -l | tr -d ' ') files"
done < <(pin_keys chromium_trees)

# Electron's files, each judged by its blob id.
while IFS= read -r path; do
  want=$(pin electron_files "$path")
  mkdir -p "$(dirname "$root/electron/$path")"
  get "$raw/$path" "$root/electron/$path"
  found=$(gitc hash-object --no-filters "$root/electron/$path")
  [ "$found" = "$want" ] || fail "Electron's $path at $electron_commit is blob $found, and the pins say $want"
  echo "electron/$path: blob $want"
done < <(pin_keys electron_files)

cp "$here/scripts/electron-ffmpeg-source.sh" "$here/.github/workflows/vendor.yml" "$root/legible-cities/"
cp "$pins" "$root/legible-cities/pins.json"

commit=${GITHUB_SHA:-$(git -C "$here" rev-parse HEAD 2>/dev/null || echo unknown)}
repository="this repository"
if [ -n "${GITHUB_REPOSITORY:-}" ]; then
  repository="${GITHUB_SERVER_URL:-https://github.com}/$GITHUB_REPOSITORY"
fi
trees=$(while IFS= read -r path; do
  printf 'src/%s/\n  %s\n  Chromium %s, commit %s: tree %s.\n' \
    "$path" "$(pin chromium_trees "$path" what)." "$chromium_version" "$chromium_commit" \
    "$(pin chromium_trees "$path" tree)"
  printf '  Licence: %s.\n' "$(pin chromium_trees "$path" licence)"
done < <(pin_keys chromium_trees))
files=$(while IFS= read -r path; do
  printf '  electron/%s  blob %s\n' "$path" "$(pin electron_files "$path")"
done < <(pin_keys electron_files))
decoders=$(pin components decoders)
parsers=$(pin components parsers)
demuxers=$(pin components demuxers)
{
  echo "The source of the FFmpeg library Electron $electron_version ships inside Legible Cities:"
  echo "libffmpeg.dylib in Electron Framework.framework/Versions/A/Libraries/ on macOS, and"
  echo "ffmpeg.dll beside the executable on Windows. It is Chromium's media decoder; the"
  echo "app never calls it, and it is not the ffmpeg and ffprobe the app's exports use,"
  echo "whose source is the ffmpeg-source archive."
  echo
  echo "Written by scripts/electron-ffmpeg-source.sh, run by the electron-ffmpeg-source job"
  echo "of .github/workflows/vendor.yml, of $repository at commit $commit."
  echo "Copies of that script, of that workflow and of vendor/pins.json as they were then"
  echo "are in legible-cities/."
  echo
  echo "Licence: $licence."
  echo
  echo "Every part was verified by its git object id against the pins before it was packed:"
  echo
  echo "src/third_party/ffmpeg/"
  echo "  Chromium's copy of FFmpeg at commit $ffmpeg_commit of"
  echo "  $ffmpeg_repo: tree $ffmpeg_tree,"
  echo "  which Chromium $chromium_version's DEPS names as its ffmpeg_revision. It carries"
  echo "  FFmpeg's sources, the COPYING files, BUILD.gn, ffmpeg_generated.gni, ffmpeg_options.gni,"
  echo "  and chromium/config/<branding>/<os>/<arch>/, the configuration FFmpeg's configure"
  echo "  wrote for each branding and target (config.h holds the configure line it was run"
  echo "  with, and codec_list.c, parser_list.c and demuxer_list.c what it enabled)."
  echo "  The library reports FFmpeg version $ffmpeg_reports."
  printf '%s\n' "$trees"
  echo "electron/"
  echo "  Files of Electron $electron_tag, commit $electron_commit of $electron_repo:"
  printf '%s\n' "$files"
  echo "  patches/ffmpeg/ is the one change Electron makes to FFmpeg, applied to"
  echo "  src/third_party/ffmpeg with \`git am\` in the order .patches lists (it links the"
  echo "  macOS library with an @loader_path install name). build/args/ holds the gn args"
  echo "  Electron's release builds use. Electron's DEPS at that commit names Chromium"
  echo "  $chromium_version, and Chromium's tag $chromium_tag is commit $chromium_commit."
  echo
  echo "How the library is built: Electron checks out Chromium $chromium_version with gclient,"
  echo "applies its patches, and builds with electron/build/args/release.gn, which imports"
  echo "all.gn: ffmpeg_branding = \"Chrome\" and proprietary_codecs = true select the"
  echo "configuration under src/third_party/ffmpeg/chromium/config/Chrome/, and"
  echo "is_component_ffmpeg = true with is_official_build = true builds FFmpeg's"
  echo "shared_library(\"ffmpeg\") target in src/third_party/ffmpeg/BUILD.gn, from the sources"
  echo "ffmpeg_generated.gni lists for that branding, operating system and architecture,"
  echo "with //third_party/opus linked in. That configuration has CONFIG_GPL, CONFIG_NONFREE"
  echo "and CONFIG_VERSION3 at 0, and enables:"
  echo "  decoders: $decoders"
  echo "  parsers: $parsers"
  echo "  demuxers: $demuxers"
  echo "The Chromium branding under chromium/config/Chromium/ is the same without the"
  echo "aac and h264 decoders and parsers and the aac demuxer. src/media/ffmpeg/scripts/"
  echo "regenerates the configuration and the GN files; src/build/ is the GN configuration"
  echo "BUILD.gn imports. The compiler is Chromium's own clang, fetched by gclient at the"
  echo "same Chromium commit, and GN and the rest of the checkout are Chromium's at that"
  echo "commit, $chromium_repo."
  echo
  echo "What this is, in the terms of the GNU Lesser General Public License, version 2.1,"
  echo "section 0: the source code for all modules the library contains (FFmpeg's, and"
  echo "libopus's, which is linked into it), with the scripts used to control its"
  echo "compilation (FFmpeg's BUILD.gn and generated configuration, the scripts that"
  echo "generate them, the GN configuration they import, Electron's patch and gn args)."
  echo "The full text of the licence is src/third_party/ffmpeg/COPYING.LGPLv2.1, and it"
  echo "is also in Electron's LICENSES.chromium.html."
  echo
  echo "Patent licensing for the H.264 and AAC decoders is not assessed by this project."
} > "$root/BUILD.txt"

rm -f "$out/$archive"
# Sorted names, fixed owners and modes, every time the FFmpeg commit's, and
# one xz thread: xz's block layout depends on its thread count.
tar --create --file - --format=gnu --sort=name --owner=0 --group=0 --numeric-owner \
  --mode='u+rw,go-w,a+rX' --mtime="@$when" -C "$work" "$name" \
  | xz -9 -T1 -c > "$out/$archive"
listing=$(xz -dc "$out/$archive" | tar --list --file -)
for expected in "$name/BUILD.txt" "$name/src/third_party/ffmpeg/BUILD.gn" \
  "$name/src/third_party/ffmpeg/COPYING.LGPLv2.1" "$name/src/third_party/opus/BUILD.gn" \
  "$name/electron/patches/ffmpeg/link_with_loader_path.patch" "$name/legible-cities/pins.json"; do
  grep -qxF "$expected" <<< "$listing" || fail "$archive does not hold $expected"
done
if grep -qE '(^|/)\.git(/|$)' <<< "$listing"; then
  fail "$archive carries git metadata"
fi
echo "wrote $out/$archive: $(wc -c < "$out/$archive" | tr -d ' ') bytes, $(grep -vc '/$' <<< "$listing") files"
