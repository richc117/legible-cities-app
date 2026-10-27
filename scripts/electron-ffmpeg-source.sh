#!/usr/bin/env bash
# The source of the FFmpeg library Electron ships inside the app, fetched
# from the pins and verified by git object id, packed into one reproducible
# archive (issue 109, ADR-043).
#
#   scripts/electron-ffmpeg-source.sh <outdir>
#   scripts/electron-ffmpeg-source.sh --verify <archive>  check an archive against the pins, offline
#   scripts/electron-ffmpeg-source.sh --tree-id <dir>     print a folder's tree id, as the checks take it
#
# Writes <outdir>/electron-ffmpeg-<electron version>-source.tar.xz, which the
# electron-ffmpeg-source job of .github/workflows/vendor.yml uploads and the
# release job attaches to each GitHub Release.
#
# The job keeps the archive in its cache (issue 585), keyed on the Electron
# version, on the tar and xz that pack it and on the three files
# legible-cities/ copies, because the fetch from Chromium's mirror stalls
# now and then and a stalled fetch stops every installer of the run. A
# cached archive is checked before it is used: the job runs --verify on it,
# which needs no network. That reads its entries first, with the same
# function that checks a fresh archive, and refuses anything but files and
# folders (a link, a device, a FIFO), a name twice, a mode the packing would
# not give, an entry the pins do not name, a missing one and git metadata;
# unpacks it into an empty folder and refuses anything there but files and
# folders, and any empty folder; holds it to the pins exactly as the fetch
# holds what it fetched: every directory by the tree id its files make, with
# the same tree_id, FFmpeg's reported version, every Electron file by its
# blob id; requires legible-cities/'s copies to be this checkout's files
# byte for byte, and BUILD.txt to name a full commit (and, in a workflow,
# this repository) and to be the one the pins make for it, which is the
# commit whose run packed it; and last packs what it checked again, with the
# same function the fetch packs with, and requires that to be the file's own
# bytes, so nothing in the file went unread. A cached archive that fails is
# set aside and the source fetched again; a fetched one is put through
# --verify too before it is cached, which proves on every miss that the
# archive packs reproducibly. So every run still judges the archive it
# uploads by its object ids against the pins, and no installer is packaged
# in a run whose Electron library's source did not verify (ADR-043): the
# cache saves the fetch, never the check. That defends against a corrupted
# entry, drift and a bad entry, not against someone who can already write a
# cache entry in main's scope (a compromised action in a workflow running on
# main): the entry is unpacked into the workspace before --verify runs, and
# this script and the three files it compares against come from that same
# workspace. No workflow here has a pull_request_target, issue_comment or
# workflow_run trigger, so only trusted runs on main write such entries.
#
# Electron bundles Chromium's FFmpeg as a shared library (libffmpeg.dylib on
# macOS, ffmpeg.dll on Windows), LGPL-2.1-or-later. LGPL-2.1 section 4 asks
# whoever distributes it in object form to accompany it with the complete
# corresponding source, or to offer equivalent access to it from the same
# place, and section 0 says what that is: the source of every module, and the
# scripts that control its compilation. What this project takes that to be
# is, under electron-ffmpeg-<version>-source/:
#
#   src/third_party/ffmpeg/   Chromium's FFmpeg at the commit Chromium's DEPS pins,
#                             with its BUILD.gn, ffmpeg_generated.gni and the
#                             generated configuration of every branding and target
#   src/third_party/opus/     libopus, linked statically into the library
#   src/third_party/nasm/     the assembler BUILD.gn builds FFmpeg's x86-64 assembly
#                             with, and its nasm_assemble.gni
#   src/media/ffmpeg/         the scripts that configure FFmpeg and generate the GN files
#   src/tools/generate_stubs/ the script that writes ffmpeg.dll's export list
#   src/build/                Chromium's GN build configuration that BUILD.gn imports
#   electron/                 Electron's FFmpeg patch, its release gn args, and its
#                             patches to Chromium's build/
#   legible-cities/           copies of this script, the pins and the vendor workflow
#   BUILD.txt                 what each part is, how the library was built, and
#                             what is left out
#
# Those directories are everything FFmpeg's BUILD.gn and the .gni files it
# imports name outside themselves, checked when the pins were taken; the pins'
# note says how.
#
# Nothing is trusted for its bytes. Everything from Chromium comes over git,
# which checks every object it receives against its id: Chromium's commit
# with its trees and none of its files, then the files of the pinned
# directories only; FFmpeg and nasm each at their commit. Each directory is
# judged by the tree id the pinned commit records for it and again by the
# tree id its exported files make, against the pins; Electron's files by
# their blob ids. Chromium's own repository is fetched from `chromium.fetch`
# in the pins, a mirror of `chromium.repo`: an object id names the same
# bytes wherever they come from, and googlesource's web pages (gitiles) and
# its batched object fetches for chromium/src failed for a day in September
# 2026 while its git protocol for the smaller repositories did not (issue
# 183). The tags are still asked of `chromium.repo`. The tree ids
# are taken with no git configuration but the script's own, core.autocrlf
# off and every attribute that could change a file's bytes unset, so a
# .gitattributes inside a tree cannot make the same files hash differently.
#
# Refuses, before anything is fetched, a package-lock.json that installs
# another Electron than the pins name, and then an Electron tag that no
# longer names the pinned commit, an Electron DEPS that names another
# Chromium, a Chromium tag that no longer names its pinned commit, a
# Chromium DEPS that names another FFmpeg revision, and a Chromium tree or
# DEPS that records another revision or repository for nasm.
#
# Needs bash, git, curl, python3, GNU tar and xz: the job runs on
# ubuntu-22.04. The archive is packed with names sorted, owner and group 0,
# modes normalised and every time the FFmpeg commit's, and compressed with
# one xz thread, so the same pins and the same copies make the same bytes on
# the same tar and xz, but for the commit BUILD.txt names. --verify needs
# bash, git, python3, cmp, xz and GNU tar (gtar on macOS), and the tar and
# xz that packed the archive, or its bytes differ and it fails.
#
# ELECTRON_FFMPEG_PINS names another pins file, and ELECTRON_FFMPEG_LOCK
# another package-lock.json, so a wrong pin can be tried without editing the
# committed files. ELECTRON_FFMPEG_WORK names a folder to work in and keep,
# which must not exist or be empty (with --verify, the archive is unpacked
# there, beside the BUILD.txt the pins make); by default the work is in a
# temporary folder removed at exit.
set -euo pipefail
umask 022

