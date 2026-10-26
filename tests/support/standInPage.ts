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
import { PAGE_SEAMS } from '../../src/shared/viewer'

/**
 * The line a stand-in page ends its seam with to be a page the pinned engine
 * drew: every method of `PAGE_SEAMS` the page has not written itself, as a
 * function that does nothing, records nothing and answers nothing (issue
 * 465). Since then a page lacking any of them is one an older engine drew,
 * and the app redraws it when its project opens, which the stand-in engine
 * does by writing `{}`; a spec's page that is meant to be the map a person
 * is looking at carries this, and one meant to be an older engine's does not.
 * Read from the app's own list, so a pin that adds a seam moves every stand-in
 * with it.
 */
export const EVERY_SEAM = everySeamBut([])

/**
 * The same line, for a page an engine between two seams drew: every method
 * of `PAGE_SEAMS` but the ones named, and the page's own `__present` left as
 * it wrote it. `everySeamBut(['setCard', 'setDrawn'])` is a page from engine
 * v0.13.0 to v0.14.x, which has a theme and a trip and lacks only the
 * opening's two, and is older all the same (issue 517).
 */
export function everySeamBut(gone: readonly string[]): string {
  const names = PAGE_SEAMS.filter((name) => !gone.includes(name))
  return `(function () {
  var present = window.__present;
  ${JSON.stringify(names)}.forEach(function (name) {
    if (typeof present[name] !== "function") present[name] = function () {};
  });
})();`
}

