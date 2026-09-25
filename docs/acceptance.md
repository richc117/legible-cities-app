# Acceptance checklist

> **This document still describes the project screen as a tab strip, and is
> rewritten once, at the end of the notebook's work, against the interface
> that ships (ADR-045).** A5.5-08 replaced the Map and Export tabs with six
> numbered cells and moved or renamed several of the controls and sentences
> quoted below, so a step here that names a tab will not be found on screen.
> The release gate does not run against this text until that rewrite lands.

The release gate's run over an installed app (issue A6-04): one person, one
machine, an installer from a GitHub Release draft, and
[`install.md`](install.md) open beside it. Run it once on a Windows PC and
once on a clean Mac, a Mac that has never had Legible Cities on it. The
stranger's timed run is a separate document,
[`acceptance-stranger.md`](acceptance-stranger.md); the screen-reader
walkthrough is in [`accessibility.md`](accessibility.md#walking-it-with-a-screen-reader).

**Results are recorded in an issue, one per run, never committed.** Copy
the [results template](#results-template) into a new issue, fill it in as
you go, and file every failure as an issue of its own, linked from the
run's issue (see [Failures](#failures)).

## How to read a step

Each step says what to **do** and what you should **see**. What you should
see is taken from the app's own code and its end-to-end tests. Where the
checklist could not find a sentence in either, the line starts with
**check:** and says what to look for instead of guessing the words; write
down what the app actually showed. A step passes when everything under
**See** holds. Anything else is a failure, even a small one: say what
happened in the step's notes.

Quoted text is the app's own, word for word. `<angle brackets>` stand for
something that varies, such as a date or a version. A **status** sentence
is text the screen shows and a screen reader announces without moving
focus.

Before you start, note the time: the results template asks how long the
run took.

## The automated run

Most of this checklist is also driven by a machine, against the same
installers, so a Release has evidence from both systems before a person
sits down with it. `.github/workflows/acceptance.yml`, run by hand with the
Release's tag (the Release must be published, a prerelease for an `-rc`
tag, since the run's token cannot see a draft), does step 1 on a macOS and
a Windows runner, installs the app, runs
`tests/acceptance/acceptance.spec.ts` over steps 3 to 20 against the
installed app, and uninstalls it for step 21. Its record is this
checklist's [results template](#results-template), filled in, as the job's
summary and an artefact with a screenshot of each failed step, ready to
paste into the run's issue. On a machine with the app already installed,
the spec runs on its own:

```
LEGIBLE_ACCEPTANCE_APP="/Applications/Legible Cities.app" LEGIBLE_ACCEPTANCE_TAG=v0.1.0-rc.3 npm run test:acceptance
```

The record and the screenshots go to `acceptance-results/` (ignored by git;
`LEGIBLE_ACCEPTANCE_OUT` moves them). It launches the app, so never beside
another launch of it; it uses a temporary profile and export folder,
removes both afterwards, and leaves the clipboard holding the last thing
the app copied.

Two things a local run leaves that a runner does not:

- **The screenshots are not redacted.** The record writes your home folder
  as `~`, but a screenshot of a failed step shows the screen as it was,
  Settings' folder paths included. On Windows the temporary folder is
  inside your home, so set `LEGIBLE_ACCEPTANCE_TEMP` to a folder outside
  it (such as `C:\lc-acceptance`) before a run whose screenshots you mean
  to share, and look at each before attaching it.
- **On a Mac, your own logs.** A packaged app writes its logs to
  `~/Library/Logs/Legible Cities` whatever its profile. The run removes the
  log files it created, but its lines are appended to a `main.log` or
  `engine.log` that was already there, and can push one past its 5 MB cap,
  rotating your existing `main.log` into `main.old.log`; that file is left
  alone. It brings the app's
window to the front, takes focus and scrolls the map into view before
watching it, because Chromium stops the map's animation in a window hidden
behind others and in a frame scrolled out of sight; if the window still is not
visible, the record says the trains' movement was not checked rather than
failing it.

What it cannot do stays a person's, and the record says so step by step
("not automated"), never counting it as passed:

- **Step 2**: a runner downloads without a quarantine attribute or a mark of
  the web, so neither Gatekeeper nor SmartScreen warns, and the way past
  the warning in `install.md` is not exercised. The Mac app is copied from
  the disk image rather than dragged to Applications; the Windows installer
  runs silently and so does not open the app.
- **Judgement**: whether a map, a colour, a theme or a GIF looks right,
  whether a drag feels right (the spec drags the picker with the mouse and
  checks it stays open), and whether the Finder or File Explorer came to
  the front with the file selected (the spec records what the app asked
  the system to show or open, and checks those files).
- **Places**: the profile and export folder are temporary, so the folders
  in `install.md`'s tables are checked only in step 21.
- **Newer than the release**: a check of something that landed on `main`
  after the tag under test (the skip past the map in step 8 is newer than
  `v0.1.0-rc.3`) is written as "not checked, not in this build" with the
  commit that brought it. The workflow names the tag; a local run names it
  with `LEGIBLE_ACCEPTANCE_TAG`, or the check runs only if the build has
  the control.
- **The stranger's timed run and the screen-reader walkthrough**, which
  are separate documents and entirely a person's.

## The steps

### 1. Download and check the installer

**Do.** Open the Release draft (or the published release) and download the
file for this machine, as [Which file to download](install.md#which-file-to-download)
says, and `SHA256SUMS.txt`. Compute the file's SHA-256 as
[Check the download](install.md#check-the-download-optional) says.

**See.**
- The installer's name is one of `Legible-Cities-<version>-mac-arm64.dmg`,
  `Legible-Cities-<version>-mac-x64.dmg` or
  `Legible-Cities-<version>-windows-x64-setup.exe`
  (`scripts/release.mjs`), and `<version>` is the release's.
- Its checksum matches its line in `SHA256SUMS.txt`. Write both the file
  name and the checksum into the run's issue.

Result: ____

### 2. Install and open it the first time

**Do.** Follow [Install on a Mac](install.md#install-on-a-mac) or
[Install on Windows](install.md#install-on-windows) exactly, including the
steps past the unsigned-app warning for this version of macOS or Windows.

**See.**
- Every warning the install document describes appears as it describes it,
  and the way past it works. **check:** any wording that differs from the
  document, word for word, in the notes: the document is what the stranger
  will follow.
- On Windows the installer asks no questions, and opens the app when it has
  finished (install.md).
- The window opens with the header across the top: the Legible Cities mark
  and name, the engine's status line, **Jobs** and **Settings**.

Result: ____

### 3. First run: the Library, the engine and the bundled tools

**Do.** Wait without pressing anything for about thirty seconds. Then press
**Settings** and read the screen from the top. Press **Back to Library**.

**See.**
- The Library opens with its heading, **Library**, and the empty state:
  "No projects yet. Pick one of the feeds below, or add your own, and make
  a project from it." with a **New project** button.
- The engine's status line starts at "Checking the engine…" or "Starting
  the engine." and becomes "Engine ready (`<engine version>`)." The version is the engine pin in
  `vendor/pins.json` at the release tag (0.8.3 when this was written).
- **No dialog opens.** The first-run check of the bundled LOOM and ffmpeg
  passes silently; a dialog titled "LOOM will not run", "ffmpeg will not
  run" or "LOOM and ffmpeg will not run" is a failure of this step. Write
  down its sentences and press **Copy diagnostics** in it before you close
  it.
- Under **Feeds**, a **Presets** list of the engine's networks, each row
  with its city and network and "not downloaded yet", and a
  **Start a project** button.
- In Settings, **Bundled tools** says "The bundled LOOM and ffmpeg ran.",
  with **LOOM tools** "ran (`<n>` ms)." and **ffmpeg and ffprobe**
  "ran (`<n>` ms)."
- **Versions** lists Engine (the same version as the status line),
  Protocol `1`, Python, LOOM backend `native`, LOOM commit and ffmpeg, none
  of them blank. Copy the six into the run's issue.
- **Folders** shows the **Engine data folder** and the **Export folder**,
  each "the default", at the places install.md's table gives for this
  system, and the engine folder's size ("empty", or a size and a count of
  files).

Result: ____

### 4. Create a project from the LA preset

**Do.** In the Library, press **New project**. Leave the **Feed** as it
opens, type the name `Los Angeles`, and press **Create**. Then press the
new row.

**See.**
- The dialog is titled **New project**, and its **Feed** select opens on
  "LA Metro Rail (Los Angeles · Metro Rail)", the app's default feed
  (`la-metro-rail`).
- After **Create**, the Library lists one project, read aloud as
  "Open Los Angeles", with "Feed la-metro-rail" and "Service day not yet
  chosen" beneath it.
- The project screen's heading is **Los Angeles**. Its fields say Feed
  `la-metro-rail`, Mode `all`, Agency `none`, Service day "not yet chosen",
  Layout "not laid out yet".
- Below the fields, **In the feed** says "Reading the feed, and downloading
  it first if it is not on this machine yet…" and then fills in; see step 6.

Result: ____

### 5. Add a feed by its web address

The feed is **Caltrain**, from
`https://data.trilliumtransit.com/gtfs/caltrain-ca-us/caltrain-ca-us.zip`.
It was chosen because it is small (about 170 KB, so the download is quick
on any connection), public (the agency's official feed, published by its
data vendor without a key), current (its calendar runs from 31 January
2026 to 31 January 2027, and the host was updating it in August 2026), rail
only (five routes, all of route type 2, so the app's `all` mode keeps a
map rather than a city's buses), carries `shapes.txt`, which the engine
draws from, and is not one of the engine's presets, so it lands in the
**Added** list. Its agency is named "Caltrain", which becomes the feed's
name. If the address has stopped answering, record that and use another
small, rail-only, current GTFS zip, and say which in the notes.

**Do.** Press **Back to Library**, then **Add feed**. Paste the address
into **Or from an address** and press **Add feed** in the dialog. When the
dialog has closed, press **Start a project** on the new row, name it
`Caltrain`, and press **Create**. Then press **Remove** on the Caltrain
row, and **Remove** in the confirmation.

**See.**
- The dialog is titled **Add a feed**, with **Choose a zip** and
  **Or from an address**.
- While it runs, a progress line with two stages, `download` and `check`,
  and beside it "downloaded `<n>` of `<n>` bytes" (or "downloaded `<n>`
  bytes"), then "checked the feed's tables". The dialog's left button reads
  **Cancel the add** while it runs.
- The dialog closes by itself, and the Library shows an **Added** list with
  a row **Caltrain**, "downloaded", with **Start a project** and
  **Remove**.
- The confirmation is titled "Remove Caltrain?", with **Cancel** focused.
  Pressing **Remove** while the Caltrain project exists is refused in the
  dialog: "One project uses this feed; delete the project first." Press
  **Cancel**; the row is still there.

Result: ____

### 6. Inspect: mode and operator

**Do.** Open **Los Angeles** and read **In the feed**. Press the **Label**,
**Type** and **Trips** headers of the routes table. Open the **Mode**
select and look at its options without changing it. Then, for the
operator: go back to the Library, press **Start a project** on
**Mexico City Metro**, name it `Mexico City`, create and open it, and read
**In the feed** again.

**See.**
- For Los Angeles: **Operators**, **Stops**, **Trips** and **Service**
  filled in; Service reads "`<start>` to `<end>`; the engine would draw
  `<day>`".
- A table captioned "Route types, and what the chosen mode keeps", every
  row "kept" under mode `all`, and a routes table captioned
  "Routes: `<n>`". The routes open sorted by **Label**, ascending, so the
  first press on **Label** reverses it; the first press on **Trips** sorts
  most trips first, and on **Type** ascending; every further press on the
  column already sorted reverses it (an arrow beside that header shows the
  direction).
- The **Mode** select offers "all (every type)", the mode names of the
  feed's route types (the engine's suggestion, if it is one of them, marked
  "(the engine suggests it)") and "other…".
- **check:** Los Angeles shows no **Operator** select: the app offers one
  only when the feed names more than one operator or the project already
  has one (`Inspect.tsx`), and the LA rail feed is expected to name one.
- For Mexico City: the fields say Agency `METRO`, and **In the feed** has an
  **Operator** select whose first option is "every operator", followed by
  the feed's operators. The routes table's caption reads
  "Routes of METRO: `<n>`".
- Do not lay Mexico City out. Delete it now: **Delete project**, then
  **Delete** in the confirmation titled "Delete Mexico City?". The app goes
  back to the Library, and the project is gone from the list.

Result: ____

### 7. Lay out

**Do.** Open **Los Angeles** and press **Lay out**. Time it from the press
to "Laid out.". Then open **Caltrain** and press **Lay out** there too.

**See.**
- A region with a progress line of eight named stages, in this order:
  `parse`, `collapse`, `order`, `octilinear`, `trips`, `draw`, `animate`,
  `write`. These are the app's words for the engine's eight stages, one
  each, in the engine's own order (A5.5-10); the engine's own names are
  still what the jobs inspector's log and the geographic view's two
  buttons say. Each stage's station is filled as the engine finishes it, and
  the sentence beside the line is the engine's for the last stage that
  finished. **Cancel** is beside it while it runs.
- It ends with "Laid out." and a **Lay out again** button and a
  **Re-layout** button.
- The fields now say Service day `<day>` and Layout `<8 characters>`,
  made `<date and time>`.
- **What it costs.** Nothing here is a promise. The only figures are from
  the native-LOOM spike, which ran the LOOM tools by hand on a Mac, not the
  app's layout run: `gtfs2graph` over LA took about 13 seconds and `topo`,
  `loom` and `octi` under a second each (`docs/adr/spikes/loom-native.md`).
  The download of LA's zip happened in step 4, and the last four stages
  were not measured there. **check:** write down the whole time. On
  Windows it has not been measured before this run.
- Caltrain: **check:** the same eight stages and "Laid out.". Caltrain is
  this checklist's choice of feed, not one the engine's tests lay out, so a
  refusal here is recorded with the engine's sentence (it shows under the
  line) and filed, and the run carries on with Los Angeles.

Result: ____

### 8. The views on the project screen

The project screen has one frame showing the engine's page, and panels
around it. Under the **Map** tab, from the top: **What the build had to
fudge** (the diagnostics), **Service day**, **Line colours**,
**Line order**, **Theme**, and **Where the routes run** (the geographic
view's two stages); below the tabs, the viewer. Above the tabs sits
**In the feed** (step 6).

**Do.** In **Los Angeles**, read **What the build had to fudge**, press the
information button beside one measure (a screen reader names it
"What `<measure>` means"), press **Escape**, and press **Copy as text**. In **Where the routes run**, press **gtfs2graph**, then
**loom**; press Tab until the drawing has focus, and press `+`, `-`, an
arrow and `0`. Press Tab once more, and then **Enter**. Then use the map's
own controls inside the viewer.

**See.**
- The diagnostics open with either "No caveats: nothing was fudged, and
  the issues score is `<n>`." or "`<n>` caveats, and an issues score of
  `<n>`, where 0 is clean.", a table captioned "What the engine measured
  drawing the map for `<day>`", and an explanation that appears on the
  press and goes on **Escape**. **Copy as text** says "The figures and the
  caveats are on the clipboard."
- **Where the routes run**: the two buttons **gtfs2graph** and **loom**,
  the pressed one marked as pressed, and beside them the pressed stage's
  description only ("as the feed draws its routes" for gtfs2graph, "lines
  sorted onto shared track" for loom); a drawing that changes between the two
  without going blank; the counts **Nodes**, **Stations**, **Junctions**,
  **Edges** and **Lines**; and the drawing zooming, panning and fitting
  again from the keyboard, as the line under it says: "Zoom with the wheel
  or plus and minus, pan by dragging or with the arrows, 0 to fit."
- The Tab after the drawing shows **Skip past the map** over the top edge
  of the viewer, and **Enter** on it puts focus on **Rename**, below the
  map, without passing through the map's own controls.
- The viewer shows the animated map, its trains moving, with the engine's
  own view switcher and controls, and they respond. **check:** no message
  "This project's map is not there. Lay it out again." under it.

Result: ____

### 9. Restyle: line colours, by dragging

**Do.** In **Line colours**, press **Choose** on one line and **drag**
through the picker's colour square and hue slider without letting go for a
moment, then release outside the picker. Click somewhere outside the row.
Press **Reset** on that line. Choose a colour for the default row,
"Lines with no colour in the feed", by typing a hex value and pressing
**Use this colour**; then **Reset every line**.

**See.**
- The picker **stays open for the whole drag** and while you release; it
  closes on the click outside the row, not before (issue 87).
- The line's row says "your colour, `#rrggbb`", and after a moment the
  progress line runs again and says "Drawn in the colours you chose, from
  the stored layout. The stations have not moved." The map in the viewer
  shows the new colour on the line, its chips and the time chart.
- **Reset** puts the row back to "the colour in the feed, `#rrggbb`" (or
  "the default, ...") and the map follows; **Reset every line** does the
  same for all and then is unavailable.
- No step here says "Laid out."; nothing is laid out again.

Result: ____

### 10. Restyle: line order

**Do.** In **Line order**, press **Down** on the first line, then **Up** on
another. Wait for the map. Press **Back to alphabetical**.

**See.**
- A list "Lines in the order they are drawn", each row with **Up** and
  **Down**; the first row's **Up** and the last row's **Down** unavailable.
- After a move, a status sentence "`<line>` is now `<n>` of `<total>`.",
  and after a moment "Drawn with the lines in the order you chose, from the
  stored layout. The stations have not moved." The page's line rows follow
  the new order.
- **Back to alphabetical** says "The lines are in alphabetical order
  again." and becomes unavailable.

Result: ____

### 11. Restyle: theme

**Do.** In **Theme**, press **Sepia**. Then press **Warm dark**.

**See.**
- Two buttons, **Warm dark** and **Sepia**, the map's current one marked as
  pressed.
- The viewer reloads in the sepia theme at once, with no progress line and
  no layout run; the interface around it keeps its own theme.
- Beneath the two buttons, one sentence says that line width, station size
  and label size are the engine's own for now. Nothing else in this section
  offers to set them, not even a control that cannot be pressed.
- **Warm dark** brings it back. Leave it on **Warm dark** for the exports,
  or their file names gain `-light` (step 13).

Result: ____

### 12. The service day

**Do.** Open cell **03 Frame and service day**. Choose another date in
**Draw for another day** and look at the cells below before pressing
anything; then press **Draw for this day**. Then press **Use the busiest
weekday** and **Draw for this day** again. Try typing a date outside the
range the section gives and pressing **Draw for this day**.

**See.**
- The section says "Drawn for `<day>`. The feed covers `<start>` to
  `<end>`; the busiest weekday, counted from `<anchor>`, is `<day>`." and the
  date control's calendar offers only days in that range.
- Choosing a date **starts nothing**: no progress line, and the Jobs toggle
  stays at "Jobs, none running". The section says "`<new day>` is chosen;
  the map still shows `<old day>`.", cell 03's own state stays **ready**,
  and cells **04 Style**, **05 Lines** and **06 Export** say **not drawn
  yet**. Collapsed, cell 03's row reads "`<new day>`, the day you chose, not
  drawn yet".
- **Draw for this day** then runs the progress line and ends with "Drawn for
  `<day>` from the stored layout. The stations have not moved."; the
  fields' Service day changes to the new date, the Layout does not, and
  cells 04 to 06 go back to **ready**.
- A date outside the range is refused under the control as soon as it is
  typed: "The feed covers `<start>` to `<end>`.", nothing is stored, and
  pressing **Draw for this day** refuses it again and runs nothing.
- The cell offers no crop, rotation, margin or clip mask, not even greyed
  out, and says in one sentence that it will gain them.
- End on the busiest weekday, and write the day down for step 16.

Result: ____

### 13. Export a reel

**Do.** Press the **Export** tab. Leave **Preset** on
"instagram-reel: 1080 by 1920, video, MP4" (under **Instagram**) and
**Storyboard** on the preset's own. Press **Export**. Time it.

**See.**
- The **Preset** select lists thirteen presets under Instagram, LinkedIn,
  Bluesky and X, each "`<name>`: `<width>` by `<height>`, `<what it
  makes>`".
- While the tab is open, the viewer shows the export's tall frame, with the
  parts Instagram covers shaded.
- A progress line with `plan`, `capture` and `encode`, the current stage
  marked as it moves through them and each filled when done, and
  **Cancel**. Beside it the sentence changes as the export goes, among
  them "Planning the export.", "Planned `<file>`: `<n>` frames at `<fps>`
  frames per second.", "Capturing `<n>` frames.", "Captured `<n>` of `<n>`
  frames.", "Encoding `<n>` frames." and "Encoded `<n>` of `<n>` frames.";
  each is replaced by the next, and a short one can be gone before it can
  be read, so which of them you catch does not matter. "Captured `<n>` of
  `<n>` frames." counting up is the one that stays long enough to read; the choices above are unavailable while it runs,
  with "The choices wait until the export that is going has finished: it
  was planned from them."
- It ends with "Exported la-metro-rail-instagram-reel.mp4." and **Reveal**.
  No folder path is shown anywhere.
- **What it costs.** Not a promise: the only figure is from development,
  where the same reel took about two minutes on an Apple silicon laptop
  against engine v0.3.0 and a development ffmpeg, not the bundled one
  (`specs/010-export/spec.md`, SC-003). **check:** write down the time.

Result: ____

### 14. Export a post and a GIF

**Do.** Choose **Preset** "instagram-post: 1080 by 1350, still, PNG" and
press **Export**. Then choose "instagram-reel-gif: 630 by 1120, GIF" and
press **Export**.

**See.**
- For the post: a **View** select and a **Start time** field appear, and
  **Storyboard** goes; the viewer's frame changes shape with no shaded
  parts. It ends with "Exported la-metro-rail-instagram-post.png."
- For the GIF: **Storyboard** returns; it ends with
  "Exported la-metro-rail-instagram-reel-gif.gif."
- **check:** open both files. The post is a still of the map, the GIF plays.

Result: ____

### 15. Reveal the export

A named gate item **on Windows as much as on a Mac**.

**Do.** Press **Reveal**.

**See.**
- The platform's own file browser (the Finder, or File Explorer) opens on
  the export folder's `Los Angeles` folder, with the last export selected.
- The folder is at the place install.md's table gives (on Windows, inside
  OneDrive if OneDrive backs up the desktop) and holds the three files of
  steps 13 and 14, each with a `.json` file of the same name beside it.
- On Windows, **check:** the window comes to the front, and the file is
  selected rather than only its folder opened.

Result: ____

### 16. The jobs inspector

**Do.** Press **Jobs** in the header. If a job has a **Details**
disclosure, open it, and press **Copy log** on one job. Press **Escape**.

**See.**
- The toggle is read as "Jobs, none running" when nothing runs.
- The inspector's heading **Jobs** takes focus, and lists this session's
  jobs, the newest first and at most the last twenty finished: "Export as instagram-reel-gif",
  "Export as instagram-post", "Export as instagram-reel", the rebuilds
  ("Rebuild for `<day>`", "Redraw in new colours",
  "Redraw in a new line order"), "Layout run" for both projects and the
  feed add ("Feed add of Caltrain"), each "finished, started `<time>`",
  headed by its project's name, or by "Feeds" for the feed add.
- **Details** appears only on a failed job whose engine detail says more
  than its hint; a run where every job finished has none.
- **Copy log** says "The log is on the clipboard, with the keys in web
  addresses taken out and your home folder written as ~."
- **Escape** closes it and puts focus back on **Jobs**.

Result: ____

### 17. Quit, and reopen the project

**Do.** Quit the app (on a Mac, Legible Cities › Quit; on Windows, close the
window). Open it again, and open **Los Angeles**.

**See.**
- The app quits without a dialog, and **check:** no `Legible Cities`,
  `python` or LOOM tool process is left running (Activity Monitor, or Task
  Manager's Details tab).
- On reopening: no first-run dialog; the Library lists Los Angeles and
  Caltrain with their service days; **Added** still lists Caltrain.
- Los Angeles opens on "Drawn from layout `<8 characters>` for
  `<day>`.", the **same day** you wrote down in step 12, the same Layout
  in the fields, and the map in the viewer.
- **Nothing runs:** no progress line appears, the Jobs toggle stays at
  "Jobs, none running", and the diagnostics panel is absent (it is shown
  only for a map drawn in this session). The line colours and order you
  left are the map's.
- On the **Export** tab, **Preset** is the GIF, the last choice made.

Result: ____

### 18. Copy diagnostics

**Do.** Open **Settings** and press **Copy diagnostics**. Paste the result
into a plain text editor.

**See.**
- The screen says "The diagnostics are on the clipboard, with your home
  folder written as ~. Nothing was sent anywhere."
- The text begins "# Legible Cities diagnostics" and has the sections
  **App** ("Legible Cities `<version>`": write this app version into the
  run's issue), **Runtime**, **Operating system**, **Engine**,
  **Bundled tools**, the last 200 lines of `main.log` and of `engine.log`,
  and **Maps drawn this session**.
- Your user name does not appear in any path in it: the home folder is
  written as `~`.

Result: ____

### 19. Licences

**Do.** In Settings, read the **Licences** section. Press **Open the
notices** and look at what opens; close it. Press **Show the licence
texts** and look at the folder that opens. Press **Open Chromium's
licences** and look at the page that opens; close it.

**See.**
- The section says "Legible Cities is free software under the GNU General
  Public License, version 3 or later (GPL-3.0-or-later)." and lists the
  components, starting with "The legible-cities engine",
  "GPL-3.0-or-later", with LOOM, FFmpeg, Python, Electron and Chromium
  among them, none with a blank licence.
- **Open the notices** opens `THIRD_PARTY_NOTICES.md` in the system's
  viewer for Markdown files, or, where the system has none (Windows, by
  default), shows the file selected in Finder or File Explorer. Nothing on
  the screen names a path.
- **Show the licence texts** opens a folder named `licenses` holding
  `CPython-Doc-license.rst` and texts named `LICENSE.<library>.txt`, among
  them `LICENSE.openssl-3.txt`, `LICENSE.libffi.txt` and
  `LICENSE.zlib.txt`.
- **Open Chromium's licences** opens `LICENSES.chromium.html` in the
  browser: a long page of the open-source software in Chromium.
- No button says it is not bundled or missing.

Result: ____

### 20. Reset engine data

**Do.** In Settings, press **Reset engine data**, then **Cancel**. Press it
again, then **Reset**. Press **Back to Library**. Quit and open the app
again.

**See.**
- The confirmation is titled "Reset the engine's data?", with **Cancel**
  focused, and **Cancel** changes nothing.
- After **Reset**, the screen says "The engine's data is gone:
  `<the folders removed>`. Start the app again so the engine reads its
  folder afresh." The folders named are among `data`, `out`, `projects` and
  `frames`, and the engine folder's size goes down.
- The Library shows the empty state again.
- **check:** by the time the app has started again, the **Added** list and
  Caltrain are gone (the engine keeps its record of added feeds in the
  removed `data` folder), and the presets say "not downloaded yet".
- The exports from steps 13 and 14 are still in the export folder.

Result: ____

### 21. Uninstall, and what is left

**Do.** Follow [Uninstall completely](install.md#uninstall-completely),
steps 2 and 3 (step 1 was this checklist's step 20). Leave the exports.
Then look in every place the tables in
[What the app writes, and where](install.md#what-the-app-writes-and-where)
name.

**See.**
- The app is gone from Applications, or from the Windows apps list and the
  Start menu. **check:** on Windows, the desktop shortcut went with it.
- None of the places in the tables exist any more, except the export
  folder with your exports in it.
- **check:** anything else named for the app that is still on the machine:
  on a Mac, search the Finder for "Legible Cities" and for
  `com.richardcaballero.legiblecities`; on Windows, look in
  `%LOCALAPPDATA%` and `%APPDATA%` for a folder named for the app or for
  `legible-cities-app`. Anything found is a failure of install.md, not of
  the person: name it.

Result: ____

## Failures

Every failure becomes an issue of its own, one per defect, even when two
happened in the same step. Give it the step's number and title, the
machine and OS from the run, what you did, what the checklist says you
should have seen, and what you saw instead, with a screenshot where it
helps and the diagnostics from step 18 (read them first, as install.md
says). Label it `type:bug`. Link each one from its step's row in the run's
issue. A **check:** line that turned out differently from what it
describes is a failure only if the app is wrong; if the checklist is
wrong, file it against this document.

## Results template

Copy everything in the block below into a new issue titled
`A6-04 run: <macOS or Windows> <version>, <date>`.

```markdown
## Acceptance run

| | |
|---|---|
| App version | (step 18, "App") |
| Engine version | (step 3, Versions) |
| OS and version | (e.g. macOS 15.6, Windows 11 24H2) |
| Machine | (model, chip or processor, memory) |
| Clean machine? | (never had Legible Cities installed: yes / no) |
| Date | |
| Run by | |
| Installer file name | |
| Its SHA-256 | |
| Matches SHA256SUMS.txt? | yes / no |
| Started, finished | |
| Time taken | |

## Steps

| # | Step | Result | Notes and failure issues |
|---|---|---|---|
| 1 | Download and check the installer | pass / fail | |
| 2 | Install and open it the first time | pass / fail | |
| 3 | First run: the Library, the engine and the bundled tools | pass / fail | |
| 4 | Create a project from the LA preset | pass / fail | |
| 5 | Add a feed by its web address | pass / fail | |
| 6 | Inspect: mode and operator | pass / fail | |
| 7 | Lay out (LA: ___ s; Caltrain: ___ s) | pass / fail | |
| 8 | The views on the project screen | pass / fail | |
| 9 | Restyle: line colours, by dragging | pass / fail | |
| 10 | Restyle: line order | pass / fail | |
| 11 | Restyle: theme | pass / fail | |
| 12 | The service day | pass / fail | |
| 13 | Export a reel (___ s) | pass / fail | |
| 14 | Export a post and a GIF | pass / fail | |
| 15 | Reveal the export | pass / fail | |
| 16 | The jobs inspector | pass / fail | |
| 17 | Quit, and reopen the project | pass / fail | |
| 18 | Copy diagnostics | pass / fail | |
| 19 | Licences | pass / fail | |
| 20 | Reset engine data | pass / fail | |
| 21 | Uninstall, and what is left | pass / fail | |

## Versions from Settings

(the six rows of step 3)

## Anything else
```
