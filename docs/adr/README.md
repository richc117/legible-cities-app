# Architecture decision records

One file per decision, `docs/adr/NNN-short-title.md` with a three-digit
number in order of acceptance and a kebab-case title. A record is not
rewritten after it is accepted: the only line that changes is its status,
and a changed decision is a new record that names the one it supersedes.

Each record opens with a header (Status, Date, Supersedes or Superseded-by)
and has four sections: **Context** (what forced a choice), **Options** (what
was on the table), **Decision** (what we chose), **Consequences** (what it
costs and what it buys). Status is one of Proposed, Accepted, or Superseded
by ADR-NNN. Copy `000-template.md` to start one.

Spikes (timeboxed experiments) end in a record here, not in code; their
working reports sit under `spikes/`.

Anyone using Claude Code in this repository can run `/adr` to write a record
from the template and add its row below, and `/spike` to set up an
experiment and its report. Neither is required: a record written by hand is
the same record.

A number is allocated when a decision is accepted, not when it is written
up. The founding decisions were made before this repository existed, so the
numbers below are already taken even where the file is not here yet. Every
number in use appears in the table, including the ones held by decisions
about the project rather than the software, which are recorded elsewhere and
will not appear here as files. **The next free number is the one after the
last row.** Add your row when you add a record, and check that nothing
already cites the number you mean to use.

| Number | Title | Status |
|---|---|---|
| 000 | Template | n/a |
| 001 | The desktop shell is Electron | Accepted, not yet written up |
| 002 | The engine stays in Python and runs as a sidecar | Accepted, not yet written up |
| 003 | The code is licensed GPL-3.0-or-later | Accepted, not yet written up |
| 004 | Reserved: a decision about the project, recorded outside this repository | - |
| 005 | Reserved: a decision about the project, recorded outside this repository | - |
| 006 | Reserved: a decision about the project, recorded outside this repository | - |
| 007 | Reserved: a decision about the project, recorded outside this repository | - |
| 008 | Reserved: a decision about the project, recorded outside this repository | - |
| 009 | electron-vite + React + TypeScript, packaged by electron-builder | Accepted, not yet written up |
| 010 | JSON-RPC 2.0 over stdio, using existing LSP libraries | Accepted, not yet written up |
| 011 | LOOM ships as native binaries built in CI from a pinned commit | Accepted, not yet written up |
| 012 | FFmpeg is bundled and encoding stays in Python | Accepted, not yet written up |
| 013 | [The generated animation page is the viewer, served same-origin](013-the-generated-page-is-the-viewer.md) | Accepted |
| 014 | [Spec Kit for specs; decision records for decisions; spikes end in a record](014-spec-kit-for-specs.md) | Accepted |
| 015 | [Public-repo hygiene is enforced by tools, not attention](015-hygiene-enforced-by-tools.md) | Accepted |
| 016 | [All data lives in the user's data folder; the engine never writes beside its code](016-data-lives-in-the-user-data-folder.md) | Accepted |
| 017 | The app is called "Legible Cities" | Accepted, not yet written up |
| 018 | Public ADRs use three-digit numbers and a header block | Accepted, not yet written up |
| 019 | [LOOM ships without its optional solvers, and not on macOS until it is deterministic](019-loom-binaries.md) | Accepted |
| 020 | [The Python sidecar ships as a pinned python-build-standalone runtime](020-sidecar-packaging.md) | Accepted |
| 021 | [Windows stays in the first release; LOOM is not built from source there](021-windows-in-the-first-release.md) | Accepted |
| 022 | Reserved: a decision about the project, recorded outside this repository | - |
| 023 | [Determinism is per project; the layout is computed once and stored](023-per-project-determinism.md) | Accepted |
| 024 | Reserved: the capture path, written when spike A0-07 ends | - |
| 025 | Reserved: a decision about the project, recorded outside this repository | - |
| 026 | [The design system's icons, select control and mark](026-design-system-choices.md) | Accepted |
