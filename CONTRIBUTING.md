# Contributing

Thank you for looking. This project is small and early; the guide below is
what keeps it coherent as it grows.

## Where things stand

The repository is public and **open to outside contributions**: you do not
need to be asked, and you do not need to know the maintainer. It holds its
charter, the Phase 0 spike reports and decision records, and the
application: a front door of projects and sample cities, a project as a
notebook of six cells under its map, the engine supervised as a child
process, and exports for the engine's social presets, with checks on three
platforms (`README.md`, "What it does" and "Developing"). Version 0.1.0 has
been released; work goes on after it.

The roadmap is the milestones on this repository, and its Milestones page
lists them: Phase 0 - Foundation, Phase 5.5 - The notebook, Phase 5.6 - The
front door, Phase 6 - Release readiness, Phase 7 - Polish, Consolidation,
and After 0.1.0. An issue labelled `good first issue` or `help wanted` is
one the maintainer would be glad to see taken; any open issue may be, once
you have said so on it. If what you want to change has no issue, open one
first and say what you would do, so that nobody builds a change the project
would not take. An issue with the `type:spike` label is a timeboxed
experiment whose deliverable is a decision record, not code.

### Labels, milestones and issue codes

Planned issues carry four labels: a phase (`phase:0` to `phase:7`, and
`phase:5.5`), a type (`type:spike`, `type:feature`, `type:chore`,
`type:docs`), an area (`area:shell`, `area:sidecar`, `area:capture`,
`area:export`, `area:ui`, `area:ci`, `area:release`) and a size (`size:S`,
`size:M`, `size:L`). A defect carries `bug` (there is no `type:bug`), and
`accessibility` where it is one; `good first issue` and `help wanted` mark
work open to a newcomer. The milestones are the ones listed above, and the
front door's issues carry `phase:5.5`. The maintainer creates labels and
milestones before the first issues are posted; the issue templates apply a
label only when it already exists.

Planned issues carry a short code in their title, such as `A2-03`: the
repository (`A` for this app, `E` for the engine), the phase, and a sequence
number. It is a reading aid, not something a tool checks.

## Setting up a checkout

You need Node.js 22.12 or later (`engines` in `package.json`; CI runs
Node 22), and git. On a Mac, Windows or Linux machine, with no engine at all:

```
npm ci
npx install-electron --no         # the Electron binary is fetched separately since Electron 42
npm run lint && npm run typecheck && npm test && npm run build
npm run test:e2e                  # Playwright launches the built app (on Linux: xvfb-run -a npm run test:e2e)
```

`README.md`, "Developing", says what each check proves. Do not run two
launches of the app at once: its single-instance lock makes the second quit.

### The engine

