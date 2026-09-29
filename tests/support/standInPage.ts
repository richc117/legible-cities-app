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

import { readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** A page with the seam on it, recording every call, at the address a run wrote. */
export function standInPage(engineHome: string): void {
  const id = readdirSync(join(engineHome, 'projects'))[0]
  writeFileSync(
    join(engineHome, 'out', id, 'la-metro-rail.html'),
    [
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
      '  hasGeo: function () { return true },',
      '  bounds: function () { return { t0: T0, t1: T1 } },',
      '  state: function () { return { now: at, clock: fmt(at), viewName: "schematic", labels: true } },',
      '};',
      '</script></body>',
    ].join('\n'),
  )
}
