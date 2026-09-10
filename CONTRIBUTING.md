# Contributing

Thank you for looking. This project is small and early; the guide below is
what keeps it coherent as it grows.

## Where things stand

The repository holds its charter, the Phase 0 spike reports and decision
records, and the application so far: one window, a Library of projects,
the `app://local` origin, the engine supervised as a child process, a
layout run and the viewer, with checks on three platforms (`README.md`,
"Developing"). The roadmap is the milestones on this repository, in
order: Phase 0 (foundation and spikes),
Phase 1 (engine boundary), First reel (one preset feed through layout,
viewer and export, before anything broadens), then Phases 2 to 6 through
release readiness. An issue with the `type:spike` label is a timeboxed
experiment whose deliverable is a decision record, not code.

### Labels, milestones and issue codes

Issues carry four labels: a phase (`phase:0` to `phase:6`), a type
(`type:spike`, `type:spec`, `type:feature`, `type:bug`, `type:chore`,
`type:docs`), an area (`area:engine`, `area:shell`, `area:sidecar`,
`area:capture`, `area:export`, `area:ui`, `area:ci`, `area:release`) and a
size (`size:S`, `size:M`, `size:L`). The milestones are the seven phases and one
between them: Foundation, Engine boundary, First reel, Library and inspect,
Schematic, Style, Export, Release readiness. First reel carries no phase
label of its own; its issues keep the label of the capability they belong
to, and the milestone says when. The maintainer creates labels and milestones before the
first issues are posted; the issue templates apply a type label only when it
already exists.

Planned issues carry a short code in their title, such as `A2-03`: the
repository (`A` for this app, `E` for the engine), the phase, and a sequence
number. It is a reading aid, not something a tool checks.

## How work happens

1. **Pick an issue.** Comment that you are taking it. Issues carry a phase,
   a type, an area and a size label.
2. **Spec first.** Feature issues get a spec under `specs/` with user stories
   and acceptance criteria before any code. Spikes get a question, a method
   and a timebox. See **Specs** below.
3. **Branch and pull request.** One issue, one branch named for it
   (`123-geographic-view`, or `A2-03-geographic-view` for a planned issue),
   one pull request. `main` only changes through pull requests with green
   checks: since 2026-09-07, when the `ci` check landed with the skeleton,
   branch protection refuses a direct push, the maintainer's included.
4. **Review.** A maintainer reviews; automated checks must pass; the pull
   request template's checklist must be honest.
5. **Squash merge.** `main` reads as one commit per issue.

## Commits

- Subject: an imperative sentence under 72 characters. Body: why, not what.
- `Co-Authored-By:` trailers are welcome for pair and tool-assisted work.
  Do not add trailers that link to tool sessions or private services.
- Run `bin/preflight` before pushing. It refuses personal file paths,
  private addresses, keys and session links, none of which belong in a
  public repository.

## Local hooks

This is a public repository, so two scanners run over every commit:
`gitleaks` for keys and tokens, and `bin/preflight` for the things a secret
scanner does not recognise - absolute paths from someone's machine, personal
addresses, private hostnames, links to tool sessions. `shellcheck` runs
beside them, because the hooks that enforce all this are themselves shell.
Install them once per checkout:

```
pip install pre-commit        # or your package manager's equivalent
pre-commit install
```

That is all the setup there is. `pre-commit` fetches and builds its own
pinned copy of `gitleaks`, so nothing else needs installing; the first
commit afterwards is a little slow while it does. To run the hooks by hand
without committing:

```
pre-commit run --all-files
```

Note what that does and does not cover: `bin/preflight` reads the whole
tracked tree, but the `gitleaks` hook reads only what is **staged**, because
that is the job it has at commit time. For a scan of everything in the
working tree you need `gitleaks` itself on your `PATH`:

```
gitleaks dir . --redact
```

CI scans the full history on every push and pull request, so a missing hook
costs you a red check rather than a leak. If a scanner is wrong, say so in
the pull request rather than reaching for `--no-verify`: a false positive is
a line in `.gitleaks.toml`, with a comment saying why. See
`docs/adr/015-hygiene-enforced-by-tools.md`.

