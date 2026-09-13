#!/usr/bin/env bash
# Build ffmpeg and ffprobe for one target from the sources pinned in
# vendor/pins.json, prove the pair can do what the engine's export asks of
# it, and only then put it in place (ADR-012, ADR-040).
#
#   scripts/vendor-ffmpeg.sh <target> [outdir]               build, prove, put in place
#   scripts/vendor-ffmpeg.sh --build-only <target> <dir>     build into <dir>, prove nothing
#   scripts/vendor-ffmpeg.sh --from <dir> <target> [outdir]  prove a pair built earlier, put it in place
#   scripts/vendor-ffmpeg.sh --sources <dir>                 fetch and verify the Corresponding Source
#
# Targets: darwin-arm64, darwin-x64, win-x64 and linux-x64 (for tests only).
# The result is <outdir>/<target>/ (vendor/ffmpeg by default) holding
# exactly ffmpeg and ffprobe, with .exe on Windows: the engine reads
# SCHEMATIC_FFMPEG and finds ffprobe beside it by replacing "ffmpeg" in the
# file name (export.ffprobe_path), so both names matter.
#
# The build is native, never cross: each target on its own kind of machine,
# and win-x64 inside an MSYS2 UCRT64 shell. The proof needs no compiler, so
# on Windows the vendor job builds under MSYS2 with --build-only and proves
# under Git Bash with --from, where the proof has always run.
#
# What is built: FFmpeg from its release tarball and x264 from a pinned
# commit, both checked against the sha256 in the pins before anything is
# opened; on Windows also zlib from its release tarball, because the PNG
# codecs need it and Windows has none of its own. macOS and Linux use the
# operating system's zlib. Nothing else is linked: FFmpeg is configured
# with --disable-everything --disable-autodetect and only the components
# below enabled back, and x264 without its command-line tool, OpenCL or any
# input library. Each configure line the script composes is compared with
# the one recorded in the pins before the build runs, and FFmpeg's own record
# of it after configure, so the pins cannot drift from what is built. What
# each target needs on the machine (a C compiler, make, pkg-config, git,
# curl, tar with xz, and nasm on x86-64) is checked before anything is
# fetched; nothing is installed.
#
# --sources writes what A6-01 attaches to a release as the Corresponding
# Source: the three source archives as fetched and verified, copies of this
# script, the pins and the vendor workflow, and BUILD.txt with every
# configure line and the repository commit they came from. The vendor job
# uploads it as the ffmpeg-source artefact.
#
# VENDOR_FFMPEG_PINS names another pins file, so a wrong checksum can be
# tried without editing the committed one. VENDOR_FFMPEG_WORK names a folder
# to build in and keep (sources already there that match their pins are not
# fetched again); by default the work is in a temporary folder removed at
# exit.
#
# On Windows the proof runs under Git Bash, so as in vendor-python.sh every
# hash is taken, and every pin read, by the build machine's Python rather
# than by tools the runners do not agree on.
#
# The proof is what export.py uses at the pinned engine tag, not a list of
# what FFmpeg can do: the encoders, decoders, filters, muxers, demuxers,
# input devices and protocols its four invocations and its ffprobe call
# name, then a real encode of a one-second synthetic sequence through the
# same filter graphs into MP4 and GIF, each read back with ffprobe.
#
# See docs/adr/012-ffmpeg-is-bundled-and-encoding-stays-in-python.md and
# docs/adr/040-ffmpeg-is-built-from-pinned-sources.md.
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
usage: vendor-ffmpeg.sh <target> [outdir]
       vendor-ffmpeg.sh --build-only <target> <dir>
       vendor-ffmpeg.sh --from <dir> <target> [outdir]
       vendor-ffmpeg.sh --sources <dir>
targets: darwin-arm64 darwin-x64 win-x64 linux-x64
EOF
  exit 2
}

mode=vendor
from=
case "${1:-}" in
  --build-only) mode=build; shift ;;
  --from) [ -n "${2:-}" ] || usage; mode=prove; from=$2; shift 2 ;;
  --sources) mode=sources; shift ;;
  -*) usage ;;
esac

