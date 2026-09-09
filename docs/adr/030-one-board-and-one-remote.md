# ADR-030: One board and one remote, on GitHub

- **Status:** Accepted
- **Date:** 2026-09-09
- **Supersedes:** none
- **Superseded by:** none

## Context

This repository has had two remotes and two issue boards since the public
mirror was created. The private one was the board of record; the public one
carried the same issues, published from drafts kept outside this repository.
Continuous integration, branch protection, Dependabot, secret scanning and
push protection have always been on the public side. The private side
received a second push after every merge, and held a duplicate board.

Two boards holding the same issues under different numbers turned out to be
the most expensive thing about the arrangement, because the numbers are how
a change says what it settles. A closing keyword in a commit message is read
by whichever board the commit reaches, and a squash commit reaches both.
**Three issues were closed by changes that had nothing to do with them**, and
one issue that had shipped was left open on the mirror because its pull
request named a number that meant something else there. All six records were
repaired by hand on 2026-09-08 and the hazard was closed by a check the same
day.

The rest of the cost was smaller and steadier: a second push on every merge,
fourteen places in the planning documents spelling out two numbers for one
issue, and 430 lines of hand-written tooling to keep the boards in step.

Measured before deciding: the two boards held the same thirty-nine issues
under the same titles, and the numbering was not an offset, so nothing but
the title connected them. Twenty-one comment threads existed on the private
board; sixteen of them existed nowhere else.

## Options

**(a) Keep both.** No work. Keeps the second copy of the repository, and
keeps a hazard that has fired three times and a numbering that has to be
translated by hand every time an issue is mentioned.

**(b) One board, on GitHub.** Everything that already happens there keeps
happening; the private board stops being a second source of truth. Costs the
migration of the comment threads and the rewriting of everything that
describes the old flow, and gives up the second copy of the repository.

**(c) One board, on the private server.** Rejected: continuous integration,
branch protection, Dependabot, secret scanning and push protection are all on
GitHub and cannot follow, and the repository is public anyway.

## Decision

GitHub holds the only board and is the only remote. The sixteen comment
threads that existed nowhere else were carried across with their original
dates, each saying where it came from. The private board is left intact and
read-only by convention rather than deleted, so the history stays legible.
The issue drafts that were kept privately and published from are retired: the
board is the source now, edited with `gh`.

## Consequences

**One number means one issue.** That is the whole point, and it removes a
class of mistake that a written rule failed to prevent three times.

**One push per merge**, and no tooling to keep two boards in step.

**This repository no longer has a copy outside GitHub.** That is the real
cost and it should be stated plainly. A clone on the maintainer's machine and
GitHub are now the two copies. Nothing here is irreplaceable - the history is
public and the engine is a separate repository - but the redundancy that the
second remote provided by accident is gone, and if it is wanted back it
should be a deliberate mirror push rather than a second board.

**The closing-keyword check becomes precautionary.** With one board a keyword
in a commit message would close the right issue. The check stays because a
commit message is for why a change was made, and because a second remote
would bring the hazard back without announcing itself.

**The private planning repository still exists** and still holds what must
not be public. This decision is about where the work is tracked, not about
where the planning lives.