## If you use an assistant

The repository configures one: `CLAUDE.md` and `.claude/` are committed
(ADR-029), so a checkout carries the rules, hooks and skills the maintainer
uses; only `CLAUDE.local.md` and `.claude/settings.local.json` stay personal
and gitignored. The rules an
assistant needs are the ones a person needs, and they are here: the
constitution in `.specify/memory/constitution.md`, the decision records
under `docs/adr/`, and the specs under `specs/`. Whatever runs on your
side, the scanners in `.pre-commit-config.yaml` and the checks in CI are
what decide whether a change lands.

None of it is required, and none of it replaces reading the diff yourself.
Other tools are welcome; if you configure one, keep its files out of the
diff unless the configuration is worth sharing.

## Specs

Features are specified before they are built, with
[Spec Kit](https://github.com/github/spec-kit). The loop, one step per
command, each producing a file the next one reads:

| Step | Command | Produces |
|---|---|---|
| Specify | `/speckit-specify` from the issue text | `specs/NNN-name/spec.md`: user stories, acceptance criteria, edge cases |
| Clarify | `/speckit-clarify` | The open questions answered, in the spec |
| Plan | `/speckit-plan` | `plan.md`: technical approach, files touched |
| Tasks | `/speckit-tasks` | `tasks.md`: ordered, checkable tasks |
| Implement | `/speckit-implement`, or by hand | Code and tests |
| Analyse | `/speckit-analyze` | Whether the tasks and tests cover the spec |

One issue maps to one spec. The issue stays short and links the spec; the
spec is where the detail lives.

Every spec is read against
[`.specify/memory/constitution.md`](.specify/memory/constitution.md), which
states the principles this project builds by. A spec that conflicts with a
principle either changes, or the constitution does - in the open, with the
reason recorded, before the code is written. See
`docs/adr/014-spec-kit-for-specs.md`.

Where an issue is silent, the spec carries a `[NEEDS CLARIFICATION]` marker
naming what it blocks and what happens if it stays open, rather than a
quietly invented answer. A spec is allowed to ship with open questions; it
is not allowed to hide them.

Issues are created two ways, and they do not collide: `/speckit-taskstoissues`
turns a task list into issues for work that has already been specified, and
the maintainer publishes the planned roadmap from drafts with a script that
is idempotent by title.

Engine work does not need a spec. A good issue body and tests are enough
there.

## Definition of done

- The spec's acceptance criteria pass, and a test asserts each one that can
  be asserted. No `[NEEDS CLARIFICATION]` marker survives into the merge
  unless the pull request says why it may.
- The change complies with
  [the constitution](.specify/memory/constitution.md), or the pull request
  argues the exception in the open and amends the constitution first.
- Checks are green on macOS, Windows and Linux.
- Documentation changed with the code: architecture notes, the decision
  record, user-facing text.
- Anything a person sees follows [`docs/DESIGN.md`](docs/DESIGN.md): its
  tokens, its two type tracks, its density, its accessibility rules; a new
  component adds its rules there.
- No new secret-scanner finding; no absolute path, address or key in the
  diff. `pre-commit run --all-files` is clean.
- The pull request says what was tested by hand and on which operating system.
- The installer still builds after the merge, once there is one.

## Decisions

Anything that would be hard to reverse gets an architecture decision record
under `docs/adr/`; see the README there. A spike ends in one.

## Licence of contributions

By contributing you agree that your contribution is licensed under the
GNU General Public License v3.0 or later, the same terms as the rest of the
repository (inbound = outbound). If a contribution includes third-party
code or assets, add them to `THIRD_PARTY_NOTICES.md` with their licence.

## Reporting problems

- Bugs and ideas: open an issue with the matching template.
- Security: see `SECURITY.md`; please do not open a public issue for a
  vulnerability.
- Conduct: see `CODE_OF_CONDUCT.md`.
