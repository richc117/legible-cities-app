# ADR-014: Spec Kit for specs; decision records for decisions; spikes end in a record

- **Status:** Accepted
- **Date:** 2026-09-07
- **Supersedes:** none
- **Superseded by:** none

## Context

Three kinds of writing happen around code, and they answer different
questions. *What should this do, and how will we know it works* is a spec.
*Why did we choose this, and what does it cost* is a decision record. *Is
this even possible* is a spike. Collapsing them into one document produces
something that answers none of the three: a design document that is out of
date the week after it is written, because nobody can tell which parts were
decisions and which were guesses.

This project is also being built by someone writing their first desktop
application, with an AI assistant that will write code faster than a person
can review it. Both facts argue for the acceptance criteria existing before
the code does. An assistant given a vague instruction produces something
plausible; an assistant given a criterion a test could assert produces
something checkable.

The repository already had a decision-record convention (`docs/adr/`) and
the beginnings of a spec habit. What it lacked was a shape for specs and a
statement of the principles a spec is measured against.

## Options

**Write specs by hand into `specs/`.** No tooling, no dependency, no
templates to learn. It also means no shape: two specs written a month apart
would have different sections, and nothing would relate the spec to the
plan, the tasks, or the tests. This is what was happening.

**Spec Kit** (GitHub, MIT), initialised with its Claude integration. It
brings a spec template with mandatory sections, a constitution the specs are
read against, and a sequence - specify, clarify, plan, tasks, implement,
analyse - each step producing a file the next one reads. The cost is a
`.specify/` directory, a set of installed skills, and a workflow that has
opinions.

**A heavier process** - full requirements documents, sign-off gates. Wrong
size for one maintainer, and process nobody follows is worse than none.

## Decision

Spec Kit, with its Claude integration, and a constitution.

Every feature issue links a `specs/NNN-name/spec.md` with user stories,
acceptance criteria phrased so a test could assert them, edge cases, and
explicit markers where the issue was silent. The issue stays short; the spec
is where the detail lives. `/speckit-plan` and `/speckit-tasks` produce the
technical approach and the ordered task list from it.

`.specify/memory/constitution.md` states the principles - one renderer, the
engine is the source of truth, determinism is a feature, no network without
a reason and no telemetry, hygiene by tools, accessible by default,
decisions recorded rather than remembered - and every spec is read against
it. A spec that conflicts with a principle either changes or amends the
constitution first, in the open.

Issues are created two ways: `/speckit-taskstoissues`, which turns a task
list into issues for work already specified, and the maintainer's own
publishing script for the planned roadmap, which is idempotent by title so
the two cannot duplicate each other.

Decision records stay where they are, under `docs/adr/`. A spike is a
timeboxed experiment whose only deliverable is a report and the record that
follows it; its branch is deleted.

Engine work does not need a spec. A good issue body and tests are enough
there, because the engine has a test suite and a pipeline whose invariants
are already written down.

## Consequences

More writing before code, which is the point rather than the price: the
writing is where the shape of the thing gets learned, and where an
acceptance criterion gets phrased precisely enough to be checkable.

The specs are only as good as the questions they refuse to answer. A spec
that quietly invents a decision is worse than one that carries a visible
marker, so unresolved questions are collected rather than resolved by the
tool - the first spec written under this decision carries seven of them,
each naming what it blocks and what happens if it stays open.

Spec Kit is a dependency with opinions, and its command names have already
changed once between releases. `.specify/` is committed so a checkout is
reproducible, and the version that generated it is recorded there.

Three sets of documents now describe the project - specs, decision records,
and the code - and they can disagree. Documentation changing with the code
is in the definition of done for that reason.
