#!/usr/bin/env bash
# Take the licence texts out of python-build-standalone's `full` archive:
# python/PYTHON.json and python/licenses/, and nothing else, into <outdir>.
#
#   scripts/vendor-python-licences.sh <archive.tar.zst> <outdir>
#
# scripts/vendor-python.sh calls this once the archive's checksum has passed
# (issue 108, ADR-042), and tests/unit/vendor-python-licences.test.ts runs the
# same lines, so what the build does is what the test saw. The zstd is
# $ZSTD_BIN where the caller found one, else the first on PATH. On Windows
# this runs under Git Bash, whose tar is GNU tar, and every path it is given
# is a POSIX one: GNU tar reads `C:\dir` as a file on a host called C.
#
# Why the archive is decompressed to a file rather than piped into tar
# (issue 319). It used to be `zstd -dc | tar -xf - <members>`, with the rest
# of the archive "never written to disk". bsdtar does not read to the end of
# its input: it stops at the end-of-archive marker and leaves unread the
# padding that follows it, up to the archive's block size. If zstd had not
# yet written that padding when tar exited, its next write failed with a
# broken pipe (ours printed `zstd: /*stdout*\: Broken pipe`) and `set -o
# pipefail` turned that into a failed step with nothing wrong in the archive.
# Whether the padding was already in the pipe depended on how the writes
# fell, so it was intermittent: twice on macOS runners.
#
# The other way, tolerating that one failure, was refused: zstd's status for
# it is 141 when SIGPIPE has its default action and its own 70 when the
# process that started the job ignores it, so telling it from a real write
# error means matching a number that depends on who started the job. (The
# message above is the second case, a runner's.) A file has no reader to stop
# and no pipe to break: zstd runs to the end into a file of its own, tar
# reads that file and may stop where it likes, and the folder it sits in goes
# when this script ends, by whichever way. What it costs is the whole
# decompressed archive on disk for that long; the line printed below sizes it
# in every log.
set -euo pipefail

archive=${1:-}
outdir=${2:-}
[ -n "$archive" ] && [ -n "$outdir" ] || {
  echo "usage: $0 <archive.tar.zst> <outdir>" >&2; exit 2; }
[ -f "$archive" ] || { echo "no archive at $archive" >&2; exit 2; }

zstd_bin=${ZSTD_BIN:-$(command -v zstd || command -v zstd.exe || true)}
[ -n "$zstd_bin" ] || {
  echo "no zstd on PATH: $archive is .tar.zst and nothing else here reads it" >&2
  exit 1; }

# The decompressed archive goes in a folder of its own beside the archive,
# whose folder is where the caller has room for one, and never in <outdir>,
# which holds the two members and only them. The template names the folder
# because mktemp on macOS ignores TMPDIR without one.
scratch=$(mktemp -d "$(dirname "$archive")/licences.XXXXXX")
trap 'rm -rf "$scratch"' EXIT
mkdir -p "$outdir"

# Separate arguments for -o and its path, so that Git Bash translates the path
# for a zstd.exe that is a native Windows program.
"$zstd_bin" -d -q "$archive" -o "$scratch/full.tar" || {
  echo "zstd could not decompress $archive" >&2; exit 1; }
printf 'decompressed %s to %s bytes\n' "$(basename "$archive")" \
  "$(wc -c < "$scratch/full.tar" | tr -d ' ')"

# tar reads a file, not a pipe. A member list that GNU tar and bsdtar both
# take as prefixes, so python/licenses brings everything under it.
tar -xf "$scratch/full.tar" -C "$outdir" python/PYTHON.json python/licenses || {
  echo "tar could not take python/PYTHON.json and python/licenses/ out of $archive" >&2
  exit 1; }

if [ ! -f "$outdir/python/PYTHON.json" ] || [ ! -d "$outdir/python/licenses" ]; then
  echo "$archive has no python/PYTHON.json or python/licenses/" >&2
  exit 1
fi
