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

Spikes (timeboxed experiments) end in a record here, not in code.

The founding decisions were made before this repository existed and are
being written up as its first records.

| Number | Title | Status |
|---|---|---|
| 000 | Template | n/a |
