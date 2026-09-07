# ADR-015: Public-repo hygiene is enforced by tools, not attention

- **Status:** Accepted
- **Date:** 2026-09-07
- **Supersedes:** none
- **Superseded by:** none

## Context

This repository is public and is written with an AI assistant. Both facts
push in the same direction. A public repository leaks what it is given:
a key pasted into a config file, an absolute path in a test fixture, a
personal address in a commit trailer, the address of a private server in a
script. An assistant writes absolute paths into examples without noticing,
because on its side of the screen the path is simply where the file is.

Attention does not scale to that. The maintainer reads every diff today and
will not read every diff in a year, and no contributor can be asked to hold
a never-list in their head. Whatever protects the repository has to run
without being remembered.

Two kinds of thing must be caught, and no single tool catches both:

- **Secrets** — keys, tokens, certificates. Recognisable by shape and
  entropy, which is what a secret scanner is for.
- **Everything else on the never list** — machine paths, personal e-mail
  addresses, private hostnames and addresses, links to tool sessions. None
  of these look like a secret; a scanner walks straight past them.

## Options

**Review only.** Free, and it is what a small project usually does. It fails
the moment the project stops being small or the reviewer is tired, and it
fails silently: nobody notices the leak that was not caught.

**A secret scanner alone** (gitleaks in a hook and in CI). Catches keys,
which are the expensive failure, and nothing else on the list. The paths and
the session links go through untouched.

**A scanner plus a project-specific grep, in three places** — the commit
hook, the assistant's tool hook, and CI. More moving parts to keep in step,
and a first commit that spends a few seconds building the scanner. It is
the only option that catches both kinds of thing and that survives a
`--no-verify`.

## Decision

Both scanners, run in three places.

`gitleaks` finds keys and tokens; `bin/preflight` finds the rest of the
never list. They run from `.pre-commit-config.yaml` on every commit (and
`bin/preflight --message-file` on the message itself, while it can still be
edited), from `.claude/hooks/guard-git.sh` before any commit or push an
assistant makes, and from `.github/workflows/gitleaks.yml` and
`preflight.yml` on every push and pull request. The local hooks are convenience; CI is the one that counts,
because it cannot be skipped.

`.gitleaks.toml` extends the default rule set with an allowlist for this
project's false positives, each entry narrow and each carrying its reason.

On the hosting side, once this repository is published: secret scanning and
push protection, private vulnerability reporting, Dependabot alerts and
updates (`.github/dependabot.yml`), and branch protection on `main`. Those
are settings rather than files; `docs/repository-settings.md` lists them so
they are applied deliberately and can be checked.

`gitleaks` itself is MIT-licensed. `gitleaks-action`, which runs it in CI,
is proprietary and free for public repositories and personal accounts; it is
a build-time tool, bundled with nothing, so it does not appear in
`THIRD_PARTY_NOTICES.md`. If that licence ever stops being free for this
repository, the workflow can run the `gitleaks` binary directly instead.

## Consequences

Commits are a few seconds slower, and the first commit in a fresh checkout
is slower still while `pre-commit` builds its environment. The gitleaks
version is pinned in two files — `rev` in `.pre-commit-config.yaml` and
`GITLEAKS_VERSION` in the workflow — and they have to be moved together;
they are commented to say so.

An allowlist is a liability that grows. Every entry in `.gitleaks.toml` says
what it is for, and an entry without a reason should be deleted rather than
inherited.

The scanners find shapes, not intent. They will not catch a private
hostname that looks like a public one, or a sentence about the audience for
this app. Those still depend on where the writing is done, which is why the
private material lives in a separate repository and not in a gitignored file
here.

The repository will be noticeably stricter than the engine repository, which
keeps its straight-to-`main` habit. That difference is deliberate: this is
where the pull request flow is learned.
