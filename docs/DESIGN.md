# Design

The design system for Legible Cities: what the app looks like, how dense it
is, what it is made of, and why. It governs everything the app draws around
the map; the map itself is the engine's page and is never drawn here
(constitution, principle I).

Status: written 2026-09-07 from two research passes whose verified findings
are cited at the end, and from the two websites the brand already lives on.
It is the reference every interface issue cites from here on. The three
choices it left open were decided the same day (ADR-026).

## 1. Principles

1. **The map is the engine's.** The app draws chrome: lists, panels,
   dialogs, progress, settings. The generated animation page is embedded
   and driven, never redrawn, restyled or imitated. Nothing in the app's
   palette may be mistaken for a transit line.
2. **Editorial, warm, restrained.** The brand comes from the maintainer's
   portfolio and the Legible Cities website: a warm-dark and a sepia
   theme, an old-style serif for reading, sentences rather than labels,
   nothing decorative. The app extends that identity into dense desktop
   chrome; it does not replace it.
3. **Dense, not cramped.** Controls at 13px on a 4px grid, as Obsidian and
   Figma's plugin surfaces do, so a working screen holds a library, a job
   and a map at once. Prose keeps the websites' 18px rhythm. The two never
   share a scale.
4. **One palette, two themes, every pair checked.** Six brand colours per
   theme are the source; a ramp and a semantic layer derive from them; every
   text and control pair clears WCAG AA in both themes, by test, not by eye.
5. **Allusion, not pastiche.** Harry Beck's 1933 diagram supplies a
   vocabulary (the 45-degree join, the tick, the hollow interchange mark,
   the cream ground) for progress, steps and the mark. The map, the roundel
   and the lettering are Transport for London's and are never reproduced.
6. **Accessible by construction.** Keyboard first, labelled, visible focus,
   polite live regions, reduced motion honoured (constitution, principle
   VI). Density never buys a smaller target than 24 by 24.

## 2. The brand as it exists

Both sites share one stylesheet's worth of decisions, to the digit:

