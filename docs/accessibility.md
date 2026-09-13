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
   failed and were changed. The confirmation's second press (D8), the
   confirmed re-layout (D1) and focus a person moved being left alone were
   added after, and have not run yet. Where a defect below says
   "asserted in the sweep", that is the test that covers it; until a green
   run of the whole spec it is written, not proven. The sweep searches the
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

### Jobs inspector

| Part | Keyboard | Labels | Focus visible | Reduced motion | Contrast (warm-dark) | Contrast (sepia) | VoiceOver (macOS) | Narrator (Windows) |
|---|---|---|---|---|---|---|---|---|
| Toggle, heading, Close, Escape | pass | pass | pass | pass (no slide at any setting) | pass | pass | not yet run: a person's | not yet run: a person's |
| Jobs: progress line, Cancel, Copy log, Details | pass | pass (each names its job) | pass | pass | pass | pass | not yet run: a person's | not yet run: a person's |
| Below 900px, over the main region | audit only (the main region `inert`; not in the sweep) | audit only | audit only | audit only | pass | pass | not yet run: a person's | not yet run: a person's |

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
  heard with no control under the keyboard. Both buttons now stay focusable
  and say `aria-disabled` while the action runs, and neither a press nor
  Escape's cancel is taken then, so a repeated Enter cannot land on Cancel
  and close the dialog as cancelled over a project already deleted
  (`ConfirmDialog.tsx`, `kit/Button.tsx`). Asserted in the sweep with two
  Enters on a refused feed removal.

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

## Left for a person

- VoiceOver on macOS and Narrator on Windows over every row above, after the
  release tag: the two columns in each table.
- The end-to-end sweep's first run, and this record corrected by what it
  finds.
- A look at the sepia primary button (C1).
