## Issue

Closes #

## Spec

Link to the spec or decision record this implements, or "none: chore".

## Tested by hand on

- [ ] macOS (which version, Apple Silicon or Intel)
- [ ] Windows (which version)
- [ ] Linux or another system (which)

What you tried, in a sentence or two. If you could try it on one system
only, say which; CI runs the checks on all three.

## Checklist

- [ ] `bin/preflight` is clean, and the hooks pass: no key, personal path, address or session link in the diff (`pre-commit run --all-files`, and `gitleaks dir .` if you have it).
- [ ] Every commit is signed off (DCO), or is the maintainer's or a bot's.
- [ ] If the change touches the engine boundary, the capture or the export: the real-engine tests ran against a checkout at the pinned tag (`CONTRIBUTING.md`, "The engine"), or I say here that they did not.
- [ ] Tests added or updated for each acceptance criterion that can be asserted.
- [ ] Documentation changed with the code (architecture notes, decision record, user-facing text).
- [ ] Third-party additions are listed in `THIRD_PARTY_NOTICES.md` with their licence.
