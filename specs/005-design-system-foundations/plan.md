# Implementation Plan: Design system foundations

**Branch**: `A2-00-design-system-foundations` | **Date**: 2026-09-07 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/005-design-system-foundations/spec.md`; the design in `docs/DESIGN.md`; the decisions in ADR-026.

## Summary

Turn `docs/DESIGN.md` into files the renderer uses: `theme.css` (the ramp
and the semantic tokens per theme, on the engine's `data-theme`
convention), `scale.css` (the two type tracks, the 4px grid, control sizes,
radii, layers, motion), `figui-adapter.css` (the semantic tokens mapped
into FigUI3's variables, its type sizes overridden, its two hard-coded
colours covered), FigUI3 9.0.0 core pinned and imported by its two core
entry points with a build plugin that refuses the editor and lab bundles,
React wrappers for the elements the screens use, Phosphor's light and
regular glyphs vendored as plain files with an `Icon` component, the mark
as an SVG plus the builder's PNG, the existing screens restyled, and a
`ProgressLine` component rendered from props. Two unit tests hold the
system to its own numbers: a contrast test over every token pair in both
themes, and a no-literals test over the component files. The end-to-end
test reads computed styles in each theme through Electron's `nativeTheme`.

## Technical Context

**Language/Version**: TypeScript 5.9, React 19.2 (custom elements
supported natively), Electron 44 (Chromium 152: `light-dark()`,
`color-mix()`, `@layer`, container queries all available).

**Primary Dependencies**: `@rogieking/figui3` pinned exactly at 9.0.0 (MIT
core; the editor and lab halves are PolyForm and never imported). No other
dependency: Phosphor's SVGs are vendored files, the mark is drawn here,
the contrast maths is a hundred lines.

**Storage**: none.

**Testing**: Vitest for the contrast test (parses `tokens.css` and
`theme.css`, recomputes WCAG ratios), the no-literals test (scans the
component files), the FigUI3 guard (the plugin's resolver refuses the two
ids), and the icon manifest (every referenced glyph exists, every vendored
file carries Phosphor's notice); Playwright over the built app with
`nativeTheme.themeSource` set to each theme, reading computed styles.

**Target Platform**: as the skeleton; the app icon is generated for macOS
and Windows by electron-builder from one PNG.

**Project Type**: desktop app; renderer only, plus build configuration and
notices.

**Performance Goals**: no visible change in start time; the kit's core is
about 490KB of script and stylesheet, loaded once from the bundle.

**Constraints**: no hex, px or ms literal outside the token files; the
theme attribute is the engine's (`sepia` or none); every colour pair AA
in both themes; no network; the kit's editor bundle refused at build time;
the existing lifecycle and engine end-to-end tests keep passing.

**Scale/Scope**: three token files, one adapter, one guard plugin, four
wrappers, one icon component with about fifteen glyphs, one mark, one
progress component, six restyled components, four unit tests, one e2e
file, the notices, the design document's attribute correction.

## Constitution Check

*GATE: passed before Phase 0; re-checked after Phase 1 design below.*

| Principle or constraint | How this plan complies |
|---|---|
| I. One renderer | Chrome only. The progress line draws a line and marks for the app's own jobs, not transit geometry; the mark is an emblem, not a map. |
| II. The engine is the source of truth | The brand's six tokens stay the drift-tested copy from the engine page; everything else is the app's and derives from them. The theme attribute follows the engine's convention rather than introducing a second one. |
| III. Determinism is a feature | Untouched. |
| IV. No network, no telemetry | The kit, the icons and the mark ship inside the bundle; nothing is fetched. |
| V. Hygiene by tools | The guard plugin refuses the PolyForm half at build time; the notices are updated by hand because the kit's package metadata hides its licence; no path or address enters the tree. |
| VI. Accessible by default | The focus ring token on every focusable element including the kit's; the contrast test; targets at 24px; reduced motion global; the status line's icon is decorative; VoiceOver is a manual check recorded in the pull request. |
| VII. Decisions recorded | ADR-026 covers the three choices; the design document is the record of the rest. The theme-attribute correction is an erratum in the document, not a decision. |
| Never write inside the bundle | Nothing is written. |
| `app://local` is one origin | Unchanged. |
| The renderer holds no Node APIs | The kit is plain DOM; the icons are inline SVG strings bundled by Vite. |
| Child processes | None. |
| GPL-3.0-or-later, third parties listed | FigUI3 core (MIT), `@ungap/custom-elements-builtin` (ISC, vendored inside the kit), Phosphor (MIT) added to the notices; the Calcite row reworded to the engine's. |

