---
name: adr
description: Write a new architecture decision record under docs/adr/ from the repository's template, number it after the last one, and add its row to the index. Use when a choice has been made that would be expensive to reverse, or when a spike has finished and its recommendation needs recording.
argument-hint: "<short title, or the decision in a sentence>"
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(ls docs/adr*), Bash(bin/preflight)
---

# Write a decision record

Records already here: !`ls docs/adr | sort`

Write `docs/adr/NNN-short-title.md` for: **$ARGUMENTS**

## Number it

`NNN` is three digits, and it is **allocated, not computed**. Ask the
maintainer which number this decision has; the founding decisions were
numbered before they were written up, so several numbers between the files
in `docs/adr/` are already spoken for. `docs/adr/README.md` lists the
reserved ones - check it, and check that nothing else in the repository
already cites the number you are about to take:

```
grep -rn 'ADR-NNN' .
```

Only if the decision is genuinely new and no number has been allocated, take
the next one that is neither used nor reserved. Never renumber an existing
record.

The filename's title is kebab-case and short: `013-page-is-the-viewer.md`,
not `013-decision-about-how-the-viewer-works.md`.

## Write it

Copy the shape of `docs/adr/000-template.md` exactly: the header block
(Status, Date, Supersedes, Superseded by) and then **Context**, **Options**,
**Decision**, **Consequences**. Read `docs/adr/README.md` first if you have
not already.

- **Status** is `Proposed` unless the maintainer says the decision is
  already made, in which case `Accepted`. **Date** is today, ISO format.
- **Context** is what forced a choice: facts, measurements, constraints. Not
  a summary of the decision.
- **Options** are what was actually on the table, each with what it costs and
  what it buys. An option nobody considered is padding; leave it out. If
  there was genuinely only one option, say so and say why.
- **Decision** is one paragraph, in the past tense, saying what was chosen.
- **Consequences** is the honest half: what this costs, what it makes
  easier, and what will have to be watched. A record with only upsides in
  this section is not finished.

Write for a stranger reading in two years who has none of today's context.
Prose in full sentences, wrapped at about 76 columns to match the rest of
`docs/`.

## Then index it

Add one row to the table at the end of `docs/adr/README.md`, in number
order, linking the file:

```
| 013 | [The generated animation page is the viewer](013-page-is-the-viewer.md) | Accepted |
```

## Before you finish

This repository is public. The record carries the technical reasoning and
nothing else: no absolute paths, no addresses, no private hostnames, no
notes about audience, money or timelines, and no link to a tool session.
Those belong in the maintainer's private notes. Run `bin/preflight` when you
are done.

A record is not rewritten after it is accepted. The only line that changes
is its status, and a changed decision is a **new** record that names the one
it supersedes - fill in `Supersedes:` on the new record and
`Superseded by:` on the old one, and update both rows in the index.
