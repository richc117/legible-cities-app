---
name: lanes
description: Run several issues at once, each on its own branch in its own worktree with one agent, from the main checkout - the worktrees, the briefs, the reviewer passes, the serial end-to-end runs and the merges. Use when a wave of issues with disjoint files is ready to build.
argument-hint: "<issue codes, e.g. A5-01 A6-03 A0-06>"
disable-model-invocation: true
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(git worktree list*), Bash(git worktree add ../lc-*), Bash(git worktree prune)
---

# Run a wave of lanes

Worktrees now: !`git worktree list`

Lanes for: **$ARGUMENTS**

A lane is one issue: one branch, one worktree, one agent, one pull request.
The main session is the coordinator. It writes the briefs and one-line
fixes, never a lane's feature; it prepares the lanes, reads what comes
back against the diff, runs the things only one process at a time can run,
and merges. Briefs, pull-request bodies and probe output live in the
session's scratch directory, never in a worktree, where they are one
`git add -A` from the index. ADR-034 records why
the procedure is this one and not a plugin's.

Lane code is the issue code. The branch is `<CODE>-<slug>`, the worktree
`../lc-<CODE>` beside this checkout.

## Before the wave

1. `git pull`, and `git worktree list` shows only the main checkout.
2. **Check the files do not collide.** Name, for each lane, the files it
   will touch. Two lanes meeting in a list, a stylesheet or the channel
   table is a trivial rebase; two lanes meeting in a model is not a wave,
   it is a sequence.
3. **Merge any shared prerequisite alone, first**: a pin bump with
   `npm run typegen`, a dependency, a generator fix. Two branches doing the
   same prerequisite collide on generated files.
4. **Allocate numbers into each brief**: the spec directory and any
   decision record. Two branches both claiming `specs/0NN-` is the one
   conflict git cannot help with.
5. **The spec stage runs here, per lane, into the lane's worktree**, so the
   spec commits on the lane's branch: `/speckit-specify` with the number
   and name given explicitly, `/speckit-clarify` with the maintainer,
   `/speckit-plan`, `/speckit-tasks`. Spec Kit finds its root by walking up
   from the working directory, which is this checkout, and keeps its
   current feature in a per-checkout `.specify/feature.json`, so every one
   of its steps is given `SPECIFY_INIT_DIR=<absolute worktree path>` and
   `SPECIFY_FEATURE_DIRECTORY=<absolute worktree path>/specs/<NNN-name>`.
   Absolute, because `/speckit-specify` runs no script: it makes the
   directory itself, and a relative one lands untracked on `main`. The
   scripts strip the root back off before they record it. Without both,
   the second lane's spec repoints the first's plan. Every
   `[NEEDS CLARIFICATION]` is
   answered, or explicitly allowed to survive, before the brief is written.
   The agent never resolves one.

## The nine steps

Run by the main session from the main checkout unless a step says "agent".

1. **Worktree.**
   `git worktree add ../lc-<CODE> -b <CODE>-<slug> main`, then in it
   `npm ci && npx install-electron --no` and `npm run typecheck` as the
   baseline. Never `npm install`. No `.env.local` in the worktree; the
   `*-real` tests skip there as they do in CI. Not the harness's own
   worktree tool, which moves the coordinator's working directory and puts
   the worktree inside this checkout, where nothing ignores it.
2. **Brief and dispatch.** Copy [brief-template.md](brief-template.md) per
   lane and fill it in. One `general-purpose` agent per lane, in the
   background, every lane's dispatch in one message.
3. **Read the report against the diff.** `git -C ../lc-<CODE> diff
   main...HEAD --stat`; rerun lint, typecheck and unit tests yourself; read
   `git log main..<branch> --format=%B` for a session trailer or a closing
   keyword (`HEAD` here is `main`, so `main..HEAD` is empty and silent);
   look for probe files left behind.
4. **Reviewer, pass one.** The project's `reviewer`, from the main checkout,
   given the branch name for `git diff main...` and `git log main..`, the
   worktree's absolute path for Read and Grep, the spec's path, and the
   surface to look hardest at. Verify each finding by doing it. Fix; send a
   fix of more than a line back to the same agent with the failing output.
5. **Reviewer, pass two.** Mandatory after a fix in a destructive path (the
   reset, a sweep, feed removal, the export, the capture, a child process,
   the bridge) or after any fix that changed behaviour. Sent as a message to
   the same reviewer listing what changed. A third pass if the second found
   something the second fix could defeat.
6. **End-to-end, serially, here.** Close the app. In the worktree,
   `npm run build`, then `npm run test:e2e` with `LEGIBLE_ENGINE_CHECKOUT`
   naming a checkout of the engine at the pinned tag, outside the tool
   sandbox. Expect the agent's new tests to fail the first time; send the
   output back; run again. A feature driven by a gesture is also used by
   hand in `npm run dev`: a suite that types where a person drags can be
   green over a broken control.
7. **Rebase only when needed, and only here.** After each merge, a lane
   still open rebases only if GitHub says it is behind or it touched a file
   that merged. Rebase in the worktree onto the fetched `origin/main`, never
   with `gh pr update-branch`: that makes a merge commit authored by
   whoever runs it, and GitHub's squash then adds their name and address
   as a `Co-authored-by` trailer to the commit on `main`, which preflight
   fails on every branch forever after. Then `git diff --check` for
   conflict markers, the three checks again, the reviewer over the
   resolution if it touched code, the end-to-end suite if it touched
   behaviour, and `git push --force-with-lease`, the one forced push in
   this procedure and the coordinator's alone.
