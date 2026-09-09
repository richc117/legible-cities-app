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
block() { printf '%s\n%s\n' "$1" "$2" >&2; exit 2; }

# Fail closed. Without jq the command cannot be read, and a hook that cannot
# read the command must not be the one that says the commit is fine.
input=$(cat)
command -v jq >/dev/null 2>&1 ||
  block "jq is not installed, so the command cannot be read." \
        "Install jq; until then this hook refuses every commit and push."
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null) ||
  block "the command could not be read." "Nothing was committed."
case "$cmd" in
  *"git commit"*|*"git push"*) ;;
  *) exit 0 ;;
esac
root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
cd "$root" || exit 0

# 1. Keys and tokens, in the staged changes and - before a push - in every
#    commit that is about to leave this machine.
if ! command -v gitleaks >/dev/null 2>&1; then
  block "gitleaks is not installed; refusing to commit or push." \
        "Install it (brew install gitleaks) or run: pre-commit run --all-files"
fi
if ! out=$(gitleaks git --staged --no-banner --redact 2>&1); then
  block "gitleaks found something in the staged changes; nothing was committed:" "$out"
fi

# `git commit -a` stages tracked changes as part of the commit, after this
# hook has run, so the index scan above has not seen them. Scan the unstaged
# diff too when the command asks for that.
case "$cmd" in
  *" -a"*|*" --all"*)
    if ! out=$(gitleaks git --pre-commit --no-banner --redact 2>&1); then
      block "gitleaks found something in the changes -a would stage; nothing was committed:" "$out"
    fi
    ;;
esac

case "$cmd" in
  *"git push"*)
    # Every commit, not the range against the tracked upstream: `@{upstream}`
    # is a property of the branch and not of the remote being pushed to, so
    # the range can describe far less than a push actually sends. Scanning
    # all of it costs milliseconds and needs no reasoning about which remote
    # was named.
    if ! out=$(gitleaks git --no-banner --redact 2>&1); then
      block "gitleaks found something in the history about to be pushed:" "$out"
    fi
    ;;
esac

# 2. The rest of the never list: machine paths, personal addresses, private
#    hosts, links to tool sessions.
if ! out=$(bin/preflight 2>&1); then
  block "blocked by bin/preflight:" "$out"
fi
exit 0