target=
outdir=
if [ "$mode" = sources ]; then
  [ $# -eq 1 ] && [ -n "$1" ] || usage
  outdir=$1
else
  target=${1:-}
  case "$target" in
    darwin-arm64|darwin-x64|win-x64|linux-x64) ;;
    *) usage ;;
  esac
  if [ "$mode" = build ]; then
    [ $# -eq 2 ] && [ -n "$2" ] || usage
    outdir=$2
  else
    [ $# -le 2 ] || usage
    outdir=${2:-}
  fi
fi

# absolute <dir>: the directory's absolute path in the form the build
# machine's Python can read (`pwd -W` on Windows, under Git Bash or MSYS2).
absolute() { (cd "$1" && { pwd -W 2>/dev/null || pwd; }); }
# posix <dir>: the directory's absolute path in the shell's own form.
posix() { (cd "$1" && pwd); }

# Every path given is resolved before the cd below, so a relative path means
# relative to where the script was called.
pins=${VENDOR_FFMPEG_PINS:-}
if [ -n "$pins" ]; then
  [ -f "$pins" ] || { echo "VENDOR_FFMPEG_PINS names no file: $pins" >&2; exit 2; }
  pins="$(posix "$(dirname "$pins")")/$(basename "$pins")"
fi
if [ -n "$from" ]; then
  [ -d "$from" ] || { echo "--from names no folder: $from" >&2; exit 2; }
  from=$(posix "$from")
fi
if [ -n "$outdir" ]; then
  mkdir -p "$outdir"
  outdir=$(posix "$outdir")
fi
keep=${VENDOR_FFMPEG_WORK:-}
if [ -n "$keep" ]; then
  mkdir -p "$keep"
  keep=$(posix "$keep")
fi

# From the script's own place rather than from git: under MSYS2 on the
# Windows runner, git may refuse a checkout another user's git made.
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
pins=${pins:-$root/vendor/pins.json}
# Made whichever way it was named: in a fresh checkout the default,
# vendor/ffmpeg, does not exist (it is ignored), and the staging folder
# below is made inside it. The first CI run of this script failed there on
# every target but Windows, whose build step had already made it.
outdir=${outdir:-$root/vendor/ffmpeg}
mkdir -p "$outdir"

host_py=
for candidate in python3 python; do
  if "$candidate" -c 'import sys; sys.exit(sys.version_info < (3, 9))' >/dev/null 2>&1; then
    host_py=$candidate; break
  fi
done
[ -n "$host_py" ] || { echo "no Python 3.9 or later on PATH to read $pins" >&2; exit 2; }
pins_for_py="$(absolute "$(dirname "$pins")")/$(basename "$pins")"

sha256() {
  "$host_py" -c 'import hashlib, sys; sys.stdout.write(hashlib.sha256(sys.stdin.buffer.read()).hexdigest())' < "$1"
}

# pin <field> [<target>]: one line from the ffmpeg block of the pins, by a
# dotted path; with a target, from that target's entry. A missing field, or
# one that is not a single line, ends the script (or, inside a command
# substitution, the subshell, with Python's message on stderr).
pin() {
  local value
  value=$("$host_py" - "$pins_for_py" "$1" "${2:-}" <<'PY'
import json, sys
pins, field, target = sys.argv[1:4]
node = json.load(open(pins, encoding="utf-8"))["ffmpeg"]
where = "ffmpeg"
if target:
    node = node["targets"].get(target)
    where += f".targets.{target}"
    if node is None:
        sys.exit(f"no ffmpeg pin for target {target}")
for part in field.split("."):
    where += "." + part
    if not isinstance(node, dict) or part not in node:
        sys.exit(f"{where} is missing from the pins")
    node = node[part]
if not isinstance(node, str) or not node or "\n" in node or "\r" in node:
    sys.exit(f"{where} must be one non-empty line")
# Bytes, not text: a Windows Python's text-mode stdout writes every "\n" as
# "\r\n", in sys.stdout.write as much as in print. The first win-x64 run of
# the previous script did exactly that.
sys.stdout.buffer.write(node.encode("utf-8"))
PY
  ) || exit 1
  # And stripped all the same, so no Python on no runner can bring one back.
  printf '%s' "${value//$'\r'/}"
}

case "$target" in
  win-*) exe=.exe ;;
  *)     exe= ;;
esac

