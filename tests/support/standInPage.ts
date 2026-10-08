// A stand-in for the engine's page that carries the seam (`__present`), for
// the tests that need what the stand-in engine's own page cannot give: a
// page that answers `bounds()` and `state()`, so cell 03's transport draws
// (A5.5-16). Moved here from `layout.spec.ts` when the accessibility sweep
// needed the same page (A5.6-09).
//
// The stand-in engine writes `{}` where the page goes, so its "map" has no
// `__present` at all and the transport draws nothing over it - correctly,
// and uselessly for a test. This page is written over the one a run wrote,
// and records in `window.__seen` every call it was asked.

import { readdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** What a stand-in page can be asked for beyond what every one has. */
export interface StandInPageOptions {
  /**
   * Carry `setTheme`, as a page the engine wrote since v0.11.0 does: true for
   * the two names it takes, recorded in `__seen`, and false for any other.
   * Left out, the page is one from before the engine had it, which answers
   * "this map cannot do that" and is how the app's fallback is reached. It
   * is off unless asked for, so a spec that counts what the page was asked
   * is not given a call it did not make.
   */
  setTheme?: boolean
}

/** A page with the seam on it, recording every call, at the address a run wrote. */
export function standInPage(engineHome: string, options: StandInPageOptions = {}): void {
  writeFileSync(pagePath(engineHome), standInPageSource(options))
}

const pagePath = (engineHome: string): string => {
  const id = readdirSync(join(engineHome, 'projects'))[0]
  return join(engineHome, 'out', id, 'la-metro-rail.html')
}

/**
 * Keep the stand-in page written over whatever the stand-in engine writes,
 * until the returned function is called.
 *
 * A run's `map.build` writes `{}` into the page file and then answers, and
 * the frame loads that file a state read and a navigation later, so the page
 * a redraw arrives at is `{}` unless something puts the page back in
 * between. This does, every few milliseconds, by renaming a whole file over
 * it so a load never reads half of one. The stand-in engine cannot be told
 * to write a page with a seam.
 */
export function keepStandInPage(engineHome: string, options: StandInPageOptions = {}): () => void {
  const file = pagePath(engineHome)
  const source = standInPageSource(options)
  const timer = setInterval(() => {
    try {
      writeFileSync(`${file}.next`, source)
      renameSync(`${file}.next`, file)
    } catch {
      // Windows refuses a rename over a file a reader has open; the next
      // tick tries again.
    }
  }, 5)
  return () => clearInterval(timer)
}

function standInPageSource({ setTheme = false }: StandInPageOptions): string {
  return [
    '<!doctype html><meta charset="utf-8"><title>stand-in map</title><body>',
    '<script>',
    // 06:00 to 26:00 of the service day, which is a real feed's shape.
    'var T0 = 21600, T1 = 93600;',
    'var at = T0, speed = 60, playing = true;',
    'window.__seen = [];',
    'function fmt(s) {',
    '  var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);',
    '  return String(h % 24).padStart(2, "0") + ":" + String(m).padStart(2, "0")',
    '       + (h >= 24 ? " +1d" : "");',
    '}',
    'window.__present = {',
    '  showView: function (name) { window.__seen.push(["showView", name]) },',
    '  setLabels: function (on) { window.__seen.push(["setLabels", !!on]) },',
    '  setRoutes: function (keep) { window.__seen.push(["setRoutes", keep]) },',
    '  seek: function (sec) { at = Math.max(T0, Math.min(T1, sec)); window.__seen.push(["seek", at]) },',
    '  setSpeed: function (x) { speed = x; window.__seen.push(["setSpeed", x]) },',
    '  setPlaying: function (on) { playing = !!on; window.__seen.push(["setPlaying", !!on]) },',
    ...(setTheme
      ? [
          '  setTheme: function (name) {',
          '    if (name !== "warm-dark" && name !== "sepia") return false;',
          '    window.__seen.push(["setTheme", name]);',
          '    return true;',
          '  },',
        ]
      : []),
    '  hasGeo: function () { return true },',
    '  bounds: function () { return { t0: T0, t1: T1 } },',
    '  state: function () { return { now: at, clock: fmt(at), viewName: "schematic", labels: true } },',
    '};',
    '</script></body>',
  ].join('\n')
}
