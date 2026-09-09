#!/usr/bin/env bash
# PreToolUse hook for the `reviewer` subagent: keep its Bash tool read-only.
#
# The reviewer reports; it never changes anything. Its tool list gives it no
# Write or Edit, but Bash is all-or-nothing, so this hook is what makes
# "read-only" true rather than aspirational. Exit 2 blocks the call and shows
# the reason; exit 0 lets it through.
#
# Two rules learned by getting this wrong:
#
# 1. Read-only is a property of the whole command line, not of the verb at
#    the front of it. `git diff --output=<file>` overwrites a file,
#    `git diff --no-index` reads one outside the history, and
#    `gitleaks -r <file>` writes one.
# 2. An option pattern that assumes surrounding spaces misses `-r=file`.
#    Where a tool's option surface is large, allowlist the exact invocations
#    instead of trying to enumerate what is dangerous - which is why gitleaks
#    and bin/preflight appear below in one form each.
#
# bin/test-hooks exercises every line of this. Run it after any edit.
set -u

refuse() {
  printf 'the reviewer is read-only: %s\n' "$1" >&2
  printf 'Allowed: git diff/status/log/show/blame/grep/ls-files/rev-parse (no --output, --no-index or -O),\n' >&2
  printf '         git branch --show-current, git remote, and the two scanners in their exact forms.\n' >&2
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

# The scanners, in the exact forms the reviewer needs and no others. Anything
# else - another path, a report file, a dropped --redact - is refused rather
# than parsed. `bin/preflight --message-file <path>` prints the matching
# lines of whatever file it is given, which is the private notes if asked.
case "$cmd" in
  "gitleaks dir . --no-banner --redact"|\
  "gitleaks git --no-banner --redact"|\
  "bin/preflight")
    exit 0 ;;
esac

# Options that turn one of the read-only git verbs below into a writing,
# reading-outside-the-repository, or executing one. Only options reachable
# from those verbs are listed: `git -c`, `git --pager` and `git --exec-path`
# come before the subcommand, so they never match the anchored patterns
# below, and `--extcmd` belongs to difftool, which is not allowlisted.
case "$cmd" in
  *'--output'*|*'--no-index'*|*'--open-files-in-pager'*|*'-O'*)
    refuse "that option writes a file, reads outside the repository, or opens a pager" ;;
esac

# Read-only git. `git branch` appears only in its reporting form: the same
# verb with -d or -D deletes. `git remote` appears without -v on purpose -
# the remote's URL is private, and a transcript of this review may end up in
# a public pull request. Do not "helpfully" add it.
case "$cmd" in
  "git diff"|"git diff "*|\
  "git status"|"git status "*|\
  "git log"|"git log "*|\
  "git show"|"git show "*|\
  "git blame "*|\
  "git grep "*|\
  "git ls-files"|"git ls-files "*|\
  "git rev-parse "*|\
  "git branch --show-current"|\
  "git remote")
    exit 0 ;;
esac

refuse "refused '$cmd'"
