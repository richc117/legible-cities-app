# ADR-016: All data lives in the user's data folder; the engine never writes beside its code

- **Status:** Accepted
- **Date:** 2026-09-06 (written up 2026-09-07, with the skeleton that builds on it)
- **Supersedes:** none
- **Superseded by:** none

## Context

Everything in the engine is anchored to its repository root: feeds, graphs
and output are written beside the code. Inside an application bundle that
location is read-only on macOS and wiped on update everywhere; nothing may
be written there.

## Options

**A home under the user's data folder**, passed to the engine, with
exports going where the user chooses. **Beside the app**, which fails on
macOS and loses everything on update. **A folder the user picks at first
run**, which puts a question before the first window.

## Decision

The app passes `SCHEMATIC_HOME=<userData>/engine` to the engine, which
resolves `feeds/`, `graphs/`, `projects/`, `out/` and `logs/` under it. The
default can be overridden by configuration. Exports go to a folder the
user chooses, defaulting to a folder on the Desktop named for the app,
matching the engine's own export habit and its rule of never writing into
the repository.

## Consequences

The app writes nothing inside its own bundle; the skeleton's spec asserts
it (FR-016, SC-009). Uninstalling leaves data behind by design, which the
install notes say. A "Reset engine data" setting deletes the home after
confirmation. A relative configuration value in a packaged build resolves
against the working directory, never the bundle.
