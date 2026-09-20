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

1. **The map is the engine's; the lines are the brand's; neither is a
   state.** The app draws chrome: lists, panels, dialogs, progress,
   settings. The generated animation page is embedded and driven, never
   redrawn, restyled or imitated. The four brand lines - vermilion,
   cobalt, saffron and jade - are identity: they carry the icon, the
   lockup, the progress line and the header rules, and they are never a
   status and never stand beside one. A status has its own hue, and always
   an icon and a word with it.
2. **Editorial, warm, restrained.** The brand comes from the maintainer's
   portfolio and the Legible Cities website: two grounds, an old-style
   serif for reading, sentences rather than labels, nothing decorative.
   The interface's two are Night and Parchment, named for what they are
   rather than for the engine's; the app extends that identity into dense
   desktop chrome without replacing it.
3. **Dense, not cramped.** Controls at 13px on a 4px grid, as Obsidian and
   Figma's plugin surfaces do, so a working screen holds a library, a job
   and a map at once. Prose keeps the websites' 18px rhythm. The two never
   share a scale.
4. **One palette, two themes, every pair checked.** The interface's own
   ground and ink are the source; a ramp and a semantic layer derive from
   them; every text and control pair clears WCAG AA in both themes, by
   test, not by eye. The palette is the app's, not the engine's: the map
   keeps the engine page's colours and the two no longer have to agree
   (ADR-044).
5. **Allusion, not pastiche.** Harry Beck's 1933 diagram supplies a
   vocabulary (the tick, the hollow interchange mark, the cream ground)
   for progress and steps. The mark is no longer one of them: it is the
   brand's own icon (ADR-044). The map, the roundel
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

Four tiers, as Obsidian structures its variables: the brand, a neutral
ramp, semantic tokens named for use, and component tokens. All four are
the app's own. They were once the engine page's six, copied and drift
tested; ADR-044 separated them, because the app's stylesheets have not
been able to reach the map since its frame was given an opaque origin, and
a project's map theme and a person's interface theme have been independent
choices since A4-03. `tokens.css` is still the engine page's copy and is
still drift tested, but nothing loads it.

**Tier 1, the interface's ground and ink.** Night is the dark theme, which
takes no attribute; Parchment is the light one, at `data-theme="sepia"`.
The identifiers are the engine's because a project's map wears the
engine's two and the ids must keep matching; the names are the
interface's, and name only these colours.

| Token | Night | Parchment |
|---|---|---|
| `--bg` | `#1a1410` | `#f5e6c8` |
| `--bg-soft` | `#211c17` | `#e9dabe` |
| `--text` | `#f5ead8` | `#2d241d` |
| `--muted` | `#c4bbac` | `#5c5347` |
| `--border` | `#37322d` | `#c0b39b` |
| `--focus` | `#6f9bff` | `#2a5bb5` |

**Tier 1, the brand lines.** Four, and identity rather than state
(principle 1). They are what the icon, the lockup, the progress line and
the header rules are drawn in. They are never text, never a status, and
never a transit line: an agency's colours belong to the agency and are
drawn literally inside the engine's page.

| Token | Night | Parchment |
|---|---|---|
| `--line-vermilion` | `#f05a40` | `#d6402a` |
| `--line-cobalt` | `#6f9bff` | `#2a5bb5` |
| `--line-saffron` | `#f5ad35` | `#eb9a1c` |
| `--line-jade` | `#3fb47c` | `#1d8757` |
| `--station-fill` | `#1a1410` | `#fffaf0` |
| `--station-ink` | `#f5ead8` | `#2d241d` |

Cobalt is the accent: `--accent` and `--focus` are it, in both themes.

**Tier 2, ramp.** Twelve steps from ground to ink, private to the theme
files. Each step was solved on the ground-to-ink line in linear light to
hold the contrast its predecessor had against its own ground, since the
old ramp matched no simple interpolation. The soft background, border and
muted text sit on it.