usage() {
  echo "usage: electron-ffmpeg-source.sh <outdir>" >&2
  echo "       electron-ffmpeg-source.sh --verify <archive>" >&2
  echo "       electron-ffmpeg-source.sh --tree-id <dir>" >&2
  exit 2
}

fail() {
  echo "::error::$*" >&2
  exit 1
}

# Git is asked with no configuration but what is given here, so a person's
# global settings cannot change what a tree hashes to. A transfer slower than
# a kilobyte a second for a minute is abandoned, so a stalled fetch fails and
# is tried again rather than holding the job until its timeout.
export GIT_CONFIG_NOSYSTEM=1
export GIT_CONFIG_GLOBAL=/dev/null
export GIT_TERMINAL_PROMPT=0
gitc() {
  git -c core.autocrlf=false -c core.eol=lf -c core.safecrlf=false -c core.filemode=true \
    -c core.symlinks=true -c core.ignorecase=false -c core.precomposeunicode=false \
    -c advice.detachedHead=false -c init.defaultBranch=main \
    -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=60 "$@"
}

# The attributes that would change a file's bytes on the way into git, unset
# for every path in a repository's own info/attributes, which outranks any
# .gitattributes inside the tree.
NO_CONVERSION='* -text -eol -crlf -ident -filter -working-tree-encoding -export-ignore -export-subst'

# tree_id <dir>: the git tree id of a folder's files as they are, with no
# conversion. A .git inside would be taken for a submodule, so it is refused.
tree_id() {
  local dir=$1 gd
  if [ -n "$(find "$dir" -name .git -print -quit)" ]; then
    fail "$dir holds a .git, which a tree id would take for a submodule"
  fi
  gd=$(mktemp -d)
  gitc init --quiet --bare "$gd"
  mkdir -p "$gd/info"
  printf '%s\n' "$NO_CONVERSION" > "$gd/info/attributes"
  : > "$gd/info/exclude"
  gitc -C "$dir" --git-dir="$gd" --work-tree=. add --all --force .
  gitc -C "$dir" --git-dir="$gd" --work-tree=. write-tree
  rm -rf "$gd"
}