| Trait | Value |
|---|---|
| Themes | warm-dark (default) and sepia, switched by `data-theme` |
| Prose face | `"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif` |
| Prose size | 18px at line height 1.72; 17px under 640px wide |
| Headings | 700 weight in the same serif; display sizes 1.8 to 2.3rem |
| Meta text | 0.86rem, muted colour |
| Corners | 2px on links and inputs; 999px pills for segmented controls and the theme switch |
| Buttons | text-only, muted, underline-on-pressed; 16px icons inside pills |
| Measure | 600px for prose, 960px for figures |
| Tone | "restrained, readable, credible, warm and editorial, typography-first" (the portfolio's brief) |

The app keeps every one of these where it shows prose (help, an empty
state's sentence, an ADR-style explanation) and adds what the sites never
needed: a fixed control scale, semantic colours for states, elevation,
iconography, and components that are operated rather than read.

## 3. Colour

### 3.1 Tiers

Four tiers, as Obsidian structures its variables: the brand six, a neutral
ramp, semantic tokens named for use, and component tokens. Only the brand
six are shared with the engine's page; everything below them is the app's.

**Tier 1, brand (from the engine page, copied with a drift test):**

| Token | Warm-dark | Sepia |
|---|---|---|
| `--bg` | `#15120f` | `#f7efe1` |
| `--bg-soft` | `#1f1915` | `#f0e2cf` |
| `--text` | `#f2ede6` | `#2d241d` |
| `--muted` | `#c3b8aa` | `#655748` |
| `--border` | `#3a2f27` | `#cab9a2` |
| `--focus` | `#81a5ff` | `#4068cf` |

**Tier 2, ramp.** Twelve steps from background to text, interpolated in
sRGB, private to the theme files. The brand's soft background, border and
muted text already sit on it.

| Step | Warm-dark | on bg | Sepia | on bg |
|---|---|---|---|---|
| 0 | `#15120f` | 1.00 | `#f7efe1` | 1.00 |
| 1 | `#1e1b18` | 1.09 | `#efe7d9` | 1.08 |
| 2 | `#272420` | 1.21 | `#e7dfd1` | 1.16 |
| 3 | `#322e2b` | 1.39 | `#ddd5c8` | 1.27 |
| 4 | `#3d3936` | 1.63 | `#d3cabe` | 1.42 |
| 5 | `#4a4743` | 2.02 | `#c7beb2` | 1.61 |
| 6 | `#5c5854` | 2.65 | `#b6aea2` | 1.92 |
| 7 | `#726e69` | 3.69 | `#a29a8f` | 2.43 |
| 8 | `#8f8a85` | 5.46 | `#887f75` | 3.44 |
| 9 | `#b0aba6` | 8.19 | `#6a6158` | 5.31 |
| 10 | `#d1ccc6` | 11.70 | `#4b423a` | 8.59 |
| 11 | `#f2ede6` | 16.02 | `#2d241d` | 13.31 |

**Tier 3, semantic.** What components use. Contrast is against the
theme's `--bg` unless noted; the implementation carries a unit test that
recomputes every pair.

| Token | Use | Warm-dark | Sepia |
|---|---|---|---|
| `--surface` | the window ground | `--bg` | `--bg` |
| `--surface-raised` | panels, cards, dialogs | `--bg-soft` | `--bg-soft` |
| `--surface-sunken` | inputs, wells, the log | step 2 | step 2 |
| `--surface-hover` | a list row under the pointer | step 2 | step 1 |
| `--surface-selected` | the current item | step 3 | step 3 |
| `--border` | dividers, cards | `--border` | `--border` |
| `--border-strong` | inputs at rest, table rules (≥ 3.0) | step 7 `#726e69` 3.69 | step 8 `#887f75` 3.44 |
| `--text` | prose and labels | `--text` | `--text` |
| `--text-muted` | secondary labels (≥ 4.5) | `--muted` 9.56 | `--muted` 6.11 |
| `--text-faint` | timestamps, counts (≥ 4.5) | step 8 `#8f8a85` 5.46 | step 9 `#6a6158` 5.31 |
| `--accent` | links, the primary action, the current step | `#81a5ff` 7.78 | `#4068cf` 4.49 |
| `--accent-text` | accent used as text (≥ 4.5) | `#81a5ff` | `#2f56b8` 5.85 |
| `--on-accent` | text on an accent fill | `#15120f` 7.78 | `#f2ede6` 4.40, use 700 weight or 15px+ |
| `--focus` | the focus ring | `--focus` | `--focus` |
| `--success` | a finished job, a green tick | `#5fb37a` 7.30 | `#2f7a4f` 4.58; `#276a44` on raised |
| `--warning` | a caveat the engine reports | `#e0a83a` 8.74 | `#8a5a10` 5.18 |
| `--error` | a failure, a refused input | `#e0574a` 5.00 | `#b3261e` 5.72 |
| `--selection` | text selection | `--accent` at 30% | `--accent` at 25% |

Status colours are per theme by necessity: no single red, amber or green
clears AA on both grounds. They are never used as fills behind text; a
status fill is the colour at 12 to 16% over `--surface-raised` with the
status colour as the text.

**Tier 4, component tokens** (`--control-height`, `--icon-size`,
`--dialog-width`) live with the components in section 8.

### 3.2 Rules

- Transit line colours belong to the agency and appear only inside the
  engine's page, drawn literally. The app's semantic colours must stay
  visually distinct from them: no line-like saturated strokes in chrome, no
  "the red line means error".
- Every colour in the app is a token. A hex value in a component file is a
  bug; the contrast test reads the token file.
- The theme attribute is the engine's: no attribute is warm-dark and
  `data-theme="sepia"` is the light theme, on `<html>`, as the engine page
  and the copied tokens already do. The OS preference chooses until the
  setting arrives (A1-04); a chosen theme is never overridden by it.
- Elevation is expressed by surface step and a 1px border, never by a
  shadow larger than 0 1px 2px at 20% black; the engine's page is flat and
  the app sits beside it.

## 4. Typography

### 4.1 Two tracks

Obsidian's separation, kept exactly: a fixed pixel scale for chrome, a
relative scale for reading. Controls never inherit prose size and prose
never shrinks to control size.

**UI track (fixed, px):**

| Token | Size | Line height | Use |
|---|---|---|---|
| `--font-ui-smaller` | 11px | 16px | badges, key hints |
| `--font-ui-small` | 12px | 16px | status line, secondary labels, table cells |
| `--font-ui` | 13px | 20px | the default: lists, buttons, inputs, settings |
| `--font-ui-medium` | 15px | 20px | section headings in panels, dialog titles |
| `--font-ui-large` | 20px | 24px | a screen's title |

**Prose track (relative, the sites' rhythm):**

| Token | Size | Line height | Use |
|---|---|---|---|
| `--font-text` | 18px (17px under 640px) | 1.72 | help panels, empty-state sentences, notes |
| `--font-text-small` | 0.86em | 1.55 | meta lines under prose |
| headings | 1.25rem to 2.3rem, weight 700 | 1.3 | prose headings only |

A window zoom setting scales both tracks together; nothing else couples
them.

### 4.2 Faces

| Role | Stack | Why |
|---|---|---|
| Chrome | `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` | San Francisco on macOS 13+, Segoe UI on Windows 11: what the OS draws its own chrome in, with true intermediate weights from the variable system font. Nothing to bundle, nothing to license. |
| Prose and headings | `"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif` | The sites' stack. Both target platforms ship a Palatino; the app reads as the site does. |
| Numerals | the chrome face with `font-variant-numeric: tabular-nums lining-nums slashed-zero` | Frame counts, clocks, progress fractions align in columns. |
| Code and logs | `ui-monospace, "SF Mono", Menlo, Consolas, monospace` | The sites' stack. |

No font file ships in the first release. Bundling becomes worthwhile only
if renders must match across machines beyond what the engine's page
already guarantees, or if Linux becomes a target. The bundling path,
should it be needed, is documented and licence-checked:

| Candidate | Role | Licence | Notes verified 2026-09-07 |
|---|---|---|---|
| Domitian 1.0.1 | Palatino for prose | OFL 1.1 (also AGPL with font exception, LPPL) | An implementation of Zapf's Palatino from URW Palladio; four static OTFs, no variable, project dormant since 2020 |
| Crimson Pro 1.004 | old-style serif for prose | OFL 1.1, no reserved name | variable and 16 statics, statics auto-hinted, active |
| Source Serif 4.005 | serif with optical sizes | OFL 1.1, reserved name "Source" | use the TTF variable files on Windows (Adobe warns of a CFF2 bug) |
| Literata 3.103 | screen serif | OFL 1.1, no reserved name | designed for screens; two variable TTFs |
| Inter 4.1 | chrome sans | OFL 1.1, no reserved name | variable files unhinted; statics hinted; what FigUI3 expects when present |

OFL obligations if any of these ships: keep the licence text in
`THIRD_PARTY_NOTICES.md`, ship the files unmodified with their name tables
intact, and do not subset or rehint a face that declares a reserved name
(a subset is a Modified Version and must be renamed).

## 5. Space, size and shape

**Grid.** 4px, named by base and multiple as Obsidian does, with a 2px set
for icon-to-label gaps only:

`--space-2-1` 2px, `--space-2-2` 4px, `--space-2-3` 6px;
`--space-4-1` 4px, `--space-4-2` 8px, `--space-4-3` 12px, `--space-4-4`
16px, `--space-4-5` 20px, `--space-4-6` 24px, `--space-4-8` 32px,
`--space-4-12` 48px, `--space-4-16` 64px.

**Control sizes** (component tokens, deliberately off the grid where the
platform is):

| Token | Value |
|---|---|
| `--control-height` | 28px (dense), 32px in dialogs and settings |
| `--control-height-small` | 24px (toolbar buttons, chips) |
| `--icon-size` | 16px in controls; 24px in empty states and the mark |
| `--target-min` | 24px: no interactive element smaller in either dimension |
| `--radius-small` | 2px (inputs, links: the sites' value) |
| `--radius` | 4px (buttons, cards, list rows) |
| `--radius-large` | 8px (dialogs, panels) |
| `--radius-pill` | 999px (segmented controls, chips, the theme switch) |
| `--border-width` | 1px |
| `--focus-ring` | 2px solid `--focus`, offset 2px, radius follows the element |
| `--dialog-width` | 28rem (existing), `--dialog-width-wide` 40rem |
| `--measure` | 40rem for prose panels |
| `--tooltip-width` | 20rem: a tooltip's measure, a sentence or two |

**Layers** (z-index tokens): `--layer-base` 0, `--layer-raised` 10 (sticky
headers), `--layer-overlay` 100 (drawers), `--layer-dialog` 1000 (native
`<dialog>` handles its own top layer), `--layer-toast` 1100.

## 6. Iconography

**Requirements.** Monoline, 16px in controls and 24px in empty states and
headers, outline with a filled variant for toggled states, `currentColor`,
a hand close to Esri's Calcite UI icons (thin, geometric, drawn on a
16-unit grid), shippable inside a GPL-3.0-or-later app with a notices
entry and nothing else, and glyphs for train, map, layers, route,
timeline, clock, play, pause, export, settings.

**The set: Phosphor** (`@phosphor-icons/core` 2.1.1, MIT; ADR-026).
Designed on a 16px grid like Calcite, six weights as separate files
(thin, light, regular, bold, fill, duotone), filled paths rather than
strokes, a 256 viewBox. The **light** weight is the 16px icon in
controls, the **regular** weight the 24px icon in empty states and
headers, and the **fill** weight the toggled state. Icons are vendored as
plain SVG files under `src/renderer/src/icons/` with the MIT notice in
`THIRD_PARTY_NOTICES.md`; a glyph the set lacks is drawn by hand to the
same grid, never borrowed from another set.

Why not the Calcite UI icons the maintainer preferred: the package that
carries only the SVGs (`@esri/calcite-ui-icons` 4.5.0) is under Esri's
Master License Agreement, whose current text (E204, revised 1 August
2025, Article B.1(k)) forbids combining Esri offerings "in a manner that
would subject any Esri Offering to open-source or open-database license
terms (e.g. GPL)". This app is GPL-3.0-or-later; whether unmodified files
with their own notice escape that clause is a legal judgement nobody here
can make. The engine's page ships four of these icons on the same
reasoning and gets its own issue. Tabler (MIT) and Lucide (ISC) were the
runners-up, both 24-grid sets with 2px strokes and heavier at 16px; Remix
Icon is ruled out by its January 2026 licence, which names permissive
hosts only.

**Rules.** Icons are monochrome and inherit `currentColor`; never a second
colour, never a shadow. An icon never carries meaning alone: a label or an
`aria-label` accompanies it. Toggles show state with the filled variant
and `aria-pressed`, as the engine page's segmented control does. Sizes are
tokens; no icon is scaled to an in-between size.

## 7. Motion

Movement exists to explain a change of state, never to decorate. Durations
`--duration-fast` 120ms (hover, focus, toggles) and `--duration` 200ms
(panels opening, rows appearing); easing `cubic-bezier(0.2, 0, 0, 1)`.
Nothing loops; nothing moves while idle. Under `prefers-reduced-motion:
reduce` every transition and animation is off, as the stylesheet already
does globally. Progress is a bar that advances, not a spinner; an
indeterminate state is a static pattern with a live-region sentence. The
map's own animation is the engine's and is untouched.

## 8. Components

### 8.1 FigUI3 as the control kit

FigUI3 supplies the dense, minimal control set the maintainer wants, and
its core is adoptable under the app's licence. Verified at 9.0.0
(2026-09-07):

- **Licence.** Split since 8.9.24: `fig.js`, `fig-layer.js`, `fig.css`,
  `fig-layer.css`, `base.css`, `components.css`, `polyfills/` and their
  `dist/` builds are MIT; `fig-editor.*` and `fig-lab.*` (which carry
  `<fig-select>` and the fill picker) are PolyForm Shield 1.0.0 and cannot
  ship in a GPL app. `package.json` says `SEE LICENSE IN LICENSE`, so
  scanners see nothing; the notices carry the terms by hand, together
  with the vendored `@ungap/custom-elements-builtin` (ISC).
- **Shape.** About fifty framework-agnostic custom elements, no runtime
  dependency, no React, no Figma plugin API; `fig.css` is two imports;
  the core script has no reference to the editor. Runs in Electron 44
  unchanged, with the renderer's sandbox on.
- **Theming.** Entirely through `--figma-color-*` custom properties
  (about 188), with `light-dark()` defaults in one `@layer
  figui.defaults` block, `--figma-focus-outline*` for focus. An unlayered
  override of the variables wins by cascade rule; two hardcoded colours
  (native `<option>` popups, a checkbox stroke) are known leaks.
- **Type.** Inter-first system stack, 11px body on a 16px root, weights
  450 to 550, no `@font-face`: denser than this system's 13px, so the
  body-size tokens are overridden and the chrome face is ours.
- **Maintenance.** One author, eight releases in the three days before
  2026-09-07, a licence change on 2026-08-23. Pin an exact version.

**Adoption rules.**

1. Import only `@rogieking/figui3/fig.css` and `@rogieking/figui3/fig.js`,
   pinned at 9.0.0 as a build-time dependency, so packaging copies none of
   it; a guard in the build refuses any `fig-editor` or `fig-lab` import.
   The select control is the native `<select>` styled with the tokens
   (ADR-026); `<fig-select>` is in the editor bundle and is not used.
   Its popup renders in the platform's own style, which is accepted.
2. One adapter file, `figui-adapter.css`, maps the semantic tokens of
   section 3 into the Figma names (`--figma-color-bg` from `--surface`,
   `--figma-color-bg-secondary` from `--surface-raised`,
   `--figma-color-text` from `--text`, `--figma-color-text-secondary` from
   `--text-muted`, `--figma-color-border` from `--border`,
   `--figma-color-border-selected` and `--figma-focus-outline` from
   `--focus`, the brand, danger and warning families from `--accent`,
   `--error`, `--warning`) and sets `color-scheme` explicitly from the
   app's theme. The brand tokens stay library-agnostic; if FigUI3 is ever
   dropped, the adapter is what goes.
3. Each used element gets a thin React 19 wrapper that owns a `ref` for its
   value and listeners (the library's own React guidance), and a local
   `.d.ts` declares the `fig-*` intrinsic elements. No value is set in JSX
   during a re-render.
4. FigUI3's body-size tokens are overridden to the UI track (13px default,
   12px small, 15px medium) and `--line-height` to 20px; its numerals
   token is applied to every numeric readout.
5. Verify by doing, at adoption: that the unlayered override wins over
   every component rule in both themes, and that the two known leaks are
   covered by the adapter.

### 8.2 The app's own components

Where the platform or the existing code already does it right, FigUI3 is
not used:

| Component | Rule |
|---|---|
| Dialogs | native `<dialog>` with `showModal()`, as the create, confirm and mismatch dialogs already are; title 15px, body prose track, actions right-aligned, the safe action focused first, Escape cancels; width `--dialog-width` |
| Lists (Library, feeds, jobs) | rows of `--control-height`, 13px, name in `--text`, meta in `--text-faint` at 12px (`--text-muted` on a selected row, where faint falls under 4.5), the whole row a button, `--surface-hover` and `--surface-selected`, a 1px `--border` between groups only |
| Status line | one line, 12px, `role="status"` `aria-live="polite"`, a 16px icon for the state, never animated; sits in the header on every screen |
| Progress and steps | the Beck vocabulary (section 10): a line with ticks per stage, the current stage a hollow diamond in `--accent`, done stages filled, the sentence from the engine beside it at 13px; cancel is a text button to the right |
| Toolbar | 24px controls in a row with `--space-2-2` gaps, segmented groups as pills, labels visible at 13px until the window is narrower than 720px, then icons with tooltips |
| Panels and settings | a 15px heading, rows of label at 13px and control at `--control-height` 32px, `--space-4-3` between rows, `--space-4-6` between groups, one column |
| Empty states | a 24px icon, one prose sentence, one primary action; the Library's "first feed" call to action is one (A2-01) |
| Errors and hints | the engine's `hint` sentence verbatim in `--error` at 13px beside the control or in the status line; `detail` only in the log; never a toast for something a person must act on |
| Tooltips | 12px, `--surface-raised`, 1px `--border`, 200ms delay, keyboard-reachable through focus |
| The viewer | the engine's page in an iframe filling the main region, no chrome of the app's over it; its controls are its own |
| Tables (routes, route types) | a real `<table>` with a `<caption>` and `<th scope>`; the UI track at 12px, rules in `--border` under the header and between rows, numbers in `--numerals` aligned in their column, a header that sorts is a button styled as its label with `aria-sort` on the cell; a row the choice leaves out reads in `--text-faint`; a colour swatch is a `--space-4-3` square beside a name, never a drawing (A2-02) |
| The geographic pane | the engine's stage drawing (SVG) in an iframe with an empty `sandbox`, sized to the drawing and moved by transforms on the frame from the interface: wheel and drag, `+`, `-`, the arrows and `0` on a focusable pane named for a screen reader; the pane the viewer's shape, `--surface-sunken`, clipped; the two stages a pressed-state pair of buttons with the engine's stage names; counts as the engine sent them; no transition under reduced motion (A2-03) |
| The diagnostics panel | what the build had to fudge (A3-03): the engine's caveat sentences as prose, verbatim and in its order, with the issue score in the same line; the figures under the table rule above, two columns, measure and figure; each row's explanation on a `--target-min` text button carrying the info icon, shown on hover, on focus and on a press (the only way a touch user can ask), with `aria-expanded` saying whether it is showing and `aria-describedby` naming it so a screen reader reads it without a pointer, in the tooltip's own style; "Copy as text" a text button that copies exactly what is on screen |
| Date control | the platform's native `<input type="date">`, as the select is native (ADR-026): `--control-height`, the tokens for text, surface and border, `min` and `max` from the data so an impossible day cannot be picked, the message beneath referenced by the control; its popup renders in the platform's own style, which is accepted |
| Deliverables | an export that finished says the file's name in prose and offers "Reveal", a text button that opens the file's folder in the platform's file browser; the path is never shown, and the folder is the person's own (A1-04) |

## 9. Layout and window

Native title bar on both platforms for now; a custom one arrives only with
a reason and an ADR. Three regions when a project is open: a left rail
for the Library and navigation (`--space-4-16` wide collapsed, 240px
open), the main region (the viewer or a screen), and a right inspector
for the project's fields, diagnostics and jobs (A1-03, A3-03; 320px,
collapsible). The header holds the screen title at 20px, the status line
and the theme control. Minimum window 640 by 480 as today; below 900px the
inspector collapses first. The prose measure applies inside panels;
lists and tables fill their region.

## 10. Motifs from Beck

What the 1933 diagram verifiably did: only vertical, horizontal and
45-degree segments; short ticks for ordinary stations and diamonds for
interchanges, later circles; a line colour set that changed within its
first year (the Central line was orange, the Bakerloo red, before 1934);
lettering in Johnston, whose O is a circle. Design writers' caution is that
its rules are London's and not universal, that a fixed angle set applied as
doctrine is its own dogma, and that the design lives in execution detail:
the size of a tick, blob or diamond.

**Used, sparingly:**

- **The progress line.** Stages as ticks on a horizontal line, the current
  stage a hollow diamond, a finished run a filled end mark; a change of
  direction only ever at 45 degrees. This is the app's one signature
  component, on the layout, map and export screens.
- **The mark** (ADR-026). The app icon and the empty-state glyph: a
  45-degree join with a hollow interchange diamond, in the brand's text
  colour on the sepia ground, or in the accent on warm-dark. Drawn by
  hand to the icon grid; not a map excerpt. The app icon is the same
  drawing on the sepia ground at every platform size.
- **The ground.** The sepia theme is the cream of the pocket map already.
- **Ticks as dividers** in timelines and the jobs drawer.

**Never:** the map or any part of it, the roundel, TfL's line colours
as a system, Johnston or a clone of it for chrome (Hammersmith One, OFL,
regular weight only, is the nearest open face and is fit only for a
wordmark if one is ever wanted), or a colour-coded meaning borrowed from a
transit line. TfL treats the diagram as its copyright and has removed
derivatives.

## 11. Voice

Sentences, present tense, sentence case, no exclamation marks. Button
labels are verbs ("New project", "Run layout", "Cancel"). The engine's
`hint` is shown as written; the app adds nothing in front of it. Numbers
carry units and align in tables. Spelling follows the code base's British
conventions ("licence", "colour"). A screen says what the person can do
next before it says what went wrong.

## 12. Accessibility, made concrete

- Every control reachable by Tab in reading order; every list navigable by
  arrow keys; every dialog trapped, Escape closes, focus returns.
- Focus is `--focus-ring` on every focusable element, never removed.
- Contrast: text ≥ 4.5, controls and icons ≥ 3.0, in both themes; the
  token file's pairs are asserted by a unit test.
- Live regions: the status line is polite; a finished or failed job is
  announced once; nothing else speaks unprompted.
- Targets ≥ 24 by 24 even at the dense control height.
- Reduced motion turns all motion off; nothing is conveyed by motion
  alone.
- Every icon-only control has an `aria-label`; every image an
  alternative; the viewer iframe a title.
- Checked with VoiceOver and Narrator for each screen before its issue
  closes.

## 13. Decisions and open questions

Settled here:

- Plain CSS custom properties are the token format. Electron 44 runs
  Chromium 152, which supports `light-dark()`, `color-mix()`, `@layer`,
  `:has()`, container queries and relative colour syntax (full since
  Chromium 131), so nothing is missing. Files: `tokens.css` (the brand six
  per theme, copied from the engine page, drift-tested), `theme.css` (the
  ramp and the semantic tokens per theme, on `:root` and `:root[data-theme="sepia"]`), `scale.css` (type, space, sizes, motion),
  `figui-adapter.css`. The DTCG format (2025.10, a stable Community Group
  report, not a W3C standard) and a build with Style Dictionary 5.5.3
  (Apache-2.0) or Terrazzo 2.7.1 (MIT) become worth it only when a third
  consumer of the tokens appears; the current copy-and-test sync is the
  lighter form of the pattern GitHub's Primer uses with a published
  package.
- FigUI3 core at 9.0.0, MIT only, behind an adapter and wrappers.
- Two type tracks, system faces, no bundled fonts.
- The Beck vocabulary as above and no further.

Decided by the maintainer on 2026-09-07 and recorded in ADR-026:

1. **Icons:** Phosphor, for the reasons in section 6; the engine's page
   gets an issue to swap its four Calcite icons.
2. **FigUI3's select:** the native `<select>`, styled with the tokens.
3. **The mark:** as section 10 draws it.

## 14. Applying it

Order of work, as one issue before the feed chooser (A2-01) builds more
interface on the old scaffolding:

1. `theme.css` with the ramp and semantic tokens, a contrast unit test
   over every pair in both themes, and the header, status line, dialogs
   and Library restyled to sections 3 to 5 and 8.2.
2. FigUI3 core pinned, the adapter, the wrappers for the controls the
   Library and dialogs use, the build guard, the notices entry.
3. Phosphor vendored as plain SVG files with its notice; the status line
   and toolbar take their icons; the mark drawn.
4. The progress component (section 10), ready for A3-01.

Every later interface issue cites the sections it applies and adds its
component's rules here if new.

## 15. Sources

Verified in the research passes of 2026-09-07, primary sources read
directly:

- FigUI3: https://github.com/rogie/figui3 (LICENSE, README, components.css at 9.0.0); https://www.npmjs.com/package/@rogieking/figui3; PolyForm Shield 1.0.0: https://polyformproject.org/licenses/shield/1.0.0; FSF licence list: https://www.gnu.org/licenses/license-list.en.html
- Obsidian: https://docs.obsidian.md/Reference/CSS+variables/CSS+variables and its Typography, Spacing, Colors, Radiuses and Icons pages; https://obsidian.md/blog/1-0-theme-migration-guide
- Esri Calcite UI icons: https://github.com/Esri/calcite-design-system/blob/dev/packages/ui-icons/README.md; `@esri/calcite-ui-icons` 4.5.0 LICENSE.md; Esri Master Agreement E204 (revised 1 August 2025): https://www.esri.com/en-us/legal/terms/full-master-agreement/mla-e204-e300-english; https://developers.arcgis.com/calcite-design-system/resources/licensing/
- Icon sets: https://github.com/lucide-icons/lucide (LICENSE, 1.42.0); https://github.com/tabler/tabler-icons (LICENSE, 3.46.0); https://github.com/phosphor-icons/core (LICENSE, 2.1.1); Remix Icon licence v1.0 (January 2026)
- Typefaces: https://github.com/dbenjaminmiller/domitian; https://github.com/adobe-fonts/source-serif (4.005R); https://github.com/Fonthausen/CrimsonPro (1.004); https://github.com/googlefonts/literata (3.103); https://github.com/rsms/inter (v4.1); the OFL 1.1 text and FAQ: https://openfontlicense.org/ofl-faq/; SIL, Webfonts and Reserved Font Names
- Design tokens: https://tr.designtokens.org/format/ (2025.10); https://styledictionary.com; https://github.com/terrazzoapp/terrazzo; https://github.com/primer/primitives
- Platform: Electron 44 release notes (Chromium 152, macOS 13+); Chromium's `font_cache_mac.mm` and `system_fonts_win.cc` for how `system-ui` resolves; caniuse for relative colour syntax
- Beck: V&A E.816-1979 (the 1933 second edition); Rob Waller, Eye 85 (2013), on Roberts' *Underground Maps Unravelled* and Garland's *Mr Beck's Underground Map*; the Wikipedia articles on the Tube map and on Johnston, used only for the 1933 to 1934 colour changes and the lettering, both flagged for confirmation against Garland