work=${keep:-$(mktemp -d)}
stage=
# Back to the root first: the encode below runs inside $work, and Windows
# will not remove a folder that is some process's working directory.
cleanup() {
  cd "$root"
  [ -n "$keep" ] || rm -rf "$work"
  [ -z "$stage" ] || rm -rf "$stage"
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# The sources
# ---------------------------------------------------------------------------

version=$(pin version)
ffmpeg_url=$(pin source.url)
ffmpeg_sha=$(pin source.sha256)
ffmpeg_tarball=${ffmpeg_url##*/}
x264_repo=$(pin x264.repo)
x264_commit=$(pin x264.commit)
x264_sha=$(pin x264.sha256)
x264_tarball="x264-$x264_commit.tar"
zlib_version=$(pin zlib.version)
zlib_url=$(pin zlib.url)
zlib_sha=$(pin zlib.sha256)
zlib_tarball=${zlib_url##*/}

# verify <file> <sha256>: the file is exactly the pinned bytes, or it fails.
verify() {
  local got
  got=$(sha256 "$1")
  if [ "$got" != "$2" ]; then
    echo "checksum mismatch for $(basename "$1")" >&2
    echo "  expected $2" >&2
    echo "  got      $got ($(wc -c < "$1" | tr -d ' ') bytes)" >&2
    echo "Either the pinned source changed, or the server answered with something" >&2
    echo "else, such as a challenge or interstitial page; a size far below the" >&2
    echo "archive's says which. Do not update the pin without reading why." >&2
    return 1
  fi
  echo "checksum ok: $(basename "$1") $got"
}

# fetch <url> <sha256> <dir>: the release archive at <url> in <dir>, verified.
fetch() {
  local file="$3/${1##*/}"
  if [ -f "$file" ] && verify "$file" "$2" 2>/dev/null; then return 0; fi
  echo "fetching $1"
  curl -fsSL --retry 3 --connect-timeout 30 --max-time 900 -o "$file.part" "$1"
  mv "$file.part" "$file"
  verify "$file" "$2"
}

# fetch_x264 <dir>: x264 at the pinned commit, as `git archive` writes it.
# The commit is fetched by its id, which git verifies object by object, and
# the tar is then checked against the pinned sha256; it is also the tar
# VideoLAN's GitLab serves inside its .tar.bz2 of the commit. No line-ending
# conversion, whatever git's configuration on the machine says.
fetch_x264() {
  local file="$1/$x264_tarball" repo="$work/x264.git" i
  if [ -f "$file" ] && verify "$file" "$x264_sha" 2>/dev/null; then return 0; fi
  rm -rf "$repo"
  git init -q "$repo"
  for i in 1 2 3; do
    echo "fetching x264 $x264_commit from $x264_repo"
    if git -C "$repo" fetch -q --depth 1 "$x264_repo" "$x264_commit"; then break; fi
    [ "$i" -lt 3 ] || { echo "could not fetch x264 $x264_commit" >&2; exit 1; }
    sleep 10
  done
  if [ "$(git -C "$repo" rev-parse FETCH_HEAD)" != "$x264_commit" ]; then
    echo "x264: fetched $(git -C "$repo" rev-parse FETCH_HEAD), not $x264_commit" >&2
    exit 1
  fi
  git -C "$repo" -c core.autocrlf=false -c core.eol=lf \
    archive --format=tar --prefix="x264-$x264_commit/" -o "$file.part" FETCH_HEAD
  mv "$file.part" "$file"
  rm -rf "$repo"
  verify "$file" "$x264_sha"
}

# ---------------------------------------------------------------------------
# What is configured
# ---------------------------------------------------------------------------

# Only what export.py runs, what the proof below and the determinism test
# (tests/support/frames.ts) run, and what those need inside FFmpeg:
#   encoders   libx264 and aac (MP4), gif, png and mjpeg (stills, posters);
#              rawvideo, which the determinism test decodes frames into
#   decoders   png (the captured frames), h264 (a poster from the MP4), mjpeg,
#              gif (the determinism test reads the GIF back); wrapped_avframe
#              and the packed PCM formats are what the lavfi device hands
#              ffmpeg for testsrc and anullsrc
#   parsers    gif: the gif demuxer asks for one, and without it no frame
#              after the first decodes
#   filters    the export's scale, format, fade, palettegen, paletteuse and
#              anullsrc; the proof's testsrc; null, anull, aformat, aresample,
#              trim, atrim and crop, which the ffmpeg program inserts itself
#              (crop for an H.264 whose height is not a multiple of 16, as a
#              1080x1920 reel's is, when a poster is taken from it)
#   muxers     mp4, gif, image2, and rawvideo for the determinism test
#   demuxers   image2 (frame sequences, stills), mov (the MP4), gif
#   devices    lavfi; protocols file and pipe (-progress pipe:1)
# The ffmpeg program adds hflip, vflip, transpose and rotate on its own.
# The commas are FFmpeg's own list syntax, one argument per kind.
# shellcheck disable=SC2054
components=(
  --enable-encoder=libx264,aac,gif,png,mjpeg,rawvideo
  --enable-decoder=png,h264,mjpeg,gif,wrapped_avframe,pcm_u8,pcm_s16le,pcm_s32le,pcm_f32le,pcm_f64le
  --enable-parser=gif
  --enable-muxer=mp4,gif,image2,rawvideo
  --enable-demuxer=image2,mov,gif
  --enable-filter=scale,format,fade,palettegen,paletteuse,anullsrc,testsrc,null,anull,aformat,aresample,trim,atrim,crop
  --enable-indev=lavfi
  --enable-protocol=file,pipe
)

# Electron's own minimum macOS: LSMinimumSystemVersion in the pinned
# Electron's Info.plist. A binary built for a newer one would not start on
# a Mac the app itself supports.
macos_min=13.0

x264_args=(--enable-static --disable-cli --disable-opencl --disable-avs --disable-swscale
  --disable-lavf --disable-ffms --disable-gpac --disable-lsmash --bit-depth=8 --chroma-format=420)
zlib_args=()
ffmpeg_args=(--disable-everything --disable-autodetect --disable-doc --disable-debug
  --disable-network --disable-ffplay --enable-gpl --enable-version3 --enable-zlib
  --enable-libx264 --pkg-config-flags=--static)
zlib_mode=system
case "$target" in
  darwin-*)
    x264_args+=("--extra-cflags=-mmacosx-version-min=$macos_min" "--extra-ldflags=-mmacosx-version-min=$macos_min")
    # -dead_strip_dylibs: FFmpeg's configure adds CoreFoundation, CoreMedia
    # and CoreVideo to libavutil whether or not anything enabled uses them,
    # and nothing here does.
    ffmpeg_args+=("--extra-cflags=-mmacosx-version-min=$macos_min"
      "--extra-ldflags=-mmacosx-version-min=$macos_min -Wl,-dead_strip_dylibs")
    ;;
  win-x64)
    zlib_mode=static
    zlib_args=(--static)
    # -static: GCC's own runtime, and anything else of the toolchain's, goes
    # into the executable and never beside it as a DLL.
    ffmpeg_args+=(--extra-ldflags=-static)
    ;;
esac
ffmpeg_args+=("${components[@]}")

# ffmpeg_line: the configuration FFmpeg records for these arguments, quoted
# as its configure quotes it (sh_quote: a value after the first = holding
# anything but letters, digits and _ / . + - is put in single quotes).
ffmpeg_line() {
  local out='' arg l r
  for arg in "${ffmpeg_args[@]}"; do
    r=${arg#*=}
    l=${arg%"$r"}
    case "$r" in
      *[!A-Za-z0-9_/.+-]*) r="'$r'" ;;
    esac
    out="$out $l$r"
  done
  printf '%s' "${out# }"
}

# same <what> <this> <pinned>: the two lines agree, or the script ends
# printing both.
same() {
  if [ "$2" != "$3" ]; then
    printf '%s is\n  %q\nthe pin says\n  %q\n' "$1" "$2" "$3" >&2
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# --sources
# ---------------------------------------------------------------------------

if [ "$mode" = sources ]; then
  fetch "$ffmpeg_url" "$ffmpeg_sha" "$outdir"
  fetch_x264 "$outdir"
  fetch "$zlib_url" "$zlib_sha" "$outdir"
  mkdir -p "$outdir/build"
  cp scripts/vendor-ffmpeg.sh .github/workflows/vendor.yml "$outdir/build/"
  cp "$pins" "$outdir/build/pins.json"
  commit=${GITHUB_SHA:-$(git rev-parse HEAD 2>/dev/null || echo unknown)}
  changed=$(git status --porcelain -- scripts/vendor-ffmpeg.sh .github/workflows/vendor.yml vendor/pins.json 2>/dev/null || true)
  repository="this repository"
  if [ -n "${GITHUB_REPOSITORY:-}" ]; then
    repository="${GITHUB_SERVER_URL:-https://github.com}/$GITHUB_REPOSITORY"
  fi
  {
    echo "The Corresponding Source of the ffmpeg and ffprobe that Legible Cities ships."
    echo
    echo "Built by scripts/vendor-ffmpeg.sh, run by .github/workflows/vendor.yml, of"
    echo "$repository at commit $commit."
    if [ -n "$changed" ]; then
      echo "These files differed from that commit when this was written:"
      printf '%s\n' "$changed"
    fi
    echo "Copies of both files, and of vendor/pins.json, as they were then are in build/."
    echo
    echo "Sources, each verified against the sha256 in the pins before use:"
    echo "  $ffmpeg_tarball  sha256 $ffmpeg_sha"
    echo "    FFmpeg $version, from $ffmpeg_url"
    echo "    (tag $(pin source.tag), commit $(pin source.commit))"
    echo "  $x264_tarball  sha256 $x264_sha"
    echo "    x264 at commit $x264_commit of $x264_repo, as"
    echo "    git archive --format=tar --prefix=x264-$x264_commit/ writes it"
    echo "  $zlib_tarball  sha256 $zlib_sha"
    echo "    zlib $zlib_version, from $zlib_url; linked statically into the"
    echo "    Windows binaries only, since macOS and Linux have the operating system's own"
    echo
    echo "Each target is built natively. On Windows, zlib is configured with --prefix"
    echo "naming the build's own dependency folder, then made and installed. x264 is"
    echo "configured with --prefix naming that folder, then \`make\` and"
    echo "\`make install-lib-static\`. FFmpeg is configured out of its tree with"
    echo "PKG_CONFIG_LIBDIR naming that folder's lib/pkgconfig and PKG_CONFIG_PATH"
    echo "empty, then \`make\`; ffmpeg and ffprobe are the two programs it leaves."
    echo "On macOS MACOSX_DEPLOYMENT_TARGET is $macos_min throughout."
    for t in darwin-arm64 darwin-x64 win-x64 linux-x64; do
      echo
      echo "$t"
      echo "  zlib: $(pin zlib "$t")"
      if [ "$(pin zlib "$t")" = static ]; then
        echo "  zlib configure: $(pin zlib_configure "$t")"
      fi
      echo "  x264 configure: $(pin x264_configure "$t")"
      echo "  FFmpeg configure: $(pin configure "$t")"
      echo "  ffmpeg -version reports: $(pin reports "$t")"
    done
  } > "$outdir/BUILD.txt"
  echo "wrote the Corresponding Source to $outdir:"
  ls -l "$outdir"
  exit 0
fi

# ---------------------------------------------------------------------------
# The build
# ---------------------------------------------------------------------------

# build <dir>: ffmpeg and ffprobe for $target, into <dir>.
build() {
  local bindir=$1 jobs missing='' tool host_os host_arch srcdir deps fbuild recorded
  local cc=cc started=$SECONDS

  host_os=$(uname -s)
  host_arch=$(uname -m)
  case "$target" in
    darwin-arm64) [ "$host_os" = Darwin ] && [ "$host_arch" = arm64 ] ;;
    darwin-x64)   [ "$host_os" = Darwin ] && [ "$host_arch" = x86_64 ] ;;
    linux-x64)    [ "$host_os" = Linux ] && [ "$host_arch" = x86_64 ] ;;
    win-x64)      [ "${MSYSTEM:-}" = UCRT64 ] && [ "$host_arch" = x86_64 ] ;;
  esac || {
    echo "$target is built natively, and this is $host_os $host_arch${MSYSTEM:+ ($MSYSTEM)}." >&2
    [ "$target" != win-x64 ] || echo "win-x64 builds in an MSYS2 UCRT64 shell." >&2
    exit 2
  }

  [ "$target" != win-x64 ] || cc=gcc
  for tool in "$cc" make pkg-config git curl tar xz; do
    command -v "$tool" >/dev/null 2>&1 || missing="$missing $tool"
  done
  if [ "$host_arch" = x86_64 ]; then
    command -v nasm >/dev/null 2>&1 || missing="$missing nasm"
  fi
  if [ -n "$missing" ]; then
    echo "building ffmpeg for $target needs:$missing" >&2
    exit 2
  fi

  # The composed lines are the pinned ones, before a minute is spent.
  same "the zlib this target links" "$zlib_mode" "$(pin zlib "$target")"
  if [ "$zlib_mode" = static ]; then
    same "the zlib configure line" "${zlib_args[*]}" "$(pin zlib_configure "$target")"
  fi
  same "the x264 configure line" "${x264_args[*]}" "$(pin x264_configure "$target")"
  same "the FFmpeg configure line" "$(ffmpeg_line)" "$(pin configure "$target")"

  jobs=$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)
  srcdir="$work/sources"
  mkdir -p "$srcdir"
  fetch "$ffmpeg_url" "$ffmpeg_sha" "$srcdir"
  fetch_x264 "$srcdir"
  if [ "$zlib_mode" = static ]; then fetch "$zlib_url" "$zlib_sha" "$srcdir"; fi

  # Fresh every time: FFmpeg refuses an out-of-tree build beside a source
  # tree that was once configured in place, and nothing stale is linked.
  rm -rf "$work/build"
  mkdir -p "$work/build"
  deps="$work/build/deps"
  tar -xJf "$srcdir/$ffmpeg_tarball" -C "$work/build"
  tar -xf "$srcdir/$x264_tarball" -C "$work/build"

  # Each tool's first line, taken from its captured output: piped into head,
  # a tool that writes more than one line dies of SIGPIPE under pipefail, as
  # GNU make 4.3 did on the first Linux run ("make: write error: stdout").
  local banner
  echo "toolchain:"
  banner=$("$cc" --version); echo "${banner%%$'\n'*}"
  banner=$(make --version); echo "${banner%%$'\n'*}"
  echo "pkg-config $(pkg-config --version)"
  if [ "$host_arch" = x86_64 ]; then nasm -v; fi

  case "$target" in
    darwin-*) export MACOSX_DEPLOYMENT_TARGET=$macos_min ;;
  esac
  # Only the build's own folder is searched for .pc files: a Homebrew or
  # MSYS2 zlib.pc would otherwise put its library on the link line.
  export PKG_CONFIG_LIBDIR="$deps/lib/pkgconfig"
  export PKG_CONFIG_PATH=

  if [ "$zlib_mode" = static ]; then
    tar -xzf "$srcdir/$zlib_tarball" -C "$work/build"
    echo "building zlib $zlib_version"
    (cd "$work/build/zlib-$zlib_version" &&
      CC=$cc ./configure "${zlib_args[@]}" --prefix="$deps" &&
      make -j"$jobs" && make install) > "$work/build/zlib.log" 2>&1 || {
      tail -n 40 "$work/build/zlib.log" >&2
      echo "zlib did not build" >&2
      exit 1
    }
  fi

  echo "building x264 $x264_commit"
  (cd "$work/build/x264-$x264_commit" &&
    ./configure --prefix="$deps" "${x264_args[@]}" &&
    make -j"$jobs" && make install-lib-static) > "$work/build/x264.log" 2>&1 || {
    tail -n 40 "$work/build/x264.log" >&2
    echo "x264 did not build" >&2
    exit 1
  }

  echo "configuring FFmpeg $version"
  fbuild="$work/build/ffmpeg-build"
  mkdir -p "$fbuild"
  (cd "$fbuild" && "$work/build/ffmpeg-$version/configure" "${ffmpeg_args[@]}") \
    > "$work/build/ffmpeg-configure.log" 2>&1 || {
    tail -n 40 "$work/build/ffmpeg-configure.log" >&2
    if [ -f "$fbuild/ffbuild/config.log" ]; then tail -n 40 "$fbuild/ffbuild/config.log" >&2; fi
    echo "FFmpeg did not configure" >&2
    exit 1
  }
  # What FFmpeg itself recorded, which is what -version will print.
  recorded=$(sed -n 's/^#define FFMPEG_CONFIGURATION "\(.*\)"$/\1/p' "$fbuild/config.h")
  same "FFmpeg's recorded configuration" "${recorded//$'\r'/}" "$(pin configure "$target")"
  sed -n '/^External libraries:/,/^Programs:/p' "$work/build/ffmpeg-configure.log"

  echo "building FFmpeg"
  (cd "$fbuild" && make -j"$jobs") > "$work/build/ffmpeg-make.log" 2>&1 || {
    tail -n 60 "$work/build/ffmpeg-make.log" >&2
    echo "FFmpeg did not build" >&2
    exit 1
  }

  mkdir -p "$bindir"
  cp "$fbuild/ffmpeg$exe" "$fbuild/ffprobe$exe" "$bindir/"
  echo "built ffmpeg and ffprobe for $target in $((SECONDS - started)) s"
}

