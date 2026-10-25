# Research: The record session

The code these decisions rest on is in the spec's "Why", re-checked at a3c775d. Part numbers are FR-017's issues: part 1 is #489, part 2 #490, part 3 #491, part 4 #492.

## R1. Main already serialises its writers; what is missing is elsewhere (part 1)

- **Finding:** `ProjectStore.#serial(id, work)` (`src/main/projects.ts:238-251`) already chains every writer per project. Each writer runs inside it, reading the record as the one before left it, and changing its own fields. So two writes in main cannot overwrite each other's fields today. The review's "every writer replaces the whole record" is true of the file, and harmless: it is replaced inside the queue, from the latest read.
- **What is actually missing:**
  - (a) `drawn` is composed from the record at the write, not from what the run sent (R2).
  - (b) `get` (`projects.ts:519-522`) is outside the queue, so a read can answer before writes already in main have landed.
  - (c) A run reads its inputs from the renderer's copy, which can be behind both the store and the writes on their way. That is the reason for `writing`, `writingFrom`, `#taken`, `#current` and `#afterWrites`.
- **Decision:** "The record session" is `#serial`, extended:
  - `get` joins the queue;
  - writers accept the sent set (R2);
  - a run's inputs are read through a queued `get` (R3).

  No new store object, and no patch format: the writers already change only their own fields inside the queue. FR-005's "patch" is that behaviour, now stated, and pinned by a test where two writers race.