8. **Hygiene and the pull request.** In the worktree, each as
   `cd <worktree> && ...`: `bin/preflight`, `gitleaks git --redact`,
   `pre-commit run --all-files`. Push the same way, never with `git -C`:
   `cd <worktree> && git push -u origin <branch>`. The body is written to
   a scratch file with `Closes #N` there and only there, ending with the
   Claude Code line and no session link. Nothing else reads a pull-request
   body or title, and an agent's report is full of absolute paths, so both
   are scanned first, from a file and not a pipe (preflight reads its file
   twice, and a pipe is empty the second time): put the title on the first
   line of `<scratch>/scan.txt`, append `grep -av '^Closes #[0-9]*$'
   <body>`, and run `bin/preflight --message-file <scratch>/scan.txt`.
   Then `gh pr create --head <branch> --title <title> --body-file <body>`
   and the five checks green.
9. **Merge, clean up and record, from this checkout.** `gh pr merge <N>
   --squash --subject <title> --body-file <scanned message>`, so the
   commit on `main` says what was scanned and GitHub composes no trailers
   of its own; without `--delete-branch`, because git will not delete a
   branch another worktree has checked out, and run from the worktree `gh`
   tries to check out `main`, which this checkout holds. **Before any
   cleanup**, `gh pr view <N> --json state,headRefOid` must say `MERGED`
   and a `headRefOid` equal to `git rev-parse <branch>`; if either is not
   so, stop, because every step after this one assumes it. Then `git
   pull`, `git worktree remove ../lc-<CODE>`, `git worktree prune`, `git
   branch -D <branch>` (a squash merge is not an ancestor, so `-d`
   refuses), and `git push origin --delete <branch>`. If `worktree remove` refuses, look
   at what is left before anything else; never `--force` it. Any trap the
   lane taught goes into `.claude/rules/` and, if it is short enough to
   matter everywhere, into `CLAUDE.md`.

## The guard's blind spots

`.claude/hooks/guard-git.sh` does not protect a worktree. `git -C
../lc-X commit` does not match its pattern and is not scanned at all;
`cd ../lc-X && git commit` is matched, but scanned against this checkout's
index. The pre-commit hooks (installed once per clone, in the shared git
directory, and only at commit time: there is no pre-push hook) cover both;
CI covers both only once a branch is already public. So agents never push,
every commit in a lane is made as `cd <worktree> && git ...`, and step 8's
three commands are not optional.

## Plugins

`typescript-lsp` gives diagnostics throughout, once
`typescript-language-server` is installed. Nothing else from a plugin runs
in a lane. The Agent tool dispatching briefs in one message is the whole of
the parallelism; the project's `reviewer` is the review; Spec Kit is the
spec stage. `feature-dev`'s `code-explorer` earns one narrow use: a
read-only trace of an existing feature, pasted into `plan.md`'s research
section when the main session has not read that surface recently. Never as
the plan.

Not used here, and why:

- **superpowers** - brainstorming and writing-plans keep a second spec
  format beside `specs/` and resolve ambiguity by picking; its
  subagent-driven development commits per task and rules instead of
  stopping; its worktree skill runs `npm install` and commits a
  `.gitignore` change; finishing a branch offers a local merge to `main`;
  its code review uses a generic reviewer that may write; its session hook
  sits above `CLAUDE.md` in every session. Off in `settings.json`.
- **feature-dev** - redoes the spec stage, one feature per session.
- **code-review** - five generic reviewers posting to a public pull request.
- **code-simplifier** - another project's rules, applied on its own. Off.
- **frontend-design** - invents a palette; a literal fails the token test.
  Off.
- **claude-md-management** - grades the prose down and looks for the wrong
  local file. Off.
- **skill-creator** - nested sessions inside the repository.
- **claude-code-setup** - read-only, and nothing left to add.

## The ten hazards

These go into every brief verbatim; the template carries them.

1. The e2e lock: never run `test:e2e`, `dev`, `start` or `dist`; a second
   Electron exits at once and breaks the other lane's run. (Nothing
   enforces this: `settings.json` allows `test:e2e` because step 6 needs
   it. It rests on the agent.)
2. Never rebase, merge, reset or force; never push and never open a pull
   request; never touch `main`.
3. End-to-end tests are written, not run; list them so. A test that changes
   a setting sets `LEGIBLE_USER_DATA`; waits are deadlines, never turn
   counts.
4. Never `npm install`; never add, remove or bump a dependency. Stop and
   report instead.
5. Never read or write a `.env*` file (the deny rule does not reach a
   sibling worktree, so this rests on the agent); the `*-real` tests skip
   here by design.
6. `Co-Authored-By` only; no session trailer; no closing keyword; never
   `--no-verify`.
7. No colour, size or duration literal outside the four token stylesheets;
   no invented palette or typeface; new text or control pairs into the
   contrast test; new components into `docs/DESIGN.md` section 8.2.
8. Only the assigned spec directory and decision number; never run
   `/speckit-specify`, `/spec` or `/adr`; resolve no `[NEEDS
   CLARIFICATION]`.
9. The working directory resets between commands, so prefix each with
   `cd`; the rules files do not load in a worktree, so read them; probe
   scripts carry the lane code in their name and are deleted before
   staging.
10. A claim of green without the command's output is not a report; reviewer
    findings are leads to verify, not verdicts.
