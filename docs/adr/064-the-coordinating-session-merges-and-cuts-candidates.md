# ADR-064: The coordinating session merges and cuts release candidates

- **Status:** Accepted
- **Date:** 2026-11-12
- **Supersedes:** none
- **Superseded by:** none

## Context

Until now every merge, tag and pre-release in this repository has waited for
the maintainer, and `CONTRIBUTING.md` says so: the maintainer merges, and
writes the squash message by hand. Pull requests are built in lanes
(`.claude/skills/lanes/SKILL.md`) by agents that a coordinating assistant
session briefs, reads against the diff, sends to the `reviewer` subagent and
takes through the end-to-end suite. The last step of that procedure, the
merge, was the one the session could not take, and the same was true of the
release candidates that follow once enough has merged. Each of them waited on
one person, who was not otherwise needed at that point.

What the maintainer adds at a merge or a candidate is mostly already done by
something else. The seven required checks (`ci (ubuntu-22.04)`,
`ci (macos-15)`, `ci (windows-latest)`, `gitleaks`, `preflight`,
`e2e (macos-15)` and `e2e (windows-latest)`) must be green before GitHub
allows the merge at all. The `reviewer` subagent reads the change for
correctness, leaks and this repository's own rules, and is read-only by a
hook. `bin/preflight` and gitleaks scan the squash message, the history and
the working tree. What a person adds that none of these can is judgement
about what ought to ship, the certification of a final release, the custody
of secrets and the sitting at the gate (`docs/acceptance.md`), and those stay
with the maintainer.

Three facts bound the decision. The repository's `allow_auto_merge` setting is
off (`docs/repository-settings.md`), and GitHub's auto-merge would merge the
moment the checks pass, with no reviewer between. `main` must be up to date
before a merge, and the lanes procedure rebases for that. And a candidate is
published as a pre-release, which is not what the Releases page offers as the
latest version, so an error in one is corrected by another candidate and not
by pulling a release.

## Options

- **Keep merging by hand.** Nothing changes and nothing new can go wrong. It
  keeps every lane waiting for one person at the last step, and puts a person
  in the loop at the point where the checks and the reviewer have already
  said what there is to say.
- **GitHub's auto-merge.** It removes the wait, but it merges on green checks
  alone and so skips the reviewer, which is the one reader that is not a
  check. It also needs `allow_auto_merge` turned on, a repository setting.
- **Lift the "up to date" requirement on `main`.** It would save the rebase
  between merges. It lets two pull requests that are each green merge into a
  `main` that neither was tested against, which is the hazard the requirement
  exists for.
- **The coordinating session merges, under conditions written down.** The
  session already runs every step but the last. It costs a rule that has to
  be kept narrow, and a merge that the maintainer no longer sees before it
  happens.

## Decision

The coordinating assistant session merges a pull request when the seven
required checks are green and the `reviewer` subagent has passed it, and
again after any fix in a destructive path (the reset is the one). It never merges with `--admin`, and it
squashes with the scanned message, as `/lanes` step 9 says.

It merges only pull requests opened by its own lanes, and Dependabot pull
requests the maintainer has named. Any other pull request, including every
one from a contributor outside the maintainer's own sessions, waits for the
maintainer.

It may also do the following without asking: apply rules text
(`.claude/rules/*.md`) that a reviewed pull request's body proposes; file
issues; dispatch workflows and rehearsal builds; and tag and publish release
candidates, tags of the form `vX.Y.Z-rc.N` published as pre-releases and
never as Latest, once the freeze checklist in `docs/releasing.md` is green.

These stay the maintainer's: the final release's tag and its publish;
pushing or releasing the engine; secrets; repository settings and rulesets;
`.env.local`; and approving the deployment of a signed build.

## Consequences

- A lane's last step no longer waits for a person. The merge is still one
  per issue, still squashed with a message that `bin/preflight
  --message-file` has read, and still behind seven checks and a reviewer.
- The reviewer is what stands in for the reading the maintainer did. A
  smaller coordinating model must not mean a smaller review, so
  `.claude/agents/reviewer.md` names `model: opus` and no longer inherits.
- Auto-merge stays off. The session merges after the reviewer, so the
  reviewer is never skipped by a setting.
- A pull request from a contributor, and a Dependabot pull request nobody has
  named, are unchanged: they wait. This record widens who merges, not what
  may be merged.
- The ADR-058 clause that the maintainer reads every pull request and merges
  by hand describes the contributor's pull request, which still holds. The
  squash message still keeps each contributor's `Signed-off-by:` lines; the
  session that writes it keeps them as they were.
- A bad candidate costs another candidate, not a recall: it is a
  pre-release. The final release is not delegated, so nothing the installers
  carry reaches a user as the release without the maintainer's tag.
- The freeze checklist in `docs/releasing.md` is what a candidate is cut
  against. A session that cannot make an item true does not cut the
  candidate and says which item stopped it.
- Withdrawing this is a change to the sentence in `CONTRIBUTING.md` and to
  the lanes skill, with this record superseded; nothing in the repository's
  settings has to move.