**Post-design re-check**: the contracts introduce one judgement call, the
kit's control height. FigUI3 draws its controls at 32px; the document's
dense height is 28px. The adapter sets the kit's spacer that drives
control height to the document's value rather than overriding each
element, and the end-to-end test measures the result.

## Project Structure

### Documentation (this feature)

```text
specs/005-design-system-foundations/
├── plan.md              # This file
├── research.md          # Phase 0: custom elements in React 19, the guard plugin, icons as raw SVG, the theme in e2e, the icon PNG
├── data-model.md        # Phase 1: token tiers and names; the progress line's props
├── quickstart.md        # Phase 1: how to look at it, in both themes
├── contracts/
│   ├── tokens.md        # every token, its value per theme, its contrast
│   └── kit.md           # the adapter mapping, the wrappers' props, the guard
└── tasks.md             # Phase 2
```

### Source Code (repository root)

```text
src/renderer/src/
├── styles/
│   ├── tokens.css         # unchanged: the brand six per theme, drift-tested
│   ├── theme.css          # NEW: ramp and semantic tokens per theme
│   ├── scale.css          # NEW: type tracks, space, sizes, radii, layers, motion
│   ├── figui-adapter.css  # NEW: semantic tokens → --figma-*, type overrides, leak covers
│   └── app.css            # rewritten to the tokens; component rules per DESIGN.md 8.2
├── kit/
│   ├── index.ts           # imports fig.css and fig.js (the only import of the kit)
│   ├── intrinsics.d.ts    # JSX declarations for the fig-* elements used
│   ├── Button.tsx         # wrappers: own the ref, the value and the listeners
│   ├── TextInput.tsx
│   └── Select.tsx         # <fig-dropdown>, the kit's native-select wrapper
├── icons/
│   ├── Icon.tsx           # <Icon name size /> from the vendored files, inline, currentColor
│   ├── phosphor/          # vendored light and regular glyphs, LICENSE, README with the version
│   └── mark.svg           # the app's own drawing
├── ProgressLine.tsx       # NEW
├── App.tsx, EngineStatus.tsx, Library.tsx, ProjectView.tsx,
│   CreateProjectDialog.tsx, ConfirmDialog.tsx, MismatchDialog.tsx   # restyled
build/icon.png             # the mark on the sepia ground, 1024px, from mark.svg
scripts/render-icon.sh     # rsvg-convert, documented; the PNG is committed
electron.vite.config.ts    # + the figui guard plugin
scripts/figui-guard.mjs    # the plugin, unit-testable
package.json               # + @rogieking/figui3 9.0.0 (exact)
THIRD_PARTY_NOTICES.md     # + three rows, one reworded
docs/DESIGN.md             # the theme-attribute erratum
tests/unit/
├── contrast.test.ts, no-literals.test.ts, figui-guard.test.ts, icons.test.ts
tests/e2e/design.spec.ts   # both themes, computed styles
```

**Structure Decision**: three stylesheets with one responsibility each,
so the brand copy stays untouched, the app's tokens are one file the
contrast test reads, and the kit's names live only in the adapter. The kit
is imported from exactly one module so the guard has one place to watch
and a future removal is one deletion.

## Complexity Tracking

No violations. The one dependency added is the kit ADR-026 chose; the
contrast test replaces a tool with a hundred lines of arithmetic.
