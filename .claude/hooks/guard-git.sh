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
# A payload with no command at all reads as an empty one, and the case below
# would call that "not a commit" and let it through unscanned.
[ -n "$cmd" ] || block "the command could not be read." "Nothing was committed."
# A cheap filter over the command as written: with neither verb anywhere in
# it there is nothing to judge, and nothing below can refuse it. A verb that
# is only in a heredoc body is not a command; that is judged next, once the
# bodies are out.
case "$cmd" in
  *"git commit"*|*"git push"*) ;;
  *) exit 0 ;;
esac

# Take every heredoc body out of the command, and leave what remains in
# `code`. A body is text, a note or a message, and not a command (when its
# delimiter is quoted; see the end of this comment): a body
# that mentions `git commit` in backticks runs no git at all, and one that
# holds a line `git commit -a` is no commit asking for -a (issue 341; the
# verb was matched in the whole command first, and a body that mentioned the
# verbs was read as a commit whose options could not be read). So the verbs
# are looked for in `code`, and so are a commit's options. Answers 0 with
# `code` set, or 2 for a heredoc this cannot bound, with `code` not to be
# used: a body that cannot be found cannot be taken out.
#
# A check over the command as written, before anything is taken out of it.
# The removal below takes the first `<<` it meets for the operator of a
# heredoc, so it cannot tell one that opens a heredoc from one inside a
# string, nor the body of a heredoc from the words of an unquoted
# substitution that holds one, and in both a real commit, or its flag, would
# be cut as body. So each `<<` (not `<<<`) is judged by the text before it.
# With every `"$(` taken out, which is the form a message built by a
# substitution has, a `$(` left over means the heredoc is inside a
# substitution that nothing quotes, and an odd count of `"` or of `'` means
# the operator is inside a quote. The same number of `)"` is then taken out,
# from the left, since each closes one of the `"$(` just taken out and is not
# a quote that opens or shuts anything; with none taken out first, a `)"` is
# a quote like any other (`-m "a)" -m "see <<EOF`). For the first operator
# that text is everything before it, since a quote opened on an earlier line
# is still open on this one; for a later one it is its own line, since what
# lies before it holds a body, whose apostrophes are not quotes. A count of
# quotes is exact only with one kind of quote in the text and no backslash,
# which makes `\"` a quote that does not close: a `"` inside `'...'` is
# counted by neither, so the first operator's text is refused if it holds a
# backslash or both kinds of quote. Neither form this repository commits in,
# `-F - <<'EOF'` and `-m "$(cat <<'EOF'`, has a backslash or a `'` before its
# operator. The limit: a later operator is judged on its own line, so a `)"`
# that closes a `"$(` opened before a body is invisible there, and a
# constructed command can use that; the hook exists for slips, not
# adversaries. Nor is a `<<` inside a body spared: it is judged like any
# other, on its own line.
#
# Then each body is cut. This repository's messages quote code in backticks
# and `$HOME`, and nearly every commit here is made with one. What stays is
# what is before the operator, the rest of the operator's own line, and what
# follows the terminator line: options come after a body in
# `-m "$(cat <<EOF ... EOF` then `)` and `-a`, so cutting everything from the
# operator on would let that -a through, and a commit can follow a body that
# mentions the verbs. The terminator is the operator's word with its quotes
# and backslashes taken off, as a shell reads it, for the four spellings
# where that is all there is to it: bare, `<<'EOF'`, `<<"EOF"`, `<<\EOF`. A
# heredoc with no terminator, or no word to end it, or a word in any other
# spelling, or one that is `<<-` (a terminator indented by tabs, which
# nothing here writes), is not one this can bound. Nor is one whose word is unquoted
# (`<<EOF`) and whose body holds a `$(` or a backtick: the shell expands
# such a body, so what is in it runs, and it is not text to be cut out.
strip_bodies() {
  local word delim lead tail head line body post b inner nl seen first before opened taken dq sq
  nl=$'\n'
  seen=''; first=1
  while IFS= read -r line; do
    line=${line//<<</ }
    case "$line" in
      *"<<"*)
        before=${line%%<<*}
        if [ -n "$first" ]; then
          before=$seen$before
          first=''
          case "$before" in *\\*) return 2 ;; esac
          dq=${before//[!\"]/}; sq=${before//[!\']/}
          [ -z "$dq" ] || [ -z "$sq" ] || return 2
        fi
        opened=$before
        before=${before//\"\$(/}
        case "$before" in *\$\(*) return 2 ;; esac
        taken=$(( (${#opened} - ${#before}) / 3 ))
        while [ "$taken" -gt 0 ]; do
          before=${before/\)\"/}
          taken=$((taken - 1))
        done
        dq=${before//[!\"]/}; sq=${before//[!\']/}
        [ $(( ${#dq} % 2 )) -eq 0 ] && [ $(( ${#sq} % 2 )) -eq 0 ] || return 2
        ;;
    esac
    seen=$seen$line$nl
  done <<<"$cmd"
  code=$cmd
  while :; do
    case "$code" in *"<<"*) ;; *) break ;; esac
    head=${code%%<<*}
    tail=${code#*<<}
    case "$tail" in
      "<"*) code="$head ${tail#<}"; continue ;;   # `<<<`, a string and not a body
    esac
    case "$tail" in -*) return 2 ;; esac   # `<<-`, see above
    lead=${tail%%[![:blank:]]*}
    tail=${tail#"$lead"}
    word=${tail%%[[:space:];&|<>)]*}
    delim=${word//[\"\'\\]/}
    [ -n "$delim" ] || return 2
    # Only the four spellings whose shell reading is exactly `delim`, which
    # has no quote or backslash in it: bare, in single quotes, in double
    # quotes, or behind one backslash. Any other word is read by the shell
    # as something else (`<<"EO F"`, cut at its space; `<<"EOF' x"`, whose
    # quotes pair and whose delimiter is `EOF' x`; `<<'\EOF'`), and the body
    # would end at a line it does not end at.
    case "$word" in
      "$delim"|"'$delim'"|"\"$delim\""|"\\$delim") ;;
      *) return 2 ;;
    esac
    tail=${tail#"$word"}
    case "$tail" in
      *"$nl"*) line=${tail%%"$nl"*}; body=${tail#*"$nl"} ;;
      *) return 2 ;;                     # an operator with no body after it
    esac
    b="$nl$body$nl"
    post=${b#*"$nl$delim$nl"}
    [ "$post" != "$b" ] || return 2      # never terminated
    # A word with no quote or backslash in it is an unquoted delimiter, and
    # the shell expands such a body: a `$(` or a backtick in it runs, so it is
    # a command and not text, and cutting it out would hide it.
    if [ "$word" = "$delim" ]; then
      inner=${b%%"$nl$delim$nl"*}
      case "$inner" in *\$\(*|*\`*) return 2 ;; esac
    fi
    code="$head $line $post"
  done
  return 0
}
strip_bodies; bodies=$?
if [ "$bodies" -eq 0 ]; then
  case "$code" in
    *"git commit"*|*"git push"*) ;;
    *) exit 0 ;;                         # the verbs were only in a body
  esac
else
  # A body that cannot be found cannot be taken out, so a verb in it has to
  # count: the command as written is what is looked at, and a commit in it is
  # refused by asks_for_all as one it cannot read. A push alone has no
  # options to read, and is scanned as it always was.
  code=$cmd
fi

# Known blind spots, both about sibling worktrees. `git -C ../lc-X commit`
# does not contain "git commit", so the patterns above let it through with
# no scan at all. `cd ../lc-X && git commit` is matched, but the scan below
# runs in the project directory, against this checkout's index and not the
# worktree's. The pre-commit hooks (when `pre-commit install` has been run;
# they live in the shared git directory) and CI still cover both. /lanes
# commits only as `cd <worktree> && git ...` and runs the scanners there as
# a step.
# Two more, about a commit that holds something the index does not when this
# hook runs, both measured in issue 260: `git commit <path>` (and -i, --only)
# commits that path as it is in the working tree, and `git add ... && git
# commit` in one command stages after the scans. The pre-commit hooks and CI
# read what was actually committed, and cover both. `-a` is the case this
# hook does close: see asks_for_all.
# And a family that matches neither the pattern above nor asks_for_all, since
# both look for the text `git commit`: `git -c x=y commit`, `git --no-pager
# commit`, `git --git-dir=... commit`, `git "commit"`, and `git  commit` with
# two spaces. None is scanned at all. Widening the match is a follow-up.
root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
# Fail closed here as well. A folder this hook cannot enter is one it cannot
# scan, and `|| exit 0` here said the commit was fine. An empty root is the
# same case: bash 5 refuses `cd ""` ("null directory") and `|| exit 0` let it
# through; bash 3.2 accepts it, and the scans below would then run wherever
# the hook happened to be.
if [ -z "$root" ] || ! cd -- "$root" 2>/dev/null; then
  block "the repository folder could not be entered, so nothing was scanned and nothing was committed or pushed." \
        "Check that CLAUDE_PROJECT_DIR names a folder this hook can enter; until then it refuses every commit and push."
fi

# `git commit -a` stages the tracked files' working-tree contents after this
# hook has run, so every scan below, which reads the index, would be reading
# something other than what is committed. `bin/preflight` reads the index
# and has no way to be pointed at the working tree, so the sound answer is
# the one that needs no second scan: refuse -a, and the commit is exactly
# the index. The cost is one `git add`, which is what the hook asks for.
#
# Does the command ask `git commit` for -a or --all? It is read so that any
# doubt is a yes. Quotes and backslashes are deleted before the words are
# split, so `"-a"` is the flag it is to a shell, and the price is that a
# message given with -m on the command line that says -a is read as the flag
# too (reword it; a heredoc body is not read at all, it was cut out by
# strip_bodies before anything was looked for). The search is over `code`,
# the command with its bodies out, and starts at the first `git commit` in it
# and runs to the end, whatever is chained after it. Short options are read a
# letter at a time, stopping at one that takes a value, since the rest of that
# word is the value (`-sam` is -s -a -m, and `-ma` is a message). A word that
# is an expansion could be anything, -a included (`$'-a'`, `-$x`, `--${all}`,
# `{-a,-q}`, a backtick), so it is a doubt of the other kind: nothing can be
# said about it. That is a word that begins with `$`, a backtick or `{`, or
# begins with `-` and holds one of them anywhere; `$(` is left alone, since
# what a substitution runs is in the string as words of its own, and is read.
# Answers 0 for yes, 1 for no, and 2 for a command that could not be read,
# which includes one with a heredoc that strip_bodies could not bound.
asks_for_all() {
  local rest word chars c
  [ "$bodies" -eq 0 ] || return 2        # a body that could not be found is still in `code`
  rest=$(printf '%s' "$code" | tr -d '\042\047\134') || return 2
  case "$rest" in
    *"git commit"*) rest=${rest#*git commit} ;;
    *) return 1 ;;                       # a push alone
  esac
  set -f                                 # a `*` in a word is a `*`
  # shellcheck disable=SC2086  # split on whitespace, on purpose
  set -- $rest
  set +f
  for word; do
    case "$word" in
      \$\(*) ;;                             # read, in its own words
      \$*|\{*|'`'*|-*\$*|-*\{*|-*'`'*) return 2 ;;
      --all|--all[!A-Za-z-]*) return 0 ;;   # and not --allow-empty
      --*) ;;
      -?*)
        chars=${word#-}
        while [ -n "$chars" ]; do
          c=${chars%"${chars#?}"}; chars=${chars#?}
          case "$c" in
            a) return 0 ;;
            [mFCctSu]) break ;;          # the rest of the word is its value
            [A-Za-z]) ;;
            *) break ;;
          esac
        done ;;
    esac
  done
  return 1
}
case "$code" in
  *"git commit"*)
    asks_for_all; all=$?
    if [ "$all" -eq 0 ]; then
      block "this commit asks for -a, which stages tracked changes after the scans have run; nothing was committed." \
            "Stage the changes first (git add <files>), then commit without -a. If -a is only a word in the message, reword it."
    elif [ "$bodies" -ne 0 ]; then
      # The words were never reached: a heredoc could not be bounded, so what
      # in the command is text and what is a command could not be told, and
      # git commit may be the command or a line of the body.
      block "this command could not be read: it holds git commit and a heredoc this hook could not bound (no terminator line of its own, a <<- form, a quote or backslash open before its operator, a delimiter the shell would read differently from this hook, or an unquoted delimiter over a body with a substitution in it, say), so what is text and what is a command could not be told; nothing was scanned; nothing was run." \
            "End the heredoc with its delimiter alone on a line, quote the delimiter ('EOF') when the body is only text, and keep a commit or push in a command of its own."
    elif [ "$all" -ne 1 ]; then
      block "the options of this commit could not be read (a word that is an expansion, say), so nothing was scanned; nothing was committed." \
            "Stage the changes first (git add <files>), then commit with a plain git commit."
    fi
    ;;
esac

# 1. Keys and tokens, in the staged changes and - before a push - in every
#    commit that is about to leave this machine.
#
#    gitleaks 8.30.1 says "no leaks found" and exits 0 over a repository git
#    could not read: an index it cannot open, a corrupt one, a history with
#    an object missing, no repository at all. Git's complaint reaches its log
#    as an ERR line, nothing is scanned, and the summary is the clean one
#    (measured, issue 260). The exit status is therefore not the whole
#    answer, and a scan that logged an error or a warning did not read what
#    it was asked to and is refused. The colour is turned off so that the
#    level is a word on its own and not wrapped in an escape sequence.
if ! command -v gitleaks >/dev/null 2>&1; then
  block "gitleaks is not installed; refusing to commit or push." \
        "Install it (brew install gitleaks) or run: pre-commit run --all-files"
fi
scan() {   # $1 = what is scanned, then the arguments that follow `gitleaks git`
  local what=$1 out level
  shift
  if ! out=$(gitleaks git "$@" --no-banner --no-color --redact 2>&1); then
    block "gitleaks found something in $what, or could not scan it; nothing went through:" "$out"
  fi
  # A case and not a grep: it cannot fail, and a grep that could not run
  # would have said nothing and let the scan through. Each level is a word of
  # its own, bounded by white space or by either end of the output.
  for level in ERR WRN FTL PNC; do
    case "$out" in
      "$level"|"$level"[[:space:]]*|*[[:space:]]"$level"|*[[:space:]]"$level"[[:space:]]*)
        block "gitleaks logged an error while it scanned $what, so its \"no leaks found\" is not to be trusted; nothing went through:" "$out" ;;
    esac
  done
}
scan "the staged changes" --staged

case "$code" in
  *"git push"*)
    # Every commit, not the range against the tracked upstream: `@{upstream}`
    # is a property of the branch and not of the remote being pushed to, so
    # the range can describe far less than a push actually sends. Scanning
    # all of it costs milliseconds and needs no reasoning about which remote
    # was named.
    scan "the history about to be pushed"
    ;;
esac

# 2. The rest of the never list: machine paths, personal addresses, private
#    hosts, links to tool sessions.
if ! out=$(bin/preflight 2>&1); then
  block "blocked by bin/preflight:" "$out"
fi
exit 0
