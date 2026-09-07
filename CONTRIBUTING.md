# Contributing

Thank you for looking. This project is small and early; the guide below is
what keeps it coherent as it grows.

## Where things stand

The repository holds its charter and nothing to build yet. The roadmap is
the milestones on this repository, once published, in order: Phase 0
(foundation and spikes) through Phase 6 (release readiness). An issue with
the `type:spike` label is a timeboxed experiment whose deliverable is a
decision record, not code.

### Labels, milestones and issue codes

Issues carry four labels: a phase (`phase:0` to `phase:6`), a type
(`type:spike`, `type:spec`, `type:feature`, `type:bug`, `type:chore`,
`type:docs`), an area (`area:engine`, `area:shell`, `area:sidecar`,
`area:capture`, `area:export`, `area:ui`, `area:ci`, `area:release`) and a
size (`size:S`, `size:M`, `size:L`). The milestones are the seven phases:
Foundation, Engine boundary, Library and inspect, Schematic, Style, Export,
Release readiness. The maintainer creates labels and milestones before the
first issues are posted; the issue templates apply a type label only when it
already exists.

Planned issues carry a short code in their title, such as `A2-03`: the
repository (`A` for this app, `E` for the engine), the phase, and a sequence
number. It is a reading aid, not something a tool checks.

## How work happens

1. **Pick an issue.** Comment that you are taking it. Issues carry a phase,
   a type, an area and a size label.
2. **Spec first.** Feature issues get a spec under `specs/` with user stories
   and acceptance criteria before any code (the tooling for this arrives in
   Phase 0). Spikes get a question, a method and a timebox.
3. **Branch and pull request.** One issue, one branch named for it
   (`123-geographic-view`, or `A2-03-geographic-view` for a planned issue),
   one pull request. `main` only changes through pull requests with green
   checks.
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

## Definition of done

- The spec's acceptance criteria pass, and a test asserts each one that can
  be asserted.
- Checks are green on macOS, Windows and Linux.
- Documentation changed with the code: architecture notes, the decision
  record, user-facing text.
- No new secret-scanner finding; no absolute path, address or key in the diff.
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
