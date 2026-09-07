#!/usr/bin/env bash
# Claude Code PreToolUse hook: before any `git commit` or `git push` that
# Claude runs, run bin/preflight. Exit 2 blocks the command and shows the
# reason; exit 0 lets it through. Other commands pass untouched.
set -u
input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)
case "$cmd" in
  *"git commit"*|*"git push"*) ;;
  *) exit 0 ;;
esac
root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
cd "$root" || exit 0
if ! out=$(bin/preflight 2>&1); then
  printf 'blocked by bin/preflight:\n%s\n' "$out" >&2
  exit 2
fi
exit 0
