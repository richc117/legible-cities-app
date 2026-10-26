# How the app was built

*Moved here from `CLAUDE.md` on 25 Oct 2026 (issue 428).*

This page is history: the order the app's features were built in, and why
each is as it is, as `CLAUDE.md` told it until that date. It is kept whole
and is not kept up to date. What the app is today is
`docs/ARCHITECTURE.md`, with `docs/DESIGN.md` for how it looks and
`CLAUDE.md` for where things stand; where this page and those disagree
about where something is or what it is called, they are right and this page
is not. The rules this history states that a change must still keep live in
`CLAUDE.md`, `.claude/rules/main.md`, `.claude/rules/renderer.md` and
`docs/ARCHITECTURE.md`. A correction made on the move is marked
*[25 Oct 2026: ...]*; nothing else was rewritten.

Since this was written the project screen has been rebuilt twice over,
and it is now the notebook's six cells (ADR-045, ADR-046): a panel or a
tab named below is a section of a cell today.

The repository holds its charter (licence, contribution guide,
security policy, templates, decision-record convention), its hygiene tooling
(`bin/preflight`, gitleaks, the git hooks, the CI checks), its specs
(Spec Kit, the constitution), and the Phase 0 spike reports and decision
records under `docs/adr/` - and the Electron skeleton (A0-09): one window
opening to the Library on the `app://local` origin, the project object
(A1-05: a versioned record under the engine home, created, renamed and
deleted through the preload bridge, five methods then and fourteen now
*[25 Oct 2026: seventeen by then, in `api.projects` in `src/preload/index.ts`]*), the engine's
supervisor (A1-01: the pinned engine started as a child process and spoken
to over JSON-RPC on its stdio, with a handshake, restart and a clean
shutdown; `docs/ARCHITECTURE.md`, "The engine process"), the dev loop
against the sibling engine, and CI on three platforms - and the design
system's foundations (A2-00: the tokens of `docs/DESIGN.md` in four
stylesheets, FigUI3's MIT core behind wrappers and a build guard that
refuses its PolyForm half, Phosphor icons, the Beck progress line, every
screen restyled), the typed client generated from the engine's own schema
(A1-02), the layout run (A3-01: one button runs the engine's stages behind
a progress line and records the layout the project was drawn from; A3-05:
the id is the engine's own and "Re-layout" runs every stage again behind a
warning, ADR-033; A3-04: the service day is the engine's choice from a
stored anchor, `feeds.service` at every layout run, a date control bounded
by the stored window, and a chosen day a rebuild from the stored layout,
never a re-layout; A3-06: the layout's `made` beside its id, so a
project is told when another re-laid out the set it draws from), the feeds
(A2-01: the Library lists the engine's registry, adds a feed from a zip
chosen in the platform's dialog or from a URL over `feeds.add` with its
download on a progress line, and removes an added feed; a guard in the
main process refuses a path no dialog answered and a feed a project
names; the create dialog offers the list, and a typed key when the engine
is away; A2-02: the Inspect view reads the feed through `feeds.inspect`
and a person chooses mode and agency with the route types in view, the
histogram saying which the mode keeps, and the layout run passes both to
the engine; A2-03: two layout stages drawn where they run, the engine's
SVG over `render.stage` in a frame with an empty sandbox, panned and
zoomed from outside, the counts the engine's) and the viewer (A3-02: the engine's page in a frame sandboxed to
an opaque origin and driven from the main process, ADR-028), and the
capture (A5-02a: an offscreen window in its own session takes a page's
frames through the DevTools protocol, byte-identical run to run,
`src/main/capture.ts`) and the export (A5-02b: one preset, `instagram-reel`,
from a button on the project screen, over the engine's `export.plan` and
`export.encode` with the capture in the middle, into a folder on the
desktop or `LEGIBLE_EXPORT_FOLDER`, the sidecar beside the file;
`src/main/export.ts`) and the line colours (A4-01: the project's lines with
the colour their feed publishes, an override per line, a reset per line and
for all, and one default for the lines the feed leaves blank, built on the
gesture's release (issue 262) into a `map.build` from the stored layout and
written only once the map carries them;
`src/renderer/src/LineColours.tsx`) and the line order (A4-02: the
project's lines in the order the map stacks them, moved one place at a time
from two named buttons or, since issue 283, dragged by a grip with the
buttons kept, the whole arrangement debounced into the same rebuild and
written only once the map carries it;
`src/renderer/src/LineOrder.tsx`) and the theme (A4-03: the project's map
drawn in one of the engine page's two themes, chosen per project and
written at once, since a theme is neither a layout nor a render - the page
is then told through its seam (`setTheme`) and restyles in place, the
address carrying the theme for the next load only (issue 349) - and the
interface's own theme in Settings is a separate thing that neither follows;
`src/renderer/src/ThemeSwitch.tsx`). That is the first reel.

