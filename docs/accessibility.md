# Accessibility pass

Principle VI of the constitution, checked over every screen of the app
(issue A6-07). This is the record of the **machine half**: keyboard reach,
labels, visible focus, reduced motion and contrast, checked in code and in
an end-to-end sweep, with the small defects fixed. The **person's half** -
every screen with VoiceOver on macOS and Narrator on Windows - comes after
the release tag, and its two columns are left for it.

| | |
|---|---|
| App version | `0.0.0` (`package.json`), branched from `main` at `45b5fff` |
| Engine pin | as `vendor/pins.json` at that commit |
| Date | 2026-09-13 |
| Themes | warm-dark (the default) and sepia |

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
2. **End-to-end sweep**, `tests/e2e/accessibility.spec.ts`, against the
   stand-in engine: for each screen and each dialog, every control in the
   accessibility tree has a name (`ariaSnapshot()`); a Tab walk from the
   top reaches every enabled control and each shows a ring it did not have
   at rest; with reduced motion emulated, and the emulation asserted to
   take effect, no element or open shadow root has a running animation or
   a transition that lasts. It also asserts each fix below where a person
   meets it. **Its first runs** (macOS, 2026-09-13, by the coordinator, not
   by the lane that wrote it) passed every screen's names, walk and motion
   checks; the removed feed's focus (D5) and the one-control dialog's walk
   failed and were changed; a later full run after those changes passed
   (119 passed, 2 skipped). The confirmation's busy state (D8) was changed
   again after that run, and its two slow tests have not run yet. Where a
   defect below says "asserted in the sweep", that green run covered it,
   except D8's busy window. The sweep searches the
   light tree: of the kit's elements in use, a button is counted by its
   host and a select's and text field's focusable parts are ordinary
   children, so no kit control focusable only inside a shadow root is on
   screen, and one added later would be outside it.
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

**Legend.** *pass*: nothing found. *fixed (Dn/Cn)*: a defect this pass
fixed, listed below. *finding (Fn)*: a defect too large for this pass,
listed below for filing. *engine's*: inside the engine's page.

## Results by screen

### Header, on every screen

| Part | Keyboard | Labels | Focus visible | Reduced motion | Contrast (warm-dark) | Contrast (sepia) | VoiceOver (macOS) | Narrator (Windows) |
|---|---|---|---|---|---|---|---|---|
| Jobs toggle, Settings | pass | pass | pass | pass | pass | pass | not yet run: a person's | not yet run: a person's |
| Engine status line | pass (not a control) | pass (`role="status"`, named "Engine") | n/a | pass (the icon never moves) | pass | pass | not yet run: a person's | not yet run: a person's |
| Job-end announcement | n/a | pass (polite, visually hidden) | n/a | n/a | n/a | n/a | not yet run: a person's | not yet run: a person's |

### Library

| Part | Keyboard | Labels | Focus visible | Reduced motion | Contrast (warm-dark) | Contrast (sepia) | VoiceOver (macOS) | Narrator (Windows) |
|---|---|---|---|---|---|---|---|---|
| Toolbar (New project, Add feed) | pass | pass | pass | pass | pass | fixed (C1) | not yet run: a person's | not yet run: a person's |
| Empty state | fixed (D4) | pass | pass | pass | pass | fixed (C1) | not yet run: a person's | not yet run: a person's |
| Project rows | pass | pass (`Open <name>`, the meta as description) | pass | pass | pass | pass | not yet run: a person's | not yet run: a person's |
| Feed rows (Start a project, Remove) | fixed (D5) | pass (each names its feed) | pass | pass | pass | pass | not yet run: a person's | not yet run: a person's |
| Create-project dialog | pass | pass | pass | pass | fixed (C2) | fixed (C1, C2) | not yet run: a person's | not yet run: a person's |
| Add-feed dialog, from a zip | pass | pass | pass | pass | pass | fixed (C1) | not yet run: a person's | not yet run: a person's |
| Add-feed dialog, from an address | pass | pass | pass | pass | fixed (C5) | fixed (C1, C5) | not yet run: a person's | not yet run: a person's |
| Add-feed progress line | pass (Cancel takes focus) | pass (`role="img"` sentence, a live sentence beside it) | pass | pass | pass | pass | not yet run: a person's | not yet run: a person's |
| Remove-feed confirmation | fixed (D8) | pass | pass | pass | pass | pass | not yet run: a person's | not yet run: a person's |

