# Tasks: Design system foundations

**Input**: Design documents from `specs/005-design-system-foundations/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/tokens.md, contracts/kit.md, quickstart.md

**Tests**: wanted (spec FR-002, FR-015, SC-001, SC-003, SC-004, SC-005).

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [x] T001 Pin `@rogieking/figui3` at exactly `9.0.0` in `package.json` (`npm install --save-exact`), add `scripts/figui-guard.mjs` (a Vite plugin whose `resolveId` throws the ADR-026 sentence for `figui3/(dist/|src/)?fig-(editor|lab)`), register it for the renderer in `electron.vite.config.ts`, and write `tests/unit/figui-guard.test.ts` (forbidden ids throw, `fig.js`/`fig.css` pass)
- [x] T002 [P] Vendor Phosphor 2.1.1: copy the light and regular files for the names in data-model.md's `IconName` (plus `check`, `x` fill for toggled states) into `src/renderer/src/icons/phosphor/`, with `LICENSE` and a `README.md` naming the package, the version and the weights; draw `src/renderer/src/icons/mark.svg` (24 grid, 45-degree join, hollow diamond, `currentColor`)
- [x] T003 [P] Add `scripts/render-icon.sh` (rsvg-convert of `mark.svg` on the sepia ground to `build/icon.png` at 1024px) and commit `build/icon.png`; point `electron-builder.yml` at it if it does not already default to `build/icon.png`
- [x] T004 [P] Add the three notices rows (FigUI3 core MIT with the pinned version; `@ungap/custom-elements-builtin` ISC vendored inside it; Phosphor MIT with the version) and reword the Calcite row to the engine page's, in `THIRD_PARTY_NOTICES.md`; correct `docs/DESIGN.md`'s `data-theme="dark|light"` to the engine's `sepia`/none convention

---

## Phase 2: Foundational

- [x] T005 [P] Write `src/renderer/src/styles/theme.css` with the ramp and semantic tokens per theme from contracts/tokens.md, on `:root` and `:root[data-theme="sepia"]`
- [x] T006 [P] Write `src/renderer/src/styles/scale.css` with every scale token from contracts/tokens.md
- [x] T007 [P] Write `tests/unit/contrast.test.ts`: parse `tokens.css` and `theme.css` (resolve `var()` references and `color-mix` is skipped), recompute WCAG contrast for every pair in contracts/tokens.md in both themes, fail under the stated thresholds, and print the table
- [x] T008 [P] Write `tests/unit/no-literals.test.ts`: scan `src/renderer/src/**/*.{tsx,ts,css}` except `styles/tokens.css`, `styles/theme.css`, `styles/scale.css`, `styles/figui-adapter.css` and `icons/**` for hex colours, `\d+px` and `\d+ms` literals (allowing `0`, `1px` border widths inside `scale.css` only, and SVG attributes in `ProgressLine.tsx` that are grid units), and fail naming the file and line
- [x] T009 Write `src/renderer/src/kit/index.ts`, `intrinsics.d.ts` and `figui-adapter.css` per contracts/kit.md; import `theme.css`, `scale.css`, the kit and the adapter from `main.tsx` in that order after `tokens.css`; verify by doing in `npm run dev` that a `<fig-button>` renders at 28px in both themes and the focus ring is the app's

**Checkpoint**: tokens exist and are proven; the kit renders themed.

---

## Phase 3: User Story 1 - One system in both themes (P1)

- [x] T010 [US1] Rewrite `src/renderer/src/styles/app.css` to the tokens: header (40px, mark, status), panel and list rules per DESIGN.md 8.2 (rows at `--control-height`, name `--font-ui`, meta `--font-ui-small` `--text-faint`, hover and selected surfaces), dialogs (title `--font-ui-medium`, body prose track, actions), fields, messages, focus ring from the tokens, reduced motion
- [x] T011 [US1] Restyle `App.tsx` (header with the mark and the status), `EngineStatus.tsx` (icon per state, 12px), `Library.tsx` (rows, empty state with the mark), `ProjectView.tsx` (fields at 13px, toolbar at 24px controls) to the new classes; keep every role, name and id the smoke test uses
- [x] T012 [US1] Write `tests/e2e/design.spec.ts`: launch, set `nativeTheme.themeSource` to `dark` then `light`, assert `data-theme` follows, read computed styles of the status line (12px), a Library row (28px, 13px), and a kit button (28px, the focus outline colour equals `--focus`) in each theme

---

## Phase 4: User Story 2 - Controls from one kit (P1)

- [x] T013 [US2] Write the wrappers `src/renderer/src/kit/Button.tsx`, `TextInput.tsx`, `Select.tsx` per contracts/kit.md, with `forwardRef` and the ref-owned value and listeners
- [x] T014 [US2] Move `CreateProjectDialog.tsx`, `ConfirmDialog.tsx`, `MismatchDialog.tsx`, `ProjectView.tsx` (rename form) and `Library.tsx` (New project) onto the wrappers; keep the accessible names, ids and `aria-*` the tests use; check the form submit path through `<fig-button type="submit">` by doing
- [x] T015 [US2] Extend `tests/e2e/design.spec.ts`: the create dialog's input is the kit's at 28px, tabbing through the dialog reaches every control in order, Escape closes; and extend `tests/unit/figui-guard.test.ts` if the plugin gained cases

---

## Phase 5: User Story 3 - Icons and the mark (P2)

- [x] T016 [US3] Write `src/renderer/src/icons/Icon.tsx` (glob of the vendored files as raw strings; `aria-hidden` without a label, `role="img"` with one; size by CSS) and `tests/unit/icons.test.ts` (every `IconName` resolves to a file in the right weight; every vendored file starts with an `<svg` and carries no `<script>`; the notice file exists)
- [x] T017 [US3] Use the icons: the status line (one per state), the Library's empty state (the mark at 24px), the toolbar buttons (icon plus label), the dialogs' primary actions where the document gives one; the header's mark at 16px

---

## Phase 6: User Story 4 - The progress line (P2)

- [x] T018 [US4] Write `src/renderer/src/ProgressLine.tsx` per data-model.md (SVG, ticks, the diamond, the 45-degree lead-in, labels, the message, reduced-motion-safe transition) and its rules in `app.css`
- [x] T019 [US4] Write `tests/unit/progress-line.test.tsx` (renders four states to markup with `react-dom/server`; asserts the marks per state, the accessible label and that no literal colour appears) and add a Playwright screenshot of it in both themes to `design.spec.ts` through a hidden `?progress-preview` route in the renderer that renders sample stages (development and test only; not in the packaged app's navigation)

---

## Phase 7: Polish

- [x] T020 Update `docs/ARCHITECTURE.md` (design tokens section: the three files, the adapter, the guard, the icons) and `CLAUDE.md`'s commands if any changed
- [ ] T021 Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e`; the reviewer over the branch; fix what it finds
- [ ] T022 Screenshots of the Library, the project view and each dialog in both themes for the pull request; the manual checks (the app icon, VoiceOver) recorded; open the pull request closing #45

## Dependencies

Phase 1 and 2 first (their `[P]` tasks are independent); US1 needs T005–T009; US2 needs T009 and T010; US3 needs T002; US4 needs T006 and T010. Phase 7 last.

## Implementation Strategy

Tokens and the kit first, proven by their tests; then the screens, one at a time against the running app; then icons and the mark; then the progress line, which nothing depends on yet.

## As landed

Three tasks read differently in the code than in the list above, for
reasons research.md records: the guard is `scripts/figui-guard.ts`, not
`.mjs`, so the tests project type-checks it (T001); the end-to-end test
chooses the theme with Playwright's media emulation, because
`nativeTheme.themeSource` does not reach a page the driver has already
emulated (T012, research section 4); and the dialogs' text fields are the
kit's large size, 32px, as the design document's dialog density says,
while the toolbar's controls are 28px (T015). T021 and T022 close with the
pull request.