Route mode came with issue 272 on the engine pin at v0.13.0 (spec 030,
ADR-048): the page finds the trip between two stations and fades the rest,
and the app asks for it through the seam's `setTrip`, reads `state().trip`
as untrusted data, composes the steps in words, and keeps the map's
`stations` with the record's `drawn` so a reopened project offers its
pickers; a trip is never written to the record.

Installers (A0-10) came with Phase 5: `build.yml` runs the vendor jobs in
the same run, refuses a target whose Python, LOOM or ffmpeg is missing,
stale or the wrong architecture (`scripts/check-vendored.mjs`), compiles
the runtime's bytecode as unchecked hashes so nothing is written inside a
signed bundle, packages a dmg per Mac and an nsis installer, launches the
packaged app once and runs every bundled tool from inside it, and checks
the bundle did not change (ADR-035). They are unsigned. The maintainer decided that the first release ships that way (issue 38, A6-05); ADR-037 recorded it for v0.1.0, and ADR-054 keeps 1.0 unsigned with no automatic update. The ffmpeg they carry is our own build (#95, ADR-040):
`scripts/vendor-ffmpeg.sh` builds FFmpeg 9.0.1 and x264 at a pinned commit
natively on each target (MSYS2 UCRT64 on Windows), with
`--disable-everything` and only what the export and its checks use, x264
the one external library and zlib the system's or, on Windows, static; the
vendor job refuses any other library and uploads the Corresponding Source
as `ffmpeg-source` before any binary.
On every start a packaged app makes those tools do real work once the
engine has settled (A6-02): the main process runs `gtfs2graph` over the
three-stop feed in `resources/first-run-gtfs/`, whose output must parse as
a line graph because a zero exit proves nothing, and `ffmpeg`/`ffprobe
-version`, and a failure is one dialog naming the tool, never over the
mismatch dialog, and a row in Settings (`src/main/first-run.ts`).
A pushed tag `v<version>` or `v<version>-rc.<N>` then drafts a GitHub
Release (A6-01, ADR-041): the release job, the only one with `contents:
write`, runs after every vendor and packaging job succeeded, and
`scripts/release.mjs` refuses a tag not for `package.json`'s version, moved
since its push, or not on `main`, names the installers for their machine, archives `ffmpeg-source`,
`loom-source` and `engine-source` from the same run, writes `SHA256SUMS.txt`
and the notes from `.github/release-notes.md`, and creates or updates a
**draft, never published**; the maintainer publishes it by hand, and
`docs/install.md` is what a person follows.
The source of the FFmpeg library inside Electron (LGPL-2.1-or-later) rides
with it (ADR-043): `electron-ffmpeg-source` verifies Chromium's FFmpeg,
libopus and their build files by git object id against `electron_ffmpeg` in
the pins, which every Electron bump must move, and no installer is packaged
without it.

Settings (A1-04) came after it: one file under the user-data folder holding
the two folders a person chose and the interface's theme, read before the
configuration resolves so a stored folder sits between `.env.local` and the
default, and written the way a project record is. A folder is chosen in the
platform's own dialog, which the main process opens and whose answer it
applies itself, so no path crosses the bridge inward at all; a folder
inside the app's own bundle is refused even so. The export folder moves at
once and the engine's home at the next start, which the screen says. The
screen also shows the engine home's size, the versions from `engine.info`,
a way into the platform's log folder, and "Reset engine data".

**The reset removes four folders and never the engine's home itself**:
`projects`, `out`, `data` and `frames`, which is everything this app and
the engine put there (the engine's `config.py` names `data/feeds`,
`data/graphs` and `out`; read it before adding to the list). The home is a
folder a person can point at `~/Documents` in one click, so whatever else
is in it is theirs and stays, and a folder that turns out to be a symbolic
link is left alone and reported rather than unlinked. **The home is
resolved through `realpath` before any guard judges it**, and so is
everything it is compared against: the guards are textual, and a home that
is itself a link would pass every one of them and then remove four folders
from wherever it points. Before it starts, the main process refuses while a
reset is already running, while an export, an engine request or a record
write is in flight, and for a home so high up that those four names would
mean something else; the screen refuses separately while a layout run or an
export is open, because a run is four steps with gaps between them and only
the renderer can see the gaps. The flag goes up before the first `await`,
and while it is up every engine request, every export and every write to a
project record is refused, so nothing lands in a folder being walked away
(`src/main/settings.ts`, `src/main/settings-ipc.ts`). **A project's own
export folder is kept out of the reset's reach at three doors** (issue
206): the reset refuses while a project under the home in force exports to
a folder inside the home or around it; so does the choice of the engine's
folder in Settings, the default included, which is the door that matters -
records live under the home and nothing moves them, so after the restart
the project that exports there is a record in the old home; and a
project's own folder is judged against the engine folder **waiting for a
restart** as well as the one in force, where it is chosen and again at
each export (`destinationRefusal` in `src/main/export.ts`, which is handed
a function for the folder waiting and asks it at every judgement). **No
door sees a record left behind in a previous home.** **A projects folder
that cannot be listed refuses** the choice and the reset, because it hides
every project (`destinations()` reads strictly; `list()` does not, so the
front door still opens); **one record that cannot be read is skipped** and
refuses nothing, because the reset is the remedy for bad records. **Every
check over folders has one deadline** (`FOLDERS_TIMEOUT_MS`, `inTime`): a
folder on a share that stalls refuses, with nothing changed or removed,
rather than keeping the reset's flag up; a check that lapsed is abandoned,
so checks only read and whatever acts on their answer, the removal or a
write, comes after them; the refusal names the project whose folder did
not answer; and **a folder that has not answered is not asked again**
(`oneAtATime`), because each unanswered question holds one of the four
threads files are read with. **The screen's promise is qualified**:
exported files are not touched unless they are inside one of the four
folders. **Every refusal over
exported files asks for the files to be moved out and the folder changed,
in that order**, because changing a folder moves nothing and a reset that
goes ahead removes what was exported into one of the four.
`destinationsInTheWay` is the pure rule on Settings' side, on real paths;
the list is the project store's `destinations()`, handed in and read once
at a press.