/** What a stand-in page can be asked for beyond what every one has. */
export interface StandInPageOptions {
  /**
   * Record `setTheme` in `__seen`, as a call that changes what the page
   * shows: true for the two names it takes and false for any other. Left
   * out, the page still has it, as every page the pinned engine draws does,
   * and it does nothing and records nothing (`EVERY_SEAM`), so a spec that
   * counts what the page was asked is not given a call it did not make.
   */
  setTheme?: boolean
  /**
   * Be a page an older engine drew: one from before v0.11.0, with neither
   * `setTheme` nor any seam the engine has added since, which answers "this
   * map cannot do that" to a theme and is redrawn when its project opens
   * (issue 465).
   */
  older?: boolean
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

function standInPageSource({ setTheme = false, older = false }: StandInPageOptions): string {
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
    ...(setTheme && !older
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
    ...(older ? [] : [EVERY_SEAM]),
    '</script></body>',
  ].join('\n')
}

/** What the stand-in that is captured can be asked for (app issue 100). */
export interface CapturedStandInOptions {
  /**
   * Paint every step one draw late, always: the band shows the count before
   * the one the page reports, as a page whose paint never caught up with its
   * steps would, so no shot of any frame is fresh and the capture must fail.
   */
  late?: boolean
  /**
   * Be a page an older engine drew, from before v0.20.0: it ignores `strip`,
   * has no band and reports no `draws`, and its stage fills the viewport.
   */
  older?: boolean
}

/**
 * A stand-in page that can be captured, and that draws its frame counter as
 * engine v0.20.0's page does (its issue 85; `page/page.html` at that tag):
 * `strip=<px>` in present mode, a whole number from 1 to 256, sets
 * `data-strip` and `--strip` on the root, the stage lays out in the viewport
 * less the band, and a band `--strip` tall at the viewport's foot shows
 * `state().draws` modulo 65536 as sixteen bits from the most significant, two
 * blocks a bit, white then black for a 1, written at the end of every draw.
 * Its picture is a train along a line that moves with the clock, and the
 * clock in text, so a frame from the wrong paint is a different picture.
 */
export function capturedStandInSource({
  late = false,
  older = false,
}: CapturedStandInOptions = {}): string {
  return [
    '<!doctype html><meta charset="utf-8"><title>captured stand-in</title>',
    '<script>',
    '(function () {',
    '  var q = new URLSearchParams(location.search);',
    ...(older
      ? []
      : [
          '  if (q.get("present") === "1") {',
          '    var strip = q.get("strip");',
          '    if (strip && /^[1-9][0-9]{0,2}$/.test(strip) && +strip <= 256) {',
          '      document.documentElement.setAttribute("data-strip", strip);',
          '      document.documentElement.style.setProperty("--strip", strip + "px");',
          '    }',
          '  }',
        ]),
    '})();',
    '</script>',
    '<style>',
    '  html, body { margin: 0; background: #111; height: 100%; overflow: hidden; }',
    '  :root[data-strip] { --frame-h: calc(100vh - var(--strip)); }',
    '  #stage { width: 100%; height: var(--frame-h, 100vh); position: relative; overflow: hidden; }',
    '  #stage svg { width: 100%; height: 100%; display: block; }',
    '  #present-strip { position: fixed; left: 0; right: 0; bottom: 0; height: var(--strip);',
    '    z-index: 20; display: flex; background: #000; pointer-events: none; }',
    '  #present-strip span { flex: 1 1 0; background: #000; }',
    '  #present-strip span.on { background: #fff; }',
    '</style>',
    '<body>',
    '<div id="stage"><svg viewBox="0 0 540 960" preserveAspectRatio="none">',
    '  <line x1="40" y1="480" x2="500" y2="480" stroke="#888" stroke-width="6" />',
    '  <circle id="train" cx="40" cy="480" r="14" fill="#e8b04a" />',
    '  <text id="clock" x="20" y="60" fill="#eee" font-size="32px" font-family="monospace">00:00</text>',
    '</svg></div>',
    '<script>',
    '(function () {',
    '  var T0 = 21600, T1 = 93600;',
    '  var now = 8 * 3600, speed = 60, playing = true, capture = false, rafId = null;',
    '  var last = performance.now(), draws = 0;',
    '  var blocks = null;',
    '  if (document.documentElement.hasAttribute("data-strip")) {',
    '    var strip = document.createElement("div");',
    '    strip.id = "present-strip";',
    '    blocks = [];',
    '    for (var i = 0; i < 32; i++) blocks.push(strip.appendChild(document.createElement("span")));',
    '    document.body.appendChild(strip);',
    '  }',
    '  function stamp(count) {',
    '    var n = ((count % 65536) + 65536) % 65536;',
    '    for (var b = 0; b < 16; b++) {',
    '      var one = (n >> (15 - b)) & 1;',
    '      blocks[2 * b].classList.toggle("on", one === 1);',
    '      blocks[2 * b + 1].classList.toggle("on", one === 0);',
    '    }',
    '  }',
    '  function fmt(s) {',
    '    var h = Math.floor(s / 3600) % 24, m = Math.floor((s % 3600) / 60);',
    '    return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m;',
    '  }',
    '  function draw() {',
    '    draws++;',
    '    document.getElementById("train").setAttribute("cx", String(40 + 460 * ((now % 3600) / 3600)));',
    '    document.getElementById("clock").textContent = fmt(now);',
    // Late: the band is a draw behind the count the page reports.
    `    if (blocks) stamp(${late ? 'draws - 1' : 'draws'});`,
    '  }',
    '  function advance(dt) { if (playing) now = Math.min(T1, now + dt * speed); }',
    '  function frame(t) {',
    '    rafId = null;',
    '    advance(Math.max(0, (t - last) / 1000)); last = t; draw();',
    '    if (!capture) rafId = requestAnimationFrame(frame);',
    '  }',
    '  window.__present = {',
    '    advance: function (dt) { advance(dt); draw(); },',
    '    seek: function (sec) { now = Math.max(T0, Math.min(T1, sec)); draw(); },',
    '    setCapture: function (on) {',
    '      capture = on;',
    '      if (on) { if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; } }',
    '      else { last = performance.now(); rafId = requestAnimationFrame(frame); }',
    '    },',
    '    setPlaying: function (on) { playing = !!on; },',
    '    setSpeed: function (x) { speed = x; },',
    '    setView: function () {},',
    '    setGeo: function () { return false; },',
    '    showView: function () {},',
    '    hasGeo: function () { return false; },',
    '    setLabels: function () {},',
    '    setTheme: function (name) { return name === "warm-dark" || name === "sepia"; },',
    // Twice, as the engine's settle does with a face to fit again.
    '    settle: function () { draw(); draw(); return Promise.resolve(); },',
    '    setCard: function () { draw(); },',
    '    setDrawn: function () { draw(); },',
    '    bounds: function () { return { t0: T0, t1: T1 }; },',
    '    state: function () {',
    '      var s = { now: now, clock: fmt(now), shown: now >= 6 * 3600 && now <= 22 * 3600 ? 1 : 0,',
    '                viewName: "schematic", labels: true, card: false, drawn: 1 };',
    ...(older ? [] : ['      s.draws = draws;']),
    '      return s;',
    '    },',
    '  };',
    '  draw();',
    '  rafId = requestAnimationFrame(frame);',
    '})();',
    EVERY_SEAM,
    '</script></body>',
  ].join('\n')
}