if [ "$mode" = build ]; then
  build "$outdir"
  exit 0
fi

# Staged beside the destination, as vendor-python.sh does, so the final move
# is a rename on one filesystem, and a failed proof leaves nothing at the
# path the upload and a developer read.
dest="$outdir/$target"
stage=$(mktemp -d "$outdir/.staging-$target.XXXXXX")

if [ "$mode" = prove ]; then
  for name in "ffmpeg$exe" "ffprobe$exe"; do
    [ -f "$from/$name" ] || { echo "--from $from has no $name" >&2; exit 1; }
    cp "$from/$name" "$stage/$name"
  done
else
  build "$stage"
fi
chmod +x "$stage/ffmpeg$exe" "$stage/ffprobe$exe"

reports=$(pin reports "$target")
configure=$(pin configure "$target")

bin=$(cd "$stage" && pwd)
ff="$bin/ffmpeg$exe"
fp="$bin/ffprobe$exe"

# ---------------------------------------------------------------------------
# The proof
# ---------------------------------------------------------------------------

# run <what> <command...>: the command's stdout without carriage returns, or
# the script ends saying what failed. Output is captured and tested as text
# throughout, never piped into grep -q: under pipefail a grep that exits at
# its first match fails the pipeline when the writer has more to say.
run() {
  local what=$1 out; shift
  if ! out=$("$@"); then
    echo "$what failed: $*" >&2
    exit 1
  fi
  printf '%s' "${out//$'\r'/}"
}

