#!/usr/bin/env bash
# Claude Code PreToolUse hook: before any `git commit` or `git push` that
# Claude runs, run the two scanners this repository trusts. Exit 2 blocks the
# command and shows the reason; exit 0 lets it through. Other commands pass
# untouched.
#
# The same pair runs from .pre-commit-config.yaml and in CI. This copy exists
# because a tool-driven commit can reach for `--no-verify`, and because the
# reason for a block is worth putting in front of the model that caused it.
set -u
input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)
case "$cmd" in
  *"git commit"*|*"git push"*) ;;
  *) exit 0 ;;
esac
root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
cd "$root" || exit 0

block() { printf '%s\n%s\n' "$1" "$2" >&2; exit 2; }

# 1. Keys and tokens, in the staged changes and - before a push - in every
#    commit that is about to leave this machine.
if ! command -v gitleaks >/dev/null 2>&1; then
  block "gitleaks is not installed; refusing to commit or push." \
        "Install it (brew install gitleaks) or run: pre-commit run --all-files"
fi
if ! out=$(gitleaks git --staged --no-banner --redact 2>&1); then
  block "gitleaks found something in the staged changes; nothing was committed:" "$out"
fi
case "$cmd" in
  *"git push"*)
    if git rev-parse -q --verify '@{upstream}' >/dev/null 2>&1; then
      logopts='--log-opts=@{upstream}..HEAD'
    else
      logopts=''   # nothing pushed yet: scan all of history
    fi
    if ! out=$(gitleaks git --no-banner --redact ${logopts:+"$logopts"} 2>&1); then
      block "gitleaks found something in the commits about to be pushed:" "$out"
    fi
    ;;
esac

# 2. The rest of the never list: machine paths, personal addresses, private
#    hosts, links to tool sessions.
if ! out=$(bin/preflight 2>&1); then
  block "blocked by bin/preflight:" "$out"
fi
exit 0
