# Research: Project

Phase 0 of the plan. No open questions remain in the spec; four technical
choices are recorded here with their alternatives, so they are not
re-decided.

## 1. Atomic writes for `project.json`

**Decision.** Write to `project.json.tmp` in the same directory, then
`fs.promises.rename` it over `project.json`. Node's `rename` overwrites an
existing file on every platform ("In the case that newPath already exists,
it will be overwritten"); a crash before the rename leaves the previous
record intact and a stray `.tmp` the next read ignores (FR-004).

**Alternatives.** Writing in place: a crash mid-write leaves a truncated
file. A write-ahead journal: more machinery than one small record needs.

## 2. Identifiers

**Decision.** Twelve characters from `[a-z0-9]`, generated from
`crypto.randomBytes`, starting with a letter so the identifier can never
look like a number or a device name (`con`, `nul`, `com1`…) and always
satisfies the origin's rule `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`. Generated
once, on create, and checked against the reserved-name rule before use;
never derived from the name (FR-002, A-001).

**Alternatives.** UUIDs: longer than the URL path needs and mixed case.
Name-derived slugs: must be sanitised, deduplicated and kept stable across
renames.

## 3. Dialogs

**Decision.** The native `<dialog>` element opened with `showModal()`. The
browser makes it modal, traps focus inside it, closes it on Escape (the
`cancel` event), and returns focus to the element that had it when the
dialog closes; the dialog is labelled with `aria-labelledby` and describes
itself with `aria-describedby`. React 19 renders it through a ref. Electron
44's Chromium implements all of this.

**Alternatives.** A hand-built overlay with a focus trap: what `<dialog>`
does natively, with more code and more to get wrong. A native
`dialog.showMessageBox` for delete: not the same on both platforms and
outside the renderer's styling and testing.

## 4. Record versioning

**Decision.** `version: 1` in every record. A reader fills missing optional
fields with defaults (an older record is read forward without being
rewritten until something changes); a record whose version is higher than
the reader's is shown read-only with a message and never rewritten (FR-003,
the edge cases). Fields later features own exist now at defaults (FR-005),
so A3-01, A4-01, A4-03 and A5-01 change values, not shape.

**Alternatives.** No version: a future field rename becomes a silent
misread. A migration chain: not needed until a field changes meaning; the
version makes that day detectable.

## 5. Smaller decisions

- **Listing** reads every `projects/*/project.json`; an unreadable or
  invalid record is skipped and logged with its folder name, never shown as
  a broken entry.
- **Delete** removes `projects/<id>/` and `out/<id>/` with `fs.rm`
  (`recursive`, `force`); each failure is reported by folder in the
  result so the interface can say what remained.
- **Rename** trims the name, refuses empty or over 120 characters, and
  writes only `name` and `modified` (SC-002).
- **The feed key** is validated as `^[a-z0-9][a-z0-9-]{0,63}$`; mode as
  `^[a-z]{1,16}$` (default `all`); agency as free text up to 120 characters
  or empty. The engine's registry validates them for real later (A2-01,
  A2-02).
- **Times** are ISO 8601 strings in UTC.