# licensed <program> <binary>: the binary reports the pinned version and
# exactly the pinned configure line, is configured GPL version 3 with libx264
# and without nonfree parts, and does not call itself not legally
# redistributable. Run on ffmpeg and on ffprobe: they are separate binaries,
# and either could be the odd one out.
licensed() {
  local program=$1 binary=$2 version first token config flag licence
  version=$(run "$program -version" "$binary" -version)
  first=${version%%$'\n'*}
  echo "$first"
  # The exact token after "<program> version ", compared whole; both sides
  # are printed with %q when they differ, so an invisible character shows.
  token=${first#"$program version "}
  token=${token%% *}
  if [ "$token" != "$reports" ]; then
    printf '%s reports version %q; the pin says %q\n' "$program" "$token" "$reports" >&2
    exit 1
  fi
  config=$(grep -E '^configuration:' <<< "$version" || true)
  echo "$config"
  # The pin records the configure line so the notices can be checked against
  # the repository; this keeps the record true of what actually arrives.
  if [ "${config#configuration: }" != "$configure" ]; then
    printf '%s is configured\n  %q\nthe pin says\n  %q\n' "$program" "${config#configuration: }" "$configure" >&2
    exit 1
  fi
  for flag in --enable-gpl --enable-version3 --enable-libx264; do
    case " $config " in
      *" $flag "*) ;;
      *) echo "$program's configure line has no $flag" >&2; exit 1 ;;
    esac
  done
  # A nonfree build may not be redistributed at all.
  case " $config " in
    *" --enable-nonfree "*)
      echo "$program's configure line has --enable-nonfree; this build cannot be shipped" >&2
      exit 1 ;;
  esac
  licence=$(run "$program -L" "$binary" -hide_banner -L)
  case "$licence" in
    *"not legally redistributable"*)
      echo "$program -L says it is not legally redistributable:" >&2
      printf '%s\n' "$licence" >&2
      exit 1 ;;
  esac
}

