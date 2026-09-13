# shellcheck shell=bash
# Signature checks shared by the vendoring scripts and workflows: sourced,
# never run. scripts/vendor-ffmpeg.sh verifies FFmpeg's and zlib's release
# tarballs with it, and the loom-source job of .github/workflows/vendor.yml
# the zlib and bzip2 tarballs the Windows LOOM tools link (ADR-040,
# ADR-041). Needs bash, curl, mktemp, awk and gpg.
#
# signed() writes the signature beside the file, named with the signature
# URL's own extension (.asc or .sig), and ends the calling shell on any
# refusal.

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
  echo "fetching $sig_url"
  sig="$file.${sig_url##*.}"
  curl -fsSL --retry 3 --connect-timeout 30 --max-time 120 -o "$sig" "$sig_url"
  echo "fetching the signing key $want"
  curl -fsSL --retry 3 --connect-timeout 30 --max-time 120 -o "$home/key.asc" "$key_url"
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
