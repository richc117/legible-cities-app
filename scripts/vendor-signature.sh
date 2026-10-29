# shellcheck shell=bash
# Signature checks shared by the vendoring scripts and workflows: sourced,
# never run. scripts/vendor-ffmpeg.sh verifies FFmpeg's and zlib's release
# tarballs with it, and the loom-source job of .github/workflows/vendor.yml
# the zlib and bzip2 tarballs the Windows LOOM tools link (ADR-040,
# ADR-041). Needs bash, curl, mktemp, awk and gpg.
#
# signed() writes the signature beside the file, named with the signature
# URL's own extension (.asc or .sig), and ends the calling shell on any
# refusal. It fetches the signature and the key through tries() and
# download() below, the bounded retry scripts/vendor-ffmpeg.sh fetches its
# archives with (issue 630), and fetches both on every call: a cached key
# would hide a revocation published since.

# tries <what> <command...>: the command, run up to four times, waiting
# VENDOR_FFMPEG_BACKOFF seconds (15 by default) after the first failure and
# twice as long after each next; the calling shell ends after the fourth.
tries() {
  local what=$1 attempt=1 wait=${VENDOR_FFMPEG_BACKOFF:-15}; shift
  case "$wait" in
    *[!0-9]*) echo "VENDOR_FFMPEG_BACKOFF is a whole number of seconds, not '$wait'" >&2; exit 2 ;;
  esac
  while :; do
    if "$@"; then return 0; fi
    if [ "$attempt" -ge 4 ]; then
      echo "could not fetch $what in $attempt tries" >&2
      exit 1
    fi
    echo "try $attempt of 4 to fetch $what failed; trying again in $wait s" >&2
    sleep "$wait"
    attempt=$((attempt + 1))
    wait=$((wait * 2))
  done
}

# download <url> <file> [<seconds>]: one try at <url>, into <file> only when
# it is whole, in at most <seconds> (900 by default). A transfer slower than
# 1 KB/s for a minute is a failed try, not a wait of fifteen minutes; curl's
# own retries are left to tries(), which also retries a reset connection, as
# curl's do not.
download() {
  echo "fetching $1"
  rm -f "$2.part"
  if curl -fsSL --connect-timeout 30 --speed-limit 1024 --speed-time 60 --max-time "${3:-900}" -o "$2.part" "$1"; then
    mv "$2.part" "$2"
  else
    rm -f "$2.part"
    return 1
  fi
}

# signed <file> <signature url> <key url> <fingerprint>: the file carries a
# good signature by the key with that primary fingerprint. The key is
# fetched at run time and trusted only for its fingerprint, which the pins
# record; a key file names its owner's address, so none is committed. The
# sha256 in the pins was taken on first download; this is what ties those
# bytes to their publisher.
signed() {
  local file=$1 sig_url=$2 key_url=$3 want=$4 home status primary revoked sig
  command -v gpg >/dev/null 2>&1 || { echo "verifying $(basename "$file") needs gpg" >&2; exit 2; }
  home=$(mktemp -d)
  chmod 700 "$home"
  sig="$file.${sig_url##*.}"
  tries "$(basename "$sig")" download "$sig_url" "$sig" 120
  echo "the signing key $want:"
  tries "the signing key $want" download "$key_url" "$home/key.asc" 120
  # gpg's own messages, and the GOODSIG, BADSIG and IMPORTED status lines,
  # carry the key's user ID and so its owner's e-mail address, into a public
  # log. Only fingerprints and key ids are ever printed.
  if ! status=$(gpg --homedir "$home" --batch --status-fd 1 --import "$home/key.asc" 2> /dev/null); then
    awk '$2 ~ /^(IMPORT_OK|IMPORT_PROBLEM|IMPORT_RES|NODATA|FAILURE|ERROR)$/' <<< "$status" >&2
    echo "the signing key from $key_url did not import" >&2
    exit 1
  fi
  if ! status=$(gpg --homedir "$home" --batch --status-fd 1 --verify "$sig" "$file" 2> /dev/null); then
    signature_status "$status" >&2
    echo "$(basename "$file") has no good signature by $want" >&2
    exit 1
  fi
  # A signature by a revoked key verifies, with REVKEYSIG where GOODSIG
  # would be and VALIDSIG naming the key all the same, and gpg exits 0.
  # Revocation means the key is not to be trusted, so it is refused. An
  # expired key (EXPKEYSIG) is not: a release outlives the key that signed
  # it, and expiry says nothing about the signature made before it.
  revoked=$(awk '$2 == "REVKEYSIG" || $2 == "KEYREVOKED"' <<< "$status")
  if [ -n "$revoked" ]; then
    signature_status "$status" >&2
    echo "$(basename "$file") is signed by a revoked key" >&2
    exit 1
  fi
  # VALIDSIG's last field is the primary key's fingerprint, whichever
  # subkey signed.
  primary=$(awk '$2 == "VALIDSIG" { print $NF }' <<< "$status")
  if [ "$primary" != "$want" ]; then
    signature_status "$status" >&2
    echo "$(basename "$file") is signed by ${primary:-no valid key}, not $want" >&2
    exit 1
  fi
  rm -rf "$home"
  echo "signature ok: $(basename "$file") by $want"
}

# signature_status <gpg status>: the lines that say what was found, without
# a user ID: VALIDSIG, ERRSIG, NO_PUBKEY and KEYREVOKED whole, and BADSIG,
# REVKEYSIG, EXPKEYSIG and GOODSIG up to their key id.
signature_status() {
  awk '$2 ~ /^(VALIDSIG|ERRSIG|NO_PUBKEY|KEYREVOKED|KEYEXPIRED)$/ { print; next }
       $2 ~ /^(BADSIG|REVKEYSIG|EXPKEYSIG|EXPSIG|GOODSIG)$/ { print $1, $2, $3 }' <<< "$1"
}