licensed ffmpeg "$ff"

# has <listing> <name>: whether an ffmpeg -encoders, -filters, ... listing
# names <name> in its first or second column. Demuxers list their aliases
# joined by commas (mov,mp4,m4a,...), so a column is split on commas first.
has() {
  awk -v n="$2" '{ for (c = 1; c <= 2; c++) { k = split($c, a, ","); for (i = 1; i <= k; i++) if (a[i] == n) f = 1 } } END { exit !f }' <<< "$1"
}

# require <kind> <name...>: every name in `ffmpeg -<kind>`.
require() {
  local kind=$1 listing name missing=; shift
  listing=$(run "ffmpeg -$kind" "$ff" -hide_banner "-$kind")
  for name in "$@"; do
    has "$listing" "$name" || missing="$missing $name"
  done
  if [ -n "$missing" ]; then
    echo "ffmpeg -$kind lacks:$missing" >&2
    exit 1
  fi
  echo "$kind ok: $*"
}

# What export.py at the pinned engine tag runs:
#   _encode, mp4: image2 of PNGs + lavfi anullsrc -> fade, scale (lanczos),
#     format=yuv420p -> libx264 high + aac -> mp4 with +faststart
#   _encode, gif: palettegen, then scale + paletteuse -> gif
#   _resample: scale (lanczos) -> png, or jpg (mjpeg) with -q:v
#   poster: -ss into the mp4 (h264 decoded) -> one jpg or png frame
#   _duration: ffprobe format=duration
#   progress: -progress pipe:1
require encoders libx264 aac gif png mjpeg
require decoders png h264 mjpeg
require filters scale format fade palettegen paletteuse anullsrc
require muxers mp4 gif image2
require demuxers image2 mov
require devices lavfi
protocols=$(run "ffmpeg -protocols" "$ff" -hide_banner -protocols)
for name in file pipe; do
  has "$protocols" "$name" || { echo "ffmpeg -protocols lacks $name" >&2; exit 1; }
