#!/usr/bin/env bash
# PreToolUse hook for the `reviewer` subagent: keep its Bash tool read-only.
#
# The reviewer reports; it never changes anything. Its tool list gives it no
# Write or Edit, but Bash is all-or-nothing, so this hook is what makes
# "read-only" true rather than aspirational. Exit 2 blocks the call and shows
# the reason; exit 0 lets it through.
#
# Read-only is a property of the whole command line, not of the verb at the
# front of it. `git diff` writes a file with --output, `git difftool` runs a
# command with --extcmd, and `gitleaks` writes one with --report-path, so the
# option checks below are load-bearing rather than defensive tidiness.
set -u

refuse() {
  printf 'the reviewer is read-only: %s\nAllowed: git diff/status/log/show/blame/ls-files/rev-parse, gitleaks, bin/preflight.\n' \
    "$1" >&2
  exit 2
}

# Fail closed. A Bash call always carries a command, so an empty parse is a
# failure - a missing jq, a changed payload - and not a benign case.
command -v jq >/dev/null 2>&1 || refuse "jq is not installed, so the command cannot be read"
cmd=$(jq -r '.tool_input.command // empty' 2>/dev/null)
[ -n "$cmd" ] || refuse "the command could not be read"

# One command, no chaining, no redirection, no substitution: an allowlist
# that only checks the start of the string is not an allowlist.
# shellcheck disable=SC2016  # `$(` is matched literally here, not expanded.
case "$cmd" in
  *';'*|*'&'*|*'|'*|*'>'*|*'<'*|*'`'*|*'$('*|*$'\n'*)
    refuse "no chaining, redirection or substitution" ;;
esac

# Options that turn a reading command into a writing or executing one,
# wherever they appear on the line.
case "$cmd" in
  *'--output'*|*'--report-path'*|*' -r '*|*'--diagnostics'*|*'--extcmd'*|*' -x '*|\
  *'--upload-pack'*|*'--receive-pack'*|*'--exec'*|*'-c '*|*'--pager'*|*'-O'*)
    refuse "that option writes, executes or reconfigures" ;;
esac

# Read-only git, plus the repository's own scanners, which only read.
# `git branch` appears only in its reporting form: the same verb with -d or
# -D deletes. `git remote` appears without -v on purpose - the remote's URL
# is private, and a transcript of this review may end up in a public pull
# request. Do not "helpfully" add it.
case "$cmd" in
  "git diff"|"git diff "*|\
  "git status"|"git status "*|\
  "git log"|"git log "*|\
  "git show"|"git show "*|\
  "git blame "*|\
  "git ls-files"|"git ls-files "*|\
  "git rev-parse "*|\
  "git branch --show-current"|\
  "git remote"|\
  "gitleaks dir "*|\
  "gitleaks git "*|\
  "bin/preflight"|"bin/preflight "*)
    exit 0 ;;
esac

refuse "refused '$cmd'"
