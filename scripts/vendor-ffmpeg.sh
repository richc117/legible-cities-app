#!/usr/bin/env bash
# Fetch the pinned static FFmpeg build for one target, verify every archive
# against the checksum in vendor/pins.json, take ffmpeg and ffprobe out of it,
# and prove the pair can do what the engine's export asks of it before
# putting them in place.
#
#   scripts/vendor-ffmpeg.sh <target> [outdir]
#   scripts/vendor-ffmpeg.sh darwin-arm64 vendor/ffmpeg
#
# Targets are the keys of ffmpeg.targets: darwin-arm64, darwin-x64, win-x64
# and linux-x64 (for tests only). The result is <outdir>/<target>/ holding
# exactly ffmpeg and ffprobe, with .exe on Windows: the engine reads
# SCHEMATIC_FFMPEG and finds ffprobe beside it by replacing "ffmpeg" in the
# file name (export.ffprobe_path), so both names matter.
#
# VENDOR_FFMPEG_PINS names another pins file, so a wrong checksum can be
# tried without editing the committed one.
#
# On Windows it runs under Git Bash, so as in vendor-python.sh every hash is
# taken, and every archive opened, by the build machine's Python rather than
# by shasum, unzip or tar, which the three runners do not agree on.
#
# The proof is what export.py uses at the pinned engine tag, not a list of
# what FFmpeg can do: the encoders, decoders, filters, muxers, demuxers,
# input devices and protocols its four invocations and its ffprobe call
# name, then a real encode of a one-second synthetic sequence through the
# same filter graphs into MP4 and GIF, each read back with ffprobe.
#
# See docs/adr/012-ffmpeg-is-bundled-and-encoding-stays-in-python.md.
set -euo pipefail

target=${1:-}
outdir=${2:-vendor/ffmpeg}
[ -n "$target" ] || { echo "usage: $0 <target> [outdir]" >&2; exit 2; }

# absolute <dir>: the directory's absolute path in the form the build
# machine's Python can read (Git Bash's `pwd -W` on Windows).
absolute() { (cd "$1" && { pwd -W 2>/dev/null || pwd; }); }

# Resolved before the cd below, so a relative path means relative to where
# the script was called.
pins=${VENDOR_FFMPEG_PINS:-}
if [ -n "$pins" ]; then
  [ -f "$pins" ] || { echo "VENDOR_FFMPEG_PINS names no file: $pins" >&2; exit 2; }
  pins="$(absolute "$(dirname "$pins")")/$(basename "$pins")"
fi

root=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
cd "$root"
pins=${pins:-vendor/pins.json}

host_py=
for candidate in python3 python; do
  if "$candidate" -c 'import sys; sys.exit(sys.version_info < (3, 9))' >/dev/null 2>&1; then
    host_py=$candidate; break
  fi
done
[ -n "$host_py" ] || { echo "no Python 3.9 or later on PATH to read $pins" >&2; exit 2; }

sha256() {
  "$host_py" -c 'import hashlib, sys; sys.stdout.write(hashlib.sha256(sys.stdin.buffer.read()).hexdigest())' < "$1"
}

case "$target" in
  win-*) exe=.exe ;;
  *)     exe= ;;
esac

# The pin, one line per field: what -version must report, then each archive
# as "<sha256> <url>". The names inside must be exactly ffmpeg and ffprobe
# (with .exe on Windows), so a pin cannot quietly vendor a third binary or
# only one of the two.
plan=$("$host_py" - "$pins" "$target" "$exe" <<'PY'
import json, sys
pins, target, exe = sys.argv[1:4]
d = json.load(open(pins))["ffmpeg"]
t = d["targets"].get(target)
if not t:
    sys.exit(f"no ffmpeg pin for target {target}; known: {', '.join(d['targets'])}")
names = sorted(n for a in t["archives"] for n in a["extract"])
want = sorted(["ffmpeg" + exe, "ffprobe" + exe])
if names != want:
    sys.exit(f"ffmpeg.targets.{target} extracts {names}; it must extract exactly {want}")
lines = [t["reports"]] + [f"{a['sha256']} {a['url']}" for a in t["archives"]]
# write, not print: a Windows Python ends a printed line in \r\n.
sys.stdout.write("\n".join(lines))
PY
)
reports=${plan%%$'\n'*}
[ -n "$reports" ] || { echo "could not read the ffmpeg pin for $target" >&2; exit 1; }