done
echo "protocols ok: file pipe"

licensed ffprobe "$fp"

# A real encode, in the work folder, with relative paths only: nothing that
# Git Bash would rewrite as a path crosses to a Windows ffmpeg.
rm -rf "$work/encode"
mkdir -p "$work/encode/frames"
cd "$work/encode"
ffrun() { run "ffmpeg $*" "$ff" -hide_banner -nostdin -loglevel error -y "$@" > /dev/null; }

# expect <file> "<key=value ...>" <ffprobe options...>: every key=value in
# what ffprobe answers for <file>.
expect() {
  local file=$1 want=$2 out line; shift 2
  out=$(run "ffprobe $file" "$fp" -v error "$@" -of default=noprint_wrappers=1 "$file")
  echo "$file: $(tr '\n' ' ' <<< "$out")"
  for line in $want; do
    if ! grep -Fxq -- "$line" <<< "$out"; then
      echo "$file: ffprobe did not report $line" >&2
      exit 1
    fi
  done
}

# Ten frames at 10 fps: one second, as the engine writes a capture.
ffrun -f lavfi -i testsrc=size=64x64:rate=10 -frames:v 10 frames/%06d.png
count=$(find frames -name '*.png' | wc -l | tr -d ' ')
[ "$count" = 10 ] || { echo "the synthetic sequence has $count frames, not 10" >&2; exit 1; }