The app starts the Python engine, `legible-cities`
([its repository](https://github.com/richc117/legible-cities)), as a
sidecar, and each release of the app pins one tag of it (`engine.tag` in
`vendor/pins.json`). **Without an engine checkout, most of the work runs:**
the unit tests run against a stand-in engine (`tests/fake-engine/`, which
needs a `python3` on your `PATH`), and so does most of the end-to-end suite
(the export, layout, feeds, inspect and settings specs among them). CI is set
up that way too, so a green `ci` does not exercise the real engine.

**What needs the real engine**, each on its own condition:

- `npm run dev` runs the app against the engine named by
  `LEGIBLE_ENGINE_CHECKOUT`.
- The unit tests `sidecar-real`, `feeds-real`, `protocol-real`,
  `opening-real` and `layout-real` read only `LEGIBLE_ENGINE_CHECKOUT` and use
  that checkout's own `.venv`; `LEGIBLE_ENGINE_PYTHON` does not reach them.
  `determinism-real` takes either.
- `layout-real` also needs a layout the engine has cached for
  `la-metro-rail` in the checkout (`data/graphs/la-metro-rail/<id>/`),
  `viewer-real` a page the engine has generated under the checkout's `out/`,
  and `tokens` only the checkout's source (`src/schematic/page/page.html`).
- The end-to-end `capture` spec needs `out/la-metro-rail.html` in the
  checkout. The `reel` spec needs the same page, the checkout's `.venv`,
  `ffmpeg` on your `PATH` and `LEGIBLE_REEL_TEST=1`. The `typeface` spec needs
  `LEGIBLE_ENGINE_PYTHON` in the environment.
- The `determinism` spec runs only with `LEGIBLE_DETERMINISM_TEST=1`, and then
  it **fails rather than skips** unless `LEGIBLE_ENGINE_PYTHON` names an
  interpreter with the pinned engine and `SCHEMATIC_FFMPEG` names an ffmpeg
  with `ffprobe` beside it. The `determinism` workflow runs it, and the
  `typeface` spec, on pull requests that touch the app (it is not a required
  check).

To get one on macOS or Linux, you need [`uv`](https://docs.astral.sh/uv/)
and a clone of the engine beside this repository (in a folder called
`legible-cities` or `OpenSchematicMaps`, or anywhere, with `--engine`):

```
git clone https://github.com/richc117/legible-cities.git ../legible-cities
scripts/pin-engine.sh "$(node -p "require('./vendor/pins.json').engine.tag")"
cp .env.example .env.local        # gitignored; then edit it, see below
```

`scripts/pin-engine.sh <tag>` makes a git worktree of the engine at the tag
(`lc-engine-<tag>`, beside the engine clone), gives it a virtual
environment with the package installed, and moves one link,
`lc-engine-current`, beside this checkout, to it. It refuses a tag that is
not the pinned one unless given `--force`, and it never edits `.env.local`.
In `.env.local`, set `LEGIBLE_ENGINE_CHECKOUT` to the path of that link
(`../lc-engine-current`) once; a new pin then needs no further edit. A
variable set in the environment outranks the file, so
`LEGIBLE_ENGINE_CHECKOUT` and `LEGIBLE_ENGINE_PYTHON` given as absolute paths
on a command point one run at another engine. On Windows the script is not supported
(its own words): make the checkout and its environment by hand and name them
in the same two variables. Anything the app needs from the pipeline is a change to the
engine, versioned and tagged, never a copy here; send that to the engine's
repository.

A fresh pin has no generated page and no cached layout, so run the engine once
on that feed before the tests that read them (it needs LOOM, below, and fetches
the feed):

```
cd ../lc-engine-current && .venv/bin/python -c 'from schematic import pipeline; print(pipeline.run("la-metro-rail").summary())'
```

If your change touches any of this, name an engine checkout, run the tests it
unlocks, and tick the box for it in the pull request. (The end-to-end run
warns at its start only when there is neither the variable nor an
`.env.local`, so do not count on it to tell you a run proved less.)

The engine runs LOOM for a layout and the app needs ffmpeg for an export. With
a pinned checkout, `npm run dev` therefore wants LOOM, as the engine's Docker
image (the engine's README) or as a folder of native `gtfs2graph`, `topo`,
`loom` and `octi` named by `SCHEMATIC_LOOM_BIN`, and `SCHEMATIC_FFMPEG` naming
an ffmpeg for an export.

## What a pull request carries

- One issue, one branch, one pull request. From a fork, name the branch for
  the issue (`123-geographic-view`).
- A spec under `specs/` first, if it is a feature (see **Specs**).
- The checks green: lint, typecheck, test and build locally, and the checks
  below on the pull request.
- `bin/preflight` clean, and `gitleaks` if you have it. Install the hooks
  once (**Local hooks**, below): they are the same scanners the pull request
  check runs, and they tell you before you push instead of after.
- An interface change drawn in the design system: tokens from the token
  stylesheets under `src/renderer/src/styles/` (`theme.css`, `scale.css`,
  `figui-adapter.css`), controls from the wrappers
  in `src/renderer/src/kit/`, no colour, size or duration literal in a
  component file, and a new component's rule added to `docs/DESIGN.md`
  section 8.2.
- The gate documents changed too when an app sentence or a control name
  changes (below).
- No machine paths, e-mail addresses, private hostnames, keys, links to a
  tool session or planning notes anywhere in the diff, the commit messages
  or the pull request.
- The pull request template (`.github/PULL_REQUEST_TEMPLATE.md`) filled in,
  honestly. The issue goes in the pull request's body, and a closing
  keyword belongs there and not in a commit message. Say which systems you
  tried the change on; if you have one, that is enough, and CI covers the
  three.

The checks that must be green before a merge are `gitleaks`, `preflight`
and the three `ci` jobs (Ubuntu, macOS, Windows), and the branch must be up
to date with `main` (`docs/repository-settings.md` lists the protection).
Other workflows are not required: the determinism run also starts on pull
requests that touch the app, and the installers and the acceptance run are the
maintainer's, on a tag or by hand.

### The gate documents

The people who test a release follow documents that quote the app's own
sentences and control names: `docs/acceptance.md` (the acceptance
checklist), `docs/acceptance-stranger.md` (the stranger's timed run) and
`docs/accessibility.md` (the screen-reader walkthrough and the
per-screen record). Changing a sentence or a control name in the app means
changing these in the same pull request.

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
4. **Review.** The maintainer reviews every pull request; automated checks
   must pass; the pull request template's checklist must be honest.
   **If this is your first contribution here, the checks do not start by
   themselves.** The repository is set to require approval for workflows from
   first-time contributors (`docs/repository-settings.md`), so a pull request
   from a fork shows its checks as waiting until the maintainer approves
   them. That stops being needed once you have had a pull request **merged**;
   approving one does not do it. Nothing is wrong when the checks wait. The workflows run with read-only access
   and without the repository's secrets, so a fork's run can prove less
   than the maintainer's but cannot reach more. Run the checks locally
   meanwhile, so approval finds them green.
   **`main` must be up to date.** When GitHub says your branch is behind
   `main`, rebase it onto `main` (`git fetch origin && git rebase
   origin/main`) and push with `git push --force-with-lease`. Do not use
   GitHub's "Update branch" button, which merges `main` into your branch.
   The checks run again, after approval if you are new.
   **A failed check is re-run once before it is believed**
   (`gh run rerun <id> --failed`). The end-to-end tests launch a real
   application on shared runners, and a few of them still fail now and
   then for reasons of their own. (The one seen most often, issue 222,
   turned out to be a defect in the app and not in its test, so a failure
   that goes away on a re-run is still worth its record.) A
   failure that comes back is the change's until `main` has been run the
   same number of times; one that does not is recorded on the issue that
   tracks it, with the run's id, rather than forgotten. A failure's rate
   is measured with the `e2e-loop` workflow, which repeats one spec up to
   sixty times on one platform, with or without load, from a hand dispatch.
5. **Squash merge.** The maintainer merges, and `main` reads as one commit per
   issue, so your pull request's title becomes the subject line: write it as
   one. The maintainer does **not** use GitHub's default squash message, which
   carries every commit's message and adds a `Co-authored-by:` trailer with
   each other author's commit address: a personal address there would sit on
   `main` for good, because `preflight` reads the whole history on every push
   and force pushes are blocked. The squash message is written by hand and
   run through `bin/preflight --message-file` first, and any `Co-authored-by:`
   with a personal address is removed or rewritten to a no-reply address
   before the merge is confirmed.

## Commits

- Subject: an imperative sentence under 72 characters. Body: why, not what.
- `Co-Authored-By:` trailers are welcome for pair and tool-assisted work.
  Do not add trailers that link to tool sessions or private services.
- **Sign-off is not used.** The project does not ask for a DCO
  `Signed-off-by` line: a contribution arrives under the GPL by being
  submitted (**Licence of contributions**, below), and nothing checks for a
  sign-off. Leave one out. If you do add a `Signed-off-by:` or a
  `Co-authored-by:` trailer, **its address must not be a personal one**:
  `bin/preflight` reads every commit message the pull request adds (the whole
  message, trailers included) and fails the required `preflight` check on an
  address at `gmail.com`, `icloud.com` or `outlook.com`, and a pull request
  whose message does has to have its commits rewritten before it can merge.
  Use your GitHub no-reply address instead
  (`<id>+<username>@users.noreply.github.com`, shown under Settings, Emails),
  and treat any other personal domain the same way though the list does not
  name it. What is **not** scanned is the commit's author and committer
  fields, which git records and which stay in the public history: if you do
  not want your own address there, set `git config user.email` to the same
  no-reply address before you commit, and turn on "Keep my email addresses
  private" and "Block command line pushes that expose my email" on GitHub.
  Do this whatever you decide about trailers: a commit address can reach a
  `Co-authored-by:` trailer when the pull request is merged, and the
  maintainer should not have to catch it.
- Never put a closing keyword (`Closes #N`) in a commit message; it belongs
  in the pull request body, and `bin/preflight` refuses it.
- Run `bin/preflight` before pushing. It refuses personal file paths,
  private addresses, keys and session links, none of which belong in a
  public repository, and a symbolic link whose target is absolute, begins
  with what only a shell would expand (`~`, `$`, `%`), carries any of
  those, leaves the repository, climbs after naming a folder or cannot be
  read: a path from someone's machine by another name, or one nobody can
  check. CI runs it again over the commits a pull request adds. Whatever
  it cannot read it refuses rather than call clean: a folder that is no
  repository, or whose top it cannot enter, an index or a file in it, a
  history, a range of commits.

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
tracked tree, the target of every symbolic link in it included, but the
`gitleaks` hook reads only what is **staged**, because
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
what decide whether a change lands. The committed settings say which
plugins run here, and `/lanes` is how several issues are built at once
(ADR-034).

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
- The installers still build after the merge (`build.yml`).

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
