# Accessibility pass

Principle VI of the constitution, checked over every screen of the app.
The pass was taken over the tab strip (issue A6-07, 2026-09-13) and
rebuilt for the notebook that replaced it (A5.6-09, 2026-09-28; ADR-045).
This is the record of the **machine half**: keyboard reach, labels,
visible focus, reduced motion and contrast, checked in code and in an
end-to-end sweep, with the small defects fixed. The **person's half** -
every screen with VoiceOver on macOS and Narrator on Windows - is a
person's, recorded in [Reader runs](#reader-runs).

| | |
|---|---|
| App version | `0.1.0` (`package.json`), the rebuild branched from `main` at `e019cce` |
| Engine pin | as `vendor/pins.json` at that commit (v0.8.3) |
| Date | 2026-09-13 (the pass), 2026-09-28 (the rebuild) |
| Themes | the interface's two, Night (the default) and Parchment (ADR-044); a project's map has its own, Warm dark and Sepia, which the interface's does not follow |

## Method

1. **Code audit.** Every component under `src/renderer/src/`, control by
   control: a role and an accessible name; reachable by Tab in a sensible
   order and operable from the keyboard; a focus indicator that is a ring
   and not only a colour; state announced (`aria-pressed`, `aria-expanded`,
   `aria-selected`, `aria-busy`, live regions where something changes
   without focus moving); focus kept somewhere when a control goes; every
   transition and animation off under `prefers-reduced-motion: reduce`. The
   kit's own stylesheet (FigUI3's MIT core) and `react-colorful`'s were read
   for what they draw at rest, on focus and in motion.