- **Alternatives considered:**
  - A separate session object with a patch log: the queue already gives the ordering, and a log adds a second source of truth.
  - Moving the whole run orchestration into main: out of scope (the spec's Assumptions).

## R2. The sent set and `drawn` (part 1)

- **Decision:**
  - `LayoutDone`, `RebuildDone` and the four redraws' payloads gain one field, `sent`: the layout, `made`, the day, the palette, the default colour, the line order, the style as sent and the lines as sent. That is exactly what `#draw` built its `map.build` from (`layoutRun.ts:1457-1510`). The stations stay where they are.
  - `drew` and `redrew` are replaced by one `drawnFromSent(sent, stations, theme)`. The theme comes from the record at the write, because no `map.build` carries it (the spec's edge case).
  - Each writer validates `sent` field by field with the validators the record already uses (`validatePalette`, `validateOrder`, `validateStyle`, `validateLines`, the date and layout checks). A refused field refuses the write, with the existing sentence for that field.
  - `completeLayout`'s `date: record.date ?? done.date` is replaced by the record's date left as it is, with `drawn.date` from `sent.date`. The record's own `date` is written only when the record had none, which is the first layout's anchor (ADR-031).
- **Rationale:**
  - The renderer built the request, so it is the one place that knows what was sent.
  - Main must still not trust it blindly, since the renderer is a less trusted process. That is why each field is validated as if it were a setter's argument.
- **Alternatives considered:**
  - Main re-deriving what was sent from the engine's answer: `map.build` answers with stations and the page path, not its inputs.
  - Main building the `map.build` itself: the orchestration move, out of scope.

## R3. A run's inputs, read after every write sent before the press (part 1)

- **Decision:** At its start, after `beforeStart` has flushed the debounced controls (the day; part 2 makes the cheap edits flush too), every run (layout, rebuild, Run all, and the four redraws) reads its record with `await api.projects.get(id)`, now queued (R1 b). It plans from that. `#taken`, `#current`, `#ahead`, `#held`, `writtenAfter`, `RecordWrite`, `#writes` and `#afterWrites` go, along with `writing`/`writingFrom` and their three callers in `useProjectState.ts`.
- **This rests on FR-008:** Electron delivers `ipcRenderer.invoke` messages from one frame to main in the order they were sent, and main's handlers reach `#serial` synchronously, with no `await` before it. Then a `get` sent after a write queues behind it.
  - **The test:** one Electron test sends N writes of increasing values interleaved with `get`s, under a busy main (a CPU spin in the main process, as the loop workflow's load does). It asserts that each `get` sees every write sent before it.
  - **Audit:** every `projects:*` handler in `src/main/ipc.ts:344-393`, for no `await` before the store call. The argument readers are synchronous today.
  - **If the test fails:** each write and each `get` carries a renderer sequence number, and the session holds a `get` until every lower number has arrived. Decided by the test, not by belief.
- **Rationale:** it replaces five mechanisms with one ordering property that a test can hold. The 388, 399 and 407 tests become its regression suite.
- **Alternatives considered:**
  - Keeping `#afterWrites` as a belt with braces: two ordering rules is what the spec is removing.
  - A dedicated `projects.beginRun(id)` call: it is the same as a queued `get`, plus one more channel.

## R4. The serialisers (part 1)

- **Decision:** The theme's `writeThrough` (`themeWrites.ts:44-56`), `ExportTab`'s writing/waiting/sent (`ExportTab.tsx:385-418`) and `LayoutTuning`'s in-flight counter (`LayoutTuning.tsx:75-105`) are each replaced by: send the write, and take the answer when it comes. Answers arrive in send order (R3), so the last answer is the last write.
  - A control that wants fewer writes (the theme under a quick double press) keeps a debounce, not a serialiser.
- **Rationale:** FR-009. Each serialiser existed to put answers back in order, and R3 makes that the bridge's property.

## R5. The cheap-edit hook (part 2, outline)

- **Decision:** `useCheapEdit({ delay, gesture?, draw, fields })` in `src/renderer/src/notebook/`. It owns:
  - the debounce, or Colours' follow-then-release;
  - the hold, `busy || settling`, asked of the run and the screen;
  - the put-back on a refused start (`refusedAtStart`);
  - adoption, skipping the hook's own `fields` while its own redraw runs;
  - flush on unmount, with a refusal sent to the project's status line through `context.ts`.

  `debounce.ts`, `panelRelease.ts` and `usePutBack.ts` fold into it.
- Tested by one rendered table per panel. Spec 038's DOM-layer spike decides the harness; until then, it uses the hand-built container pattern of `announcer-region.test.tsx`.

### Part 2 design (as built, issue 490)

- **The hook** is `useCheapEdit` in `src/renderer/src/notebook/useCheapEdit.ts`, taking the panel's own kind of run, its fields as the record holds them and by reference, a `same`, the redraw, a `delay`, `atOnce` for the colours' gesture rule, the screen's `held` and `busyNow`, and an `adopt` and a `putBack`; the line order adds a `refuse` for its bound. `panelRelease.ts` and `usePutBack.ts` stay as its internals (their pure tests stay in `panel-release.test.ts`); no panel imports them or `debounce.ts`, which `ServiceDay` and `Transport` still use. `colours.ts`'s own copy (`Unbuilt`, `released`, `retried`, `stopped`, `mayAdoptRecord`, `nextStep`) is gone. `order.ts`'s `nextStep`, `styleRules.ts`'s `nextStyleStep` and `lineOptions.ts`'s `nextLinesStep` are no longer called by a panel and were left in place, outside this part's files; their tests still hold them.
- **Adoption** skips a record while a change is waiting or under a hand, or while the panel's own redraw is running, by the snapshot the render saw. For the line options, "own" is now `optioned` alone, as their put-back already was; before, they also skipped during a colours redraw, which changes none of their fields.
- **The panel going.** A waiting change is tried at once with what the last render saw. If the way is not clear, the editor outlives its panel: asked again every `delay` with only the run's state and `busyNow` read as they are then, and once clear it reads the record and the engine's state through the bridge (`projects.get`, `engine.state`), compares the change with that record and draws it over it. The value is the panel's whole palette, order, style or lines, so two editors of one kind must never hold one: a panel of the same kind that mounts for the run takes the orphan's change over (`orphans`, keyed by run and the panel's `own`), shows it and holds it as its own. The orphan listens to the run and drops its change on a stop of its own kind (`stoppedNow`), as a mounted panel does. A start refused after the panel went, which no render will see, is kept by the run (`sayRefusedGone`) for as long as the run's snapshot stands, read by `useProjectState` as `refused`, and said by the header after the cell's failure. The first review of the lane found the version that drew from the last render's record and engine, blind, and did none of the three; each is a row of the table now.
- **A read that fails after the panel went:** a project that is gone ("not found" from the store) ends the change quietly; any other refusal, of the record or of the engine's state, leaves it waiting, asked again after the delay. The status line's sentence for a refused flush is forgotten at the run's first move, since Run all with nothing to run puts back the very snapshot it started from.
- **Known and left (the coordinator's review, 24 Oct 2026):**
  - A panel that comes back while an orphan's own redraw is going can undo it: the orphan has handed its change to that redraw and holds nothing to give over, and the new panel shows the record until the redraw's read-back, so a change made on it in that window is drawn over the orphan's. Out of scope here.
  - React StrictMode's simulated unmount, in development only, can draw a taken-over change at once rather than after the delay. Nothing is lost.
- **Not done:** the cheap edits do not listen to `beforeStart` (R3 said "part 2 makes the cheap edits flush too"). A cheap edit's flush is a draw, and a draw started from inside another run's press would be overwritten by that run's own start; the change waits for the run and is drawn after it, as before.
- **Tests:** `tests/unit/cheap-edit.test.tsx` renders each panel through its cell (`LinesCell`, `StyleCell`) with React's client into a hand-built stand-in document, the leaves stood in for, and runs one table per panel: the wait, the hold (the read-back, a run, an export), the put-back (refused start, a stop and a record after it, another kind's stop), adoption, and the flush (at once, held, refused). Every row was watched failing under a named mutation of the hook, or of the panel or cell for R7-02 and the settling hand-over. The line order's bound, met by a change after its panel went, drops it without a word, since no panel is there to say it.

## R6. The invariants in main (part 3, outline)

- **Decision:** a small `ProjectActivity` in main records which projects have:
  - an engine request in flight that names them, keyed off the params' `key` and the project's `out` folder in `engine-ipc.ts`'s allowlist path;
  - an export running (`Exporter`).

  `Exporter.start` and `ProjectStore.delete` consult it. The refusal sentences are the spec's User Story 4.

## R7. The split of `shared/project.ts` (part 4, outline)

- **Decision:** `shared/project/` holds:
  - `types.ts`;
  - `validate.ts`, shared;
  - `sentences.ts`;
  - `helpers.ts`, shared.

  `main/record/parse.ts` and `main/record/drawn.ts` are main only. The renderer-only helpers go to `renderer/src/record.ts`. `shared/project.ts` becomes a re-export for one release, and is then removed. The import-graph test reads every `import` under `src/` and refuses a crossing.

## What a person sees change (all parts)

- `drawn` is truthful, so cell 03 can say "not drawn for this day yet" after a day chosen during a layout. Today it says nothing, wrongly.
- The three refusals in main (part 3).
- The panels agree on Rule 1 (flush) and Rule 2 (no adoption of their own fields during their own redraw) (part 2).
