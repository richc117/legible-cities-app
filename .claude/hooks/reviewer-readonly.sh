#!/usr/bin/env bash
# PreToolUse hook for the `reviewer` subagent: keep its Bash tool read-only.
#
# The reviewer reports; it never changes anything. Its tool list gives it no
# Write or Edit, but Bash is all-or-nothing, so this hook is what makes
# "read-only" true rather than aspirational. Exit 2 blocks the call and shows
# the reason; exit 0 lets it through.
set -u
cmd=$(jq -r '.tool_input.command // empty' 2>/dev/null)
[ -n "$cmd" ] || exit 0

refuse() {
  printf 'the reviewer is read-only: %s\nAllowed: git diff/status/log/show/blame/ls-files/rev-parse, gitleaks, bin/preflight.\n' \
    "$1" >&2
  exit 2
}

# One command, no chaining, no redirection, no substitution: an allowlist
# that only checks the start of the string is not an allowlist.
case "$cmd" in
  *';'*|*'&'*|*'|'*|*'>'*|*'<'*|*'`'*|*'$('*|*$'\n'*)
    refuse "no chaining, redirection or substitution" ;;
esac

# Read-only git, plus the repository's own scanners, which only read.
# `git branch` appears only in its reporting form: the same verb with -d or
# -D deletes.
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
  "gitleaks "*|\
  "bin/preflight"|"bin/preflight "*)
    exit 0 ;;
esac

refuse "refused '$cmd'"
