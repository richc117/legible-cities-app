// What jsdom lacks and a rendered unit test reaches, supplied once for the
// `unit` project (ADR-059). It does nothing in a file that runs in Node,
// where there is no `window`, and nothing where the global is already there.
//
// One stub, and it is named here: `ResizeObserver`, which the progress line
// (`ProgressLine.tsx`, under a run's stages and the export's run) makes when
// it mounts, to read its own width, and which jsdom does not have. It
// observes nothing and jsdom lays nothing out, so no test reads a size
// through it. A test that needs a second stub belongs in the `browser`
// project (`*.browser.test.tsx`), which has the real one; it is not a reason
// to add one here.

if (typeof window !== 'undefined' && typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
}