2. **End-to-end sweep**, `tests/e2e/accessibility.spec.ts` and, since
   A5.5-08, `tests/e2e/notebook-a11y.spec.ts`, which took every check over a
   project's own screen when that screen became a notebook of six cells
   (ADR-045); the machinery both use is `tests/support/a11y.ts`. **Since
   A5.6-09 every sweep runs twice**, once in each of the interface's
   themes (Night, then Parchment, chosen by the emulated colour scheme
   and asserted to have taken effect), so a ring or a control only one
   theme draws cannot hide. Against the
   stand-in engine: for each screen and each dialog, every control in the
   accessibility tree has a name (`ariaSnapshot()`), and nothing in it has
   the name of something it is inside (#208, below); a Tab walk from the
   top reaches every enabled control and each shows a ring it did not have
   at rest; with reduced motion emulated, and the emulation asserted to
   take effect, no element or open shadow root has a running animation or
   a transition that lasts, and no native button holds more than its box
   (`expectButtonsHoldTheirBox`, issue 273: the text of a row hanging
   below its fill is content taller than the button). It also asserts each fix below where a person
   meets it. **Its first runs** (macOS, 2026-09-13, by the coordinator, not
   by the lane that wrote it) passed every screen's names, walk and motion
   checks; the removed feed's focus (D5) and the one-control dialog's walk
   failed and were changed; a later full run after those changes passed
   (119 passed, 2 skipped). The confirmation's busy state (D8) was changed
   again after that run, and its two slow tests passed in the full runs that
   followed (macOS, 2026-09-13). Where a defect below says "asserted in the
   sweep", those green runs covered it. The sweep searches the
   light tree: of the kit's elements in use, a button is counted by its
   host and a select's and text field's focusable parts are ordinary
   children, so no kit control focusable only inside a shadow root is on
   screen, and one added later would be outside it.

   **A name said twice, nested** (#208) is read from the same snapshot,
   which a sweep takes once and hands to both checks of it, over every
   role and not only the controls: a node whose name is the
   name of one of its ancestors is a finding, as the engine log's box of
   lines was inside the region of the same name. Three things are not. A
   `heading`, because a section named by its own heading is the correct
   pattern and every dialog and every section of Settings is one. An
   ancestor of a role that takes its name from what it holds, because a
   cell's row is a heading around its toggle and says the toggle's words.
   Those roles are eighteen and the list is Playwright's own, since it is
   Playwright that computes the names: `button`, `cell`, `checkbox`,
   `columnheader`, `gridcell`, `heading`, `link`, `menuitem`,
   `menuitemcheckbox`, `menuitemradio`, `option`, `radio`, `row`,
   `rowheader`, `switch`, `tab`, `tooltip` and `treeitem`; a unit test
   holds it to the list in the installed version. And the pairs listed in
   `tests/support/a11y-names.ts`, each one name under two roles, decided
   with a run of the sweep in hand and naming the issue that decided it.
   The rule is a function of the snapshot's text and is tested without the
   app (`tests/unit/a11y-names.test.ts`); a line of the snapshot it cannot
   read fails the sweep rather than being stepped over. It is the sweep's
   one soft check: a repeated name stops nothing after it, so the test
   carries on and one run lists every screen's pairs, with the snapshot
   they were read from attached to the test as a file. With a known pair
   in place a sweep is green whether the rule reads the tree or has
   stopped, so `notebook-a11y.spec.ts` also asks the rule with no known
   pair at all, over the project once an export has finished, and expects
   the one pair that screen holds. **Its first run**
   (macOS, 2026-09-29, by the coordinator, not by the lane that wrote it) went
   over every swept screen and dialog in Night and in Parchment, read
   every line of every snapshot, and found one pair: in cell 06, once an
   export has run, a region named "Export" around a button named
   "Export". It is a real duplicate and not a false positive. It is not
   mended yet, because renaming the region changes an accessible name the
   release gate's documents follow; it is carried as a known pair under
   issue 258, and the entry goes when that issue closes.
3. **Contrast** is arithmetic, not a screenshot: `tests/unit/contrast.test.ts`
   recomputes every text and control pair the stylesheets use, in both
   themes, now including the kit's filled buttons at rest, under the
   pointer and pressed, and the resting edges and placeholder those pairs
   assume. Text 4.5, controls and their boundaries 3.0 (WCAG 2.2 AA).

Out of scope, and why: the engine's animation page inside the viewer's
frame, and its SVG in the geographic pane, are the engine's (principle I);
what the app can see of them is in the Viewer and Geographic view rows, and
the rest is finding F1. The platform's own popups - the native select's
list and the date control's calendar - render in the platform's style
(ADR-026) and were not measured.

**Legend.** *pass*: nothing found. *swept*: the end-to-end sweep checks
it (names, and that none is repeated inside the element it names, the Tab
walk and its ring, motion), in both themes. *fixed
(Dn/Cn)*: a defect this pass fixed, listed below. *finding (Fn)*: a defect too large for this pass,
listed below for filing. *engine's*: inside the engine's page.

## Results by screen

Rebuilt for the notebook (A5.6-09, ADR-045): the front door, the project's
header, rail, map, six cells and footer, and the screens around
them. A part that moved into a cell from the tab strip keeps the result the
pass gave it, since the component is the one that was audited, and is swept
again where it now stands. A part that is new since the pass says what the
sweep checks of it; **swept** means the end-to-end sweep checks its names,
its Tab walk and focus ring, and its motion, in both of the interface's
themes. Contrast is `tests/unit/contrast.test.ts`, by token pair.

The two reader columns are a person's, recorded per run in
[Reader runs](#reader-runs).

### Header, on every screen

- **Back to Library.** On a project and in Settings, Tab from the engine's
  status line: the next button is "Back to Library" (it reads "Library" on
  screen), then the Jobs toggle, then Settings. It is not on the Library.
  Press it: focus lands on the Library's own heading (issue 275).
| Part | Keyboard | Labels | Focus visible | Reduced motion | Contrast (Night) | Contrast (Parchment) | VoiceOver (macOS) | Narrator (Windows) |
|---|---|---|---|---|---|---|---|---|
| Jobs toggle, Settings | pass | pass | pass | pass | pass | pass | not yet run: a person's | not yet run: a person's |
| Engine status line | pass (not a control) | pass (`role="status"`, named "Engine") | n/a | pass (the icon never moves) | pass | pass | not yet run: a person's | not yet run: a person's |
| Job-end announcement | n/a | pass (polite, visually hidden) | n/a | n/a | n/a | n/a | not yet run: a person's | not yet run: a person's |

### The front door (Library)

| Part | Keyboard | Labels | Focus visible | Reduced motion | Contrast (Night) | Contrast (Parchment) | VoiceOver (macOS) | Narrator (Windows) |
|---|---|---|---|---|---|---|---|---|
| Heading and New project | swept | swept | swept | swept | pass | fixed (C1) | not yet run: a person's | not yet run: a person's |
| Empty state | fixed (D4) | swept | swept | swept | fixed (C6) | fixed (C1, C6) | not yet run: a person's | not yet run: a person's |
| Your projects: one button a row, `Open <name>`, the meta (feed, day, opened, how far it has got) its description (A5.6-04) | swept | swept | swept | swept | pass (`--text`, `--text-muted`; `--text-muted` on `--surface-hover` under the pointer) | pass | not yet run: a person's | not yet run: a person's |
| Sample cities: one button a card, named by its facts (A5.6-02); one press opens it laying out (A5.6-03) | swept | swept | swept | swept | pass (the same pairs) | pass | not yet run: a person's | not yet run: a person's |
| Your feeds: Start a project, Remove (A5.6-06) | fixed (D5) | swept (each names its feed) | swept | swept | pass | pass | not yet run: a person's | not yet run: a person's |
| New project sheet, a listed feed (A5.6-05) | swept | swept | swept | swept | pass (the dialog's pairs, the kit's controls) | fixed (C1) | not yet run: a person's | not yet run: a person's |
| New project sheet, a zip chosen | swept | swept | swept | swept | pass | fixed (C1) | not yet run: a person's | not yet run: a person's |
| New project sheet, an address refused | swept | swept (the alert, the field invalid) | swept | swept | pass (`--error` on `--surface-raised`) | pass | not yet run: a person's | not yet run: a person's |
| New project sheet, its add running: the progress line and Cancel the add | swept (held open by the stand-in's `add_delay_ms`; Cancel the add takes focus) | swept | swept | swept | pass | fixed (C1) | not yet run: a person's | not yet run: a person's |
| Remove-feed confirmation, and a refusal naming the projects (A5.6-06) | fixed (D8) | swept idle; the refusal is an alert naming the projects, asserted in `feeds.spec.ts` and not swept | swept idle | swept idle | pass | pass | not yet run: a person's | not yet run: a person's |

### Project: the header

| Part | Keyboard | Labels | Focus visible | Reduced motion | Contrast (Night) | Contrast (Parchment) | VoiceOver (macOS) | Narrator (Windows) |
|---|---|---|---|---|---|---|---|---|
| The project's name as the `h1`, no breadcrumb around it (A5.5-22, issue 275; the way back is in the header, below) | swept | swept | swept | swept | pass (`--text`) | pass | not yet run: a person's | not yet run: a person's |
| The notebook's sentence, Run all and Stop | Run all's handover to Stop and back, and focus to the sentence when Run all does not come back, asserted in `layout.spec.ts` ("Run all…" tests); not swept, since every sweep is of a project already drawn, where Run all is not drawn, and Stop exists only during a run | swept (the sentence one `role="status"`, and beside it a hidden `role="alert"` that holds the failure, if there is one, and is empty otherwise; Run all's name) | Run all and Stop not swept: audit only (the kit button's ring) | audit only | pass (`--text`; the primary button C1) | fixed (C1) | not yet run: a person's | not yet run: a person's |
| Read-only notice | n/a | pass (`role="status"`) | n/a | n/a | pass | pass | not yet run: a person's | not yet run: a person's |

### Project: the rail

| Part | Keyboard | Labels | Focus visible | Reduced motion | Contrast (Night) | Contrast (Parchment) | VoiceOver (macOS) | Narrator (Windows) |
|---|---|---|---|---|---|---|---|---|
| Steps: six buttons, each "`<nn> <name>`, `<state>`", `aria-current="step"` following the scroll (A5.5-21) | swept; **a step moves focus on activation**, to its cell's heading, landing it clear of the header, the only thing pinned since ADR-046, with no smooth scroll under reduced motion (`rail.spec.ts`) | swept (a `<nav>` "Steps" under an `h2` of the project's name, issue 274; the state an icon and a word, never a colour alone) | swept | swept | pass (the state words on `--surface`, and on `--surface-hover` and `--surface-selected` the warning and error words fall back to `--text-muted`; a running step's `--accent-text` on `--surface-selected` and on `--surface-hover`, both added to the contrast test by A5.6-09) | pass (the same) | not yet run: a person's | not yet run: a person's |
| Outputs: a row per export, Reveal named "Reveal `<preset>`, `<file>`", a sentence for a file moved or deleted | swept (focus to the Outputs heading when a pressed Reveal goes) | swept (a region "Outputs") | swept | swept | pass (`--text`, `--text-muted`, the warning icon with its words) | pass | not yet run: a person's | not yet run: a person's |
| Below 900px | audit only: the rail keeps its names and clips them, and is `inert` while the inspector covers the main region | audit only | audit only | audit only | pass | pass | not yet run: a person's | not yet run: a person's |

### Project: the map, and cell 06's preview

| Part | Keyboard | Labels | Focus visible | Reduced motion | Contrast (Night) | Contrast (Parchment) | VoiceOver (macOS) | Narrator (Windows) |
|---|---|---|---|---|---|---|---|---|
| Skip past the map | fixed (F3, issue 106: one Tab before the frame, sends focus to cell 03's heading, the first thing after the map since ADR-046; asserted in `notebook-a11y.spec.ts`, "the project screen: one press skips past the map to cell 03…", with forty controls in the frame) | swept (a native button named by its text) | swept (a `--surface` halo under the ring, over the map) | swept | pass (`--focus` on `--surface`) | pass | not yet run: a person's | not yet run: a person's |
| The map's frame, in the column after cell 02 (ADR-046) | the walk steps over the frame rather than through it (below) | pass (the frame's title: "`<project>`, animated") | engine's (F1) | engine's (F1) | engine's (F1) | engine's (F1) | not yet run: a person's | not yet run: a person's |
| The map's block before there is a map | swept (a link-styled button "Lay it out in cell 02." that moves focus to cell 02's heading; none on a read-only project) | pass (a `role="status"` region, always in the document, so "The map is drawn." is announced when it arrives) | swept | swept | pass (`--text-muted` on `--surface-sunken`) | pass | not yet run: a person's | not yet run: a person's |
| Cell 06's preview frame, while the cell is open (ADR-046) | takes no Tab stop: the engine's planned page has no controls (measured with a page the pinned engine wrote: none; `notebook-a11y.spec.ts` walks it and asserts fewer than five and that focus comes out), so it has no skip of its own | pass (the frame's title: "`<project>`, as the export will frame it"; a caption with the ratio and size) | n/a | engine's (F1) | engine's (F1) | engine's (F1) | not yet run: a person's | not yet run: a person's |
| A control scrolled behind the band | no longer reachable (#213): since ADR-046 the map is in the column's flow and only the header is pinned | n/a | n/a | n/a | n/a | n/a | n/a | n/a |

### Project: the cells' rows

| Part | Keyboard | Labels | Focus visible | Reduced motion | Contrast (Night) | Contrast (Parchment) | VoiceOver (macOS) | Narrator (Windows) |
|---|---|---|---|---|---|---|---|---|
| Six rows, each a plain `<button>` inside an `h2` over a named group: "`<nn> <name>` `<state>`", and the collapsed row's summary; a chevron before the number (issue 279), `aria-hidden` and so not in the name, which turns a quarter when the cell opens, with a transition only where motion is allowed | swept, with every cell open and with every cell closed | swept; the heading outline asserted (six `h2`, one a cell, nothing skipping a level); **`aria-controls` resolves** (below, #121) | swept | swept | pass (the state words, as the rail's) | pass | not yet run: a person's | not yet run: a person's |
| The provenance footer of cells 02, 03 and 06 (A5.5-11) | n/a (no control) | swept (a `<dl>` of text; nothing announced as interactive) | n/a | n/a | pass (`--text-muted` on `--surface`) | pass | not yet run: a person's | not yet run: a person's |

### Cell 01, Data

| Part | Keyboard | Labels | Focus visible | Reduced motion | Contrast (Night) | Contrast (Parchment) | VoiceOver (macOS) | Narrator (Windows) |
|---|---|---|---|---|---|---|---|---|
| Fields | n/a | pass (a definition list) | n/a | n/a | pass | pass | not yet run: a person's | not yet run: a person's |
| In the feed: mode, operator, the feed's entry | fixed (D7, D12) | pass | pass | pass | fixed (C2) | fixed (C1, C2) | not yet run: a person's | not yet run: a person's |
| In the feed: the two tables | pass | pass (captions, `th scope`, `aria-sort`) | pass | pass | pass | pass | not yet run: a person's | not yet run: a person's |
| In the feed: sortable headers | fixed (D11) | pass | pass | pass | pass | pass | not yet run: a person's | not yet run: a person's |
| The feed's download (issue 178) | swept while it downloads (`notebook-a11y.spec.ts`, "a sample's download…"); no control of its own: the header's Stop and cell 02's Cancel stop it | swept (a region "Download"; the byte count a polite `role="status"`); a refusal's `role="alert"` asserted in `layout.spec.ts` | n/a | swept | pass (the progress line's pairs; `--text-muted` on `--surface`) | pass | not yet run: a person's | not yet run: a person's |
| Where the routes run | pass (`+`, `-`, arrows, `0`) | pass (pane named, the counts); finding (F2, #105) | pass | pass | pass | fixed (C1) | not yet run: a person's | not yet run: a person's |

### Cell 02, Process

| Part | Keyboard | Labels | Focus visible | Reduced motion | Contrast (Night) | Contrast (Parchment) | VoiceOver (macOS) | Narrator (Windows) |
|---|---|---|---|---|---|---|---|---|
| The layout run and its progress line | fixed (D1) | pass | pass | pass (the marks' transitions off) | pass | fixed (C1) | not yet run: a person's | not yet run: a person's |
| Re-layout warning | fixed (D1, D8) | pass | pass | pass | pass | fixed (C1) | not yet run: a person's | not yet run: a person's |
| Engine log: a closed disclosure, the box of lines, Copy log (A5.5-13) | swept, open and closed (the box `tabindex="0"`, scrolled by its own `scrollTop`) | swept (the disclosure "The engine's log for this run" and the box "Log lines" named apart; a unit test refuses two elements in the panel sharing a name) | swept | swept | pass (`--text`, `--text-muted` on `--surface-sunken`) | pass | not yet run: a person's | not yet run: a person's |
| What the build had to fudge | fixed (D9) | pass | pass | pass (the tooltip's fade off) | pass | pass | not yet run: a person's | not yet run: a person's |

### Cell 03, Frame and service day

| Part | Keyboard | Labels | Focus visible | Reduced motion | Contrast (Night) | Contrast (Parchment) | VoiceOver (macOS) | Narrator (Windows) |
|---|---|---|---|---|---|---|---|---|
| Service day and date control | fixed (D3) | pass | pass | pass | fixed (C4) | fixed (C1, C4) | not yet run: a person's | not yet run: a person's |
| Revert, while a chosen day is not drawn (A5.5-12) | goes with its own press, focus to the date control holding the day; a refusal to the form's alert and focus to the control | pass (named with its day, "Revert to `<day>`") | pass | pass | pass | fixed (C1) | not yet run: a person's | not yet run: a person's |
| Transport: Time of day, Play day and Pause, Speed (A5.5-16) | swept on a page that answers what day it has (`notebook-a11y.spec.ts`, "cell 03's transport…"); refused with an alert rather than disabled while a run, an export or the export's preview holds the page | swept (a region named by its `h3`, "Transport"; the range's `aria-valuetext` the page's clock) | swept | swept | pass (`--text`, the range's `--accent`) | pass | not yet run: a person's | not yet run: a person's |

### Cell 04, Style

| Part | Keyboard | Labels | Focus visible | Reduced motion | Contrast (Night) | Contrast (Parchment) | VoiceOver (macOS) | Narrator (Windows) |
|---|---|---|---|---|---|---|---|---|
| Theme switch | pass | fixed (issue 124: `aria-pressed`, a named group; asserted in `theme.spec.ts`) | pass | pass | pass | fixed (C1) | not yet run: a person's | not yet run: a person's |

### Cell 05, Lines

| Part | Keyboard | Labels | Focus visible | Reduced motion | Contrast (Night) | Contrast (Parchment) | VoiceOver (macOS) | Narrator (Windows) |
|---|---|---|---|---|---|---|---|---|
| Line colours | pass | pass (every control names its line) | pass | pass | pass | fixed (C1) | not yet run: a person's | not yet run: a person's |
| Colour picker | pass (sliders take the arrows; hex field) | pass; the chip controls its panel, an auto popover, by `aria-controls` and `popovertarget` (F6, issue 284) | fixed (D10) | pass | pass | fixed (C1) | not yet run: a person's | not yet run: a person's |
| Line order, and its drag (issue 283) | pass (the arrows are every move the grip makes; the grip takes no focus) | pass (the arrows keep "Move line `<label>` up" and "down" and carry them as tooltips on hover and focus, which Escape dismisses; the grip is `aria-hidden` and has no name; asserted in `order.spec.ts`) | pass | pass (the rows the carried line passes step aside with no transition; the drag still works) | pass | pass | not yet run: a person's | not yet run: a person's |

### Cell 06, Export

| Part | Keyboard | Labels | Focus visible | Reduced motion | Contrast (Night) | Contrast (Parchment) | VoiceOver (macOS) | Narrator (Windows) |
|---|---|---|---|---|---|---|---|---|
| Preset, storyboard, view, quality | pass | pass | pass | pass | fixed (C2) | fixed (C2) | not yet run: a person's | not yet run: a person's |
| Frame switches, lines to keep | pass | pass (`fieldset` and `legend`) | pass | pass | fixed (C3) | fixed (C3) | not yet run: a person's | not yet run: a person's |
| Start time, filename tag | pass | pass | pass | pass | fixed (C5) | fixed (C5) | not yet run: a person's | not yet run: a person's |
| Where it goes: Choose folder, and Use the app's folder once a folder is chosen (A5.5-19) | Choose folder swept; Use the app's folder not swept (it is drawn only once a folder is chosen, which no sweep does) | Choose folder swept (the sentence its description); "Where it goes" is a label's text, not a field | Choose folder swept | Choose folder swept | pass | fixed (C1) | not yet run: a person's | not yet run: a person's |
| Export, its progress line, Cancel, Reveal | fixed (D2) | pass | pass | pass | pass | fixed (C1) | not yet run: a person's | not yet run: a person's |

### Project: the footer

| Part | Keyboard | Labels | Focus visible | Reduced motion | Contrast (Night) | Contrast (Parchment) | VoiceOver (macOS) | Narrator (Windows) |
|---|---|---|---|---|---|---|---|---|
| Created and Modified | n/a | pass (a definition list) | n/a | n/a | pass | pass | not yet run: a person's | not yet run: a person's |
| Rename form | pass (focus returns to Rename) | pass | pass | pass | pass | fixed (C1) | not yet run: a person's | not yet run: a person's |
| Delete confirmation | fixed (D8) | pass | pass | pass | pass | pass | not yet run: a person's | not yet run: a person's |

### Settings

| Part | Keyboard | Labels | Focus visible | Reduced motion | Contrast (Night) | Contrast (Parchment) | VoiceOver (macOS) | Narrator (Windows) |
|---|---|---|---|---|---|---|---|---|
| Folder rows | fixed (D6) | pass (each names its folder) | pass | pass | pass | pass | not yet run: a person's | not yet run: a person's |
| Logs, Copy diagnostics | pass | pass | pass | pass | pass | pass | not yet run: a person's | not yet run: a person's |
| Theme select | pass | pass | pass | pass | fixed (C2) | fixed (C2) | not yet run: a person's | not yet run: a person's |
| Versions | n/a | pass (a definition list; a null said in words) | n/a | n/a | pass | pass | not yet run: a person's | not yet run: a person's |
| Reset engine data and its confirmation | fixed (D8) | pass | pass | pass | pass | pass | not yet run: a person's | not yet run: a person's |
| Licences section (issue 108) | swept (three buttons `aria-disabled` in a development run, kept in the Tab order) | swept, and in `settings.spec.ts`; **fixed (F5, issue 113)**: each unavailable button's reason is its accessible description | swept | swept | pass | pass | not yet run: a person's | not yet run: a person's |
| Bundled tools rows (A6-02) | n/a (no control) | swept (a named region; the summary a polite `role="status"`; a definition list) | n/a | swept | pass | pass | not yet run: a person's | not yet run: a person's |

### Jobs inspector

| Part | Keyboard | Labels | Focus visible | Reduced motion | Contrast (Night) | Contrast (Parchment) | VoiceOver (macOS) | Narrator (Windows) |
|---|---|---|---|---|---|---|---|---|
| Toggle, heading, Close, Escape | pass; the toggle controls the Inspector while it is open (F6) | pass | pass | pass (no slide at any setting) | pass | pass | not yet run: a person's | not yet run: a person's |
| Jobs: progress line, Cancel, Copy log, Details | pass | pass (each names its job; the compact line has no labels, so the state line under the title names the stage and its place, "running collapse, 2 of 8", issue 278) | pass | pass | pass | pass | not yet run: a person's | not yet run: a person's |
| Below 900px, over the main region | audit only (the main region `inert`; not in the sweep) | audit only | audit only | audit only | pass | pass | not yet run: a person's | not yet run: a person's |

### First-run dialog (A6-02)

| Part | Keyboard | Labels | Focus visible | Reduced motion | Contrast (Night) | Contrast (Parchment) | VoiceOver (macOS) | Narrator (Windows) |
|---|---|---|---|---|---|---|---|---|
| The dialog: its details disclosure, Copy diagnostics, How to install, OK | swept: OK focused on opening, the Tab walk reaches the disclosure and the three buttons, Escape closes it | swept (labelled by its title, described by its sentences) | swept | swept | pass | pass (the primary button as C1) | not yet run: a person's | not yet run: a person's |
| Focus after it closes | asserted: back on the front door's heading; if what held focus when it opened has gone, the open screen's heading takes it | n/a | n/a | n/a | n/a | n/a | not yet run: a person's | not yet run: a person's |
| Waiting for another dialog | e2e (`first-run.spec.ts`): never over a dialog a person has open, or over the mismatch dialog | n/a | n/a | n/a | n/a | n/a | not yet run: a person's | not yet run: a person's |

### Mismatch dialog

| Part | Keyboard | Labels | Focus visible | Reduced motion | Contrast (Night) | Contrast (Parchment) | VoiceOver (macOS) | Narrator (Windows) |
|---|---|---|---|---|---|---|---|---|
| The dialog and OK | swept | swept | swept | swept | pass | fixed (C1) | not yet run: a person's | not yet run: a person's |

### Issue 121 in the notebook

#121 (F6 below) was closed on 2026-09-23 for the kit's buttons, whose
`aria-controls` is now an element reference on the button inside the
kit's shadow root. **The notebook does not have the problem by
construction**: a cell's row and the engine log's toggle are plain
`<button>` elements over a named group in the same document
(`kit/Disclosure.tsx`; a group rather than a region, so six cells do not
put six landmarks in a reader's menu),
so their `aria-controls` is an id that resolves. Measured rather than
assumed: `notebook-a11y.spec.ts` reads each relation from the built app's
accessibility tree through the DevTools protocol. Each open cell's row
controls the group named for it ("01 Data" to "05 Lines"); cell 06, which
starts closed, controls nothing until it opens and then "06 Export"; the
engine log's toggle controls "The engine's log for this run" once open.
A closed group is `hidden`, which takes it out of the tree, so a closed
disclosure's relation is honestly empty, and its `aria-expanded` says
which it is.

### What the sweep cannot see

- **The Tab walk steps over a frame** (A5.5-20). A document cannot see into
  a cross-origin frame, so the walk finds the first wanted control that
  follows the frame in document order and focuses it directly; **no press
  of Tab is made while focus is inside a frame**. The cost: the walk no
  longer proves that Tab crosses a frame's far edge. On the project screen
  that is one control, cell 01's row, still swept for its name and ring. A
  person's path is the documented one: "Skip past the map" is one Tab
  before the frame.
- **Occlusion by the pinned map** (#213): no longer reachable, since ADR-046 put the map in the column's flow and nothing is pinned but the header.
- **A name said twice, where the rule does not look** (#208). The engine
  log's nested name reached a pull request because `expectNamed` asks only
  whether a control has a name; the sweep now flags a node named as one of
  its ancestors is (Method, 2), and a unit test guards that panel. What it
  still cannot see: two siblings under one name, which are not nested; a
  name inside a closed disclosure, whose contents are `hidden` and out of
  the tree until a sweep opens it; a name longer than 900 characters,
  which Playwright's snapshot drops; and a repetition under an ancestor
  that is named by what it holds, which the rule allows by role. Two more
  are Playwright's. **A frame's title**: its snapshot gives every `iframe`
  an empty name, so a region around a frame of the same title is never
  seen as a pair. And **the roles it refuses a name** - `caption`, `code`,
  `definition`, `deletion`, `emphasis`, `generic`, `insertion`, `mark`,
  `paragraph`, `presentation`, `strong`, `subscript`, `suggestion`,
  `superscript`, `term` and `time` - so an `aria-label` on a `<p>`, a
  `<dd>` or a bare `<span>` never arrives, as either half of one. Both
  were read in `playwright-core` 1.63.0 (`toAriaNode` in its
  `ariaSnapshot.ts`, `elementProhibitsNaming` in its `roleUtils.ts`) and
  seen on a page in Chromium. The
  walkthrough is what catches those by ear. And one pair it found and no
  longer reports: the region named "Export" around the button named
  "Export" in cell 06 once an export has run, from the rule's first run
  (macOS, 2026-09-29), a known pair under issue 258 until it is mended. A known
  pair is matched by its two roles and its name on any screen, so while
  the entry stands a second region and button of that name would pass.
- **The engine's page** (F1) and **the geographic view's drawing** (F2).

## Defects fixed in this pass

Focus lost after an action. Chromium puts focus on the body when the
focused element is removed or disabled, so a keyboard or screen reader user
was thrown to the top of the document with nothing said.

- **D1. The layout run.** "Lay out" gives way to Cancel, Cancel to "Lay out
  again" when the run ends, and a confirmed re-layout closes its warning
  onto a Re-layout button the run has removed. The region remembers the
  element that last took focus in it; when that element can no longer hold
  focus (removed, in a closed dialog, disabled, not drawn) and focus has
  nowhere else to be, focus goes to the control that took its place,
  without scrolling. A press on prose forgets it, so a person who clicked
  away and scrolled to read is not pulled back when a run ends
  (`src/renderer/src/focusHandback.ts`, `LayoutRun.tsx`). Asserted in the sweep and in
  `tests/unit/focus-handback.test.ts`.
- **D2. The export.** The same for Export, Cancel and Reveal (`ExportRun.tsx`).
  Asserted in the sweep.
- **D3. The service day.** "Draw for this day" and the date control disable
  themselves for the rebuild; the section's heading takes focus first
  (`ServiceDay.tsx`). Asserted in the sweep. Since A5.5-15 the refusal
  under the control is also an `alert`: a day outside the window is refused
  as it is typed, with no focus move to carry it, because a focus move there
  shuts the platform's own calendar under the person's hand.
- **D4. A project made from the Library's empty state.** The button that
  opened the dialog goes with the empty state; focus lands on the new
  project's row (`Library.tsx`). Asserted in the sweep.
- **D5. A removed feed.** Its row takes its Remove with it; focus goes to the
  "Your feeds" heading while an added feed is left, or "Sample cities" once
  none is (A5.6-01), once the confirmation has closed and the list has been
  drawn, in either order, checked on every render and once more after the
  browser's next rendering update, since Chromium may move focus off the
  removed button only then (`Library.tsx`, `FeedList.tsx`). Asserted in the sweep.
- **D6. "Use the default" in Settings.** It goes once the folder is the
  default; focus goes to the row's "Choose folder" (`Settings.tsx`).
  Asserted in the sweep.
- **D7. "Use the feed's entry" in Inspect.** It goes once the choice is the
  entry's; focus goes to the mode it set (`Inspect.tsx`). Asserted in the sweep.
- **D8. A confirmation while its action runs.** The confirm button disabled
  itself, which inside a modal left focus nowhere, so a refusal's alert was
  heard with no control under the keyboard. Now, while the action runs, the
  dialog stays modal and takes nothing: both buttons keep their names and
  focus, say `aria-disabled`, refuse every press - a held Enter's repeats
  included - and are drawn unavailable; the first Escape is refused; and a
  status line in the dialog says what is running ("Removing Metro de
  Prueba… It cannot be stopped."). If the platform closes it anyway (a
  second Escape), its screen is told at once, a dialog opened again for
  another feed is not closed by the first removal finishing, and a refusal
  that arrives afterwards is said on the screen only while that screen is
  still open; the project screen's delete goes back to the Library only if
  the person is still on it (`ConfirmDialog.tsx`, `kit/Button.tsx`,
  `figui-adapter.css`, `Library.tsx`, `ProjectView.tsx`). The busy window
  is exercised only by two tests with a slow stand-in removal
  (`remove_delay_ms`): the refused presses and Escape with one
  `feeds.remove` sent and the unavailable look read from the kit's host and
  inner button, and a dialog closed by two Escapes mid-removal letting the
  next one open idle and stay open. A stalled request holding the dialog
  was a finding, F4 below, closed by issue 107.
- **D12. Cell 01's mode and operator, disabled by a run** (issue 221; of
  this kind, and numbered after the rest because it was found after them).
  While a layout run or an export is going the mode, the operator, "Use
  this mode" and "Use the feed's entry" are disabled, and a run can start
  with nobody pressing anything, since a colour or an order change is
  debounced, so the control a person was on went under them. Cell 01 was
  the one cell with nowhere to hand focus: its heading takes it first now,
  as the headings of cells 03 to 06 do. Only when focus was on one of the
  controls that go: on a sortable header, in the typed mode's field, in the
  geographic view or in another cell it is left where it is; a cell drawn
  already disabled, as a sample city's is, takes no focus for being drawn;
  and a collapsed cell hands nothing over, since nothing hidden holds focus
  and the press that collapsed it left focus on its row (`Inspect.tsx`,
  `DataCell.tsx`). Asserted in `tests/unit/inspect.test.ts` and in
  `tests/e2e/inspect.spec.ts`; not in the sweep. Cell 06's handback has the
  window this one closes by being a layout effect: `ExportTab.tsx` hands
  focus back from a passive effect over the kit's selects and two
  fieldsets, which are disabled in the commit itself, and it is safe only
  because an export starts from the press on Export, a discrete update
  whose passive effects run with its commit, made with focus on that button
  and outside the choices; the day an export can start from anything but
  that press, that effect has to become a layout effect too.

The rest:

- **D9. Diagnostics explanations could not be dismissed** without moving the
  pointer or the focus (WCAG 1.4.13). Escape sends every showing one away,
  and each comes back once the pointer and the focus have left its row, or
  on a press; one only pressed open, with nothing on its row, is put away
  rather than dismissed, and an Escape something else took (the inspector
  closing) is left alone (`Diagnostics.tsx`, `app.css`). Asserted in
  `tests/unit/diagnostics-panel.test.tsx` and end to end.
- **D10. The colour picker's sliders marked focus only by growing the thumb
  a tenth**: `react-colorful` removes the outline. The app's ring is back
  (`app.css`). Asserted in the sweep.
- **D11. Sortable table headers were 16px targets**, under the design's 24.
  They are at least `--target-min` high (`app.css`). Asserted in the sweep.

Contrast. C1 to C5 are in the token stylesheets and asserted in
`tests/unit/contrast.test.ts`, which recomputes token pairs. C6 was not,
and could not have been: it was a component rule reaching past what it was
written for, so a pair that passes on its own was drawn somewhere nothing
had paired it with. Where the cascade is the question, the measurement is
on the element, in `tests/e2e/accessibility.spec.ts`:

- **C1. A primary button's label in sepia was 4.40**: `--on-accent` on
  `--accent` at the kit's 13px and 500 weight, which is not large text. The
  kit's brand fill is `--accent-text` now, 5.74 at rest and higher under
  the pointer and pressed; in warm-dark the two tokens are one colour and
  nothing changed (`figui-adapter.css`, DESIGN.md 3.1 and 8.1). A checked
  checkbox's inset edge (the kit's `--figma-color-border-selected-strong`)
  takes the same token, so it is not a lighter ring inside the darker fill;
  a primary button draws no edge. The tab strip's underline and the progress
  line's running mark stay `--accent`: they are graphics on the ground, at
  3.0 or more in both themes. **This
  changes how the sepia primary button looks** - a darker blue - and is the
  one fix here the maintainer may want to see before it merges.
- **C2. A select's edge was `--border`**, 1.3 to 1.7 against the ground, short
  of the 3.0 a control's boundary needs (WCAG 1.4.11); `--border-strong`,
  as a text field's already was.
- **C3. An unchecked checkbox's edge was a translucent tenth of white or
  black**; `--border-strong`, kept while focused.
- **C4. The date control's edge was `--border`**; `--border-strong`.
- **C5. A text field's placeholder was the platform's own grey**, which no
  test measured: either of Chromium's two placeholder greys falls short of
  4.5 on the field's raised fill in sepia (3.62 and 1.84), and the darker
  one in warm-dark too (3.77). It is `--text-faint` now, which clears 4.5
  on that fill in both themes.

- **C6. The empty state's glyph rule reached inside its own button**
  (issue 143). `.empty .icon` is a descendant selector, so besides the mark
  - which draws from `--line-*` now and takes no colour from that rule
  (ADR-044) - it caught the `add` icon inside the empty state's primary
  action and drew
  it `--text-muted` on the accent fill: 1.23 and 1.04 on the palette of the
  day, 1.42 and 1.03 on the one the retheme brought (ADR-044), where a
  glyph needs 3.0 on either. The label beside it was `--on-accent` all
  along, which is part of why it read as deliberate. It is `.empty > .icon`
  now, and an icon inside a button takes the button's ink, which the kit
  already gives it. Asserted on the element in both themes by
  `tests/e2e/accessibility.spec.ts`, because no arithmetic over token pairs
  could see it.

Reduced motion needed no fix: the stylesheet already turns every transition
and animation off, pseudo-elements and the dialog backdrop included, and the
kit's shadow roots carry none of their own. `tests/unit/reduced-motion.test.ts`
now keeps that rule in place and the stylesheet free of animations.

## Findings for filing

Each too large for this pass: a change to the engine's page, a new control,
or a design decision.

- **F1. The animation page's own accessibility is unchecked.** *Screen:*
  the project's map (the viewer's frame). *Steps:* open a laid-out
  project; Tab past the panels into the map; use its controls; turn on
  reduced motion; switch the project's theme. *What a person meets:* the
  page's controls, their names and focus, whether its moving trains honour
  reduced motion or can be paused (WCAG 2.2.2), and its contrast in both
  themes are the engine's, behind an opaque origin the app cannot inspect
  and does not draw. An engine issue: an accessibility pass over
  `page.html`.
- **F2. The geographic view has no text alternative beyond its counts.**
  *Screen:* cell 01, "Where the routes run" (#105). *Steps:* lay a project
  out; reach the pane with Tab; listen. *What a person meets:* a named,
  focusable pane that pans and zooms, the node, station, junction, edge and
  line counts, and nothing about where the routes run: the drawing is the
  engine's SVG and is hidden from assistive technology. What a useful
  alternative would say is a design question, and its content would come
  from the engine.
- **F3. The viewer's frame stands between the panels and the project's own
  toolbar in the Tab order.** *Screen:* project, both tabs. *Steps:* from
  the tab panel, press Tab towards Rename and Delete project. *What a person
  meets:* every control of the engine's page before Rename; Shift+Tab from
  the end of the screen is the only shorter way. A skip past the map, or the
  toolbar moved above it, is a new control or a layout change. **Closed by
  issue 106:** a "Skip past the map" button immediately before the frame,
  out of sight until it takes focus, sends focus to the toolbar's first
  button that can take it (DESIGN.md 8.2), without reaching into the frame;
  from the tab panel Rename is one Tab and Enter away whatever the page
  holds, and Tab without the skip still reaches the map.
  `notebook-a11y.spec.ts` ("the project screen: one press skips past the
  map…") asserts both on both tabs, with forty controls in the frame, and
  that the map does not move when the skip appears; it passed in a full
  end-to-end run on macOS (2026-09-13), and CI runs it on three platforms. Going backwards is unchanged: Shift+Tab from the toolbar walks
  back through the map. The VoiceOver and Narrator columns are still a
  person's. *In the notebook* (ADR-045) there are no tabs: the skip sat
  before the pinned map at the top of the column and sent focus to Rename
  at the notebook's foot, past all six cells. *Since ADR-046* the map is
  in the column after cell 02, and the skip sends focus to cell 03's
  heading, the first thing after it; the same test asserts it there.

- **F4. A stalled engine request holds a destructive confirmation.**
  *Closed by issue 107.* *Screen:* the Library's feed removal. *Steps:*
  remove a feed while the engine is stalled. *What a person met:* a dialog
  that said the removal was running and could not be stopped, with both
  buttons unavailable, for as long as the sidecar's 600 s inactivity bound;
  `feeds.remove` had no request deadline of its own. *Now:* `feeds.remove`
  is sent with a deadline of 30 seconds (`FEEDS_REMOVE_DEADLINE_MS` in
  `src/main/feeds-ipc.ts`). At the deadline the dialog is released: it
  stays open, its buttons take presses again, and the alert says "The
  engine did not answer in time, so the feed may or may not have been
  removed. The list of feeds is read again to show what the engine has
  now." The pinned engine (v0.8.3, and unchanged to v0.10.1) does not stop for that: it runs
  `feeds.remove` on the one thread that reads requests, so it finishes the
  removal regardless, reads the app's `$/cancelRequest` only afterwards and
  ignores it, and answers nothing else meanwhile. The list the app asks for
  at the deadline is therefore answered once the removal is done and shows
  it done; closing the dialog reads the list once more. Until the engine
  answers, the list is left as it was, and a read that fails leaves it
  too. While the engine is still in the removal the app counts it as
  running, so "Reset engine data" refuses, and says "The engine has not
  finished a request it stopped answering. If it does not, quit and reopen
  Legible Cities.", because an engine that never answers is not restarted
  for it and only a quit ends it (`src/main/sidecar.ts`, `Library.tsx`). No other confirmation waits on the engine: deleting a
  project and resetting the engine's data are the main process's own file
  work. Asserted in `tests/unit/sidecar.test.ts` and end to end in
  `tests/e2e/feeds.spec.ts`, against a stand-in that blocks its reader for
  the removal (`remove_blocks_ms`) beyond a deadline shortened through the
  development-only `LEGIBLE_FEEDS_REMOVE_DEADLINE_MS`.

- **F5. A kit button's `aria-describedby` described nothing. Fixed
  (issue 113).** *Screen:* Settings (the Licences buttons when unavailable,
  "Choose folder" and "Reset engine data"), the add-a-feed dialog's "Choose
  a zip", and any `Button` given `aria-describedby`. *Steps:* Tab to one
  and listen for its description. *What a person met:* the name and no
  description. FigUI3's `fig-button` copies the attribute onto the
  `<button>` inside its shadow root, and an id reference there resolves
  within the shadow tree, where the page's element is not. Measured on
  2026-09-13 in Playwright's Chromium with the kit's `fig.js`: a native
  `<button aria-describedby>` had the sentence as its description and a
  `fig-button` had none, whether the attribute was set before the kit
  connected or after. *The fix*, once, in `kit/Button.tsx`: the wrapper no
  longer hands `aria-describedby` to the kit, reads the described
  elements' text, and writes it onto the inner button as
  `aria-description`, kept current by a `MutationObserver` on the button's
  document (so a reason whose text changes, or which is rendered again,
  is followed) and removed when the prop goes or the button unmounts.
  Measured in the same Chromium before choosing: `aria-description` is the
  description for both Chromium's accessibility tree and Playwright's;
  `ariaDescribedByElements` crosses the boundary in Chromium but
  Playwright's description ignores it, so no test could hold it; and the
  kit's dangling inner `aria-describedby` left beside `aria-description`
  empties Playwright's. `tests/unit/kit-button.test.tsx` tests the syncing,
  and `settings.spec.ts` asserts a Licences button's reason and the export
  folder chooser's path as their descriptions. Still a person's: that
  VoiceOver and Narrator read the reason when the button is focused.

- **F6. A kit button's `aria-controls` related it to nothing. Fixed
  (issue 121).** *Screen:* the header's Jobs toggle (`App.tsx`) and the
  line colours' Choose buttons (`LineColours.tsx`, the default colour's and
  each line's; native chip buttons since issue 284), and any `Button` given
  `aria-controls`. *Steps:* with a
  screen reader that reports controlled elements, focus one. *What a
  person met:* no relation to the inspector or the colour picker it opens.
  `kit/Button.tsx` mirrored `aria-controls` onto the `<button>` in the
  kit's shadow root, where an id resolves within the shadow tree and the
  page's element is not, as F5 was. Measured on 2026-09-13 in Playwright's
  Chromium with the kit's `fig.js`: a native `<button aria-controls>` had a
  `controls` relation to the element and the kit's inner button had none.
  *The choice:* carry the relation rather than stop claiming it, because
  unlike a description there is a form of it that works and a test can
  read. Measured on 2026-09-14 with the kit's `fig.js` in Chromium 151 and
  153, either side of the Chromium 152 in Electron 44.2.0, through the
  DevTools protocol's accessibility tree: the inner button given the
  element itself as `ariaControlsElements` had the same `controls`
  relation a native button's attribute gives, a reference from inside a
  shadow root to an element of the document around it being one the ARIA
  reflection rules allow; setting the id attribute afterwards cleared the
  reference, so nothing may write the attribute once it is set. *The fix*,
  once, in `kit/Button.tsx`: the wrapper writes no `aria-controls`
  attribute anywhere, resolves the ids in the button's document and sets
  the elements as the inner button's `ariaControlsElements`, kept current
  by a `MutationObserver` on that document (the inspector and a picker
  render after their buttons, go when they close, and can be rendered
  again as another element), cleared when none is left, when the prop goes
  and when the button unmounts, and set again after any change of
  `disabled`. The same function driven in those two Chromium builds
  related the button to an element that arrived after it, to its
  replacement, through a disabled toggle, to nothing once it went, and to
  nothing after unmounting. `tests/unit/kit-button.test.tsx` tests the
  syncing against a stand-in that behaves as Chromium does, and
  `notebook-a11y.spec.ts` ("the notebook, Inspect, the geographic view…")
  reads the
  relation from the built app's accessibility tree: each line's colour chip
  (a native button since issue 284, so its `aria-controls` is the plain
  attribute's) controls its open picker and nothing once it closes, and the Jobs toggle
  controls the Inspector while it is open and nothing while it is not.
  Still a person's: whether VoiceOver or Narrator says anything of it,
  which neither is known to; `aria-expanded` still says what the press
  does.

## Walking it with a screen reader

The person's half: the VoiceOver (macOS) and Narrator (Windows) columns of
the tables above, as a script one person can follow in one sitting per
system. It walks the screens in the tables' order. For each
part it says what to do and what to listen for: the **name** a control is
read with, its **role** (button, pop-up button or combo box, text field,
checkbox, tab, dialog, heading, table, group), its **state** (selected,
pressed, expanded or collapsed, dimmed or unavailable, invalid), and the
**announcements** the app makes without moving focus. Every name and
sentence quoted is the app's own, from the component named. How each
reader words a role or a state varies between versions ("pop-up button" or
"combo box", "dimmed" or "unavailable"): what matters is that the role and
state are said at all, and are the right ones.

### Before you start

- **The app**: an installer from the release, installed as
  [`install.md`](install.md) says, on the machine whose reader is being
  walked. Note the app version (Settings, **Copy diagnostics**, the "App"
  line) and the reader's version (the macOS or Windows version).
- **A project with a map.** Run the [acceptance checklist](acceptance.md)
  up to step 17 first, or in the same sitting: a project named
  `Los Angeles` on the LA Metro Rail preset, laid out, and a feed added by
  address (Caltrain, as the checklist's step 14). A second, throwaway
  project to delete. Leave **Reset engine data** to the very end.
- **The interface theme** as it comes (Settings, **Theme**, "Follow the
  system"); a screen reader does not see the theme.
- **Where the result goes.** Into the VoiceOver (macOS) or Narrator
  (Windows) cell of the row named in bold in each step below, replacing
  "not yet run: a person's" with one of: `pass`; `finding: #<issue>` (file
  one issue per defect, `type:bug`, with the screen, the steps and what was
  heard); or `not reachable: <why>`. Fill in the run's row in
  [Reader runs](#reader-runs): the app version, the reader and OS
  versions, the date, and who walked it. The results go in as a pull
  request that changes only those cells
  and that line; the other columns are the machine half's and stay as they
  are.

### Turning the readers on and off, and the few keys needed

**VoiceOver (macOS).** Turn it on and off with **Command-F5** (or System
Settings › Accessibility › VoiceOver). "VO" below means **Control-Option**
held together.

| To | Press |
|---|---|
| Move to the next or previous item | VO-Right Arrow, VO-Left Arrow |
| Press the item under the cursor | VO-Space |
| Go into a group, table, list or frame, and out again | VO-Shift-Down Arrow, VO-Shift-Up Arrow |
| List the headings, landmarks or form controls (the rotor) | VO-U, then Left and Right Arrow between lists |
| Move keyboard focus | Tab, Shift-Tab (VoiceOver follows it) |
| Open a pop-up button's list and choose | VO-Space, then Up and Down Arrow, then Return |
| Stop speech | Control |

**Narrator (Windows).** Turn it on and off with
**Windows logo key-Control-Enter**, or press **Narrator key-Esc** to turn
it off. The **Narrator key** is Caps Lock or Insert. In the app's window
Narrator starts in scan mode, where the arrow keys read.

| To | Press |
|---|---|
| Move to the next or previous item (scan mode) | Down Arrow, Up Arrow |
| Next heading, landmark or table | H, D, T (Shift with each for the previous) |
| Press the item under the cursor | Enter or Space |
| Turn scan mode off to type or to use a select's arrows, and on again | Narrator key-Space |
| Move keyboard focus | Tab, Shift-Tab |
| Move between a table's cells | Control-Alt-Arrow keys |
| Stop speech | Control |

Walk each part both ways: once with Tab alone, listening to what focus
lands on, and once with the reader's own navigation, listening for anything
Tab does not reach that a person would need to hear (a sentence, a count,
a table).

### Header, on every screen

- **Jobs toggle, Settings.** Tab to the first button after the status line.
  Listen for "Jobs, none running", a button, collapsed; press it and hear
  it expanded; press again. While a run is going it is read as
  "Jobs, 1 running" (`Inspector.tsx`). **Settings** is a button, and is
  dimmed while Settings is open.
- **Engine status line.** Turn the reader on **before** opening the app,
  then open it. Listen for the status named "Engine" being announced by
  itself, without focus moving: possibly "Checking the engine…" first
  (what it says before the app has heard from the engine at all, which is
  not a defect), then "Starting the engine." and then
  "Engine ready (`<version>`)." (`EngineStatus.tsx`). Move the reader's
  cursor onto it and hear the sentence again. The icon beside it is never
  read.
- **Job-end announcement.** On any screen, when a layout run, rebuild,
  export or feed add ends, listen for one sentence said once without focus
  moving: "`<project>`: `<job>`, `<finished, failed or cancelled>`.", such
  as "Los Angeles: Layout run, finished." (`App.tsx`, `shared/jobs.ts`).
  Start a second identical job and listen for the same sentence said again.
  Leave the project screen while a run is going and listen for it on the
  Library.

### The front door (Library)

- **Heading and New project.** On opening, listen for the heading
  "Library" read first, at level 1 (focus is put there). Tab: **New
  project**, a button. Adding a feed is inside it since A5.6-05.
- **Empty state.** This part needs a Library with no projects, which the
  sitting only has on a new install or after **Reset engine data** at the
  end of Settings below: if you already have projects, skip it now and come
  back to it after the reset. Listen for the status "Legible Cities draws a
  transit network as a schematic map and plays a day of its service on it:
  start from a sample city below, or add a feed of your own." and a **New project**
  button after it. Create a project from that button: when the dialog
  closes, listen for focus landing on the new project's row,
  "Open `<name>`" (D4), not on nothing.
- **Project rows.** In the list "Projects", each row is a button
  "Open `<name>`", with its feed and service day read as its description
  ("Feed la-metro-rail, Service day `<day>`, Opened `<when>`, finished up
  to 05 Lines", A5.6-04).
- **Sample cards and feed rows (Start a project, Remove).** Listen for the
  headings "Sample cities" and, once a feed has been added, "Your feeds",
  over the lists "Presets" and "Added". Each sample is one button named by
  what its card shows, "`<name>`, `<city · network>`, keeps `<mode>`,
  downloaded" or "not downloaded yet" (A5.6-02); pressing one opens the
  sample's notebook with its layout starting, and listen for the project's
  heading read first and cell 02's progress line after it (A5.6-03); an added feed's row is
  named for its feed, with the buttons "Start a project on `<feed>`" and
  "Remove `<feed>`". Then, after the add-feed progress line below has
  added a second Caltrain, remove the one no project uses (the two rows
  have the same name; if the removal is refused, it was the other): when the
  confirmation closes, listen for "Caltrain was removed." and focus on the
  "Your feeds" heading while an added feed is left, or "Sample cities" once
  none is (D5).
- **New project sheet (A5.6-05).** Press **New project**. Listen for a
  dialog "New project" described by "A project draws one feed: a sample
  city, or a GTFS feed of your own from a file or an address.", with focus
  on **Cancel**. Tab: the "Start from" group of three radio buttons, the
  "Feed" pop-up button, the text field "Name" (filled with the feed's
  name), **Cancel**, **Create**. Clear the name and press **Create**: focus
  moves to "Name", invalid, with "name is required" read with it. Press
  Escape and listen for focus back on the button that opened it.
- **The sheet, from a zip.** Choose **A GTFS zip on this computer**.
  Listen for **Choose a zip** with "No file chosen." read as its
  description. Press it: the platform's file chooser opens (its own reader
  support is the platform's); cancel it and listen for focus back on
  **Choose a zip**.
- **The sheet, from an address.** Choose **A feed at an address**. Type
  `abc` into "Feed address" and press **Add the feed**: listen for the
  alert "a feed address starts with http:// or https://" and focus back in
  the field, invalid.
- **The sheet's progress line.** Paste the Caltrain address from the
  checklist's step 14 again and press **Add the feed**; the engine keeps it
  as a second feed of the same name. Listen for focus moving to **Cancel
  the add**, a region "Adding the feed", an image named "Adding the feed:
  `<the engine's sentence>`", and the polite status reading "downloaded
  `<n>` of `<n>` bytes" and "checked the feed's tables" as they change.
  When it ends, listen for "The feed is in." and focus landing in "Name",
  filled with "Caltrain". Listen for whether the byte count floods speech;
  if it does, that is a finding. (`NewProjectSheet.tsx`)
- **Remove-feed confirmation.** Press **Remove** on an added feed a project
  uses. Listen for a dialog "Remove `<feed>`?", its description, and focus
  on **Cancel**. Press **Remove**: while it runs, listen for the status
  "Removing `<feed>`… It cannot be stopped." and both buttons read as
  dimmed or unavailable while they keep focus (D8); then the alert "The
  project “`<name>`” uses this feed; delete it first.", naming the project
  (A5.6-06). The busy window may
  be too short to hear; write "busy state too quick to hear" in the cell
  beside the result rather than failing it.

### Project: the header, the rail and the map

- **The heading.** Open **Los Angeles** from **Your projects**. Listen
  for its name read as a level-1 heading (focus is put there). There is no
  navigation landmark "Breadcrumb" (issue 275); the way back is the header's
  "Back to Library".
- **The notebook's sentence, Run all and Stop.** After the heading, listen
  for one status sentence about the notebook as a whole ("The map is drawn
  from every cell." on a project laid out and drawn; "Nothing has been
  laid out yet." on one that is not), and **Run all**, only when there is something to run: on
  a project laid out and drawn it is not there at all (issue 276). On a project not yet laid
  out, press **Run all**: listen for focus moving to **Stop**, the
  sentence changing to "02 Process is running." as the run goes, and at
  its end focus on the sentence (Run all not coming back), the
  sentence "The map is drawn from every cell.", and the job-end
  announcement. Listen for whether the sentence is heard too often during
  the run; if it floods speech, that is a finding.
  Then make a run fail (a feed with no calendar will do) and listen for
  the failure said once, assertively, as "02 Process failed.", and that the
  sentence under it is not read out as well; press **Run all** again and
  listen for the failure said again if it fails again. A failure that is
  still showing when the project is left and opened again may be silent:
  that is the design, not a finding.
- **The rail: Steps.** With the reader's own navigation, find the
  landmark "Steps", a navigation holding six buttons, each read as its
  number, name and state as one, "01 Data, ready" to "06 Export, ready".
  Listen for which is marked as the current step, and that it follows as
  you scroll the notebook without taking focus. Press "04 Style, ready":
  **focus moves** to cell 04's heading, and the cell is brought into view
  below the map. This move on activation is the part of the rail most
  worth hearing: note what is read when focus lands.
- **The rail: Outputs.** Find the region "Outputs": "Nothing exported
  yet." before any export, and afterwards a row per export read as its
  preset and when it was made, with a button "Reveal `<preset>`,
  `<file>`". A file since moved or deleted is read as "the file has been
  moved or deleted", with no button.
- **Skip past the map.** Tab past cells 01 and 02. Listen for a button
  "Skip past the map" and look for it appearing over the top edge of the
  map. Press it: listen for focus on cell 03's heading, "03 Frame and
  service day", with the map not read. Look for the focus ring on a band
  of the interface's ground, clear against the map in either of the
  project's themes. Shift+Tab from cell 03 walks back through the map,
  which is expected (F3, issue 106).
- **No map yet.** On a project not laid out, between cells 02 and 03,
  listen for "This project has no map yet." and a button "Lay it out in
  cell 02.". Press it: focus on cell 02's heading. When the layout
  finishes, listen for "The map is drawn." said once, without focus
  moving.
- **Viewer frame.** From **Skip past the map**, press Tab without pressing
  it. Listen for the frame named "`<project>`, animated" in a region "Map".
  Going on into it reaches the engine's page and its own controls, which are
  the engine's (F1); note what is read in the cell.

### Project: the cells

- **The cells' rows.** With the reader's heading navigation, listen for
  six level-2 headings, "01 Data" to "06 Export", each holding one button
  read with the cell's number, name and state ("01 Data ready") and,
  collapsed, the one-line summary after it; the button is expanded or
  collapsed, and the chevron at its left edge is not read. Collapse cell 03
  and listen for its summary (its day). Nothing inside a cell is another level-2
  heading: the panels' names are level 3.
- **The provenance footer.** Under cells 02, 03 and 06 (06 once
  something is exported), a description list read as term and value
  pairs: Layout, Made, Built with, Engine now; Service day, The feed
  covers, The engine's busiest weekday, Counted from; Exported, and the
  sentence about the sidecar. Nothing in it is announced as interactive.

#### Cell 01, Data

- **Fields.** Listen for a description list: Feed, Mode and Agency, each
  term with its value.
- **Inspect: mode, operator, the feed's entry.** Listen for the heading
  "In the feed", the status "Reading the feed, and downloading it first if
  it is not on this machine yet…" if it is still reading, and the pop-up
  button "Mode" with its value. Choose another mode: listen for the sentence
  "The feed's own entry draws `<mode>` for every operator." and a button
  **Use the feed's entry**; press it, and listen for focus landing on
  "Mode" with the entry's value (D7). The "Operator" pop-up button appears
  whenever the project has an agency, or its feed names more than one
  operator: go back to the Library, press **New project**, choose
  "Mexico City Metro" under "Feed", name it `Mexico City`, open it, and listen for "Operator" with
  "every operator" first among its options. Delete this project afterwards
  (it can be the throwaway project for **Delete confirmation** below).
- **Inspect: the two tables.** With T (Narrator) or the rotor (VoiceOver),
  find the tables "Route types, and what the chosen mode keeps" and
  "Routes: `<n>`". Go into each and move across a row and down a column:
  each cell is read with its column header.
- **Inspect: sortable headers.** In the routes table, Tab to the header
  buttons "Label", "Type" and "Trips", and listen for "Label" read as sorted
  ascending when the table opens (`aria-sort`). Press "Label": descending.
  Press "Trips": sorted descending (most trips first) on its first press;
  press "Type": ascending on its first press. Every further press on the
  column already sorted reverses it. The arrow beside it is not read.
- **Geographic view.** Listen for the heading "Where the routes run", the
  sentence saying what the two stages are, the group "Stage" (described by
  that sentence, read on entering it, issue 282) with toggle buttons "gtfs2graph" and "loom" (the current one
  pressed), the description list "Counts" (Nodes, Stations, Junctions,
  Edges, Lines), and a focusable group "The gtfs2graph stage, as the feed
  draws its routes" described by "Zoom with the wheel or plus and minus, pan
  by dragging or with the arrows, 0 to fit." Press `+`, `-`, an arrow and
  `0` on it; nothing is announced for them, and the drawing itself is not
  read (F2).

#### Cell 02, Process

- **Layout run and its progress line.** On a project never laid out the
  cell opens on one sentence of plain text, "This project is not laid out
  yet."; on one already laid out there is no such sentence, and the layout
  and when it was made are the footer's to say (issue 209). A project made
  by a newer version of the app is offered no run, and the cell says so in
  plain text instead: "This project was made by a newer version of the app,
  so it cannot be laid out here." Before pressing anything, cell 02
  draws the eight stages at rest (A5.5-10): listen for an image named "The
  layout run's 8 stages, none started." on a project never laid out, or
  "The layout run's 8 stages." on one already laid out. The stations carry
  the app's words - `parse`, `collapse`, `order`, `octilinear`, `trips`,
  `draw`, `animate`, `write` - while the sentences spoken beside them stay
  the engine's own. Then press **Lay out again** (or
  **Lay out**). Listen for focus moving to **Cancel** (D1), a region
  "Layout run", an image named "Running: `<sentence>`", and the polite
  status reading the engine's sentence for each stage as it finishes. At the
  end listen for "Laid out." (or the rebuild's sentence), the job-end
  announcement, and focus on **Lay out again**, not on nothing.
- **Re-layout warning.** Press **Re-layout**. Listen for a dialog "Lay this
  project out from scratch?", its description, and focus on **Cancel**.
  Press **Cancel** and listen for focus back on **Re-layout**. Open it
  again and press **Re-layout**: the dialog closes and the run starts with
  focus on **Cancel** (D1, D8).
- **The engine log.** Under the stages, a button "Engine log" with its
  line count, collapsed, which opens a group named "The engine's log for
  this run". Press it: listen for expanded and a scrolling box "Log lines"
  (Tab reaches it; the arrow keys scroll it), then **Copy log**, read as
  "Copy log: the engine's log for this run"; press it and listen for "The
  log is on the clipboard, with the keys in web addresses taken out and
  your home folder written as ~." Listen that the box's name and the
  disclosure's are not heard nested in each other.
- **Diagnostics panel.** After a run in this session, listen for the heading
  "What the build had to fudge", the status sentence ("No caveats: nothing
  was fudged, and the issues score is `<n>`." or "`<n>` caveats, and an
  issues score of `<n>`, where 0 is clean."), and the table "What the
  engine measured drawing the map for `<day>`". Tab to a button
  "What `<measure>` means", collapsed, and listen for its explanation read
  as its description; press it (expanded), press Escape, and check that the
  explanation is no longer shown and focus has not moved (D9). Press **Copy as text** and
  listen for "The figures and the caveats are on the clipboard."

#### Cell 03, Frame and service day

- **Service day and date control.** In cell **03 Frame and service day**,
  listen for the section "Service day" (its name is the cell's heading, so
  there is no heading of its own inside it), the status "Drawn for `<day>`.
  The feed covers `<start>` to `<end>`; the busiest weekday, counted from
  `<anchor>`, is `<day>`.", and the date field "Draw for another day".
  Change the date, and **before pressing anything**: the day is written as
  it is chosen (A5.5-15), so listen for the status to change to "`<new
  day>` is chosen; the map still shows `<old day>`." Then press **Draw for
  this day**: listen for focus on the cell's own heading (D3) and the
  rebuild's end, after which the status is "Drawn for `<new day>`." again.
  Press **Use the busiest weekday** and listen for focus in the date field.
  Type a date outside the window: listen for "The feed covers `<start>` to
  `<end>`." spoken as it is typed, with **no focus move** - the message is
  an alert, because taking focus there would shut the platform's calendar.
  Then press **Draw for this day** and listen for focus back in the field,
  invalid, with the same sentence read with it.
- **Revert.** Choose another day and, **before drawing it**, listen for a
  button "Revert to `<day>`" in the row with **Draw for this day**. Press
  it: listen for focus landing in the date field, which holds that day
  again, and the status reading "Drawn for `<day>`." The button goes with
  its own press.
- **Transport.** Listen for the heading "Transport" (level 3), the
  sentence "Where the map is in its service day. …", the slider "Time of
  day" read with the clock (such as "07:20"), the button **Play day** or
  **Pause** (it says which it is), and the pop-up button "Speed". Move the
  slider with the arrow keys and listen for the clock read as its value.
  Press **Play day** and listen for it becoming **Pause**. Start a layout
  (Lay out again) and press the slider or **Play day** during it: listen
  for "The map is being drawn. It can be moved again when the run ends."
  as an alert, with focus not moved, and for nothing said on a second
  press.

#### Cell 04, Style

- **Theme switch.** Listen for the region "Theme" and the group "The theme
  this map is drawn in" with the buttons "Warm dark" and "Sepia", the
  current one pressed. Press the other and listen for it pressed and the
  first not. Start a run (Lay out again) and listen for both buttons dimmed,
  the status "The theme waits until the run that is going has finished: …",
  and focus on the cell's own heading (D3) if it was on a button. Cell 04
  draws its one control headless (A5.5-17), so "Theme" is the region's name
  and there is no heading of that name to land on. A redraw for a colour or
  a line order, which a person starts and which takes moments, dims the
  buttons without the sentence: it would add a line under the cell a colour
  panel is being picked from and move the panel (issue 304). The sentence
  is still said when an export is the reason.

#### Cell 05, Lines

- **Line colours.** Listen for the heading "Line colours", the list
  "Lines", and in each row the line's label, the feed's colour, where the
  shown colour comes from ("the colour in the feed, `#rrggbb`"), a colour chip
  at the row's start, a button "Choose the colour of line `<label>`",
  collapsed. The button "Reset line `<label>` to the colour in the feed" is
  in the chip's panel, dimmed until the line has a colour of its own (issue
  284). Before the list, not inside it, is the row
  "Lines with no colour in the feed", with the button "Choose the colour of
  lines the feed leaves uncoloured".
- **Colour picker.** Press the chip of a line: listen for expanded (focus stays
  on the chip, and one Tab enters the panel), and a
  group "Colour for line `<label>`" holding the sliders "Color" and "Hue",
  each read with its value, and the text field "Hex value" and the button
  **Use this colour**. Move each slider with the arrow keys and listen for
  the value changing. Press Escape: the picker goes and focus is back on
  the chip. Type a hex value that is not one, press **Use this colour**,
  and listen for "A colour is six hexadecimal digits, such as 0072bc." read
  with the field when you return to it.
- **Line order.** Listen for the heading "Line order" and an ordered list
  "Lines in the order they are drawn", each row read with its position
  ("1 of 6"), its label, and the buttons "Move line `<label>` up" (dimmed on
  the first) and "Move line `<label>` down" (dimmed on the last). Press
  the first line's "Move line `<label>` down": listen for the status
  "`<label>` is now 2 of `<n>`." and focus staying on that line's button as
  the list redraws. Move a line to the end and listen for focus handed to
  its "up" button when its "down" is dimmed. Press **Back to alphabetical**: "The lines are in alphabetical
  order again." and focus on the cell's own heading (D3) - not on the "Line
  order" heading, which is a label and takes no focus. Each row also has a
  grip at its start for dragging with a pointer (issue 283); it should not
  be heard at all - no name, no stop in the Tab order - because the two
  buttons are the same moves. The buttons are drawn as arrows now; their
  names are unchanged.

#### Cell 06, Export

- **Preset, storyboard, view, quality.** Open cell **06 Export**. Cell 06
  draws its choices headless under the cell's own row (A5.5-19), so there
  is no heading "Export" inside it; the row is what names the cell. Listen
  for the pop-up buttons "Preset" (its options
  grouped by platform: listen for the group names Instagram, LinkedIn,
  Bluesky and X), "Storyboard" (for a video or GIF preset), "View" (for a
  still), and "Quality". Choose the preset "bluesky: 1200 by 900, still,
  JPG" and listen for "Quality" dimmed and "This preset is a JPEG still,
  which the engine makes at standard quality only." after it.
- **Frame switches, lines to keep.** Listen for the group "What the frame
  shows" with the checkboxes "Station names", "The title: city, network and
  service day" and "The clock", each checked or not; and the group
  "Lines to keep", "None chosen draws every line.", one checkbox per line.
- **Start time, filename tag.** For a still, the text field "Start time",
  read with its rule "HH:MM. The still is taken at this time; …". Type
  `7`, Tab away, and listen for "the start time must be written HH:MM, such
  as 07:30" read with the field when you return; clear it. The text field
  "Filename tag", read with "Added to the file’s name, so a draft does not
  replace the last good export."
- **Where it goes.** Listen for the label "Where it goes" (text, not a
  field: nothing refers to it, which is itself worth noting) and, with no
  folder of the project's own chosen, the sentence "This project's exports
  go to the app's export folder, which Settings names, in a folder named
  after the project." and one button, **Choose folder**, described by that
  sentence. Press it, choose a folder in the platform's own dialog, and
  listen for the path read in its place and a second button, **Use the
  app's folder**. Press that and listen for the first sentence back and
  focus on **Choose folder**. Choose a folder inside the app itself and
  listen for the refusal under the pair, as an alert: "that folder is
  inside the app itself; nothing can be kept there" (A5.5-19).
- **Export, its progress line, Cancel, Reveal.** Choose a still preset (it
  is quick) and press **Export**. Listen for focus moving to **Cancel**
  (D2), a region "Export", an image "Running: `<sentence>`", and the
  polite status reading the export's sentences, among them "Planning the
  export.", "Capturing `<n>` frames.", "Captured `<n>` of `<n>` frames.",
  "Encoding `<n>` frames." and "Encoded `<n>` of `<n>` frames."; the choices above are dimmed, with
  the status "The choices wait until the export that is going has
  finished: it was planned from them." At the end listen for
  "Exported `<file>`.", the job-end announcement, and focus on **Reveal**.
  Press **Reveal**: the Finder or File Explorer opens, and the reader moves
  to it; switch back (Command-Tab or Alt-Tab) and listen for focus still on
  **Reveal**. Then export the reel, and listen for whether the frame count
  floods speech over its minutes: note it in the cell if it does. Start
  another export and press **Cancel**: "The export was cancelled. Nothing
  was written." and focus on **Export**.
- **Cell 06's preview.** With cell 06 open, a second frame in the cell,
  after its first sentence: listen for it named "`<project>`, as the
  export will frame it", followed by its caption ("9:16, 1080 x 1920." and,
  where the preset has safe zones, that the shading is guidance and not in
  the export). Tab from the cell's heading goes on to **Preset**: the
  preview takes no stop. The map above keeps its own frame and is not
  sent anywhere. What is in the preview is the engine's (F1).

### Project: the footer

- **Created and Modified.** A description list at the foot of the
  notebook: Created and Modified, each read with its date and time.
- **Rename form.** Press **Rename**: expanded, focus stays on it; Tab past
  **Delete project** to the text field "New name", required. Empty it and press **Save**: "name is
  required" read with the field. Press **Cancel** and listen for focus back
  on **Rename**, collapsed.
- **Delete confirmation.** On the throwaway project, press
  **Delete project**. Listen for a dialog "Delete `<project>`?", the
  description "This removes the project and its generated output. The feed
  stays.", and focus on **Cancel**. Press **Delete**: listen for the status
  "Deleting `<project>`… It cannot be stopped." if it is long enough to
  hear (D8), then the Library, with its heading read.

### Settings

- **Folder rows.** Press **Settings**. Listen for the heading "Settings"
  (focus is put there), then, under the heading,
  "Folders" the buttons "Choose the engine data folder" and "Choose the
  export folder", each read with its folder's path as its description.
  Choose another export folder in the platform's dialog: listen for
  "chosen here" and a button "Use the default export folder"; press it and
  listen for focus on "Choose the export folder" (D6). The engine folder's
  size is a status: "Measuring…" and then the size.
- **Logs, Copy diagnostics.** **Open logs folder** opens the platform's file
  browser. **Copy diagnostics** is read with its description "Copies what a
  bug report needs: …"; press it and listen for "The diagnostics are on the
  clipboard, with your home folder written as ~. Nothing was sent
  anywhere."
- **Theme select.** Under "Appearance", the pop-up button "Theme" with
  "Follow the system", "Night" and "Parchment" - the interface's own two,
  not the engine's, which a project's map switch still calls Warm dark and
  Sepia. Change it and listen for the new value; change it back.
- **Versions.** A description list under "Versions": Engine, Protocol,
  Python, LOOM backend, LOOM commit, ffmpeg, none read as empty.
- **Reset engine data and its confirmation.** Last of all in the sitting.
  With a run going, listen for **Reset engine data** dimmed and read with
  "A run is going; resetting would pull the folder out from under it."
  With nothing going, press it: a dialog "Reset the engine's data?", focus
  on **Cancel**. Press **Reset**: listen for "Resetting the engine's data…
  It cannot be stopped." if it is long enough to hear (D8), then the status
  "The engine's data is gone: `<folders>`. Start the app again so the engine
  reads its folder afresh."
- **Licences section (issue 108).** Listen for the heading "Licences", the
  sentence naming the GNU General Public License, and a description list
  of components and their licences, "The legible-cities engine",
  "GPL-3.0-or-later" first. Then the buttons "Open the notices", "Show the
  licence texts" and "Open Chromium's licences". In an installed app, press
  each: the notices open in the platform's viewer (or are shown in its file
  browser), the licence texts' folder opens in the file browser, and
  Chromium's licences open in the browser. In a development run each is
  read dimmed, with its reason as its description (F5, fixed; confirm it
  is read on focus); a press says "… not bundled in a development run, so
  there is nothing to open here.", and a second press says it again.
- **Bundled tools rows (A6-02).** Listen for the heading "Bundled tools",
  the status "The bundled LOOM and ffmpeg ran.", and a description list:
  "LOOM tools", "ran (`<n>` ms)."; "ffmpeg and ffprobe", "ran (`<n>` ms)."

### Jobs inspector

- **Toggle, heading, Close, Escape.** Press **Jobs**. Listen for focus on
  the heading "Jobs", inside a landmark "Inspector" (complementary), and a
  button "Close the inspector". Press Escape: the inspector closes and
  focus is back on the toggle, collapsed.
- **Jobs: progress line, Cancel, Copy log, Details.** Open it after a few
  jobs. Each job is a list item named by its project and label
  ("Los Angeles Layout run"), with "`<finished>`, started `<time>`", an
  image "`<label>` finished." (or "Running `<stage>`." while it runs), and
  the buttons "Copy log: `<label>`, `<project>`" and, while it runs,
  "Cancel: `<label>`, `<project>`"; a feed add is named by "Feeds" in
  place of a project. A failed job whose detail says more than its hint has
  a collapsed **Details** disclosure; a clean run has none. Press **Copy log**: "The log is on the clipboard,
  with the keys in web addresses taken out and your home folder written as
  ~." Start a layout, open the inspector and press its **Cancel**: listen
  for focus on the job's heading as it moves below the running jobs.
- **Below 900px, over the main region.** Make the window narrower than
  900 pixels and open the inspector. With the reader's own navigation,
  listen for the header still being reachable and nothing of the screen
  under the inspector being read or reached.

### First-run dialog (A6-02)

The dialog opens only when a bundled tool will not run, so it is made to
happen by starting the app with its LOOM folder pointed at an empty one.
Quit the app first. This session cannot lay out; quit it afterwards and
start the app normally.

- On a Mac, in Terminal:

  ```sh
  SCHEMATIC_LOOM_BIN="$(mktemp -d)" "/Applications/Legible Cities.app/Contents/MacOS/Legible Cities"
  ```

- On Windows, in PowerShell (**check** that the file name is the one in the
  app's folder):

  ```powershell
  $env:SCHEMATIC_LOOM_BIN = (New-Item -ItemType Directory -Force "$env:TEMP\legible-empty-loom").FullName
  & "$env:LOCALAPPDATA\Programs\legible-cities-app\Legible Cities.exe"
  ```

- **The dialog: its details disclosure, Copy diagnostics, How to install,
  OK.** Within about ten seconds of the window opening, listen for a dialog
  "LOOM will not run" read with its description: "The LOOM tools
  SCHEMATIC_LOOM_BIN names are missing, so maps cannot be laid out." and
  "The Library still opens, and everything that does not need LOOM still
  works. Reinstalling the app usually puts it right; the install document
  says how." Focus is on **OK**. Tab: the disclosure "Details: LOOM",
  collapsed (open it and listen for its sentence), **Copy diagnostics**
  (press it and listen for "The diagnostics are on the clipboard, …"),
  **How to install** (it opens the install document in the browser; come
  back), and **OK**. Focus never leaves the dialog while it is open.
- **Focus after it closes.** Press Escape (or **OK**). Listen for focus on
  the Library's heading, "Library". The dialog does not come back this
  session.
- **Waiting for another dialog.** Start the app the same way, and press
  **New project** as soon as the Library appears, before the check has
  finished. Listen for the first-run dialog not opening over "New project",
  and opening, with focus on **OK**, once you close "New project". If the
  check finishes before you can open the other dialog, write "could not
  open a dialog in time" rather than a result.

### Mismatch dialog

- **The dialog and OK.** It opens only when the engine the app starts is
  not the version the app was built for. An installed app can be made to
  start another engine - it honours `LEGIBLE_ENGINE_PYTHON` from the
  environment before its own bundled runtime - but only with a Python that
  has a different engine version installed, which a tester will not have.
  Without one, record `not run: needs a Python with another engine version`
  in both cells. With one, start the app from a terminal with
  `LEGIBLE_ENGINE_PYTHON` naming that interpreter, and listen for a dialog "Engine version mismatch" read with its
  description, focus on **OK**, and the engine status line still saying
  the mismatch after it closes.

## Reader runs

The person's half, one row per run. A run is the walkthrough above from
start to end on one machine; a finding is filed as its own issue and
linked from the row of the table it belongs to, as well as here. The
keyboard-only run is the same walk with no reader, once in each of the
interface's themes (Settings, **Theme**, **Night** and then
**Parchment**) and with the system's reduced motion on (macOS: System
Settings, Accessibility, Display, **Reduce motion**; Windows: Settings,
Accessibility, Visual effects, **Animation effects** off): every control
reached, its focus seen, nothing moving that is not the map's own
animation (the engine's, F1).

| Run | App version | OS and version | Reader and version | Date | Walked by | Findings |
|---|---|---|---|---|---|---|
| Keyboard only, Night and Parchment, reduced motion on | | | none | | | |
| VoiceOver | | macOS | VoiceOver, as the macOS version | | | |
| Narrator | | Windows | Narrator, as the Windows version | | | |

## Left for a person

- The three runs above, after the release tag, following
  [Walking it with a screen reader](#walking-it-with-a-screen-reader); the
  two reader columns of each table fill in from them.
- A look at the Parchment primary button (C1).