ffrun -framerate 10 -i frames/%06d.png \
  -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=48000 \
  -vf fade=t=in:st=0:d=0.2,fade=t=out:st=0.80:d=0.2,scale=64:64:flags=lanczos,format=yuv420p \
  -c:v libx264 -profile:v high -preset slow -crf 20 \
  -r 10 -c:a aac -b:a 96k -shortest -movflags +faststart -progress pipe:1 test.mp4
expect test.mp4 "codec_name=h264 profile=High width=64 height=64 pix_fmt=yuv420p nb_read_frames=10" \
  -select_streams v:0 -count_frames -show_entries stream=codec_name,profile,width,height,pix_fmt,nb_read_frames
expect test.mp4 "codec_name=aac" -select_streams a:0 -show_entries stream=codec_name

ffrun -framerate 10 -i frames/%06d.png -vf palettegen=stats_mode=diff palette.png
ffrun -framerate 10 -i frames/%06d.png -i palette.png \
  -lavfi 'scale=48:48:flags=lanczos[s];[s][1:v]paletteuse=dither=bayer:bayer_scale=3' test.gif
expect test.gif "codec_name=gif width=48 height=48 nb_read_frames=10" \
  -select_streams v:0 -count_frames -show_entries stream=codec_name,width,height,nb_read_frames

# _resample and poster, and the duration read the way _duration reads it.
ffrun -i frames/000001.png -vf scale=32:32:flags=lanczos still.png
ffrun -i frames/000001.png -vf scale=32:32:flags=lanczos -q:v 3 still.jpg
expect still.png "codec_name=png width=32 height=32" -show_entries stream=codec_name,width,height
expect still.jpg "codec_name=mjpeg width=32 height=32" -show_entries stream=codec_name,width,height
duration=$(run "ffprobe duration" "$fp" -v error -show_entries format=duration -of csv=p=0 test.mp4)
echo "test.mp4 duration: $duration"
if ! "$host_py" -c 'import sys; d = float(sys.argv[1]); sys.exit(not 0.9 <= d <= 1.2)' "$duration"; then
  echo "test.mp4 lasts $duration s, not about one second" >&2
  exit 1
fi
ffrun -ss 0.60 -i test.mp4 -frames:v 1 -q:v 2 poster.jpg
expect poster.jpg "codec_name=mjpeg width=64 height=64" -show_entries stream=codec_name,width,height

cd "$root"
staged=$(ls -A "$stage")
if [ "$staged" != "$(printf 'ffmpeg%s\nffprobe%s' "$exe" "$exe")" ]; then
  echo "the staging folder holds more than ffmpeg and ffprobe:" >&2
  printf '%s\n' "$staged" >&2
  exit 1
fi

# Only now is the old pair removed and the new one put in its place.
rm -rf "$dest"
mv "$stage" "$dest"
stage=

printf 'vendored ffmpeg %s for %s: %s\n' "$reports" "$target" "$(du -sh "$dest" | cut -f1)"