The export's options (A5-01) widened the reel's one button. They were a tab
once and are cell 06 now. Export offers the thirteen social presets
from `export.presets` grouped by platform, a storyboard from
`export.storyboards` for a video or GIF, and view, labels, title, clock,
start time, lines, quality and a filename tag, and since issue 352 a caption,
the clock's corner and the sidecar's alt text, and for a video or GIF an opening (a title card, the
network drawing in, or both, composed as an authored beat list ahead of the storyboard's own, with the
capture driving the page's `setCard` and `setDrawn`); the choice is the project's,
written to the record's `export` the moment it is made. While cell 06 is
open a frame of the cell's own is the preview (ADR-046; until then it was
the map's frame), at the address `export.plan` answers with `safe` on
exactly where the preset has safe zones, and **an export's plan never
carries `safe`**. A still is captured as
one beat of one frame pinned at the plan's `at`, since the app's capture
takes frames from beats and a still plan has none
(`src/renderer/src/ExportTab.tsx`, `src/renderer/src/exportChoice.ts`,
`src/main/export.ts`). An export goes to the folder Settings names, or to
the project's own where it has one (A5.5-19).

The logs (A6-03) came next: `main.log` and `engine.log` in the platform's
log folder behind the sink in `src/main/log.ts`, routed by the `engine`
tag, each capped at 5 MB with one `.old.log` kept and no dependency
(`src/main/log-file.ts`); the logs follow `LEGIBLE_USER_DATA`, which macOS
would not do on its own, and in development `LEGIBLE_LOGS` names a folder
for them, which the end-to-end suite sets for every launch
(`tests/e2e/global-setup.ts`) so no run writes a person's own log.
"Copy diagnostics" in Settings puts the versions, `engine.info`, the end of
both logs and the session's map reports on the clipboard, composed in the
main process with the home folder written as `~` (its 8.3 short form on
Windows included) and checked for afterwards
(`src/main/diagnostics-text.ts`). Every log line, and the copy again, has
its URLs' user information, query values and fragments redacted, and the
query values of a scheme-less path as urllib3 prints one
(`src/main/redact.ts`); a token in a URL's path is not. Nothing is sent
anywhere.

The jobs (A1-03) followed: a right-hand inspector that is the window's, not
a project's (ADR-036), rendered from `App.tsx` beside all three screens,
collapsed until its header toggle is pressed, the toggle carrying the
running count; below 900px it covers the main region. It lists the
session's layout runs, rebuilds, exports and feed adds, running first and
then the last twenty finished, each on its run's own progress line with
Cancel through the run's own `cancel()`, the engine's hint and its detail
behind a closed disclosure, and "Copy log", which the main process redacts
through the diagnostics copy's own home lookup before the clipboard
(`src/main/jobs-ipc.ts`). **A running job is derived from its run's
snapshot each time it is read; a finished job and a project's name are
copies kept beside the runs** (`job()` on each run, `JobRegistry` in
`runs.ts`, `src/shared/jobs.ts`), and **the runs' snapshots and behaviour
did not change**. A project's jobs leave only when its own screen has
deleted it, never because a list read missed a record, and a rename hands
the new name in. The list is the inspector's own state, so a run's
progress never re-renders the screen beside it. Tracking a run is silent,
since `layoutRunFor` is called during a render. A job's end is announced
once, emptied and refilled a frame later so a repeat is spoken; nothing is
written to disk.

The determinism test (A5-04) exports the committed BART fixture twice
through cell 06 against the real engine and the vendored ffmpeg and
compares the two captures frame by frame in RGB at a tolerance of 8, with
the capture required to move, the stored layout checked unmoved and no
`graph.build` sent; the capture stays the verdict for the frames. From
engine v0.17.0, whose GIF colour table is composed from the plan rather
than counted from the frames (engine issue 33, ADR-055), the delivered
GIFs are judged too, beyond their structure: by their colour tables (256
entries each, no local table, the two byte-identical) and by what moved
(decoded beside the captures, the GIFs differ only on pixels the captures
differ on, exactly, and never on more of them). The tolerance of 8 is
never applied to the GIFs, because a pixel near the boundary between two
entries flips by the gap between them (`tests/support/gif.ts`; ADR-039 is
why only the structure was checked before). It runs on three platforms once
per pull request that touches what an export is made of and five times a
week
(`tests/e2e/determinism.spec.ts`, `.github/workflows/determinism.yml`).

The automated acceptance run (A6-04) drives a published Release's own
installed app through `docs/acceptance.md` on a macOS and a Windows
runner, dispatched by hand with the tag: the installer checked against
`SHA256SUMS.txt`, installed, steps 3 to 20 against the real engine, a real
layout and real exports, then uninstalled; the record is the checklist's
results template, with whatever a machine cannot judge written as not
automated, never passed (`tests/acceptance/acceptance.spec.ts`,
`.github/workflows/acceptance.yml`). It launches the installed app, so
`npm run test:acceptance` is for a person or a runner, never beside
another launch.

The accessibility pass's machine half (A6-07) checked every screen and
dialog for keyboard reach, names, visible focus, reduced motion and
contrast in both themes, fixed the small defects it found (focus handed on
when a pressed control goes, `src/renderer/src/focusHandback.ts`; control
edges, placeholders and the sepia primary fill), sweeps them in
`tests/e2e/accessibility.spec.ts` and, for the notebook,
`tests/e2e/notebook-a11y.spec.ts` (A5.6-09), in Night and then in
Parchment, and records the result per screen in `docs/accessibility.md`,
whose VoiceOver and Narrator columns are a person's.
The people at the release gate follow documents that quote the app's own
sentences and control names, so changing one means changing them too
(A6-04): the acceptance checklist (`docs/acceptance.md`), the stranger's
timed run (`docs/acceptance-stranger.md`) and the screen-reader walkthrough
in `docs/accessibility.md`.

The licence texts (issue 108, ADR-042) followed: every installer carries
the texts of the libraries linked into the Python runtime, taken from the
same python-build-standalone build's `full` archive, and CPython's
`Doc/license.rst`, under `python/licenses/`; **the build metadata is not
trusted alone** - on macOS it names a text the archive lacks, on Windows it
names nothing for the zlib, Expat and libmpdec in the DLLs - so three
reviewed lists per target in `vendor/pins.json` say what it does not, and
`scripts/check-vendored.mjs` fails the python job and the package whenever
the metadata, the folder and the lists disagree. **A new
python-build-standalone release fails until those lists are reread**, on
purpose. The Mac app gets Electron's and Chromium's licences back, which
electron-builder deletes from it. Settings has a Licences section: the
components from `src/shared/licences.ts`, held to the notices file by a
test, and three buttons to open the notices, the texts and Chromium's
licences, each saying so when there is nothing bundled to open.

Work proceeds phase by phase; `CONTRIBUTING.md` explains the flow, the
labels, the milestones and the `A0-05`-style issue codes. The four Phase 0
spikes have run: LOOM ships without its optional solvers (ADR-019), the
sidecar is a pinned python-build-standalone runtime (ADR-020), Windows
stays in the first release (ADR-021), and a project's layout is stored
rather than recomputed because `topo` is not reproducible on macOS
(ADR-023), with the service day resolved once at the first layout
(ADR-031). The sidecar's `python` job in `vendor.yml` vendors all three
targets (darwin-arm64, darwin-x64, win-x64; A0-06); the offscreen-capture
spike is finished, and
ADR-024 puts capture in the app's own process, in an offscreen window
driven through the Chrome DevTools Protocol. The "First reel" milestone -
one preset feed through layout, viewer and export before the phases
broaden - is complete: the engine's export halves (E10, E09b) landed at
v0.3.0 and the app exports the reel (A5-02b). Since 2026-09-07 `main`
changes only through pull requests with the `ci` check green: one issue,
one branch, one pull request, the maintainer included.
