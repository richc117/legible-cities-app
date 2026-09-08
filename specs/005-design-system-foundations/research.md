# Research: Design system foundations

Five questions the plan had to settle, each ending in a decision.

## 1. Custom elements in React 19

**Decision**: use the kit's elements directly in JSX with a local
`intrinsics.d.ts` declaring them, and wrap each value-bearing element in a
thin component that owns a `ref`, sets `value` through the ref in an
effect, and attaches the kit's `input`/`change` listeners through the ref.

**Rationale**: React 19 renders custom elements natively (attributes for
primitives, properties where the element defines them), which is enough
for buttons and static elements. The kit's README warns that setting
`value` in JSX on every render loops through `attributeChangedCallback`,
and its custom events carry the value in `detail`; both are handled by the
ref pattern the README gives. Wrapping keeps the kit's tag names in one
directory.

**Alternatives considered**: a React binding generated per element
(nothing to generate from: the kit ships no types); plain HTML elements
styled to look like the kit (loses the kit, which was the point).

## 2. Refusing the PolyForm half at build time

**Decision**: a tiny Vite plugin, `scripts/figui-guard.mjs`, whose
`resolveId` throws with a sentence when an import id contains
`figui3/fig-editor`, `figui3/fig-lab` or their `dist/` or `src/` forms,
registered for the renderer in `electron.vite.config.ts`; a unit test calls
the hook with the forbidden and the allowed ids.

**Rationale**: the npm tarball ships both halves in one package, so the
line is what the app imports; a resolver hook is the earliest point a
build can refuse, and it fails `npm run build` in CI with the reason. A
grep in a script would pass a dynamic import string; the resolver sees the
id whatever the syntax.

**Alternatives considered**: an ESLint `no-restricted-imports` rule (good
for editors, but lint is a separate step and the build is what ships);
vendoring the six core files into the repository (avoids the tarball
entirely, at the cost of a copy to maintain; kept as the fallback if the
package ever bundles the halves together).

## 3. Icons as inline SVG

**Decision**: vendor the Phosphor files the interface uses (light for 16px,
regular for 24px, fill for toggled states) unmodified under
`src/renderer/src/icons/phosphor/` with the MIT notice, and render them
through an `Icon` component that imports the directory with Vite's
`import.meta.glob` as raw strings and inlines them, `aria-hidden`, sized by
CSS, coloured by `currentColor`.

**Rationale**: `currentColor` needs the SVG in the DOM, not in an `<img>`;
Phosphor's files carry `fill="currentColor"` and a `viewBox` with no
width or height, so the CSS size token is the only sizing. Vendoring the
fifteen files rather than depending on the 9,000-file package keeps the
tree and the notices exact. The mark is the app's own drawing in the same
directory and goes through the same component.

**Alternatives considered**: `@phosphor-icons/react` (a dependency for a
loop over strings; also pulls all weights); an icon font (kerning and
alignment trouble at 16px, and a font to license).

## 4. Choosing the theme in the end-to-end test

**Decision**: `page.emulateMedia({ colorScheme })` from Playwright; the
renderer's existing `prefers-color-scheme` listener sets `data-theme`.

**Rationale**: Playwright emulates the colour scheme on every page it
attaches to, light unless told otherwise, and that emulation wins over
Electron's `nativeTheme` (verified by doing: `themeSource = 'dark'`
flipped `shouldUseDarkColors` and the renderer's query stayed light). The
emulation is the same lever the OS preference pulls, so the app's own
switching logic is what the test exercises, in both directions, without a
setting that does not exist until A1-04.

**Found on the way**: the kit's `package.json` lists `./fig.js` under
`sideEffects` while its export resolves to `./dist/fig.js`, so Rollup
dropped the script that registers the custom elements from the production
bundle (the dev server, which does not tree-shake, showed nothing). The
guard plugin now resolves the core script itself and marks it
`moduleSideEffects: true`; the unit test covers it, and the end-to-end
test would catch a regression because every kit button disappears.

## 5. The app icon

**Decision**: `mark.svg` is the source; `scripts/render-icon.sh` runs
`rsvg-convert` to a 1024px `build/icon.png` on the sepia ground, and the
PNG is committed. electron-builder derives `.icns` and `.ico` from it.

**Rationale**: the renderer is the one tool on the maintainer's machine
that rasterises SVG faithfully (the engine's `bin/preview` uses it for the
same reason); committing the PNG means CI needs no rasteriser. The script
documents the step so the PNG is reproducible from the SVG.

**Alternatives considered**: `sharp` as a dev dependency (a native module
for one step); rasterising in Electron at build time (a headless window in
CI for an icon).

## 6. FigUI3's control height

**Decision**: the adapter sets the kit's spacing token that drives control
height (`--spacer-4`) to the document's 28px inside the app's stylesheet
scope, and the end-to-end test reads the rendered height of a kit button.

**Rationale**: the kit's buttons and inputs take their height from one
spacer, so one override reaches every control; per-element overrides
would drift. If the spacer turns out to drive layout the app does not want
at 28px, the fallback is per-element `height` on the wrappers, and the
test says which happened.

## 7. The kit and the Content Security Policy

**Decision**: `style-src 'self' 'unsafe-inline'` for the interface in every
build; `script-src` stays `'self'` outside development.

**Rationale**: found by doing. FigUI3 styles the inside of each shadow root
with a `<style>` element it creates at connection, and the skeleton's
policy (`style-src 'self'`) blocked every one of them: the kit's buttons
rendered with the browser's default padding and a second, default focus
ring, and the console said why. Inline styles carry no script; the
allowance is the usual one for web-component libraries. Hashing the kit's
style blocks instead would break on every kit release.
