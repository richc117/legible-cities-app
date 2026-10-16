# ADR-056: A record keeps the keys it does not know

- **Status:** Accepted
- **Date:** 2026-10-16
- **Supersedes:** none
- **Superseded by:** none

## Context

Fourteen optional fields have been added to the project record since v0.1.0 without moving `RECORD_VERSION`, which moved once, from 1 to 2 (issue 350, ADR-049). The rule that let them in is the run graph's "Adding a field" (`specs/028-the-notebook/contracts/run-graph.md`), and its third criterion said an older build that writes the record loses only what a person would not notice, because "every writer reads the record and writes it whole, so an older build drops a field it does not know".

The codebase review of 15 Oct 2026 (R6-01) found that the criterion does not hold between two version-2 builds. The released build, v0.1.0, holds version 1 and reads a version-2 record as read-only, so nothing is lost today. Two version-2 builds that know different fields are not read-only to each other: the older one drops `lines`, `tuning`, `laidOutWith` and any style key it does not know, gives up the whole export choice for the reel over one key it does not know, and every writer but `markOpened` writes that loss to disk on its next write. A line's name is typed by a person, which the criterion itself says is not acceptable to lose.

`markOpened` already did otherwise. Its review (A5.6-04) found that writing the parsed record back would turn an export choice, a colour or an unknown field into its default because a person had looked at a project, so it writes `opened` onto the file as stored. Issue 425 asked for that rule made general, and the maintainer took it on 16 Oct 2026: keep unknown keys on parse, merge them back on write. It has to land before the first release that carries record version 2.

## Options

**(a) Move `RECORD_VERSION` for every field.** Every existing project becomes read-only in every older build, for a field whose absence the older build reads correctly. The run graph's contract already argues against this, and nothing about R6-01 changes the argument.

**(b) Keep the criterion and admit only fields an older build may drop.** That freezes the record for anything a person chooses. `lines` and `tuning` are already in it, and a build that drops them exists on `main`.

**(c) Keep unknown keys on parse and put them back on write.** Three ways to carry them:

- *(c1) A bag on the record*, a `_unknown` field on `ProjectRecord`. Every `{ ...record }` copies it, so every way out of the main process - the bridge's answers, the export's plan, the summaries - has to remember to strip it, and a record can be built with one by accident.
- *(c2) Every writer writes onto the raw file*, as `markOpened` does. A writer that removes a known key (a tuning reset, a line reset) must also remove it from the raw file or the old value comes back, so every writer needs the list of known keys anyway, and a known field this build cannot read would come back beside the writer's own reading of it.
- *(c3) A second answer from the parser*: the record as before, and beside it an opaque holder of what the file held that this build does not read, put back by one function at the one write.

## Decision

(c), carried as (c3). `parseRecord` answers `{ record, readOnly, carried }`. `Carried` (`src/shared/project.ts`) holds every key the parser does not read, at the top level and inside every object it rebuilds from the keys it knows: the style, the export choice and its options, the tuning and `laidOutWith`, each line's options and its casing, `service`, `built`, `drawn` with its style, its lines and each of its stations. A key is known where the reader reads it, by the reader's own list - the record's twenty-five fields and the blocks' named by their types, so a field added to a type and not to the list is a type error; the style's, the tuning's and a line's by `STYLE_GROUP`, `TUNING_FIELDS` and `LINE_FIELDS`; the export choice's by the list its validator takes. A key with a known field's name is that field's, valid or not, and is never carried. A key named `__proto__` is the one key not carried at all, because a plain object cannot be given it by assignment. Every writer in the store passes what it read to `#save`, which writes `carried.onto(record, renewed)`: the writer's record, and each carried key back in the object it was found in. `writeAtomic` takes no `ProjectRecord`, so the record cannot be handed to it as it stands, though a spread of it could be; what holds every writer to `#save` is the test over every member of the store, below. Two readers change with it: a stored export choice is judged without its unknown keys, and a casing with a third key keeps its width and colour. `markOpened` keeps its own stricter rule. `RECORD_VERSION` does not move.

**One exception: a fact a writer renews.** `drawn`, `service`, `built` and `laidOutWith` (`RECORD_FACTS`) record a draw or an answer from the engine, not a choice. A writer that records a new one - every draw for `drawn`, a layout run for all four - names it, and nothing from the old block is carried into the new one. A key a later build kept in `drawn` says what that map was drawn with; this build's draw did not send it, and carrying it would say the new map carries what it does not.

**Why (c3).** The record type has no slot for a carried key, so no record built anywhere can hold one. The holder's keys are private fields: a spread of it adds nothing, and the bridge's structured clone of it is `{}`. They come out in one place, `onto`, whose only caller is the write. That keeps the validation that exists for a reason where it was. A carried key is never interpreted - not validated, compared, drawn or sent - and the bridge's shape is still the known fields: `get`, the summaries and every writer's answer are built from the record, and an export plans from `get`.

## Consequences

**A record a later build wrote comes back field for field** after any writer of this one, except inside a fact the writer renews. `tests/unit/record-carries.test.ts` holds it: a record with a key this build does not know at every depth above, through every writer in a table with the facts each renews, and a test that fails while any member of the store is neither a row nor named as a member that writes no record it read. A writer outside the store would not be seen; none exists, and records are written only by `ProjectStore`.

**The bridge shows the renderer none of it.** The same test drives every project channel against that record, through the real handlers and a real store, and scans each answer as structured clone would send it.

**A carried key is carried blind.** It can disagree with the known fields beside it after an edit here: an export option a later build allows for one preset survives a change of preset. The build that knows the key reads it, and is the one to judge it, as it judges anything in the file.

**A fact goes inside its block.** A field that describes a draw or an engine's answer belongs inside `drawn`, `service`, `built` or `laidOutWith`, where it is renewed with the fact. One put beside the block is carried past the renewal and goes on describing the old fact. The run graph's rule now says so.

**A known field's value this build cannot read is still lost on write.** A third theme, a preset this build does not offer, or a label it refuses is read by its field's own rule and written as read. Carrying cannot help here, because the key is known. That case is a field whose meaning changed, which is what moves `RECORD_VERSION`.

**A reset keeps what it cannot see.** A tuning or a line reset here removes this build's key, and an object holding only the later build's keys is written in its place, which this build reads as nothing set.

**A carried value is held, never copied.** The carry keeps a reference to the value in the JSON the store has just parsed, which nothing else holds. A copy at parse would recurse into a value of any depth, on every listing. `structuredClone` overflows the stack at a few thousand levels; `JSON.parse` takes 200,000. A record holding a value that deep therefore reads and lists, and counts when a reset asks where projects export. Its write fails: the store writes the record indented, and the indented `JSON.stringify` recurses where the parser did not. The failure happens inside the write, before anything touches the disk, so it is reported as "the project could not be saved" and the file stays as it was. Writing compact would break the record's format, and rewriting the value would be reading it.

**The parser answers for any input and never throws.** A record it cannot read whole, what it carries included, is an error like a file that is not JSON: the store skips it and names it in the log. One file never rejects a list of every project or refuses a reset, and a record whose carry failed is never written back without it.

**Every parse walks the record twice.** The second walk is the carry's. On the largest record the reader admits, 20,000 stations in `drawn`, it is about 0.7 ms of a 1.9 ms parse on an Apple-silicon Mac, once per project per listing.

**Builds before this one still drop what they do not know.** No release holds one at version 2. The first release that carries version 2 carries this rule as well.