### Project, above the tabs

| Part | Keyboard | Labels | Focus visible | Reduced motion | Contrast (warm-dark) | Contrast (sepia) | VoiceOver (macOS) | Narrator (Windows) |
|---|---|---|---|---|---|---|---|---|
| Fields | n/a | pass (a definition list) | n/a | n/a | pass | pass | not yet run: a person's | not yet run: a person's |
| Inspect: mode, operator, the feed's entry | fixed (D7) | pass | pass | pass | fixed (C2) | fixed (C1, C2) | not yet run: a person's | not yet run: a person's |
| Inspect: the two tables | pass | pass (captions, `th scope`, `aria-sort`) | pass | pass | pass | pass | not yet run: a person's | not yet run: a person's |
| Inspect: sortable headers | fixed (D11) | pass | pass | pass | pass | pass | not yet run: a person's | not yet run: a person's |
| Layout run and its progress line | fixed (D1) | pass | pass | pass (the marks' transitions off) | pass | fixed (C1) | not yet run: a person's | not yet run: a person's |
| Re-layout warning | fixed (D1, D8) | pass | pass | pass | pass | fixed (C1) | not yet run: a person's | not yet run: a person's |
| Tab strip (Map, Export) | pass (one stop, arrows, Home, End) | pass | pass | pass | pass | pass | not yet run: a person's | not yet run: a person's |

### Project, Map tab

| Part | Keyboard | Labels | Focus visible | Reduced motion | Contrast (warm-dark) | Contrast (sepia) | VoiceOver (macOS) | Narrator (Windows) |
|---|---|---|---|---|---|---|---|---|
| Diagnostics panel | fixed (D9) | pass | pass | pass (the tooltip's fade off) | pass | pass | not yet run: a person's | not yet run: a person's |
| Service day and date control | fixed (D3) | pass | pass | pass | fixed (C4) | fixed (C1, C4) | not yet run: a person's | not yet run: a person's |
| Line colours | pass | pass (every control names its line) | pass | pass | pass | fixed (C1) | not yet run: a person's | not yet run: a person's |
| Colour picker | pass (sliders take the arrows; hex field) | pass | fixed (D10) | pass | pass | fixed (C1) | not yet run: a person's | not yet run: a person's |
| Line order | pass | pass | pass | pass | pass | pass | not yet run: a person's | not yet run: a person's |
| Theme switch | pass | pass (`aria-pressed`, a named group) | pass | pass | pass | fixed (C1) | not yet run: a person's | not yet run: a person's |
| Geographic view | pass (`+`, `-`, arrows, `0`) | pass (pane named, the counts); finding (F2) | pass | pass | pass | fixed (C1) | not yet run: a person's | not yet run: a person's |
| Viewer frame | finding (F3) | pass (the frame's title) | engine's (F1) | engine's (F1) | engine's (F1) | engine's (F1) | not yet run: a person's | not yet run: a person's |
| Rename form | pass (focus returns to Rename) | pass | pass | pass | pass | fixed (C1) | not yet run: a person's | not yet run: a person's |
| Delete confirmation | fixed (D8) | pass | pass | pass | pass | pass | not yet run: a person's | not yet run: a person's |

### Project, Export tab

| Part | Keyboard | Labels | Focus visible | Reduced motion | Contrast (warm-dark) | Contrast (sepia) | VoiceOver (macOS) | Narrator (Windows) |
|---|---|---|---|---|---|---|---|---|
| Preset, storyboard, view, quality | pass | pass | pass | pass | fixed (C2) | fixed (C2) | not yet run: a person's | not yet run: a person's |
| Frame switches, lines to keep | pass | pass (`fieldset` and `legend`) | pass | pass | fixed (C3) | fixed (C3) | not yet run: a person's | not yet run: a person's |
| Start time, filename tag | pass | pass | pass | pass | fixed (C5) | fixed (C5) | not yet run: a person's | not yet run: a person's |
| Export, its progress line, Cancel, Reveal | fixed (D2) | pass | pass | pass | pass | fixed (C1) | not yet run: a person's | not yet run: a person's |
| Preview in the viewer's frame | finding (F3) | pass | engine's (F1) | engine's (F1) | engine's (F1) | engine's (F1) | not yet run: a person's | not yet run: a person's |

### Settings

| Part | Keyboard | Labels | Focus visible | Reduced motion | Contrast (warm-dark) | Contrast (sepia) | VoiceOver (macOS) | Narrator (Windows) |
|---|---|---|---|---|---|---|---|---|
| Folder rows | fixed (D6) | pass (each names its folder) | pass | pass | pass | pass | not yet run: a person's | not yet run: a person's |
| Logs, Copy diagnostics | pass | pass | pass | pass | pass | pass | not yet run: a person's | not yet run: a person's |
| Theme select | pass | pass | pass | pass | fixed (C2) | fixed (C2) | not yet run: a person's | not yet run: a person's |
| Versions | n/a | pass (a definition list; a null said in words) | n/a | n/a | pass | pass | not yet run: a person's | not yet run: a person's |
| Reset engine data and its confirmation | fixed (D8) | pass | pass | pass | pass | pass | not yet run: a person's | not yet run: a person's |
| Licences section (issue 108) | asserted in the sweep, written, not run (three buttons `aria-disabled` in a development run, kept in the Tab order) | asserted in the sweep, written, not run (a named region; a definition list; each unavailable button described by its reason; a polite `role="status"` line) | asserted in the sweep, written, not run | asserted in the sweep, written, not run | pass (existing pairs: `--text-muted` and `--text` on `--surface`; the unavailable button's look is the kit's existing one) | pass (the same pairs) | not yet run: a person's | not yet run: a person's |
| Bundled tools rows (A6-02) | n/a (no control; the screen's walk is swept with the rows present: asserted in the sweep, written, not run) | pass (a named region; the summary a polite `role="status"`; a definition list, "LOOM tools" and "ffmpeg and ffprobe"): asserted in the sweep, written, not run | n/a | asserted in the sweep, written, not run | pass (existing pairs: `--text-muted` and `--text` on `--surface`) | pass (the same pairs) | not yet run: a person's | not yet run: a person's |

### Jobs inspector

| Part | Keyboard | Labels | Focus visible | Reduced motion | Contrast (warm-dark) | Contrast (sepia) | VoiceOver (macOS) | Narrator (Windows) |
|---|---|---|---|---|---|---|---|---|
| Toggle, heading, Close, Escape | pass | pass | pass | pass (no slide at any setting) | pass | pass | not yet run: a person's | not yet run: a person's |
| Jobs: progress line, Cancel, Copy log, Details | pass | pass (each names its job) | pass | pass | pass | pass | not yet run: a person's | not yet run: a person's |
| Below 900px, over the main region | audit only (the main region `inert`; not in the sweep) | audit only | audit only | audit only | pass | pass | not yet run: a person's | not yet run: a person's |

### First-run dialog (A6-02)

Added after the pass, with the first-run check (specs/026): the sweep's
test "the first-run dialog, and Settings with the Bundled tools rows",
launched with `SCHEMATIC_LOOM_BIN` an empty folder. **Written, not run**: its
cells say "asserted in the sweep" and become pass or a defect once it runs.

| Part | Keyboard | Labels | Focus visible | Reduced motion | Contrast (warm-dark) | Contrast (sepia) | VoiceOver (macOS) | Narrator (Windows) |
|---|---|---|---|---|---|---|---|---|
| The dialog: its details disclosure, Copy diagnostics, How to install, OK | asserted in the sweep: OK focused on opening, the Tab walk reaches the disclosure and the three buttons, Escape closes it; written, not run | asserted in the sweep (labelled by its title, described by its sentences); written, not run | asserted in the sweep (the global `:focus-visible` ring); written, not run | asserted in the sweep; written, not run | pass (existing pairs: `--text`, `--text-muted` on `--surface-raised`, the kit's buttons) | pass (the same pairs; the primary button as C1) | not yet run: a person's | not yet run: a person's |
| Focus after it closes | asserted in the sweep: back on the Library's heading; if what held focus when it opened has gone, the open screen's heading takes it (`FirstRunDialog.tsx`, with `focusHandback.ts`'s `focusLost`); written, not run | n/a | n/a | n/a | n/a | n/a | not yet run: a person's | not yet run: a person's |
| Waiting for another dialog | audit and e2e (`tests/e2e/first-run.spec.ts`): it never opens over a dialog a person has open, or over the mismatch dialog, and opens when that one closes, taking focus then | n/a | n/a | n/a | n/a | n/a | not yet run: a person's | not yet run: a person's |

### Mismatch dialog

| Part | Keyboard | Labels | Focus visible | Reduced motion | Contrast (warm-dark) | Contrast (sepia) | VoiceOver (macOS) | Narrator (Windows) |
|---|---|---|---|---|---|---|---|---|
| The dialog and OK | pass | pass | pass | pass | pass | fixed (C1) | not yet run: a person's | not yet run: a person's |

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
  (`ServiceDay.tsx`). Asserted in the sweep.
- **D4. A project made from the Library's empty state.** The button that
  opened the dialog goes with the empty state; focus lands on the new
  project's row (`Library.tsx`). Asserted in the sweep.
- **D5. A removed feed.** Its row takes its Remove with it; focus goes to the
  Feeds heading once the confirmation has closed and the list has been
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
  next one open idle and stay open. A stalled request holding the dialog is
  a finding for filing, below.

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

Contrast, all in the token stylesheets and asserted in
`tests/unit/contrast.test.ts`:

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

Reduced motion needed no fix: the stylesheet already turns every transition
and animation off, pseudo-elements and the dialog backdrop included, and the
kit's shadow roots carry none of their own. `tests/unit/reduced-motion.test.ts`
now keeps that rule in place and the stylesheet free of animations.

## Findings for filing

Each too large for this pass: a change to the engine's page, a new control,
or a design decision.

- **F1. The animation page's own accessibility is unchecked.** *Screen:*
  project, Map and Export tabs (the viewer's frame). *Steps:* open a laid-out
  project; Tab past the panels into the map; use its controls; turn on
  reduced motion; switch the project's theme. *What a person meets:* the
  page's controls, their names and focus, whether its moving trains honour
  reduced motion or can be paused (WCAG 2.2.2), and its contrast in both
  themes are the engine's, behind an opaque origin the app cannot inspect
  and does not draw. An engine issue: an accessibility pass over
  `page.html`.
- **F2. The geographic view has no text alternative beyond its counts.**
  *Screen:* project, Map tab, "Where the routes run". *Steps:* lay a project
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
  toolbar moved above it, is a new control or a layout change.

- **F4. A stalled engine request holds a destructive confirmation.**
  *Screen:* the Library's feed removal (and any confirmation whose action
  waits on the engine). *Steps:* remove a feed while the engine is stalled.
  *What a person meets:* a dialog that says the removal is running and
  cannot be stopped, with both buttons unavailable, for as long as the
  sidecar's 600 s inactivity bound; `feeds.remove` has no request deadline
  of its own. Two presses of Escape close it, and nothing else does.

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
  up to step 7 first, or in the same sitting: a project named
  `Los Angeles` on the LA Metro Rail preset, laid out, and a feed added by
  address (Caltrain, as the checklist's step 5). A second, throwaway
  project to delete. Leave **Reset engine data** to the very end.
- **The interface theme** as it comes (Settings, **Theme**, "Follow the
  system"); a screen reader does not see the theme.
- **Where the result goes.** Into the VoiceOver (macOS) or Narrator
  (Windows) cell of the row named in bold in each step below, replacing
  "not yet run: a person's" with one of: `pass`; `finding: #<issue>` (file
  one issue per defect, `type:bug`, with the screen, the steps and what was
  heard); or `not reachable: <why>`. Add a line under the table at the top
  of this file giving the app version, the reader and OS versions and the
  date. The results go in as a pull request that changes only those cells
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

### Library

- **Toolbar (New project, Add feed).** On opening, listen for the heading
  "Library" read first, at level 1 (focus is put there). Tab: **New project**
  and **Add feed**, both buttons; **Add feed** is dimmed until the engine
  is ready.
- **Empty state.** This part needs a Library with no projects, which the
  sitting only has on a new install or after **Reset engine data** at the
  end of Settings below: if you already have projects, skip it now and come
  back to it after the reset. Listen for the status "No projects yet. Pick one of the feeds
  below, or add your own, and make a project from it." and a **New project**
  button after it. Create a project from that button: when the dialog
  closes, listen for focus landing on the new project's row,
  "Open `<name>`" (D4), not on nothing.
- **Project rows.** In the list "Projects", each row is a button
  "Open `<name>`", with its feed and service day read as its description
  ("Feed la-metro-rail, Service day `<day>`").
- **Feed rows (Start a project, Remove).** Listen for the heading "Feeds",
  the lists "Presets" and "Added", each row named for its feed, and the
  buttons "Start a project on `<feed>`" and, on an added feed,
  "Remove `<feed>`". Then, after the add-feed progress line below has
  added a second Caltrain, remove the one no project uses (the two rows
  have the same name; if the removal is refused, it was the other): when the
  confirmation closes, listen for "Caltrain was removed." and focus on the
  "Feeds" heading (D5).
- **Create-project dialog.** Press **New project**. Listen for a dialog
  "New project" with its description "A project draws one feed. Add a feed
  to the Library to see it here.", and focus in the text field "Name",
  required. Tab: the "Feed" pop-up button, **Cancel**, **Create**. Press
  **Create** with the name empty: focus returns to "Name", invalid, with
  "name is required" read with it (`CreateProjectDialog.tsx`). Press Escape
  and listen for focus back on the button that opened it.
- **Add-feed dialog, from a zip.** Press **Add feed**. Listen for a dialog
  "Add a feed", described by "A GTFS zip from your disk, or the address the
  agency publishes it at. …", and focus on **Choose a zip** with
  "No file chosen." read as its description. Press it: the platform's file
  chooser opens (its own reader support is the platform's); cancel it and
  listen for focus back on **Choose a zip**.
- **Add-feed dialog, from an address.** Tab to the text field
  "Or from an address". Type `abc` and press **Add feed**: listen for the
  alert "a feed address starts with http:// or https://" and focus back in
  the field, invalid.
- **Add-feed progress line.** Paste the Caltrain address from the
  checklist's step 5 again and press **Add feed**; the engine keeps it as a
  second feed of the same name. Listen
  for focus moving to **Cancel the add**, a region "Adding the feed", an
  image named "Adding the feed: `<the engine's sentence>`", and the polite
  status reading "downloaded `<n>` of `<n>` bytes" and "checked the feed's
  tables" as they change. Listen for whether the byte count floods speech;
  if it does, that is a finding. (`AddFeedDialog.tsx`)
- **Remove-feed confirmation.** Press **Remove** on an added feed a project
  uses. Listen for a dialog "Remove `<feed>`?", its description, and focus
  on **Cancel**. Press **Remove**: while it runs, listen for the status
  "Removing `<feed>`… It cannot be stopped." and both buttons read as
  dimmed or unavailable while they keep focus (D8); then the alert "One
  project uses this feed; delete the project first." The busy window may
  be too short to hear; write "busy state too quick to hear" in the cell
  beside the result rather than failing it.

### Project, above the tabs

- **Fields.** Open **Los Angeles**. Listen for its name read first as a
  level-1 heading (focus is put there), then a description list: Feed, Mode,
  Agency, Service day, Layout, Created, Modified, each term with its value.
- **Inspect: mode, operator, the feed's entry.** Listen for the heading
  "In the feed", the status "Reading the feed, and downloading it first if
  it is not on this machine yet…" if it is still reading, and the pop-up
  button "Mode" with its value. Choose another mode: listen for the sentence
  "The feed's own entry draws `<mode>` for every operator." and a button
  **Use the feed's entry**; press it, and listen for focus landing on
  "Mode" with the entry's value (D7). The "Operator" pop-up button appears
  whenever the project has an agency, or its feed names more than one
  operator: go back to the Library, press **Start a project on Mexico City
  Metro**, name it `Mexico City`, open it, and listen for "Operator" with
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
- **Layout run and its progress line.** Press **Lay out again** (or
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
- **Tab strip (Map, Export).** Tab to the tab list "The project's map, and
  its export". Listen for the tab "Map", selected, 1 of 2. Right Arrow:
  "Export", selected, and its panel shown; Left Arrow, Home and End move
  too, and Tab leaves the strip in one press.

### Project, Map tab

- **Diagnostics panel.** After a run in this session, listen for the heading
  "What the build had to fudge", the status sentence ("No caveats: nothing
  was fudged, and the issues score is `<n>`." or "`<n>` caveats, and an
  issues score of `<n>`, where 0 is clean."), and the table "What the
  engine measured drawing the map for `<day>`". Tab to a button
  "What `<measure>` means", collapsed, and listen for its explanation read
  as its description; press it (expanded), press Escape, and check that the
  explanation is no longer shown and focus has not moved (D9). Press **Copy as text** and
  listen for "The figures and the caveats are on the clipboard."
- **Service day and date control.** Listen for the heading "Service day",
  the status "Drawn for `<day>`. The feed covers `<start>` to `<end>`; the
  busiest weekday, counted from `<anchor>`, is `<day>`.", and the date field
  "Draw for another day". Change the date and press **Draw for this day**:
  listen for focus on the "Service day" heading (D3) and the rebuild's end.
  Press **Use the busiest weekday** and listen for focus in the date field.
  Type a date outside the window and press **Draw for this day**: listen for
  focus back in the field, invalid, with "The feed covers `<start>` to
  `<end>`." read with it.
- **Line colours.** Listen for the heading "Line colours", the list
  "Lines", and in each row the line's label, the feed's colour, where the
  shown colour comes from ("the colour in the feed, `#rrggbb`"), a button
  "Choose the colour of line `<label>`", collapsed, and a button
  "Reset line `<label>` to the colour in the feed", dimmed until the line
  has a colour of its own. Before the list, not inside it, is the row
  "Lines with no colour in the feed", with the button "Choose the colour of
  lines the feed leaves uncoloured".
- **Colour picker.** Press **Choose** on a line: listen for expanded, and a
  group "Colour for line `<label>`" holding the sliders "Color" and "Hue",
  each read with its value, and the text field "Hex value" and the button
  **Use this colour**. Move each slider with the arrow keys and listen for
  the value changing. Press Escape: the picker goes and focus is back on
  **Choose**. Type a hex value that is not one, press **Use this colour**,
  and listen for "A colour is six hexadecimal digits, such as 0072bc." read
  with the field when you return to it.
- **Line order.** Listen for the heading "Line order" and an ordered list
  "Lines in the order they are drawn", each row read with its position
  ("1 of 6"), its label, and the buttons "Move line `<label>` up" (dimmed on
  the first) and "Move line `<label>` down" (dimmed on the last). Press
  **Down** on the first line: listen for the status "`<label>` is now 2 of
  `<n>`." and focus staying on that line's button as the list redraws. Move
  a line to the end and listen for focus handed to its **Up** when **Down**
  is dimmed. Press **Back to alphabetical**: "The lines are in alphabetical
  order again." and focus on the "Line order" heading.
- **Theme switch.** Listen for the heading "Theme" and the group "The theme
  this map is drawn in" with the buttons "Warm dark" and "Sepia", the
  current one pressed. Press the other and listen for it pressed and the
  first not. Start a run (Lay out again) and listen for both buttons dimmed,
  the status "The theme waits until the run that is going has finished: …",
  and focus on the "Theme" heading if it was on a button.
- **Geographic view.** Listen for the heading "Where the routes run", the
  group "Stage" with toggle buttons "gtfs2graph" and "loom" (the current one
  pressed), the description list "Counts" (Nodes, Stations, Junctions,
  Edges, Lines), and a focusable group "The gtfs2graph stage, as the feed
  draws its routes" described by "Zoom with the wheel or plus and minus, pan
  by dragging or with the arrows, 0 to fit." Press `+`, `-`, an arrow and
  `0` on it; nothing is announced for them, and the drawing itself is not
  read (F2).
- **Viewer frame.** Tab past the panels. Listen for the frame named
  "`<project>`, animated" in a region "Map". Going on into it reaches the
  engine's page and its own controls, which are the engine's (F1) and stand
  in the Tab order before the project's toolbar (F3); note what is read in
  the cell, and whether you could get past it.
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

### Project, Export tab

- **Preset, storyboard, view, quality.** Choose the **Export** tab. Listen
  for the heading "Export" and the pop-up buttons "Preset" (its options
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
- **Preview in the viewer's frame.** With the tab open, listen for the
  frame now named "`<project>`, as the export will frame it". What is in it
  is the engine's (F1, F3).

### Settings

- **Folder rows.** Press **Settings**. Listen for the heading "Settings"
  (focus is put there), then "Back to Library", and under the heading
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
  "Follow the system", "Warm dark" and "Sepia". Change it and listen for the
  new value; change it back.
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
  read dimmed with "not bundled in a development run", and a press says it
  again.
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

## Left for a person

- VoiceOver on macOS and Narrator on Windows over every row above, after the
  release tag: the two columns in each table, following
  [Walking it with a screen reader](#walking-it-with-a-screen-reader).
- The end-to-end sweep's first run, and this record corrected by what it
  finds; the first-run dialog's test (A6-02) has not run yet.
- A look at the sepia primary button (C1).
