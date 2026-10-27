# ADR-059: Rendered unit tests run in jsdom, and the kit-facing ones in a browser

- **Status:** Proposed
- **Date:** 2026-10-26
- **Supersedes:** none
- **Superseded by:** none

## Context

Spec 038 (the test pyramid) found the unit layer had no DOM: component
tests render to a string with `renderToStaticMarkup`, where no effect
runs, or go through React's client into a hand-built stand-in document;
where a rendered test was too hard, a test reads the component's source
and matches it with a regular expression, which passes over code that is
never reached. FR-004 asked for a timeboxed spike to choose the DOM layer
among four candidates - the hand-built stand-in, jsdom, happy-dom and
Vitest's browser mode - judged on R7-02's case and two others, the suite's
time, and the licence and size of what is added. This record is that
spike's report.

**What had changed since the spec was written.** Issue 490 moved the hold
R7-02 named into one hook, `useCheapEdit`, and `tests/unit/cheap-edit.test.tsx`
renders the cells through React's client into a stand-in document and
holds a move while the record is read back; under R7-02's own mutation
(`LineOrder.tsx`, `held: disabled || settling` made `held: disabled`) that
one row goes red. So FR-005 was met by the incumbent before the spike
began, and the spike's question was the narrower one: which layer lets the
remaining source guards, the hand-backs and the render-count tests be
written as rendered tests with a real press and real focus, against an
incumbent that already serves R7-02. The stand-in itself is four copies
(`announcer-region`, `trip-summary-region`, `cheap-edit`, and the
`container()` functions of two more files), none of which dispatches an
event or has a focus model, and every one mocks the kit's leaves and
presses a control by calling its handler prop.

**The kit is web components.** `src/renderer/src/kit/index.ts` loads
FigUI3's `fig.js`: custom elements with open shadow roots, delegated
focus, `adoptedStyleSheets`, the popover API, `ResizeObserver`,
`requestAnimationFrame` and CSS anchor positioning. The wrappers in `kit/`
write `type`, `disabled`, `aria-description` and `ariaControlsElements`
onto the inner button after connection (issues 113, 121, 124). Whether a
layer can run the kit unmocked is what decides whether the rendered tests
exercise those wrappers or a stand-in for them.

**What was measured**, with one harness of three cases run under each
candidate, the kit real and the kit replaced by a native button in six
lines; each case was then shown red under a named mutation
(`LineOrder.tsx`'s hold, `useCheapEdit.ts`'s delay armed at 0, the
`focus()` call removed from `focusHandback.ts`):

| | A, the stand-in | B, jsdom 30.1.3 | C, happy-dom 21.0.4 | D, Vitest browser mode, Chromium 156 |
|---|---|---|---|---|
| Case 1, R7-02's hold, with a real press | handler call only | yes, kit real or mocked | kit mocked only | yes, kit real or mocked |
| Case 2, a debounce, two changes drawn once, with a real `change` | handler call only | yes | yes | yes |
| Case 3, a focus hand-back from Cancel to Reveal, with real focus | no: no focus model | kit mocked only | kit mocked only | yes, kit real or mocked |
| Red under each case's mutation | yes | yes, wherever the arm was green | yes, the same | yes |
| `fig.js` loads | n/a | yes, no stub at import | yes, no stub | yes, no stub |
| Globals the cases needed stubbed | the whole DOM | `ResizeObserver` | none | none |
| What the layer lacks | events, focus, layout | focus delegation, `showPopover`, `checkVisibility`, `adoptedStyleSheets` | a click inside a shadow root is not retargeted to its host, so React never sees it; no `showPopover` | nothing found |
| Controls found by role and name through the kit's shadow roots | n/a | no | no | yes, `page.getByRole` |
| The arm's files | 1.34 s, 101 tests | 0.90 s wall, 4 files, 22 tests | in the same run | 1.15 s wall, 2 files, 11 tests, the launch included |
| The whole unit suite with the arms in | 26.0 s | 24.2 and 24.9 s, inside the noise | the same run | a second configuration, about 1.2 s an invocation |
| Harness code | 100 to 150 lines a file, four copies | a 6-line button stub and a 10-line `ResizeObserver` stub, shared | a 6-line stub | a 17-line configuration |
| Install | nothing | 13 MB on disk, 5.5 MB unpacked, about 33 lockfile entries, MIT | 18 MB, 9.2 MB unpacked, about 7 entries, MIT | 0.8 MB, MIT, and a Playwright Chromium: a 99 MiB download, 203 MB on disk |
| On a runner | nothing | nothing | nothing | `npx playwright install chromium --with-deps`, cacheable |
| `vi.mock` of the bridge and the kit | yes | yes | yes | yes |
| A cell's renders countable (by wrapping its adapter in a counting mock; a `Profiler` does not see a context-only render) | yes | yes | yes | yes |

Testing Library was installed beside them and not needed: its queries do
not pierce shadow roots, and the browser's locators do.

## Options