| Step | Night | on bg | Parchment | on bg |
|---|---|---|---|---|
| 0 | `#1a1410` | 1.00 | `#f5e6c8` | 1.00 |
| 1 | `#221d18` | 1.09 | `#eddec1` | 1.08 |
| 2 | `#2a2621` | 1.21 | `#e5d6ba` | 1.16 |
| 3 | `#34302a` | 1.39 | `#dacdb2` | 1.28 |
| 4 | `#3f3b35` | 1.64 | `#d0c2a9` | 1.42 |
| 5 | `#4e4842` | 2.02 | `#c3b79f` | 1.61 |
| 6 | `#5f5a52` | 2.67 | `#b3a791` | 1.92 |
| 7 | `#767066` | 3.72 | `#9e9380` | 2.45 |
| 8 | `#938c80` | 5.47 | `#837969` | 3.47 |
| 9 | `#b5ad9f` | 8.20 | `#655c4f` | 5.33 |
| 10 | `#d8cebe` | 11.72 | `#453d34` | 8.65 |
| 11 | `#f5ead8` | 15.32 | `#2d241d` | 12.33 |

**Tier 3, semantic.** What components use. Contrast is against the
theme's `--bg` unless noted; the implementation carries a unit test that
recomputes every pair.

| Token | Use | Night | Parchment |
|---|---|---|---|
| `--surface` | the window ground | `--bg` | `--bg` |
| `--surface-raised` | panels, cards, dialogs | `--bg-soft` | `--bg-soft` |
| `--surface-sunken` | inputs, wells, the log | step 2 | step 2 |
| `--surface-hover` | a list row under the pointer | step 2 | step 1 |
| `--surface-selected` | the current item | step 3 | step 3 |
| `--border` | dividers, cards | `--border` | `--border` |
| `--border-strong` | inputs at rest, table rules (≥ 3.0) | step 7 `#767066` 3.72 | step 8 `#837969` 3.47 |
| `--text` | prose and labels | `--text` | `--text` |
| `--text-muted` | secondary labels (≥ 4.5) | `--muted` 9.60 | `--muted` 6.12 |
| `--text-faint` | timestamps, counts (≥ 4.5) | step 8 `#938c80` 5.47 | step 9 `#655c4f` 5.33 |
| `--accent` | links, the primary action, the current step | cobalt 6.78 | cobalt 5.22 |
| `--accent-text` | accent used as text (≥ 4.5) | cobalt 6.78 | `#2753a6` 5.93, since cobalt itself is 4.09 on a selected row |
| `--on-accent` | text on an accent fill | `--bg` 6.78 on `--accent` | `--bg` 5.22 on `--accent` |
| `--focus` | the focus ring | `--focus` | `--focus` |
| `--success` | a finished job, a green tick | `#5fb37a` 7.13 | `#2f7a4f` 4.24 |
| `--success-strong` | a finished job in words (≥ 4.5) | `#5fb37a` 7.13 | `#276a44` 5.27 |
| `--warning` | a caveat the engine reports | `#e0a83a` 8.54 | `#83560f` 5.16 |
| `--error` | a failure, a refused input | `#e0574a` 4.89 | `#b3261e` 5.30 |
| `--selection` | text selection | `--accent` at 30% | `--accent` at 25% |

Status colours are per theme by necessity: no single red, amber or green
clears AA on both grounds. They are never used as fills behind text; a
status fill is the colour at 12 to 16% over `--surface-raised` with the
status colour as the text.

**Which ground a colour may be drawn on.** The figures above are against
`--surface`. On the denser grounds some of them fall short, so the rule is
the narrow one that holds in both themes:

- `--error`, `--warning` and `--border-strong` are drawn on `--surface`
  and `--surface-raised` only. Night's `--error` is 4.03 on `--surface-sunken`
  and 3.51 on `--surface-selected`; Parchment's `--border-strong` is 2.99
  on sunken.
- `--text-faint` additionally misses on `--surface-selected`: 3.93 in
  Night, 4.18 in Parchment. `--success-strong` misses there in Parchment
  only, at 4.13; it holds in Night, at 5.13.
- `--text`, `--text-muted`, `--accent`, `--accent-text` and `--focus` clear
  their thresholds on every ground in both themes.

**Tier 4, component tokens** (`--control-height`, `--icon-size`,
`--dialog-width`) live with the components in section 8.

