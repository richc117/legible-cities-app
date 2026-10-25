# ADR-058: Contributions carry a DCO sign-off

- **Status:** Accepted
- **Date:** 2026-10-25
- **Supersedes:** none
- **Superseded by:** none

## Context

On 24 Oct 2026 the maintainer decided that the public repository is open to
outside contributors (issue 438). `CONTRIBUTING.md` then said, as a default
left for him to confirm, that sign-off is not used: a contribution arrives
under the GPL by being submitted, under GitHub's terms ("inbound =
outbound"), and nothing checks for a sign-off.

That default rested on a clause of GitHub's terms of service, which a
contributor has agreed to by having an account and has not read as a
statement about this project. On 25 Oct 2026 the maintainer asked for
current best practice instead. The sources agree:

- The OpenSSF Best Practices criteria (silver, `dco`) ask for a legal
  mechanism by which contributors assert that they may make their
  contribution, and name the Developer Certificate of Origin (DCO) as the
  recommended one.
- The Linux Foundation's contribution guidance describes the DCO as the
  lightweight, inbound = outbound mechanism most of its projects use, and a
  contributor licence agreement (CLA) as what to avoid unless the project
  needs to relicense or to hold rights the contributor keeps.

The project is GPL-3.0-or-later. It has no commercial edition, no dual
licence and no plan to move to another licence, so it never needs a right
the licence does not already give it.

The DCO 1.1 is four short statements, (a) to (d). A contribution is the
contributor's own work, or is under a compatible open source licence they
may pass on, or came from someone who certified one of those to them, and
the contributor understands that the contribution and the sign-off are
public and kept indefinitely. The sign-off is a line,
`Signed-off-by: Name <address>`, which `git commit -s` writes from
`user.name` and `user.email`.

Three facts about this repository shape the mechanism:

- Its commit history is public for good and force pushes to `main` are
  blocked (`docs/repository-settings.md`). Item (d) of the DCO says the
  sign-off is part of that record, so the address on it is published for
  good. `bin/preflight` already refuses a personal address (gmail.com,
  icloud.com, outlook.com) in any commit message, trailers included, and
  says to use the GitHub no-reply address. Nothing in it treats
  `Signed-off-by` by name, so a no-reply sign-off passes and a personal one
  still fails; a unit test now pins both.
- Pull requests are squash merged, and the maintainer writes the squash
  message by hand because GitHub's default would add a `Co-authored-by:`
  trailer with each author's commit address (`CONTRIBUTING.md`, "Squash
  merge"). A squash that kept only the pull request's title would leave
  `main` with no sign-off, though every commit it replaced had one.
- The seven required checks are named in the branch protection
  (`docs/repository-settings.md`), and a required check that never starts
  blocks the merge. A new check is therefore either a new required name,
  changed in the setting within the hour, or a step of a job that is
  already required.

## Options

- **Nothing more: inbound = outbound under GitHub's terms.** Costs nothing
  and was the default. It gives a contributor no moment at which to ask
  themselves whether they may contribute, and gives the project no record
  of one having said so. The OpenSSF criterion is not met.
- **A CLA.** A signed agreement, usually with a bot that holds the
  signatures. It buys the right to relicense and to defend or assign
  rights, none of which a GPL-3.0-or-later project with no second licence
  needs. It costs a stranger an account on a third-party service, a legal
  text to read before the first one-line fix, and the project a store of
  personal data. The same sources say to avoid it for this case.
- **The DCO, checked by a third-party GitHub App.** The widely used DCO app
  does this check. It would be a new app with read access to the
  repository's pull requests and a place to configure its exemptions that is
  not in the repository.
- **The DCO, checked by a step of our own.** No new app gets access to the
  repository, and the rule is a script in the repository that a contributor
  can read, run and change in a pull request, and that the unit tests run.
  It costs the script and its tests.
- **The DCO, trusted without a check.** Review would catch a missing
  sign-off for as long as the maintainer remembers to look. A check is
  cheap, and fails with the command that fixes it.

## Decision

Every commit a pull request adds carries a Developer Certificate of Origin
1.1 sign-off. There is no CLA, and the bare terms-of-service default is
withdrawn; `CONTRIBUTING.md` links the DCO's text and says what the line
certifies.

**The check is the project's own.** `scripts/dco-check.mjs` is a pure
function over the commits that `gh api repos/{owner}/{repo}/pulls/{n}/commits`
lists, run as the last step of the existing `preflight` job on
`pull_request`. It is not a third-party app, so no new app gets access to
the repository, and the rule lives in the repository where a contributor can
read it. It is a step of a job that is already required, so the seven
required checks do not change.

A commit passes when it is one of these:

