# Feature Specification: Design system foundations

**Feature Branch**: `A2-00-design-system-foundations`

**Created**: 2026-09-07

**Status**: Draft; no open questions (the one convention the design document left ambiguous, the theme attribute, is decided under [Assumptions](#assumptions))

**Input**: Planned issue A2-00 (GitHub #45). `docs/DESIGN.md` and ADR-026 fix what the interface looks like: four colour tiers from the brand's six tokens, two type tracks, a 4px grid, FigUI3's MIT core as the control kit behind an adapter, Phosphor icons, the native select, and a mark and a progress line drawn from Beck's vocabulary. The screens that exist (the header and status line, the Library, the project view, three dialogs) were built before it. This feature lays the foundations once and brings those screens onto them, before the feed chooser (A2-01) adds more interface.

---

## Overview

Everything a person sees in the app today is functional scaffolding: one panel, system font at 16px, four colours. The design system says what it should be, with numbers. This feature turns the document into files the code uses (the theme tokens, the type and space scale, the control kit, the icons), proves the colour choices by a test rather than by eye, restyles the existing screens so the app reads as one system in both themes, and builds the two pieces the document names as the app's own: the mark and the progress line. It adds no screen and no behaviour; a person can do exactly what they could before, and it looks and moves as the document says.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The app reads as one system in both themes (Priority: P1)

A person opens the app in the warm-dark theme and in sepia and sees the same interface in the brand's colours at the document's density: a compact header with the engine's status, a Library whose rows are dense and legible, dialogs that match, prose where there is prose. Every text and control is readable against its ground, in both themes, with nothing to squint at.

**Why this priority**: It is the foundation the later screens are built on; a token set proven now is never re-proved.

**Independent Test**: Launch in each theme, read the Library and open each dialog; run the contrast test over the token file.

**Acceptance Scenarios**:

1. **Given** the app in either theme, **When** any screen shows, **Then** every colour on it comes from the semantic tokens of the design document, and the unit test that recomputes contrast for every text pair (at least 4.5) and every control pair (at least 3.0) passes in both themes.
2. **Given** the Library with projects, **When** it is read, **Then** rows are 28px high with the name in the interface text colour at 13px and the meta line in the faint colour at 12px, and the hovered and selected rows use the document's surface steps.
3. **Given** a dialog, **When** it opens, **Then** its title is 15px, its body uses the prose track, its actions sit to the right with the safe action focused first, and it closes on Escape as before.
4. **Given** the system switches its colour preference while the app is open, **When** the change arrives, **Then** every component, including every control from the kit, changes theme with no element left in the old one.

---

### User Story 2 - Controls come from one kit (Priority: P1)

The buttons, inputs, checkboxes and selects a person uses are consistent with one another in size, spacing, focus and state, and behave the same from the keyboard.

**Why this priority**: The feed chooser, the settings and the style screens will add dozens of controls; they must have somewhere to come from.

**Independent Test**: Open the create dialog and the project view; tab through every control; compare with the document's control heights and focus ring.

**Acceptance Scenarios**:

1. **Given** the create dialog, **When** it opens, **Then** its text input, buttons and any select are the kit's elements or the styled native select, at the document's control height, with the shared focus ring.
2. **Given** a kit control, **When** the theme is either one, **Then** its colours are the app's semantic tokens through the adapter, including hover, pressed, disabled and focus, and the two colours the kit hard-codes (native option popups, the checkbox stroke) are covered.
3. **Given** the build, **When** any source file imports the kit's editor or lab bundle, **Then** the build fails with a sentence naming the file and the licence reason.
4. **Given** the notices file, **When** it is read, **Then** it carries the kit's core licence (MIT), the library the kit vendors (ISC) and Phosphor (MIT), and no longer lists the Calcite UI icons as the app's own once the engine page stops shipping them (until then, the row says where they are).

---

### User Story 3 - Icons and the mark (Priority: P2)

Where the interface uses an icon, it is a Phosphor glyph at 16px in controls or 24px in an empty state, in the text's colour, with a label; the empty Library shows the app's mark; the app's icon on the desktop is the same mark.

**Why this priority**: The status line, the toolbar and the dialogs are the first places icons appear; the mark is the app's face from the first launch.

**Independent Test**: Read the status line in each state, the empty Library, and the built app's icon.

**Acceptance Scenarios**:

1. **Given** the status line, **When** the engine is in any state, **Then** a 16px icon for that state precedes the sentence, in the same colour, and a screen reader hears the sentence alone.
2. **Given** an empty Library, **When** it shows, **Then** the mark at 24px, one prose sentence and one primary action are all there is.
3. **Given** the built app, **When** it is installed or run from the build output, **Then** its window and dock or taskbar icon is the mark on the sepia ground, at every size the platforms ask for.
4. **Given** any icon in the tree, **When** the notices are checked, **Then** it is a Phosphor file carried unmodified with the MIT notice, or a glyph drawn by hand to the same grid and said to be so; no Calcite file remains in the app's tree.

---

### User Story 4 - The progress line exists (Priority: P2)

A component draws a run's stages as ticks on a line with the current stage as a hollow diamond, in the document's vocabulary, ready for the first layout run (A3-01) to drive it; until then it is shown with sample data where a developer can look at it.

**Why this priority**: It is the app's one signature component and the first thing A3-01 needs; building it alone lets its geometry be judged before real jobs arrive.

**Independent Test**: Render it with four stages at each state (pending, running, done, failed) in both themes and compare with the document.

**Acceptance Scenarios**:

1. **Given** four stages of which the second is running, **When** the component renders, **Then** the first tick is filled, the second is a hollow diamond in the accent, the rest are ticks, joined by a line whose only direction changes are at 45 degrees, with the stage's sentence beside it at 13px.
2. **Given** a failed stage, **When** it renders, **Then** the mark for it is in the error colour and the sentence says why; nothing animates.
3. **Given** reduced motion is off, **When** a stage completes, **Then** the diamond becomes a filled tick over 200ms; with reduced motion on, at once.

---

### Edge Cases

- The theme changes while a dialog is open: the dialog and its backdrop change with everything else.
- A kit control is used where the kit's default type (11px) would leak through: the adapter's size overrides apply everywhere, checked by reading computed styles in the end-to-end test.
- A Phosphor glyph the interface needs does not exist: it is drawn by hand to the 16 or 24 grid and named in the notices as the app's own; it is never taken from another set.
- The window narrows below 720px: labels beside toolbar icons give way to tooltips; nothing is cut off.
- Windows renders the native select's popup in the platform's style, outside the tokens: accepted by ADR-026.
- High-contrast mode on Windows (forced colours): system colours override the tokens; the app must remain readable, checked by a person.
- A future FigUI3 release changes its licence again: the pinned version and the CI check are what protect the app; upgrading re-reads the licence file.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A theme token file MUST define, per theme, the twelve-step ramp and every semantic token in the design document's section 3 with exactly its values; the brand's six tokens stay the drift-tested copy of the engine page.
- **FR-002**: A unit test MUST read the token files and recompute the contrast of every text pair (text, muted, faint, accent-as-text, each status colour) against the surfaces they are used on and of every control pair (border-strong, accent, focus) against the surfaces, in both themes, failing under 4.5 and 3.0 respectively.
- **FR-003**: The interface MUST expose the two type tracks and the space, size, radius, layer and motion tokens of sections 4, 5 and 7 as custom properties, and use no size, colour or duration literal in a component file.
- **FR-004**: The kit's core MUST be pinned at an exact version and imported by its core entry points only; the build MUST refuse any import of the editor or lab bundles with a message that says why.
- **FR-005**: An adapter stylesheet MUST map the semantic tokens into the kit's variables for both themes, set the colour scheme from the app's theme, override the kit's body type sizes to the interface track, and cover the kit's known hard-coded colours.
- **FR-006**: Each kit element the app uses MUST have a thin wrapper that owns its value and its listeners, so React re-renders never set the element's value attribute directly; the element names MUST be declared for the type checker.
- **FR-007**: The select control MUST be the platform's native select (through the kit's native-select wrapper or styled directly), never the kit's custom listbox.
- **FR-008**: The header, status line, Library, project view and the three dialogs MUST match the design document's component rules (section 8.2) for size, spacing, type and colour in both themes.
- **FR-009**: Icons MUST be Phosphor files carried unmodified under `src/renderer/src/icons/`, the light weight for 16px and the regular weight for 24px, rendered in `currentColor`, each with a text label or an accessible name; the fill weight marks a toggled state.
- **FR-010**: The mark MUST be drawn by hand to the icon grid as the design document describes and used as the empty-state glyph and as the app icon at every platform size the builder needs, on the sepia ground.
- **FR-011**: A progress-line component MUST render stages as ticks on a line with the current stage a hollow diamond and a failed stage in the error colour, with direction changes only at 45 degrees, the stage sentence beside it, and no motion under reduced motion.
- **FR-012**: The notices MUST list the kit's core (MIT), the library it vendors (ISC) and Phosphor (MIT) with their obligations, and MUST say of the Calcite UI icons that they are the engine page's until the engine swaps them.
- **FR-013**: Every screen MUST remain keyboard reachable and labelled, show the shared focus ring on every focusable element, honour reduced motion, and keep every interactive target at least 24 by 24.
- **FR-014**: Nothing this feature adds MAY reach the network at run time; the kit, the icons and the mark ship inside the app.
- **FR-015**: The end-to-end test MUST launch the built app in each theme and read the computed styles of the status line, a Library row and a dialog control against the document's values.

### Key Entities

- **Theme token set**: the brand six, the ramp and the semantic tokens for one theme; two sets, selected by the document element's theme attribute.
- **Kit wrapper**: a React component around one kit element, owning its value and events.
- **Icon**: a Phosphor SVG file at a named weight, or a hand-drawn glyph, referenced by name and size.
- **Progress line**: stages with a state each (pending, running, done, failed) and a sentence; the current stage is the one running.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The contrast test passes for every pair in both themes; the design document's stated ratios and the test's agree to two decimals.
- **SC-002**: A screenshot of the Library, the project view and each dialog in both themes is attached to the pull request, and each matches the document's densities (row height, type sizes, spacing) when measured.
- **SC-003**: No hex colour, pixel size or duration literal exists in a component file; a lint rule or a test says so.
- **SC-004**: A deliberate import of the kit's editor bundle fails the build in CI with the documented message.
- **SC-005**: The end-to-end test reads a 28px row, 13px row text, 12px status text and the focus ring on a control, in both themes, on all three platforms.
- **SC-006**: The app's icon shows the mark on macOS and Windows, checked by a person.
- **SC-007**: VoiceOver reads the status line, a Library row and each dialog as before, with no icon read aloud (checked by a person).

## Assumptions

- **The theme attribute stays the engine's**: `data-theme="sepia"` for the light theme and no attribute for warm-dark, as the engine page and the copied tokens already do; the design document's `dark|light` wording is corrected to match. The setting that lets a person choose arrives with A1-04; until then the OS preference decides, as today.
- **FigUI3 is pinned at 9.0.0**, the version the research verified; `<fig-dropdown>` (in the core, a native-select wrapper) is the styled select.
- **Phosphor is vendored from `@phosphor-icons/core` 2.1.1**, only the files the interface uses, so the tree does not carry 9,000 SVGs; the notices name the package and version.
- **The mark is drawn as an SVG** in the repository and rasterised for the platforms by the builder's icon step; the sepia ground is the brand's `#f7efe1` with the drawing in `#2d241d`.
- **Bundle size** is not a criterion here; the kit's minified core is about 490KB of script and stylesheet together, acceptable for a desktop app that ships nothing over the network.
- **No screen changes its behaviour**; the project lifecycle tests keep passing unchanged except for selectors that follow the new structure.
- **The progress line is not wired** to a job in this feature; it renders from props, with sample data in a development-only page or test.

## Dependencies

- A1-05 (the screens being restyled), ADR-026 and `docs/DESIGN.md`: done.
- A3-01 will drive the progress line; A2-01 and every later interface issue builds on the tokens and the kit.
- E16 on the engine swaps the page's four Calcite icons; until it lands the notices keep the engine's row.