work=$(mktemp -d)
stage=
# Back to the root first: the encode below runs inside $work, and Windows
# will not remove a folder that is some process's working directory.
trap 'cd "$root"; rm -rf "$work" ${stage:+"$stage"}' EXIT

# Every archive is fetched and checked before anything is opened.
i=0
while read -r want url; do
  i=$((i + 1))
  file="$work/$i-${url##*/}"
  echo "fetching $url"
  curl -fsSL --retry 3 -o "$file" "$url"
  got=$(sha256 "$file")
  if [ "$got" != "$want" ]; then
    echo "checksum mismatch for $url" >&2
    echo "  expected $want" >&2
    echo "  got      $got" >&2
    echo "The pinned archive changed. Do not update the pin without reading why." >&2
    exit 1
  fi
  echo "checksum ok: $got"
done <<< "${plan#*$'\n'}"

# Staged beside the destination, as vendor-python.sh does, so the final move
# is a rename on one filesystem, and a failed proof leaves nothing at the
# path the upload and a developer read.
dest="$outdir/$target"
mkdir -p "$outdir"
stage=$(mktemp -d "$outdir/.staging-$target.XXXXXX")

# Only the named members are read, and each is written to a fixed name, so
# nothing else in the archive (ffplay, documentation, a path with ..) lands.
"$host_py" - "$pins" "$target" "$(absolute "$work")" "$(absolute "$stage")" <<'PY'
import json, os, shutil, sys, tarfile, zipfile
pins, target, work, stage = sys.argv[1:5]
t = json.load(open(pins))["ffmpeg"]["targets"][target]
for i, a in enumerate(t["archives"], start=1):
    path = os.path.join(work, f"{i}-{a['url'].rsplit('/', 1)[1]}")
    wanted = {member: name for name, member in a["extract"].items()}
    if path.endswith(".zip"):
        with zipfile.ZipFile(path) as z:
            for member, name in wanted.items():
                with z.open(member) as src, open(os.path.join(stage, name), "wb") as dst:
                    shutil.copyfileobj(src, dst)
    elif path.endswith((".tar.xz", ".tar.gz")):
        found = set()
        with tarfile.open(path, "r|*") as tf:
            for m in tf:
                if m.name in wanted and m.isfile():
                    with tf.extractfile(m) as src, open(os.path.join(stage, wanted[m.name]), "wb") as dst:
                        shutil.copyfileobj(src, dst)
                    found.add(m.name)
        missing = set(wanted) - found
        if missing:
            sys.exit(f"{a['url']} has no {', '.join(sorted(missing))}")
    else:
        sys.exit(f"cannot open {a['url']}: not a .zip, .tar.xz or .tar.gz")
PY
chmod +x "$stage/ffmpeg$exe" "$stage/ffprobe$exe"

bin=$(cd "$stage" && pwd)
ff="$bin/ffmpeg$exe"
fp="$bin/ffprobe$exe"

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

version=$(run "ffmpeg -version" "$ff" -version)
first=${version%%$'\n'*}
echo "$first"
case "$first" in
  "ffmpeg version $reports "*) ;;
  *) echo "ffmpeg reports '$first'; the pin says ffmpeg version $reports" >&2; exit 1 ;;
esac
config=$(grep -E '^configuration:' <<< "$version" || true)
echo "$config"
for flag in --enable-gpl --enable-version3 --enable-libx264; do
  case " $config " in
    *" $flag "*) ;;
    *) echo "the configure line has no $flag" >&2; exit 1 ;;
  esac
done
# A nonfree build may not be redistributed at all; martin-riedl.de's Linux
# build of the same release is one.
case " $config " in
  *" --enable-nonfree "*) echo "the configure line has --enable-nonfree; this build cannot be shipped" >&2; exit 1 ;;
esac

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

probe_version=$(run "ffprobe -version" "$fp" -version)
probe_first=${probe_version%%$'\n'*}
echo "$probe_first"
case "$probe_first" in
  "ffprobe version $reports "*) ;;
  *) echo "ffprobe reports '$probe_first'; the pin says ffprobe version $reports" >&2; exit 1 ;;
esac

# A real encode, in the work folder, with relative paths only: nothing that
# Git Bash would rewrite as a path crosses to a Windows ffmpeg.
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