- **A merge commit** (more than one parent). It carries no change of its
  own, and the author of a merge is the person who pressed the button. GitHub
  makes one when a branch is updated from `main`, and the guide says to
  rebase instead, so this is a courtesy to a mistake already made.
- **Authored by a bot** (`author.type` is `Bot`, or the login ends in
  `[bot]`). A bot has no name to sign with and certifies nothing; its
  changes are the maintainer's to accept, and Dependabot's are.
- **Authored by the repository owner.** The maintainer certifies nothing to
  himself, and has the rights to what he writes in his own repository. The
  DCO app's option that members need not sign off is the precedent. The
  owner's login is passed to the script, not written in it.
- **Carrying a `Signed-off-by:` line whose name is the commit author's name**
  (trimmed, case-insensitive) **or whose address is the author's address.**
  Name matching is there because the author's address may be a personal
  one, and `bin/preflight` refuses a personal address in the message: a
  contributor whose git configuration has a personal address in the author
  field can still sign with the no-reply address, under their own name. A
  commit with no linked GitHub account (`author` null) is judged on its
  line alone.

**Why each exemption is safe.** None of them is a security boundary, and
the DCO is not one either: it is an attestation, and the fields it is
compared with are whatever git was told. GitHub links a commit to an
account by its address, so a commit that claims the owner's address, or a
bot's, is exempt from the check. The exemptions do not open anything that
review leaves shut: the maintainer reads every pull request and merges by
hand, the squash message is his, and a contribution that claimed to be his
would have to survive that reading. What the check is for is the honest
mistake, a contributor who does not know of the DCO or forgot `-s`, and the
exemptions are the commits where there is nobody who could have forgotten.

**The sign-off is public for good, so the GitHub no-reply address is the
one to use.** `CONTRIBUTING.md` says to set it with `git config user.email`
before the first commit, which also keeps the contributor's own address out
of the author field, and `bin/preflight` keeps a personal address out of
the message. The failure of the check says the same.

**An assistant never adds a `Signed-off-by` for a person.** Only the
person certifies: item (a) to (d) are statements about what that person
knows and has the right to do, and a tool cannot make them. An assistant's
commit carries its own `Co-Authored-By:` line, as before, and the person who
submits it adds their sign-off, with `-s`, having read the change. The
maintainer's own commits, made with an assistant's help, are exempt by the
owner clause and carry none.

**The squash message carries every contributor's `Signed-off-by:` lines.**
The maintainer writes the squash message by hand and keeps each
contributor's `Signed-off-by:` lines as they were written, so that `main`
records the certificate each contribution came under although the commits
are gone. A line whose address is a personal one never gets this far: the
`preflight` check refuses it in the commit that carries it.

## Consequences

- A stranger's first pull request needs `git commit -s` and a no-reply
  address in `user.email`, or one `git rebase --signoff origin/main` and a
  force-push with lease after the check fails. The failure says so and names
  each commit by its short id and subject. That is a step, and one that
  every project with a DCO asks for; the cost of leaving it out is a red
  check, not a rejected contribution.
- The check reads the list from the API, because the API says which account
  authored a commit and whether it is a bot, which a checkout does not. The
  list is public data, so the read-only token a fork's pull request gets
  reads it as well as the maintainer's does. The `preflight` job asks for
  `pull-requests: read` in its own `permissions:` block, beside
  `contents: read`, because that is the scope GitHub documents for the
  endpoint, and a job's block replaces the workflow's. The script is given
  the head commit the event names and refuses a list that does not end
  there, so a push between the event and the read cannot give a verdict
  about other commits. The API lists at most 250 commits and does not say
  when it stopped, so a pull request of 250 or more fails the step with that
  sentence rather than pass on a list that may be short.
- The check tells an honest mistake from none and nothing else. It cannot
  tell that a name on a line is the person's own. If a contribution turns
  out not to have been the contributor's to give, the sign-off is what makes
  that the contributor's statement and not the project's assumption, and
  the maintainer can remove the contribution; it is not a lock.
- The maintainer takes on one more thing at a merge: the sign-off lines in
  the squash message. `bin/preflight --message-file` already reads it for a
  personal address.
- Contributors keep their copyright. The project cannot relicense without
  every contributor's agreement, which is what a GPL project that expects to
  stay one wants.
- A pull request that only changes the guide still carries the sign-off
  check, since it is a step of `preflight`, which has no path filter.
- The `pull_request` event runs the pull request's own copy of the script
  and of the workflow, so a change to either is read in review like any
  other change. It is the same exposure `bin/preflight` has.
- Changing the rule is a pull request that changes `scripts/dco-check.mjs`
  and its test, with this record amended or superseded if the decision, and
  not just the code, changes.