if [ "${1:-}" = --tree-id ]; then
  [ $# -eq 2 ] && [ -d "$2" ] || usage
  tree_id "$2"
  exit 0
fi

mode=build
if [ "${1:-}" = --verify ]; then
  [ $# -eq 2 ] && [ -f "$2" ] || usage
  mode=verify
else
  [ $# -eq 1 ] && [ -n "$1" ] || usage
fi
command -v python3 >/dev/null 2>&1 || fail "electron-ffmpeg-source.sh needs python3"

absolute() {
  python3 -c 'import os, sys; print(os.path.abspath(sys.argv[1]))' "$1"
}
if [ "$mode" = verify ]; then
  target=$(absolute "$2")
else
  outdir=$(absolute "$1")
fi
here=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
pins=$(absolute "${ELECTRON_FFMPEG_PINS:-$here/vendor/pins.json}")
lock=$(absolute "${ELECTRON_FFMPEG_LOCK:-$here/package-lock.json}")
work_given=
if [ -n "${ELECTRON_FFMPEG_WORK:-}" ]; then
  work_given=$(absolute "$ELECTRON_FFMPEG_WORK")
  # The work is emptied as it goes and kept after, so a folder that holds
  # anything already (the checkout, with ELECTRON_FFMPEG_WORK=.) is refused.
  if [ -e "$work_given" ] && { [ ! -d "$work_given" ] || [ -n "$(ls -A "$work_given")" ]; }; then
    fail "ELECTRON_FFMPEG_WORK names $work_given, which exists and is not an empty folder"
  fi
fi

# The pins, read once rather than by a python3 for each value (a run asks
# for about seventy): every non-empty string under electron_ffmpeg, one per
# line, as its keys joined by a unit separator, a tab, and the value. A key
# or value holding either separator or a newline is refused.
pins_flat=$(python3 - "$pins" <<'PY'
import json, sys
def walk(node, keys):
    if isinstance(node, dict):
        for key, value in node.items():
            yield from walk(value, keys + [key])
    elif isinstance(node, str) and node != "":
        yield keys, node
for keys, value in walk(json.load(open(sys.argv[1], encoding="utf-8"))["electron_ffmpeg"], []):
    if any(c in part for part in keys + [value] for c in "\t\n\x1f"):
        raise SystemExit(f"::error::electron_ffmpeg {keys} holds a tab, a newline or a unit separator in the pins")
    print("\x1f".join(keys) + "\t" + value)
PY
)

# pin <key>...: a value under electron_ffmpeg in the pins, one key per
# argument, since Electron's file names have dots in them; a missing one ends
# the run rather than passing a blank.
pin() {
  local want line
  want=$(IFS=$'\x1f'; printf '%s' "$*")
  while IFS= read -r line; do
    if [ "${line%%$'\t'*}" = "$want" ]; then
      printf '%s\n' "${line#*$'\t'}"
      return 0
    fi
  done <<< "$pins_flat"
  fail "electron_ffmpeg $* is not a string in the pins"
}

# pin_keys <key>: the keys of an object under electron_ffmpeg, one per line;
# an object that is missing or empty ends the run.
pin_keys() {
  python3 - "$pins" "$1" <<'PY'
import json, sys
node = json.load(open(sys.argv[1], encoding="utf-8"))["electron_ffmpeg"][sys.argv[2]]
if not isinstance(node, dict) or not node:
    raise SystemExit(f"::error::electron_ffmpeg {sys.argv[2]} is not an object with entries in the pins")
for key in node:
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
chromium_fetch=$(pin chromium fetch)
ffmpeg_repo=$(pin ffmpeg repo)
ffmpeg_commit=$(pin ffmpeg commit)
ffmpeg_tree=$(pin ffmpeg tree)
ffmpeg_reports=$(pin ffmpeg reports)
licence=$(pin licence)
# Captured, not read from a process substitution, so a failure stops the run.
tree_keys=$(pin_keys chromium_trees)
deps_keys=$(pin_keys chromium_deps)
file_keys=$(pin_keys electron_files)

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

if [ "$mode" = verify ]; then
  tools=(git xz cmp)
else
  tools=(git curl tar xz)
fi
for tool in "${tools[@]}"; do
  command -v "$tool" >/dev/null 2>&1 || fail "electron-ffmpeg-source.sh needs $tool"
done
# GNU tar packs the archive, and --verify packs what it checked again with
# the same command; as tar, or as gtar where tar is another one (macOS).
gnu_tar=
for tool in tar gtar; do
  if "$tool" --version 2>/dev/null | head -1 | grep -q 'GNU tar'; then gnu_tar=$tool; break; fi
done
[ -n "$gnu_tar" ] || fail "electron-ffmpeg-source.sh needs GNU tar, for --sort=name"

name="electron-ffmpeg-$electron_version-source"
archive="$name.tar.xz"

if [ -n "$work_given" ]; then
  mkdir -p "$work_given"
  work=$work_given
else
  work=$(mktemp -d)
  trap 'rm -rf "$work"' EXIT
fi

# check_ffmpeg_version <dir> <what>: the version FFmpeg's Chrome
# configuration reports is the pins'.
check_ffmpeg_version() {
  local version
  version=$(grep -h '#define FFMPEG_VERSION ' "$1"/chromium/config/Chrome/mac/*/libavutil/ffversion.h | sort -u || true)
  [ "$version" = "#define FFMPEG_VERSION \"$ffmpeg_reports\"" ] || fail "$2 says ${version:-no version}, and the pins say $ffmpeg_reports"
}

# pack_archive <parent> <mtime> <file>: <parent>/$name packed as the archive
# is, with names sorted, owner and group 0, modes normalised and every time
# <mtime>, and one xz thread, since xz's block layout depends on its thread
# count. The fetch packs with it, and --verify packs what it checked again
# with it, so the bytes are the same or the check fails.
pack_archive() {
  rm -f "$3"
  LC_ALL=C "$gnu_tar" --create --file - --format=gnu --sort=name --owner=0 --group=0 --numeric-owner \
    --mode='u+rw,go-w,a+rX' --mtime="@$2" -C "$1" "$name" \
    | xz -9 -T1 -c > "$3"
}

# check_listing <archive>: the archive holds only files and folders, each
# name once and at the mode pack_archive gives it (0644 or 0755 for a file,
# 0755 for a folder), every part the pins name, no git metadata, and nothing
# else, all inside its one folder. Read by Python's tarfile, which says what
# each entry is; a folder's name ends in /. Sets listing, and mtime to the
# one time every entry carries. That time is the FFmpeg commit's committer
# time, which the fetch reads from the commit and the pins do not hold, so
# --verify cannot learn it offline: it accepts the one time the archive
# carries, and packs with it again.
check_listing() {
  local entry part path allowed expected parts exact listed
  listed=$(python3 - "$1" "$archive" <<'PY'
import sys, tarfile
path, archive = sys.argv[1], sys.argv[2]
kinds = {tarfile.SYMTYPE: "a symbolic link", tarfile.LNKTYPE: "a hard link",
         tarfile.CHRTYPE: "a character device", tarfile.BLKTYPE: "a block device",
         tarfile.FIFOTYPE: "a FIFO", tarfile.CONTTYPE: "a contiguous file"}
def refuse(message):
    raise SystemExit(f"::error::{archive} {message}")
seen, mtimes, names = set(), set(), []
try:
    with tarfile.open(path, mode="r:xz") as tar:
        for member in tar:
            if member.type in (tarfile.REGTYPE, tarfile.AREGTYPE):
                name = member.name
            elif member.type == tarfile.DIRTYPE:
                name = member.name.rstrip("/") + "/"
            else:
                refuse(f"holds {member.name}, which is {kinds.get(member.type, 'neither a file nor a folder')}: only files and folders are packed")
            if "\n" in name:
                refuse(f"holds a name with a newline in it, {name!r}")
            mode = member.mode & 0o7777
            if member.type == tarfile.DIRTYPE and mode != 0o755:
                refuse(f"holds {name} at mode {mode:04o}, and a folder is packed 0755")
            if member.type != tarfile.DIRTYPE and mode not in (0o644, 0o755):
                refuse(f"holds {name} at mode {mode:04o}, and a file is packed 0644 or 0755")
            if name in seen:
                refuse(f"holds {name} twice")
            seen.add(name)
            mtimes.add(member.mtime)
            names.append(name)
except (tarfile.TarError, EOFError, OSError) as error:
    refuse(f"cannot be read as a tar.xz: {error}")
if len(mtimes) != 1:
    refuse(f"carries {len(mtimes)} times, and the archive is packed with one")
print(mtimes.pop())
print("\n".join(names))
PY
) || exit 1
  mtime=${listed%%$'\n'*}
  listing=${listed#*$'\n'}
  expected=("$name/BUILD.txt" "$name/legible-cities/pins.json"
    "$name/src/third_party/ffmpeg/BUILD.gn" "$name/src/third_party/ffmpeg/COPYING.LGPLv2.1")
  while IFS= read -r path; do expected+=("$name/src/$path/"); done <<< "$tree_keys"
  while IFS= read -r path; do expected+=("$name/src/$path/"); done <<< "$deps_keys"
  while IFS= read -r path; do expected+=("$name/electron/$path"); done <<< "$file_keys"
  for entry in "${expected[@]}"; do
    grep -qxF "$entry" <<< "$listing" || fail "$archive does not hold $entry"
  done
  if grep -qE '(^|/)\.git(/|$)' <<< "$listing"; then
    fail "$archive carries git metadata"
  fi
  parts=("$name/src/third_party/ffmpeg/")
  while IFS= read -r path; do parts+=("$name/src/$path/"); done <<< "$tree_keys"
  while IFS= read -r path; do parts+=("$name/src/$path/"); done <<< "$deps_keys"
  exact=("$name/BUILD.txt" "$name/legible-cities/electron-ffmpeg-source.sh"
    "$name/legible-cities/vendor.yml" "$name/legible-cities/pins.json")
  while IFS= read -r path; do exact+=("$name/electron/$path"); done <<< "$file_keys"
  while IFS= read -r entry; do
    case "/$entry/" in */../*) fail "$archive holds $entry, which climbs out of its folder" ;; esac
    case $entry in "$name"/*) ;; *) fail "$archive holds $entry, outside $name/" ;; esac
    case $entry in */) continue ;; esac
    allowed=
    for part in "${parts[@]}"; do
      case $entry in "$part"?*) allowed=1; break ;; esac
    done
    if [ -z "$allowed" ]; then
      for part in "${exact[@]}"; do
        if [ "$entry" = "$part" ]; then allowed=1; break; fi
      done
    fi
    [ -n "$allowed" ] || fail "$archive holds $entry, which is none of the parts the pins name"
  done <<< "$listing"
}

# write_build_txt <file> <repository> <commit>: the archive's BUILD.txt, made
# from the pins alone but for the repository and commit whose run packed it.
write_build_txt() {
  local file=$1 repository=$2 commit=$3 trees files path what tree tree_licence dep_repo dep_commit decoders parsers demuxers
  trees=
  while IFS= read -r path; do
    what=$(pin chromium_trees "$path" what)
    tree=$(pin chromium_trees "$path" tree)
    tree_licence=$(pin chromium_trees "$path" licence)
    trees+="src/$path/
  $what.
  Chromium $chromium_version, commit $chromium_commit: tree $tree.
  Licence: $tree_licence.
"
  done <<< "$tree_keys"
  while IFS= read -r path; do
    what=$(pin chromium_deps "$path" what)
    tree=$(pin chromium_deps "$path" tree)
    dep_repo=$(pin chromium_deps "$path" repo)
    dep_commit=$(pin chromium_deps "$path" commit)
    tree_licence=$(pin chromium_deps "$path" licence)
    trees+="src/$path/
  $what.
  $dep_repo at commit $dep_commit, as Chromium $chromium_version records it: tree $tree.
  Licence: $tree_licence.
"
  done <<< "$deps_keys"
  files=
  while IFS= read -r path; do
    files+="  $path  blob $(pin electron_files "$path")
"
  done <<< "$file_keys"
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
    printf '%s' "$trees"
    echo "electron/"
    echo "  Files of Electron $electron_tag, commit $electron_commit of $electron_repo:"
    printf '%s' "$files"
    echo "  patches/ffmpeg/ is the one change Electron makes to FFmpeg, applied to"
    echo "  src/third_party/ffmpeg in the order its .patches lists (it links the macOS library"
    echo "  with an @loader_path install name). build/args/ holds the gn args Electron's"
    echo "  release builds use. patches/chromium/ holds, with the list that orders them, the"
    echo "  patches Electron applies to Chromium that change files under src/build/; apply them"
    echo "  to src/ with the others that list names. Electron's DEPS at that commit names"
    echo "  Chromium $chromium_version, and Chromium's tag $chromium_tag is commit $chromium_commit."
    echo
    echo "How the library is built: Electron checks out Chromium $chromium_version with gclient,"
    echo "applies its patches, and builds with electron/build/args/release.gn, which imports"
    echo "all.gn: ffmpeg_branding = \"Chrome\" and proprietary_codecs = true select the"
    echo "configuration under src/third_party/ffmpeg/chromium/config/Chrome/, and"
    echo "is_component_ffmpeg = true with is_official_build = true builds FFmpeg's"
    echo "shared_library(\"ffmpeg\") target in src/third_party/ffmpeg/BUILD.gn, from the sources"
    echo "ffmpeg_generated.gni lists for that branding, operating system and architecture,"
    echo "with //third_party/opus linked in; on x86-64 its assembly is assembled by"
    echo "//third_party/nasm, and on Windows //tools/generate_stubs writes the DLL's exports."
    echo "That configuration has CONFIG_GPL, CONFIG_NONFREE and CONFIG_VERSION3 at 0, and"
    echo "enables:"
    echo "  decoders: $decoders"
    echo "  parsers: $parsers"
    echo "  demuxers: $demuxers"
    echo "The Chromium branding under chromium/config/Chromium/ is the same without the"
    echo "aac and h264 decoders and parsers and the aac demuxer. src/media/ffmpeg/scripts/"
    echo "regenerates the configuration and the GN files; src/build/ is the GN configuration"
    echo "BUILD.gn imports."
    echo
    echo "Left out, as the toolchain and the rest of a Chromium checkout rather than the"
    echo "library's source: Chromium's clang and its runtime libraries, GN, Python, and the"
    echo "platform SDKs, which gclient and the host provide; build_overrides/, buildtools/"
    echo "and the gclient_args.gni gclient writes, which src/build/ reads; the PGO profiles"
    echo "gclient's hooks download for official builds, which are profile data rather than"
    echo "source or scripts; and Electron's other patches to Chromium, none of which changes"
    echo "a file under build/, third_party/ffmpeg/, third_party/opus/, third_party/nasm/,"
    echo "media/ffmpeg/ or tools/generate_stubs/ (checked when these pins were taken). All of"
    echo "them are public at the commits named here: $chromium_repo and $electron_repo."
    echo
    echo "What this project takes to be the complete source code, in the terms of the GNU"
    echo "Lesser General Public License, version 2.1, section 0: the source code for all"
    echo "modules the library contains (FFmpeg's, and libopus's, which is linked into it),"
    echo "with the scripts used to control its compilation (FFmpeg's BUILD.gn and generated"
    echo "configuration, the scripts that generate them, the GN configuration and the tools"
    echo "they use from Chromium's tree, and Electron's patches and gn args). The full text of"
    echo "the licence is src/third_party/ffmpeg/COPYING.LGPLv2.1, and it is also in"
    echo "Electron's LICENSES.chromium.html."
    echo
    echo "Patent licensing for the H.264 and AAC decoders is not assessed by this project."
  } > "$file"
}

# check_tree <dir> <want> <what>: the tree id a folder's files make is the pin.
check_tree() {
  local found
  found=$(tree_id "$1")
  [ "$found" = "$2" ] || fail "$3 makes tree $found, and the pins say $2"
}

# verify <archive>: the archive, unpacked into the work folder, holds what
# the fetch below would have packed from the pins and this checkout, judged
# by the same ids, with no network. BUILD.txt names the commit whose run
# packed it, which for a cached archive is an earlier one with the same
# three copies; the rest of it must be what the pins make.
verify() {
  local file=$1 root path want found built_repository built_commit
  [ "$(basename "$file")" = "$archive" ] || fail "$file is not $archive, the archive the pins name for Electron $electron_version"
  check_listing "$file"
  xz -dc "$file" | "$gnu_tar" -x -f - -C "$work" --no-same-owner || fail "$archive does not unpack"
  # Nothing but its one folder, and in it only files and folders, before any
  # file's bytes are read.
  [ "$(ls -A "$work")" = "$name" ] || fail "$archive unpacks to more than $name/"
  found=$(find "$work" ! -type f ! -type d -print -quit)
  [ -z "$found" ] || fail "$archive unpacks to ${found#"$work/"}, which is neither a file nor a folder"
  # A git tree holds no empty folder, so no tree id would judge one.
  found=$(find "$work/$name" -type d -empty -print -quit)
  [ -z "$found" ] || fail "$archive holds the empty folder ${found#"$work/"}/, which no pinned tree can hold"
  # As below, no git command runs inside the checkout.
  cd "$work"
  root="$work/$name"
  check_tree "$root/src/third_party/ffmpeg" "$ffmpeg_tree" "$archive's src/third_party/ffmpeg"
  check_ffmpeg_version "$root/src/third_party/ffmpeg" "$archive's FFmpeg Chrome config"
  echo "src/third_party/ffmpeg: tree $ffmpeg_tree, reports $ffmpeg_reports"
  while IFS= read -r path; do
    want=$(pin chromium_trees "$path" tree)
    check_tree "$root/src/$path" "$want" "$archive's src/$path"
    echo "src/$path: tree $want"
  done <<< "$tree_keys"
  while IFS= read -r path; do
    want=$(pin chromium_deps "$path" tree)
    check_tree "$root/src/$path" "$want" "$archive's src/$path"
    echo "src/$path: tree $want"
  done <<< "$deps_keys"
  while IFS= read -r path; do
    want=$(pin electron_files "$path")
    found=$(gitc hash-object --no-filters "$root/electron/$path")
    [ "$found" = "$want" ] || fail "$archive's electron/$path is blob $found, and the pins say $want"
  done <<< "$file_keys"
  echo "electron/: every file its pinned blob"
  cmp -s "$root/legible-cities/electron-ffmpeg-source.sh" "$here/scripts/electron-ffmpeg-source.sh" \
    || fail "$archive's legible-cities/electron-ffmpeg-source.sh is not this checkout's scripts/electron-ffmpeg-source.sh"
  cmp -s "$root/legible-cities/vendor.yml" "$here/.github/workflows/vendor.yml" \
    || fail "$archive's legible-cities/vendor.yml is not this checkout's .github/workflows/vendor.yml"
  cmp -s "$root/legible-cities/pins.json" "$pins" \
    || fail "$archive's legible-cities/pins.json is not the pins this run reads"
  echo "legible-cities/: this checkout's script, workflow and pins, byte for byte"
  built_repository=$(sed -n 's|^of \.github/workflows/vendor\.yml, of \(.*\) at commit \([^ ]*\)\.$|\1|p' "$root/BUILD.txt")
  built_commit=$(sed -n 's|^of \.github/workflows/vendor\.yml, of \(.*\) at commit \([^ ]*\)\.$|\2|p' "$root/BUILD.txt")
  [ -n "$built_repository" ] && [ -n "$built_commit" ] || fail "$archive's BUILD.txt names no repository and commit that packed it"
  [[ $built_commit =~ ^[0-9a-f]{40}$ ]] || fail "$archive's BUILD.txt names commit $built_commit, which is not 40 lowercase hex digits"
  # In a workflow, the run that packed it was this repository's.
  if [ -n "${GITHUB_SERVER_URL:-}" ] && [ -n "${GITHUB_REPOSITORY:-}" ] \
    && [ "$built_repository" != "$GITHUB_SERVER_URL/$GITHUB_REPOSITORY" ]; then
    fail "$archive's BUILD.txt names $built_repository, and this run is $GITHUB_SERVER_URL/$GITHUB_REPOSITORY"
  fi
  write_build_txt "$work/BUILD.txt" "$built_repository" "$built_commit"
  cmp -s "$root/BUILD.txt" "$work/BUILD.txt" \
    || fail "$archive's BUILD.txt is not the one the pins make for $built_repository at commit $built_commit"
  echo "BUILD.txt: the pins', packed by $built_repository at commit $built_commit"
  # What was checked, packed again as the fetch packs it, must be the file
  # itself, so nothing in it (bytes after the tar's end, a second xz stream,
  # an entry the unpacking overwrote) went unread.
  mkdir "$work/repacked"
  pack_archive "$work" "$mtime" "$work/repacked/$archive"
  cmp -s "$file" "$work/repacked/$archive" \
    || fail "$archive is not what its checked files pack to, so it holds bytes the checks did not read"
  echo "$archive: its checked files, packed again, are its bytes"
  echo "verified $file against the pins, offline: $(grep -vc '/$' <<< "$listing") files"
}

if [ "$mode" = verify ]; then
  verify "$target"
  exit 0
fi

mkdir -p "$outdir"
# Every git command below runs outside any repository, the checkout's
# included: a worktree's .git names a folder another machine may not have.
cd "$work"
root="$work/$name"
mkdir -p "$root/src" "$root/electron" "$root/legible-cities"

# get <url> <file>: fetch with backoff. A failed transfer (a truncated body
# included, which curl can report with a 200), a 5xx or a 429 is tried again,
# five times in all; any other answer ends the run.
get() {
  local url=$1 file=$2 attempt code status delay=5
  for attempt in 1 2 3 4 5; do
    if code=$(curl -sS -L --connect-timeout 30 --max-time 900 -o "$file" -w '%{http_code}' "$url"); then
      status=0
    else
      status=$?
    fi
    [ -n "$code" ] || code=000
    if [ "$status" -eq 0 ] && [ "$code" = 200 ]; then
      return 0
    fi
    if [ "$status" -eq 0 ] && ! [[ "$code" =~ ^(429|5[0-9][0-9])$ ]]; then
      fail "fetching $url answered $code"
    fi
    echo "fetching $url answered $code, curl exit $status (attempt $attempt of 5)" >&2
    if [ "$attempt" -lt 5 ]; then
      sleep "$delay"
      delay=$((delay * 2))
    fi
  done
  fail "fetching $url failed five times, the last with $code and curl exit $status"
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

# shallow <git dir> <repo> <commit> [<fetch option>...]: one commit fetched
# with no history, tried three times; the commit fetched must be the one asked.
shallow() {
  local gd=$1 from=$2 want=$3 attempt found
  shift 3
  for attempt in 1 2 3; do
    if gitc --git-dir="$gd" fetch --quiet --no-tags --depth 1 "$@" "$from" "$want"; then break; fi
    [ "$attempt" -lt 3 ] || fail "could not fetch $want from $from"
    sleep $((attempt * 10))
  done
  found=$(gitc --git-dir="$gd" rev-parse FETCH_HEAD)
  [ "$found" = "$want" ] || fail "fetching $want from $from gave $found"
}

# A repository to fetch into, bare, with every conversion attribute unset.
bare() {
  gitc init --quiet --bare "$1"
  mkdir -p "$1/info"
  printf '%s\n' "$NO_CONVERSION" > "$1/info/attributes"
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

# Chromium: the commit with every tree and no file, from the mirror; a file
# is fetched when it is read, and the pinned directories' files together
# below. A promisor remote is what lets git fetch the rest later, and the
# repository has a work tree only so that a sparse checkout can do that.
checkout="$work/chromium"
chromium="$checkout/.git"
gitc init --quiet "$checkout"
mkdir -p "$chromium/info"
printf '%s\n' "$NO_CONVERSION" > "$chromium/info/attributes"
gitc --git-dir="$chromium" remote add origin "$chromium_fetch"
gitc --git-dir="$chromium" config remote.origin.promisor true
gitc --git-dir="$chromium" config remote.origin.partialclonefilter blob:none
shallow "$chromium" origin "$chromium_commit" --filter=blob:none
echo "Chromium $chromium_commit fetched from $chromium_fetch, its trees without their files"
for attempt in 1 2 3; do
  if gitc --git-dir="$chromium" cat-file blob "$chromium_commit:DEPS" > "$work/chromium-DEPS"; then break; fi
  [ "$attempt" -lt 3 ] || fail "could not read Chromium's DEPS at $chromium_commit from $chromium_fetch"
  sleep $((attempt * 10))
done
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
bare "$repo"
shallow "$repo" "$ffmpeg_repo" "$ffmpeg_commit"
found=$(gitc --git-dir="$repo" rev-parse "$ffmpeg_commit^{tree}")
[ "$found" = "$ffmpeg_tree" ] || fail "FFmpeg $ffmpeg_commit has tree $found, and the pins say $ffmpeg_tree"
when=$(gitc --git-dir="$repo" log -1 --format=%ct "$ffmpeg_commit")
mkdir -p "$root/src/third_party/ffmpeg"
gitc --git-dir="$repo" archive --format=tar "$ffmpeg_commit" | tar -x -C "$root/src/third_party/ffmpeg"
found=$(tree_id "$root/src/third_party/ffmpeg")
[ "$found" = "$ffmpeg_tree" ] || fail "FFmpeg's exported files make tree $found, and the pins say $ffmpeg_tree"
check_ffmpeg_version "$root/src/third_party/ffmpeg" "FFmpeg's Chrome config"
rm -rf "$repo"
echo "FFmpeg $ffmpeg_commit: tree $ffmpeg_tree, $(find "$root/src/third_party/ffmpeg" -type f | wc -l | tr -d ' ') files, reports $ffmpeg_reports"

# The Chromium directories: the tree the pinned commit records for each path
# must be the pin, and so must the tree its exported files make. Their files
# are fetched in one request by a sparse checkout, which asks for every
# missing file it needs at once rather than one at a time as an archive
# would; the checkout is only the fetch, and the files are exported from the
# commit itself.
sparse=()
while IFS= read -r path; do
  want=$(pin chromium_trees "$path" tree)
  found=$(gitc --git-dir="$chromium" rev-parse --verify --quiet "$chromium_commit:$path" || true)
  [ "$found" = "$want" ] || fail "Chromium's $path at $chromium_commit is tree ${found:-nothing}, and the pins say $want"
  sparse+=("/$path/")
done <<< "$tree_keys"
gitc -C "$checkout" sparse-checkout set --no-cone "${sparse[@]}"
for attempt in 1 2 3; do
  if gitc -C "$checkout" checkout --quiet --force "$chromium_commit"; then break; fi
  [ "$attempt" -lt 3 ] || fail "could not fetch the files of Chromium's pinned directories from $chromium_fetch"
  sleep $((attempt * 10))
done
while IFS= read -r path; do
  want=$(pin chromium_trees "$path" tree)
  mkdir -p "$root/src/$path"
  gitc --git-dir="$chromium" archive --format=tar "$chromium_commit:$path" | tar -x -C "$root/src/$path"
  found=$(tree_id "$root/src/$path")
  [ "$found" = "$want" ] || fail "Chromium's $path at $chromium_commit, exported, makes tree $found, and the pins say $want"
  echo "src/$path: tree $want, $(find "$root/src/$path" -type f | wc -l | tr -d ' ') files"
done <<< "$tree_keys"

# The DEPS entries: Chromium's tree records each one's revision as a gitlink
# and its DEPS the repository, which must be the pins'; each is fetched with
# git at that revision and judged the same way.
while IFS= read -r path; do
  dep_repo=$(pin chromium_deps "$path" repo)
  dep_commit=$(pin chromium_deps "$path" commit)
  want=$(pin chromium_deps "$path" tree)
  found=$(gitc --git-dir="$chromium" ls-tree "$chromium_commit" -- "$path" | awk '$2 == "commit" { print $3 }')
  [ "$found" = "$dep_commit" ] || fail "Chromium $chromium_commit takes $path at ${found:-no revision}, and the pins say $dep_commit"
  found=$(python3 - "$work/chromium-DEPS" "src/$path" "$dep_commit" <<'PY'
import re, sys
text, key, commit = open(sys.argv[1], encoding="utf-8").read(), sys.argv[2], sys.argv[3]
vars_ = dict(re.findall(r"'(\w+)'\s*:\s*'([^']*)'", text.split("deps = {", 1)[0]))
entry = re.search(re.escape(f"'{key}'") + r"\s*:\s*\{\s*'url'\s*:\s*([^}]*?)\s*,?\s*\}", text)
if not entry:
    raise SystemExit(0)
parts = re.findall(r"Var\('(\w+)'\)|'([^']*)'", entry.group(1))
url = "".join(vars_.get(name, "\0") if name else literal for name, literal in parts)
repo, _, revision = url.rpartition("@")
print(repo.removesuffix(".git") if revision == commit else "")
PY
)
  [ "$found" = "$dep_repo" ] || fail "Chromium's DEPS at $chromium_commit takes $path from ${found:-another repository or revision}, and the pins say $dep_repo at $dep_commit"
  dep="$work/dep.git"
  bare "$dep"
  shallow "$dep" "$dep_repo" "$dep_commit"
  found=$(gitc --git-dir="$dep" rev-parse "$dep_commit^{tree}")
  [ "$found" = "$want" ] || fail "$dep_repo at $dep_commit is tree $found, and the pins say $want"
  mkdir -p "$root/src/$path"
  gitc --git-dir="$dep" archive --format=tar "$dep_commit" | tar -x -C "$root/src/$path"
  rm -rf "$dep"
  found=$(tree_id "$root/src/$path")
  [ "$found" = "$want" ] || fail "$dep_repo at $dep_commit, exported, makes tree $found, and the pins say $want"
  echo "src/$path: $dep_repo at $dep_commit, tree $want, $(find "$root/src/$path" -type f | wc -l | tr -d ' ') files"
done <<< "$deps_keys"
rm -rf "$checkout"

# Electron's files, each judged by its blob id.
while IFS= read -r path; do
  want=$(pin electron_files "$path")
  mkdir -p "$(dirname "$root/electron/$path")"
  get "$raw/$path" "$root/electron/$path"
  found=$(gitc hash-object --no-filters "$root/electron/$path")
  [ "$found" = "$want" ] || fail "Electron's $path at $electron_commit is blob $found, and the pins say $want"
  echo "electron/$path: blob $want"
done <<< "$file_keys"

cp "$here/scripts/electron-ffmpeg-source.sh" "$here/.github/workflows/vendor.yml" "$root/legible-cities/"
cp "$pins" "$root/legible-cities/pins.json"

commit=${GITHUB_SHA:-$(git -C "$here" rev-parse HEAD 2>/dev/null || echo unknown)}
repository="this repository"
if [ -n "${GITHUB_REPOSITORY:-}" ]; then
  repository="${GITHUB_SERVER_URL:-https://github.com}/$GITHUB_REPOSITORY"
fi
write_build_txt "$root/BUILD.txt" "$repository" "$commit"

# Every time the FFmpeg commit's.
pack_archive "$work" "$when" "$outdir/$archive"
check_listing "$outdir/$archive"
echo "wrote $outdir/$archive: $(wc -c < "$outdir/$archive" | tr -d ' ') bytes, $(grep -vc '/$' <<< "$listing") files"