**Keep the hand-built stand-in.** No dependency, and it already holds
R7-02. It cannot express a focus hand-back, dispatches no event, mocks
every kit leaf, and is copied four times; every rendered test it gains is
another handler call that proves the wiring and not the press.

**happy-dom alone.** The smallest harness and a real `change`; but a
`click()` on the kit's inner button reaches the host with the inner
button as its target, so React's delegated handler never fires. With the
kit real no press works; with the kit mocked it is jsdom with fewer
features and five milliseconds saved.

**jsdom alone.** Real presses and real timers, with the kit real or
mocked, and `fig.js` loads without a stub. It has no focus delegation, so
a hand-back to a kit button is seen only with the kit mocked to a native
button, and the popover, `checkVisibility` and the kit's styling are
absent. Enough for the hooks and the cells; not for the controls that are
the kit's.

**Browser mode alone.** Every case passes with the kit real and no stub,
and controls are found by the names the gate documents quote. Its cost is
a Chromium on every machine and runner that runs `npm test`, a download of
about a hundred megabytes before the first unit test can run, and a second
configuration; a contributor's checkout stops being `npm ci` and nothing
else.

**Two layers, chosen per file.** jsdom as the default for a rendered test,
and browser mode as a second Vitest project for the tests that need what
jsdom lacks. It costs two environments to know and the browser's download
on the runners; it buys a middle layer that needs nothing beyond `npm ci`
for most tests, and a real browser for the few that are about the kit.

## Decision

Two layers, chosen per file.

A rendered unit test declares `// @vitest-environment jsdom` and renders
through React's client into the document, presses with a real `click()`
or a real `change`, and reads what the DOM shows. The kit is left as it is
where the test presses, and replaced by a native button through one shared
stub in `tests/support/` where the test hands focus, since jsdom does not
delegate focus into a shadow root. One shared `renderCell(cell, state)`
helper replaces the hand-built `ProjectState` objects the tests build
today, and the four stand-in documents go, file by file, as their tests
are converted. `jsdom` is a `devDependency` at an exact version; so are
`@vitest/browser` and `@vitest/browser-playwright`.

The kit-facing tests - a focus hand-back onto a kit button with the kit
real, the colour panel's popover, a disclosure's expanded state as the
inner button carries it, anything that reads `checkVisibility` or depends
on anchor positioning - are a second Vitest project that runs in Chromium
through Playwright, headless, with its own configuration and a file name
of its own (`*.browser.test.tsx`), so a file says where it runs. `npm test`
runs both projects; the browser project **fails** with the install command
in its message where the browser is missing, and never skips. CI installs
the browser in the fast layer with a cache, on all three platforms.

happy-dom is not taken, for the retargeting defect above. Testing Library
is not taken: the browser's locators find a control by role and name
through the kit's shadow roots, and in jsdom a short helper by attribute
is enough. The hand-built stand-in is retired as its files are converted
and not used for a new test.

## Consequences

- **A rendered test can fail on a press that does not reach its handler,
  and on focus that lands nowhere.** That is what the source guards and the
  handler calls could not do, and it is the point.
- **Two environments to know.** A file's first line, or its name, says which. The rule
  for choosing is short: jsdom unless the test is about what the kit does
  with focus, a popover or layout, and then the browser.
- **A Chromium on the runners and on a contributor's machine that runs the
  browser project**, about a hundred megabytes, cached in CI. A contributor
  who runs only the jsdom and node projects needs nothing new; the browser
  project tells them the command. ADR-024's decision that the *app* ships
  neither Playwright nor a second Chromium is untouched: this is a
  development tool, as Playwright already is for the end-to-end suite.
- **jsdom's gaps are stubbed in one place**, `tests/support/`, and each
  stub is named (`ResizeObserver` today); a test that needs a second stub
  is a candidate for the browser project, not a reason for a third.
- **Timing is explicit.** Fake timers drive the debounces as the incumbent
  does; a hand-back's `requestAnimationFrame` runs real in a browser test.
  No rendered test waits on the wall clock.
- **The mutation job (spec 038, Part 3) has its form:** a JSON file beside
  the test (`<name>.mutations.json`), each entry a `file`, a `find` that
  must occur once, a `replace`, the `test` file and a `title` pattern; the
  job applies one at a time to a clean checkout, runs that test, and
  expects it red. The three mutations measured here are its first entries.
- **A cell's renders are counted by its adapter.** #433a's acceptance
  test counts a cell's adapter calls through a mock that wraps it, as
  `cell-renders.test.tsx` does, with the cell's element made once by
  `renderCell`, so only a render the context caused is counted.
- **The suite's time did not move** with the first twenty-two rendered
  tests; the browser project adds about a second an invocation for its
  launch, and more as it grows. It is to be kept small: the kit's tests,
  not every cell's.
- **What to watch.** jsdom gaining focus delegation or the popover API
  would let the browser project shrink; the kit changing how it delegates
  focus or forwards attributes is seen first by the browser project, which
  is where such a change should fail. If the browser project ever needs
  Electron's Chromium rather than Playwright's, that is a new record:
  ADR-024 measured the two rasterisers 99 levels apart, and nothing here
  compares pixels.