### 3.2 Rules

- Transit line colours belong to the agency and appear only inside the
  engine's page, drawn literally. The brand's four lines are not those and
  never stand for them: they are identity, and they never carry a status.
  A status keeps its own hue and never appears as a bare stroke - it has an
  icon and a word, so "the red line means error" stays impossible.
- Every colour in the app is a token. A hex value in a component file is a
  bug; the contrast test reads the token file.
- The theme attribute is the engine's: no attribute is the dark theme and
  `data-theme="sepia"` is the light one, on `<html>`, because a project's
  map wears the engine's two and the identifiers must keep matching. Only
  the names a person reads are the interface's - Night and Parchment in
  Settings, while a project's map switch still says Warm dark and Sepia,
  which is what the engine draws. The OS preference chooses until a person
  chooses (A1-04); a chosen theme is never overridden by it.
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
| `--picker-size` | 200px: the colour picker's square, big enough to aim in |

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

**The mark is the one exception**, and it is not an icon in this sense: it
is the identity, and the identity is four coloured lines (ADR-044). It
takes the `--line-*` tokens rather than `currentColor`, which is also how
it follows Night and Parchment from one file. It is never given a meaning,
never stands for a state, and is never used where a glyph is wanted - the
set above is for that. It is drawn at 24px or larger: below that the four
lines and the gaps where they cross collapse into noise, which is why the
header lockup takes the large size rather than the control size.

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
   `--focus`, the brand, danger and warning families from `--accent`
   (the brand *fill* from `--accent-text`, which is `--accent` in
   warm-dark and the darker blue in sepia, so `--on-accent` clears 4.5 on
   it; A6-07),
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
| Dialogs | native `<dialog>` with `showModal()`, as the create, confirm and mismatch dialogs already are; title 15px, body prose track, actions right-aligned, the safe action focused first, Escape cancels; width `--dialog-width`; while a confirmed action runs the dialog stays modal and takes nothing: both buttons keep their names and focus with `aria-disabled`, refuse every press and are drawn unavailable (the kit's variant tokens pointed at `--surface-sunken` and `--text-faint`), the first Escape is refused, and a `role="status"` line inside says what is running in the caller's words and that it cannot be stopped; if the platform closes it anyway (a second Escape) the screen is told at once, and a refusal that arrives afterwards is said on that screen while it is still open, never after a person has left it (A6-07) |
| Lists (Library, feeds) | rows of `--control-height`, 13px, name in `--text`, meta in `--text-faint` at 12px (`--text-muted` on a selected row, where faint falls under 4.5), the whole row a button, `--surface-hover` and `--surface-selected`, a 1px `--border` between groups only |
| Status line | one line, 12px, `role="status"` `aria-live="polite"`, a 16px icon for the state, never animated; sits in the header on every screen |
| Progress and steps | the Beck vocabulary (section 10): a line with ticks per stage, the current stage a hollow diamond in `--accent`, done stages filled, the sentence from the engine beside it at 13px; cancel is a text button to the right; the controls a run offers change as it moves - Lay out gives way to Cancel, Cancel to Lay out again, Export to Cancel to Reveal - and focus on the one that went is handed to the one that came, without scrolling, only when the control that last took focus there can no longer hold it and focus has nowhere else to be; a press on prose forgets it (A6-07) |
| Toolbar | 24px controls in a row with `--space-2-2` gaps, segmented groups as pills, labels visible at 13px until the window is narrower than 720px, then icons with tooltips |
| Panels and settings | a 15px heading, rows of label at 13px and control at `--control-height` 32px, `--space-4-3` between rows, `--space-4-6` between groups, one column |
| Empty states | a 24px icon, one prose sentence, one primary action; the Library's "first feed" call to action is one (A2-01) |
| Errors and hints | the engine's `hint` sentence verbatim in `--error` at 13px beside the control or in the status line; `detail` only in the log, or in a failed job in the inspector behind a closed "Details" disclosure; never a toast for something a person must act on |
| Tooltips | 12px, `--surface-raised`, 1px `--border`, 200ms delay, keyboard-reachable through focus |
| The viewer | the engine's page in an iframe filling the main region, no chrome of the app's over it; its controls are its own. While the export tab is open the same frame is the export's preview (A5-01): sent to the address the engine planned, sized to the preset's aspect ratio as large as the viewer's shape allows and centred on `--surface-sunken`, with the frame, title, clock and safe zones the page's own drawing; resized over `--duration` and not at all under reduced motion |
| Skip past the map (issue 106) | the bypass-blocks pattern (WCAG 2.4.1) for the viewer's frame, whose page puts every one of its own controls in the Tab order: a native button "Skip past the map" immediately before the frame, on both tabs wherever the frame is, out of sight but in the Tab order at rest (clipped to `--border-width`, as the visually hidden line is) and shown only while it holds focus - absolutely placed at its own spot, so it lies over the frame's top edge and moves nothing as it appears and goes, on `--surface` with a 1px `--border`, `--accent-text` underlined at 13px, at least `--target-min` high, `--radius-small`, the focus ring every control has with a `--surface` halo under it as wide as the offset and twice the ring - the ring lies over the engine's page, which is drawn in the project's theme and not the interface's (A4-03), so without it a dark interface's ring over a sepia map falls near 2:1 - scrolled clear of the sticky header, and no transition at any motion setting. A press sends focus to the project's toolbar after the frame: its first button that can take it (Rename, or Delete project while Rename is disabled), or the screen's heading when neither can, which does not happen in practice (Rename is disabled only on a read-only project, Delete only while that project's run or export goes, and a read-only project starts neither) and is there so a press never leaves focus nowhere. The toolbar gains no role or name of its own, so Tab onto Rename says nothing more than it did. It never reaches into the frame (ADR-028), and a person who wants the map presses Tab again and walks into it. There is no reverse control: Shift+Tab from the toolbar still walks back through the map, since a second skip after the frame would put a stop between the map and Rename for everyone going forwards |
| Tables (routes, route types) | a real `<table>` with a `<caption>` and `<th scope>`; the UI track at 12px, rules in `--border` under the header and between rows, numbers in `--numerals` aligned in their column, a header that sorts is a button styled as its label with `aria-sort` on the cell; a row the choice leaves out reads in `--text-faint`; a colour swatch is a `--space-4-3` square beside a name, never a drawing (A2-02) |
| The geographic pane | the engine's stage drawing (SVG) in an iframe with an empty `sandbox`, sized to the drawing and moved by transforms on the frame from the interface: wheel and drag, `+`, `-`, the arrows and `0` on a focusable pane named for a screen reader; the pane the viewer's shape, `--surface-sunken`, clipped; the two stages a pressed-state pair of buttons with the engine's stage names; counts as the engine sent them; no transition under reduced motion (A2-03) |
| The diagnostics panel | what the build had to fudge (A3-03): the engine's caveat sentences as prose, verbatim and in its order, with the issue score in the same line; the figures under the table rule above, two columns, measure and figure; each row's explanation on a `--target-min` text button carrying the info icon, shown on hover, on focus and on a press (the only way a touch user can ask), with `aria-expanded` saying whether it is showing and `aria-describedby` naming it so a screen reader reads it without a pointer, in the tooltip's own style; "Copy as text" a text button that copies exactly what is on screen; Escape sends every showing explanation away without moving the pointer or the focus (WCAG 1.4.13), and each comes back once both have left its row, or on a press (A6-07) |
| Date control | the platform's native `<input type="date">`, as the select is native (ADR-026): `--control-height`, the tokens for text and surface and a resting edge in `--border-strong`, `min` and `max` from the data so an impossible day cannot be picked, the message beneath referenced by the control; its popup renders in the platform's own style, which is accepted |
| Colour control (A4-01) | one row per line: a `--space-4-3` swatch in the line's own colour as an inline style from the record, the label at 13px, what the feed publishes and where the colour came from in `--text-muted` at 12px, then Choose and Reset; the picker is a disclosure under its row, `--surface-raised` with a 1px `--border`, holding react-colorful's square at `--picker-size` and a hex field from the kit beside it, so a colour can be set without a pointing device; it stays open until it is dismissed - a press outside its row, Escape, or its own toggle again - because every pointer event inside it is a colour and a disclosure that closed on the first one made a drag impossible (issue 87); the dismissal is on the click and not the press, since a picker leaving the flow between a button being pressed and released moves everything below it and the press is then delivered to neither; only the hex field's own button means "finished", and that is what hands focus back to the toggle; every control names the line it acts on; nothing is disabled while another run reads the project's page - the change waits and builds once the way is clear, because a control that disables itself under a person's hands takes the focus with it and a refused change is a lost one |
| Order control (A4-02) | one row per line, in the order the map draws them: the place as a figure in `--text-muted` at 12px, right-aligned and `--numerals` so the names line up, then the same `--space-4-3` swatch the colour control has, the label at 13px, then Move up and Move down; the place is said once, as that figure - the list is an `<ol>`, which tells a screen reader the position itself, and the status line says it again after a move; each names the line it moves, and the one at the end of the list it cannot move towards is disabled, with focus handed to its opposite before it goes; the move is said in a `role="status"` line, because a button whose name does not change tells a screen reader nothing, and the same line says the panel is waiting while another run or an export holds the page, since that wait is minutes rather than the usual fraction of a second; "Back to alphabetical" a text button in a toolbar, disabled when there is nothing to put back; nothing is disabled while another run reads the project's page, as the colour control is not; no drag handle, which would put the feature out of reach of the keyboard |
| Theme switch (A4-03) | the project's own theme, not the interface's: the two the engine's page draws, as a segmented pair in the toolbar shape the geographic view's stage toggle uses - the chosen one `primary` with `aria-pressed`, the pair in a group named for what it sets - under a 15px heading and one sentence saying that the interface has its own and neither follows the other. Not disabled while the write is in flight, because a button that disables itself under a person's hands takes the focus with it, and a press that arrives then is kept and applied after it; disabled while a run or an export is going - a run rewrites the page file in place and the change would reload the frame onto half a document, and an export took the theme when it planned, so a change now would not reach the reel - with a `role="status"` line inside the section saying so, since the run's own panel is elsewhere and tied to this by nothing a screen reader can follow, and focus handed to the heading before the buttons go, because a debounced colour or order change closes the way with nobody pressing anything |
| Tabs (A5-01) | the WAI-ARIA tabs pattern with real buttons, not FigUI3's `fig-tabs`, whose mutation observer and scroll buttons would fight React for the children: a `tablist` named for what it chooses between, one tab stop for the strip, Left and Right moving between tabs and choosing the one they land on (wrapping), Home and End to the ends, `aria-selected` and `aria-controls` on each tab, each panel a `tabpanel` labelled by its tab and a tab stop of its own (`tabindex="0"`), so Tab from the strip reaches it even when it holds nothing focusable. Text tabs at 13px, at least `--control-height-large` high, over a 1px `--border` rule: the chosen one in `--text` at the strong weight with a `--focus-ring-width` underline in `--accent`, the rest in `--text-muted`, `--surface-hover` under the pointer. A panel not chosen is hidden and stays mounted, because it may hold work a person has started - a colour waiting to be drawn, a time half typed. Which tab is open is where a person is looking, not a setting, and is not stored |
| Export tab (A5-01) | a 15px heading, one sentence saying the map shows the export's frame while the tab is open, then panel rows in one column: the preset as a native select with an `<optgroup>` per platform, each option the engine's name, its size and what it makes; the storyboard as a native select for a video or GIF preset only, each option its views and length, the preset's own marked; the engine's refusal of the choice in `--error` at 13px directly under those two, where the choice was made, and Export disabled until the choice changes; the view as a native select, for a still only, since a storyboard's first beat names its own view and clock; the quality as a native select, and for a JPEG still (the engine's table says which) a disabled select at standard with one message line saying the engine makes a JPEG still at standard quality only; the frame's three switches and the lines to keep as native checkboxes in `<fieldset>`s whose `<legend>` reads as a field's label, `accent-color` from `--accent`, each row at least `--target-min`; the start time (a still's only) and the filename tag as the kit's text field with their rule beneath as the field's message, written when committed (Enter or leaving the field), never on each keystroke, and a sentence in `--error` there when the engine's pattern refuses it; then the export's own progress line, cancel and Reveal. Every choice is written to the project the moment it is made. While an export runs the choices are disabled, with a `role="status"` line saying why and focus handed to the heading first; a saved choice the engine no longer offers falls back to the reel and a `role="status"` line names what was dropped |
| Inspector (A1-03) | the window's right-hand region, `<aside>` named "Inspector", beside whichever screen is open: `--inspector-width` wide on `--surface` with a 1px `--border` on its left, sticky under the header and scrolled on its own; below 900px it is fixed over the main region on `--surface-raised` at `--layer-overlay` instead of squeezing it, and the main region is `inert` while it is covered, so Shift+Tab cannot reach controls a person cannot see; the header, and the toggle that closes it, stay reachable. It opens from a header toggle - a secondary button with the layers icon, "Jobs" and, while any run, "N running", its accessible name "Jobs, N running" or "Jobs, none running", `aria-expanded` - and is rendered only while open. Opening moves focus to its 15px "Jobs" heading; closing, from the toggle, its Close text button or Escape anywhere inside, returns focus to the toggle. It appears and goes without a slide, at every motion setting. It starts collapsed and never opens by itself |
| Jobs (A1-03) | a list with no bullets in the inspector, running jobs first and then the finished ones newest first, at most twenty of those, a `--border` rule between jobs: each an `<li>` named by its heading - the project's name (or "Feeds") in `--text` at the strong weight and the job's label beneath in `--text-muted`, the heading focusable so focus can be handed to it - then its state and start time in `--text-faint` at 12px, the run's own progress line scrolled sideways rather than shrunk so its stage names stay 12px, the last sentence, and when it failed the engine's hint in `--error` and its detail, when it says more, behind a native `<details>` closed by default in the monospaced track at 12px. Cancel (while running) and "Copy log" are text buttons in a toolbar, each naming the job it acts on; Cancel hands focus to the job's heading before it goes. "Copy log" says in a `role="status"` line that the log is on the clipboard with the keys in web addresses taken out and the home folder written as `~`, or why not. A job's end is said once, politely, in a visually hidden line on every screen - "<project>: <label>, <state>." - never repeating the hint; the line is emptied and filled a frame later, so the same sentence twice is spoken twice. Cancel hands focus to the job's heading, and if the job then moves below a running one the list gives the heading the focus again - only after a press of Cancel, and never once focus or a pointer has landed outside that job, so focus a person moved is not taken back. No absolute path is on screen |
| Deliverables | an export that finished says the file's name in prose and offers "Reveal", a text button that opens the file's folder in the platform's file browser; the path is never shown, and the folder is the person's own (A1-04) |
| First-run dialog (A6-02) | the dialog row above, as the mismatch dialog: a 15px title naming each tool that will not run ("LOOM will not run", "LOOM and ffmpeg will not run"), then each tool's sentence as prose - what failed and what it stops, maps for LOOM and exports for ffmpeg - and one sentence saying the Library still opens and how to put it right; each tool's detail, which never holds an absolute path, behind a native `<details>` closed by default in the job detail's style (the monospaced track at 12px in `--text-muted`); "Copy diagnostics" and "How to install" secondary and "OK" primary and focused first, right-aligned; the copy's outcome in a `role="status"` line above the actions. Shown once per start and never over another dialog - the mismatch dialog, or one a person has open to create a project, add a feed or confirm a removal - which it waits for, opening when that one closes; once shown it stays, and a dialog a person opens over it is theirs; nothing on the page names the install document's address |
| Bundled tools (Settings, A6-02) | a 15px "Bundled tools" heading, the check's summary as a message in a polite `role="status"` line that changes when the check ends, then a definition list in the versions rows' style with one row per tool, "LOOM tools" and "ffmpeg and ffprobe", each outcome as a sentence: checking, ran with its time, not checked and why, or the failure's sentence and detail |
| Licences (Settings, issue 108) | a 15px "Licences" heading, one message sentence naming the app's licence, then the components the installers carry as a definition list in the versions rows' style - the name as the term in `--text-muted`, its licence as the value - from the one list in `src/shared/licences.ts`; then "Open the notices", "Show the licence texts" and "Open Chromium's licences", secondary buttons each with the info icon in a toolbar of its own. A file that is not there to open (every one, in a development run) leaves its button in place and in the Tab order, `aria-disabled` and drawn unavailable, with a message beneath saying why, which is the button's accessible description (`docs/accessibility.md`, F5, fixed in issue 113); a press says it again, emptied and written a frame later so a second press is said too, in the section's polite `role="status"` line, which also says why a file would not open. Nothing is disabled outright, since a disabled button leaves the Tab order and takes its reason with it. No path is shown |
| Folder and version rows (Settings) | a folder's path is the one place a path is shown, because it is the person's own choice: the monospaced track at 12px, `--text` on `--surface-sunken`, wrapped rather than cut, under a 13px label, with its source beneath as a message ("the default", "chosen here", "set in the environment") and the actions under that; a folder waiting for a restart reads in `--warning`; a folder the environment names carries no action at all. Versions are a definition list, the term in `--text-muted`, the value as the engine sent it; a field the engine reports as null reads as a sentence saying so, never as a blank (A1-04) |

## 9. Layout and window

Native title bar on both platforms for now; a custom one arrives only with
a reason and an ADR. Three regions are planned: a left rail for the
Library and navigation (`--space-4-16` wide collapsed, 240px open), the
main region (the viewer or a screen), and a right inspector (320px,
collapsible). The header holds the screen title at 20px, the status line,
the inspector's toggle and the way into Settings, which is where the theme
control went: it is a choice made once, not a switch to flick, and it sits
with the other things the app decides for itself (A1-04). Minimum window
640 by 480 as today. The prose measure applies inside panels; lists and
tables fill their region. The inspector is the window's, not a project's,
because jobs span projects (ADR-036): it sits beside all three screens, the
Library and Settings included, and below 900px it covers the main region
rather than squeezing it.

Deliberately absent from this layout for now (ADR-036):

| Not yet | Why |
|---|---|
| The left rail | three screens and a Back button navigate well enough; a rail is worth its width when there is more to reach |
| The project's fields and diagnostics in the inspector | they stay on the project screen, where they are read beside the map; the inspector holds only the jobs, which are the one thing that spans projects |

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
- **The mark** (ADR-044, superseding ADR-026's). The app icon, the header
  lockup and the empty-state glyph: two pairs of lines, one running
  straight through and one crossing it and stepping down on two rounded
  bends, in the four brand colours. The app icon carries its own ground and
  its stations; the interface's copy drops the stations, which are mush
  below 64px, and takes the ground from the surface it sits on, so what is
  left is the lines. Not a map excerpt, and not a picture of any city's
  network: it is six fixed paths, and it is never drawn from a project's
  data. A preview of a map is the engine's page, as principle 1 says.
- **The ground.** The sepia theme is the cream of the pocket map already.
- **Ticks as dividers** in timelines. The inspector's jobs use a plain
  rule for now; a tick there waits until the list has groups to divide.

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
- The pass over every screen is `docs/accessibility.md`: keyboard, labels,
  focus, reduced motion and contrast checked in code and in
  `tests/e2e/accessibility.spec.ts` (A6-07), with the VoiceOver and
  Narrator columns a person's.
- Checked with VoiceOver and Narrator for each screen before its issue
  closes.

## 13. Decisions and open questions

Settled here:

- Plain CSS custom properties are the token format. Electron 44 runs
  Chromium 152, which supports `light-dark()`, `color-mix()`, `@layer`,
  `:has()`, container queries and relative colour syntax (full since
  Chromium 131), so nothing is missing. Files: `theme.css` (the
  interface's ground and ink, the brand lines, the ramp and the semantic
  tokens per theme, on `:root` and `:root[data-theme="sepia"]`),
  `scale.css` (type, space, sizes, motion), `figui-adapter.css`.
  `tokens.css` is the engine page's own two blocks, drift-tested and
  loaded by nothing (ADR-044). The DTCG format (2025.10, a stable Community Group
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
