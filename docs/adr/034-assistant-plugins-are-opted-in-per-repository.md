# ADR-034: Assistant plugins are opted in per repository

- **Status:** Accepted
- **Date:** 2026-09-12
- **Supersedes:** none
- **Superseded by:** none

## Context

ADR-029 committed the assistant's configuration so that a checkout behaves
the same on any machine. Plugins break that promise from the other side.
A plugin enabled in a person's own settings runs in every repository they
open, including this one, and nothing in the checkout says so.

Nine plugins from the official marketplace were enabled that way on the
maintainer's machine, beside the two the committed settings already opt
in (`security-guidance` and `github`, since pull request 78). Reading the
nine found three kinds:

- **One that conflicts with the repository's own procedure on every
  session.** `superpowers` installs a session-start hook that places its
  own instructions above `CLAUDE.md` and tells the assistant to reach for
  its skills before anything else. Those skills keep plans in a second
  format beside `specs/`, commit per task under their own directory,
  resolve an ambiguous requirement by choosing where the constitution says
  to leave a marker, run `npm install` where this repository runs
  `npm ci`, commit a `.gitignore` change when making a worktree, and offer
  a local merge to `main`, which branch protection refuses.
- **Three that act on code by their own conventions when invoked or
  suggested.** `frontend-design` chooses a palette and typefaces, which
  the design system's token test refuses. `code-simplifier` applies
  another project's style rules. `claude-md-management` grades `CLAUDE.md`
  against a generic template and looks for a local notes file under a
  different name.
- **Five that are inert unless a person invokes them.** `feature-dev`,
  `code-review`, `skill-creator` and `claude-code-setup` add commands and
  agents with no hooks. `typescript-lsp` adds diagnostics from
  `typescript-language-server` and nothing else.

Several issues are about to be built at once, each on its own branch with
its own agent, the way four were on 12 September 2026. That procedure was
carried in one session's memory and nowhere a fresh checkout could read.

A measurement settled whether the repository can switch a plugin off.
A nested session run in the checkout with `superpowers` set to `false` in
the committed settings, and `true` in the person's own, loaded neither the
plugin nor its session-start instructions; the same run with the committed
line removed loaded both.

## Options

**(a) Leave plugins to each person's settings.** No change. A session here
then runs whatever that person has installed, and the one that conflicts
most injects itself on every start.

**(b) Name every plugin in the committed settings.** Complete and explicit,
but it switches off, for everyone, plugins that are harmless and useful
elsewhere, and the list goes stale whenever the marketplace grows.

**(c) Name the ones that matter here.** On what the repository relies on,
off what conflicts with it, and silence on the inert ones, which stay a
person's choice. A written procedure for parallel work, as a project skill,
so the conflicting plugin is not needed for it.

## Decision

The committed `.claude/settings.json` names the plugins that matter in this
repository. `security-guidance`, `github` and `typescript-lsp` are on.
`superpowers`, `frontend-design`, `code-simplifier` and
`claude-md-management` are off, because each acts on this repository by
conventions that contradict its own. `feature-dev`, `code-review`,
`skill-creator` and `claude-code-setup` are not mentioned: they have no
hooks and do nothing unless invoked. Building several issues at once
follows `/lanes` (`.claude/skills/lanes/`), which is written in this
repository's terms and names what it does not use from any plugin, and why.

## Consequences

**A checkout decides what runs in it**, which is ADR-029's promise extended
to plugins. A contributor with `superpowers` installed gets this
repository's procedure here and theirs everywhere else.

**The list will go stale.** A plugin installed later is on here until
someone adds a line. The session's own list of loaded plugins is where to
look, and the nested-session measurement above is how to check a new line
works before relying on it.

**The override depends on the harness honouring project scope over user
scope.** It did when measured. If a release changes that, the fallback is
each person switching the four off in their own settings, and this record
should be amended to say so.

**`typescript-lsp` needs a language server on the machine.**
`typescript-language-server` is a development tool, like `gitleaks`: without
it the plugin does nothing and nothing breaks.

**The procedure is now a file, and it is only as good as its last use.**
Every wave that teaches a trap adds it to `/lanes` or to `.claude/rules/`
in the same change, or the next wave pays for it again.
