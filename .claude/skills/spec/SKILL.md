---
name: spec
description: Scaffold a feature spec from an issue - user stories, acceptance criteria and edge cases under specs/ - before any code is written. Use when starting a feature issue, or when an issue's acceptance criteria need turning into something testable.
argument-hint: "<issue number, or the feature in a sentence>"
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(gh issue view *), Bash(gh issue list *), Bash(ls *)
---

# Scaffold a spec

Write the spec for: **$ARGUMENTS**

Features get a spec with acceptance criteria before code. The spec is where
the detail lives; the issue stays short and links to it. See
`CONTRIBUTING.md`.

## 1. Get the issue

If the argument is a number, read the issue:

```
gh issue view <number>
```

If `gh` cannot reach it - no remote yet, no network, not a GitHub issue -
say so and ask the maintainer to paste the issue text rather than inventing
it. A spec written from a guess at the issue is worse than no spec.

Take from the issue: the title, the planned code if it has one (`A2-03`),
the acceptance criteria, and the phase and area labels.

## 2. Use Spec Kit if it is installed

If `.specify/` exists, Spec Kit owns the spec's structure and numbering:
run `/speckit.specify` with the issue text and let it write
`specs/NNN-name/spec.md`, then fill in the sections below. Read
`.specify/memory/constitution.md` first and keep the spec inside it.

If `.specify/` does not exist yet, write `specs/NNN-name/spec.md` by hand
from [spec-template.md](spec-template.md), numbering it after the highest
directory already under `specs/`, and keep the same section names so the
two forms are interchangeable later.

## 3. Fill it in

- **User stories** are in the user's words and say why, not how: "As someone
  making a video for a city's transit page, I want the busiest weekday
  chosen for me, so that I do not have to know the feed's calendar." A story
  that names a component or a function is a task, not a story.
- **Acceptance criteria** come from the issue, one per line, each phrased so
  a test could assert it. "The export is deterministic" is not a criterion;
  "two exports of the same job differ by no more than 8 per RGB channel" is.
  Say which ones a test will assert and which ones only a person can check.
- **Edge cases** are where the work actually goes: an empty feed, a feed
  with one route, a feed whose calendar has ended, a cancelled job, a
  sidecar that died mid-job, a path with a space in it, a second monitor
  with a different scale factor.
- **Out of scope** is a real section. Write down what this issue is *not*
  doing, so the pull request does not grow.

## 4. Mark what you do not know

Where the issue is silent, leave the marker rather than deciding:

```
[NEEDS CLARIFICATION: what should happen when the feed has no service on the chosen date?]
```

Do not resolve these yourself. Collect them at the end of the spec and ask
the maintainer; a spec that quietly invents an answer is how a feature ends
up being built twice.

## 5. Before you finish

- Every acceptance criterion in the issue appears in the spec.
- Every criterion is testable, or is marked as needing a person.
- The spec names no absolute path, address or key: this repository is
  public. Run `bin/preflight`.
- Link the spec from the issue, and the issue from the spec.
