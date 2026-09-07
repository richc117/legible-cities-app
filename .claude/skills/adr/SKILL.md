---
name: adr
description: Write a new architecture decision record under docs/adr/ from the repository's template, number it after the last one, and add its row to the index. Use when a choice has been made that would be expensive to reverse, or when a spike has finished and its recommendation needs recording.
argument-hint: "<short title, or the decision in a sentence>"
allowed-tools: Read, Write, Edit, Glob, Grep
---

# Write a decision record

Records already here: !`ls docs/adr | sort`

Write `docs/adr/NNN-short-title.md` for: **$ARGUMENTS**

## Number it

`NNN` is three digits. Use the next unused number after the highest one in
`docs/adr/`, unless this decision already carries a number somewhere the
maintainer will tell you about, in which case use that one so the references
match. Never renumber an existing record.

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
