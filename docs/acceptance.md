# Acceptance checklist

The release gate's run over an installed app (issue A6-04): one person, one
machine, an installer from a GitHub Release draft, and
[`install.md`](install.md) open beside it. Run it once on a Windows PC and
once on a clean Mac, a Mac that has never had Legible Cities on it. The
stranger's timed run is a separate document,
[`acceptance-stranger.md`](acceptance-stranger.md); the screen-reader
walkthrough is in [`accessibility.md`](accessibility.md#walking-it-with-a-screen-reader).

The steps follow what a person does with the app: install it, open a
sample city and watch it download and lay out, go down the project's six
cells - the feed, the layout and what it had to fudge, the day and the
clock, the style, the lines, the export - then add a feed of their own,
reopen, rename, delete, reset and uninstall. The project screen is the
notebook of ADR-045 and ADR-046: six numbered cells with the map between
cells 02 and 03, and a rail of steps and outputs beside them.

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

A **cell** is one of the project's six numbered sections, "01 Data" to
"06 Export". Each is opened and closed by pressing its heading, and each
heading carries the cell's state as an icon and a word: **ready**,
**running**, **not drawn yet** or **failed**. The **rail** beside the cells
lists the same six as **Steps**; pressing a step opens its cell and scrolls
it into view. Below the steps, **Outputs** lists what the project has
exported.

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
LEGIBLE_ACCEPTANCE_APP="/Applications/Legible Cities.app" LEGIBLE_ACCEPTANCE_TAG=v0.1.0-rc.5 npm run test:acceptance
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
  alone.

It brings the app's window to the front, takes focus and scrolls the map
into view before watching it, because Chromium stops the map's animation in
a window hidden behind others and in a frame scrolled out of sight; if the
window still is not visible, the record says the trains' movement was not
checked rather than failing it.

What it cannot do stays a person's, and the record says so step by step
("not automated"), never counting it as passed:

- **Step 2**: a runner downloads without a quarantine attribute or a mark of
  the web, so neither Gatekeeper nor SmartScreen warns, and the way past
  the warning in `install.md` is not exercised. The Mac app is copied from
  the disk image rather than dragged to Applications; the Windows installer
  runs silently and so does not open the app.
- **Judgement**: whether a map, a colour, a theme or a GIF looks right,
  whether a drag feels right (the spec drags the picker with the mouse and
  checks it stays open, and a line of the order by its grip and checks
  where it lands), and whether the Finder or File Explorer came to
  the front with the file selected (the spec records what the app asked
  the system to show or open, and checks those files).
- **Places**: the profile and export folder are temporary, so the folders
  in `install.md`'s tables are checked only in step 21.
- **Older than the checklist**: a release tagged before the front door and
  the notebook this checklist follows (A5.6-06, pull request 243) cannot
  pass it, so the run refuses its tag before step 3 and says why, rather
  than failing eighteen steps. Accept such a release with the checklist
  and spec at its own tag: dispatch the workflow on the tag itself. The
  workflow names the tag; a local run names it with
  `LEGIBLE_ACCEPTANCE_TAG`, and without one nothing is refused.
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
  and name, the engine's status line, **Jobs** and **Settings**. On the
  Library there is no way back to offer; on a project and in Settings the
  header also holds **Library** (named "Back to Library") after the status
  line.

Result: ____

### 3. First run: the front door, the engine and the bundled tools

**Do.** Wait without pressing anything for about thirty seconds. Then press
**Settings** and read the screen from the top. Press **Back to Library**.
Press **Settings** again, choose **Parchment** under **Theme**, press **Back
to Library**, and look at the sample cards; then choose **Night** again.

**See.**
- The front door opens with its heading, **Library**, and its
  introduction: "Legible Cities draws a transit network as a schematic map
  and plays a day of its service on it: start from a sample city below, or
  add a feed of your own." Under it, **Your projects** holds one card,
  **New project**, with a plus where a picture would be and "Projects you
  make appear here, most recently opened first." beside it, and below that
  the **Sample cities**. There is no other **New project** button and no
  **Your feeds** yet.
- The engine's status line starts at "Checking the engine…" or "Starting
  the engine." and becomes "Engine ready (`<engine version>`)." The version
  is the engine pin in `vendor/pins.json` at the release tag (0.10.1 when
  this was written).
- **No dialog opens.** The first-run check of the bundled LOOM and ffmpeg
  passes silently; a dialog titled "LOOM will not run", "ffmpeg will not
  run" or "LOOM and ffmpeg will not run" is a failure of this step. Write
  down its sentences and press **Copy diagnostics** in it before you close
  it.
- Under **Sample cities**, a card for each of the engine's networks - 22 at
  the pinned engine - the same card as **New project**: each with a small
  picture of that city's network where the picture would be (the lines in
  their feed's colours on the card's sunken ground, no labels, and nothing
  to load: they come with the app), its name, its city and network, and
  "not downloaded yet" in a small chip. In Night every picture is the one
  for the dark ground; in Parchment, after the change above, every one is
  the one for the light ground, and Night puts the dark ones back, each
  time without the front door being reloaded. A picture is not read aloud
  and changes no card's name.
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

### 4. Open a sample city, and watch it download and lay out

**Do.** Press the **LA Metro Rail** card under **Sample cities**, and
nothing else until the run ends. Time it from the press to the end of the
run.

**See.**
- The card is read aloud as "LA Metro Rail, Los Angeles · Metro Rail, not
  downloaded yet", with nothing said for its picture, the drawing of the LA
  network above its name.
- One press opens the project, without a dialog: a heading **LA Metro
  Rail**, with **Library** in the header beside the engine's status (a
  screen reader names it "Back to Library"), and the notebook's six cells, 01 to 06, with cells 01 to 05
  open and 06 closed. The rail's **Steps**, under the project's name, lists the same six, and its
  **Outputs** says "Nothing exported yet."
- The layout starts by itself. The status sentence under the heading reads "01
  Data is running." while the feed downloads, then "02 Process is running.",
  with **Stop** beside it.
  If a run fails, the same sentence reads "02 Process failed." and a
  screen reader says it once, assertively, from an alert of the header's
  own, without the sentence being read out a second time.
- In cell **01 Data**, **In the feed** says "Reading the feed, and
  downloading it first if it is not on this machine yet…" and then fills
  in (step 5).
- In cell **02 Process**, a progress line of eight named stages, in this
  order: `parse`, `collapse`, `order`, `octilinear`, `trips`, `draw`,
  `animate`, `write`. These are the app's words for the engine's eight
  stages, one each, in the engine's own order (A5.5-10). Each stage's
  station is filled as the engine finishes it, and the sentence beside the
  line is the engine's for the last stage that finished. **Cancel** is
  beside it while it runs.
- It ends with "Laid out.", **Lay out again** and **Re-layout**. The map
  appears after cell 02, its trains moving, and scrolls with the cells. The
  sentence under the heading becomes
  "The map is drawn from every cell." and **Run all** is gone, since
  there is nothing to run.
- Every cell's heading, and every step in the rail, says **ready**.
- **What it costs.** Nothing here is a promise. The only figures are from
  the native-LOOM spike, which ran the LOOM tools by hand on a Mac, not the
  app's layout run: `gtfs2graph` over LA took about 13 seconds and `topo`,
  `loom` and `octi` under a second each (`docs/adr/spikes/loom-native.md`).
  This time includes the feed's download. **check:** write down the whole
  time. On Windows it has not been measured before this run.
- While the feed downloads, cell **01 Data** shows a line of one station,
  `download`, with "downloaded `<n>` of `<n>` bytes" beside it counting up,
  and reads **running**; cell 02 says "Waiting for the feed to download
  (cell 01)." and its line waits at `parse`. **In the feed** fills in only
  once the download is done (issue 178, engine v0.10.0).

Result: ____

### 5. Cell 01, Data: the feed and where its routes run

**Do.** Read cell **01 Data**. Press the **Label**, **Type** and **Trips**
headers of the routes table. Open the **Mode** select and look at its
options without changing it. In **Where the routes run**, press
**gtfs2graph**, then **loom**; press Tab until the drawing has focus, and
press `+`, `-`, an arrow and `0`. Press Tab once more to reach **The network
in words**, press **Enter** on it, then **Enter** on one **Stations on
`<line>`, in order**, and **Enter** on **The network in words** again to close
it. Press Tab on through cell 02 until **Skip past the map** appears over the
map's top edge, and then **Enter**.

**See.**
- The fields say Feed `la-metro-rail`, Mode `<the card's mode>` and Agency
  `none`.
- **In the feed**: **Operators**, **Stops**, **Trips** and **Service**
  filled in; Service reads "`<start>` to `<end>`; the engine would draw
  `<day>`".
- A table captioned "Route types, and what the chosen mode keeps", and a
  routes table captioned "Routes: `<n>`". The routes open sorted by
  **Label**, ascending, so the first press on **Label** reverses it; the
  first press on **Trips** sorts most trips first, and on **Type**
  ascending; every further press on the column already sorted reverses it
  (an arrow beside that header shows the direction).
- The **Mode** select offers "all (every type)", the mode names of the
  feed's route types (the engine's suggestion, if it is one of them, marked
  "(the engine suggests it)") and "other…".
- **check:** Los Angeles shows no **Operator** select: the app offers one
  only when the feed names more than one operator or the project already
  has one (`Inspect.tsx`), and the LA rail feed is expected to name one.
  Step 15 finds one.
- **Where the routes run**: a sentence under the heading saying what the
  two are ("The map below is the schematic. These are two earlier stages of
  the same layout, drawn where the routes really run ..."), then the two
  buttons **gtfs2graph** and **loom**,
  the pressed one marked as pressed, and beside them the pressed stage's
  description only ("as the feed draws its routes" for gtfs2graph, "lines
  sorted onto shared track" for loom); a drawing that changes between the
  two without going blank; the counts **Nodes**, **Stations**,
  **Junctions**, **Edges** and **Lines**; and the drawing zooming, panning
  and fitting again from the keyboard, as the line under it says: "Zoom
  with the wheel or plus and minus, pan by dragging or with the arrows, 0
  to fit."
- **The network in words**, a button one Tab after the drawing's pane,
  closed to begin with. The pane's own name (read in a screen reader or the
  browser's accessibility tree) is the stage, its description and the
  counts: "The `<stage>` stage, `<its description>`: `<L>` lines, `<S>`
  stations". Opened, it shows one sentence, "On the day drawn,
  the longest trip on one line takes `<m>` minutes: the `<line>` from `<A>`
  to `<B>`.", and a list with one item per line in the engine's order:
  "`<line>`: from `<A>` to `<B>`, `<n>` stations; meets `<X>` at `<P>`, and
  `<Y>` and `<Z>` at `<Q>`." (or "meets no other line."; a loop reads "a loop
  of `<n>` stations through `<A>`"). Each item has a button **Stations on
  `<line>`, in order**, closed to begin with; pressing it lists the line's
  stations in order. **check:** the day in the first sentence is the day
  cell 03 says is drawn, and no station list is open until you open one.
- Tab on past cell 02 reaches **Skip past the map** over the top edge of
  the map, which sits after cell 02, and **Enter** on it puts focus on cell
  03's heading, "03 Frame and service day", without passing through the
  map's own controls.
- Collapsed, cell 01's row reads "`<n>` stops in the feed", under a
  chevron that points right at the row's left edge; open, the chevron
  points down. The state word ("ready") is at the row's far end.

Result: ____

### 6. Cell 02, Process: the layout and what the build had to fudge

**Do.** Read cell **02 Process**. Open **Engine log** and press **Copy
log**. Read **What the build had to fudge**, press the
information button beside one measure (a screen reader names it
"What `<measure>` means"), press **Escape**, and press **Copy as text**.
Press **Re-layout**, then **Cancel** in the dialog.

**See.**
- The run's line still says "Laid out." beside **Lay out again** (the
  sentence a later visit reads there is step 17's).
- The cell's footer lists **Layout** (`<8 characters>`), **Made** (`<date
  and time>`), **Built with** and **Engine now** (the engine's version, the
  same as the status line). Write the Layout and the Made down for step 17.
- **Engine log**, with the count of its lines beside it, is closed until
  opened (a screen reader names what it opens "The engine's log for this
  run"); **Copy log** says "The log is on the clipboard, with the keys in
  web addresses taken out and your home folder written as ~." The lines are
  the engine's own, one for each stage it finished, and anything the LOOM
  tools wrote while they ran (engine v0.9.0, E37). After step 4's layout it
  holds a line per stage, each after its level, from "[info] gtfs2graph:
  `<n>` nodes (`<n>` stations, `<n>` junctions), `<n>` edges, lines:
  `<labels>` (`<n>` s)" to "[info] write: la-metro-rail.svg,
  la-metro-rail.html and la-metro-rail.positions.json (`<n>` s)", with
  "[info] layout `<8 characters>`: read from the store" before the draw's
  lines, where the draw reads the layout the run has just made; none of
  them names a folder.
- The diagnostics open with either "No caveats: nothing was fudged, and
  the issues score is `<n>`." or "`<n>` caveats, and an issues score of
  `<n>`, where 0 is clean.", a table captioned "What the engine measured
  drawing the map for `<day>`", and an explanation that appears on the
  press and goes on **Escape**. **Copy as text** says "The figures and the
  caveats are on the clipboard."
- **Re-layout** opens a dialog titled "Lay this project out from
  scratch?", with **Cancel** focused; **Cancel** closes it and starts
  nothing.

Result: ____

### 7. Cell 03, Frame and service day: pick a day, scrub the clock

**Do.** In cell **03 Frame and service day**, choose another date in
**Draw for another day** and look at the cells below before pressing
anything; then press **Draw for this day**. Then press **Use the busiest
weekday** and **Draw for this day** again. Try typing a date outside the
range the section gives and pressing **Draw for this day**. Then, under
**Transport**, drag **Time of day** to another hour, press **Play day**
and then **Pause**, and choose another **Speed**.

**See.**
- The section says "Drawn for `<day>`. The feed covers `<start>` to
  `<end>`; the busiest weekday, counted from `<anchor>`, is `<day>`." and
  the date control's calendar offers only days in that range.
- Choosing a date **starts nothing**: no progress line, and the Jobs toggle
  stays at "Jobs, none running". The day is kept at once: **Service day**
  in the cell's footer already shows it. The section's sentence now begins "`<new day>`
  is chosen; the map still shows `<old day>`.", cell 03's own state stays
  **ready**, and cells **04 Style**, **05 Lines** and **06 Export** say
  **not drawn yet**. The sentence under the heading names them: "04 Style
  to 06 Export are not drawn yet." Collapsed, cell 03's row reads
  "`<new day>`, not drawn yet".
- **Draw for this day** then runs the progress line and ends with "Drawn
  for `<day>` from the stored layout. The stations have not moved."; the
  **Layout** and **Made** in cell 02's footer do not change, and cells 04
  to 06 go back to **ready**.
- A date outside the range is refused under the control as soon as it is
  typed: "The feed covers `<start>` to `<end>`.", nothing is stored, and
  pressing **Draw for this day** refuses it again and runs nothing.
- The cell offers no crop, rotation, margin or clip mask, not even greyed
  out, and says in one sentence: "The frame's margin is one of the sizes in
  cell 04; the frame is padded and never cropped or rotated, and a clip mask
  waits on a designer's intent, so this cell holds the day alone."
- **Transport**: "Where the map is in its service day." and **Time of
  day**, a slider whose clock beside it reads `HH:MM`; the map moves to
  the hour the slider is left at. **Play day** and **Pause** start and stop
  the map's clock, and **Speed** offers "15 seconds a second", "30 seconds a
  second", "A minute a second", "Two minutes a second" and "Five minutes a
  second". None of this starts a job or changes the project.
- End on the busiest weekday, and write the day down for step 17.

Result: ____

### 8. Cell 04, Style: the theme and the sizes

**Do.** With the map playing, note the hour on the clock beside cell 03's
slider. In cell **04 Style**, press **Sepia**. Then press **Warm dark**.
Then, under **Sizes**, type **12** into **Line width** and press Enter, and
wait for the map to be drawn again. Type **30** into **Line width** and
press Enter. Set **Station radius** to **8**, leave the field, and then set
**Interchange radius** to **9**. Press **Reset to the engine's sizes**.

**See.**
- Two buttons, **Warm dark** and **Sepia**, the map's current one marked as
  pressed.
- The map changes to the sepia theme at once and in place: it does not go
  blank or start again, its clock carries on from the hour you noted rather
  than from the start of the day, and the view and labels you had are as
  you left them. There is no progress line and no layout run; the interface
  around it keeps its own theme.
- Under **Sizes**, one sentence names the unit once: "In the map's own
  units: the map is drawn 1,800 wide, so a line width of 7 is seven of
  1,800." Below it are eight fields, **Line width**, **Line gap**,
  **Station radius**, **Interchange radius**, **Station outline**,
  **Label size**, **Label offset** and **Margin**, each showing the
  engine's own number (7, 1.6, 4.2, 6, 2.2, 11, 9 and 24) and saying its
  range beneath it ("1 to 24. The engine's own is 7."). Beside **Margin**:
  "The frame is padded, never cropped or rotated: a station is never cut
  off, and a tighter frame is a smaller margin." **Reset to the engine's
  sizes** cannot be pressed while nothing has been set. Nothing in the cell
  says the engine cannot be told.
- A figure is taken when it is left or Enter is pressed, not as it is
  typed. **12** in **Line width** draws the map again from the stored
  layout: cell 04 reads **running** for a moment and then **ready**, the
  progress line is cell 02's sentence "Drawn in the sizes you chose, from
  the stored layout. The stations have not moved.", the lines are drawn
  thicker and no station has moved, and no cell below reads **not drawn
  yet**. Collapsed, cell 04's row reads "Warm dark, sizes of your own".
- **30** is refused beside the field with the engine's sentence, "style.line_width must
  be from 1 to 24, in SVG user units at the map's width", the figure stays
  where it was typed, and nothing is drawn.
- **8** in **Station radius** is refused beside it, "style.interchange_radius
  (6) must not be below style.station_radius (8); a field left out counts as
  its default, so send both", and nothing is drawn; setting **Interchange
  radius** to **9** takes both in one redraw.
- **Reset to the engine's sizes** puts all eight fields back to the
  engine's own numbers, draws the map once more as it was before, and then
  cannot be pressed; the row reads "Warm dark" again.
- **Warm dark** brings the theme back. Leave it on **Warm dark** for the
  exports, or their file names gain `-light` (step 11).

Result: ____

### 9. Cell 05, Lines: colours, by dragging

**Do.** In cell **05 Lines**, under **Line colours**, press the colour chip
at the start of one line's row and **drag** through the picker's colour
square and hue slider without letting go for a moment, then release outside
the picker. Click somewhere outside the picker. Press the chip again and
**Reset** in its panel. Choose a colour
for the default row, "Lines with no colour in the feed", by typing a hex
value and pressing **Use this colour**; then **Reset every line**.

**See.**
- The picker opens **floating under the chip** and moves no row; near the
  foot of the window it opens above. It **stays open for the whole drag** and
  while you release; it closes on the click outside it, not before (issue
  87), and on Escape, with focus back on the chip.
- The line's row says "your colour, `#rrggbb`", and the chip follows the
  colour while you drag. **Cell 02 does not run, and the map does not change,
  while the button is down, however long you hold it**; when you let go,
  cell 02's progress line runs once and says "Drawn in the colours you chose,
  from the stored layout. The stations have not moved." The map shows the new
  colour on the line, its chips and the time chart.
- **Reset**, inside the panel, closes it and puts the row back to "the colour in the feed, `#rrggbb`" (or
  "the default, ...") and the map follows; **Reset every line** does the
  same for all and then is unavailable.
- Nothing is laid out again: no "Laid out." here.

Result: ____

### 10. Cell 05, Lines: the order

**Do.** Under **Line order**, press the grip at the start of the first
line's row (six dots) and **drag** it down to the last place without
letting go for a moment, then release. Drag another line a little way and,
still holding it, press Escape; then release. Rest the pointer on a row's
up arrow. Then press the down arrow on the first line, and the up arrow on
another. Wait for the map. Press **Back to alphabetical**.

**See.**
- A list "Lines in the order they are drawn", each row with a grip at its
  start and two arrows at its end; the first row's up arrow and the last
  row's down arrow unavailable.
- While a line is dragged it is lifted onto a lighter ground with an edge
  around it and **follows the pointer**, and the lines it passes step aside
  to show where it will land. On release it stays there, the status says
  "`<line>` is now `<n>` of `<total>`." for the place it landed in, and the
  map is drawn **once**.
- Escape during the drag puts every line back where it was, and nothing is
  drawn.
- An arrow names its move in a tooltip, "Move line `<line>` up", when the
  pointer rests on it and when it has focus.
- After a press, a status sentence "`<line>` is now `<n>` of `<total>`.",
  and after a moment "Drawn with the lines in the order you chose, from the
  stored layout. The stations have not moved."
- The page's line rows follow the new order only from engine v0.12.0
  (richc117/legible-cities#63); with the pinned v0.10.1 the page sorts
  its Linear and Time rows A to Z whatever the order, and on the
  schematic the change shows only where two lines share track, so a map
  that looks the same here is not a failure of the app (issue 343).
- **Back to alphabetical** says "The lines are in alphabetical order
  again." and becomes unavailable.

Result: ____

### 11. Cell 06, Export: a reel

**Do.** Open cell **06 Export**. Leave **Preset** on
"instagram-reel: 1080 by 1920, video, MP4" (under **Instagram**) and
**Storyboard** on the preset's own. Press **Export**. Time it.

**See.**
- The **Preset** select lists thirteen presets under Instagram, LinkedIn,
  Bluesky and X, each "`<name>`: `<width>` by `<height>`, `<what it
  makes>`".
- While the cell is open, a preview inside it shows the export's tall
  frame, with the parts Instagram covers shaded, and a caption under it,
  "9:16, 1080 x 1920." and that the shading is guidance and not in the
  export. The map above it keeps running where it was.
- Among the choices, a **Caption** field, a **Clock corner** select and,
  near the foot, **Alt text for the file’s sidecar**. On the reel
  **Clock corner** lists "top right (the preset’s own)" and "bottom left"
  only, with "The platform’s own buttons cover the bottom right, so it is
  not offered. Bottom left is inside its bottom zone, where they can cover
  the clock; top right keeps it clear. The title and a caption sit top
  left, so the clock is not offered there while either is drawn." under it.
  Leave all three as they are for this step: the reel is timed as it comes.
- A progress line with `plan`, `capture` and `encode`, the current stage
  marked as it moves through them and each filled when done, and
  **Cancel**. Beside it the sentence changes as the export goes, among
  them "Planning the export.", "Planned `<file>`: `<n>` frames at `<fps>`
  frames per second.", "Capturing `<n>` frames.", "Captured `<n>` of `<n>`
  frames.", "Encoding `<n>` frames." and "Encoded `<n>` of `<n>` frames.";
  each is replaced by the next, and a short one can be gone before it can
  be read, so which of them you catch does not matter. "Captured `<n>` of
  `<n>` frames." counting up is the one that stays long enough to read;
  the choices above are unavailable while it runs, with "The choices wait
  until the export that is going has finished: it was planned from them."
- It ends with "Exported la-metro-rail-instagram-reel.mp4." and **Reveal**.
  The cell's footer says **Exported** `la-metro-rail-instagram-reel.mp4`
  and "The engine wrote a sidecar beside it: what the file is, the caveats
  of the network it shows, and its alt text." No folder path is shown
  anywhere.
- The rail's **Outputs** gains a row for it.
- **What it costs.** Not a promise: the only figure is from development,
  where the same reel took about two minutes on an Apple silicon laptop
  against engine v0.3.0 and a development ffmpeg, not the bundled one
  (`specs/010-export/spec.md`, SC-003). **check:** write down the time.

Result: ____

### 12. Cell 06, Export: a post and a GIF

**Do.** Choose **Preset** "instagram-post: 1080 by 1350, still, PNG". In
**Caption** type any 60 characters and then an 81st, and read what appears
under the field. Replace them with `Rush hour on the Red Line` and press
Tab. In **Alt text for the file’s sidecar** type
`A schematic of the Los Angeles rail lines.` with a space before it and one
after, and click elsewhere. Press **Export**. Then choose
"instagram-reel-gif: 630 by 1120, GIF" and press **Export**.

**See.**
- For the post: a **View** select and a **Start time** field appear, and
  **Storyboard** goes; the preview in cell 06 changes shape with no shaded
  parts and, a moment after you left **Caption**, shows
  `Rush hour on the Red Line` under its title. **Clock corner** is
  unavailable, with "The clock is off, so it has no corner to choose.",
  until **The clock** is checked; checked, it lists "top right", "bottom
  left" and "bottom right (the preset’s own)".
  It ends with "Exported la-metro-rail-instagram-post.png."
- **Caption** counts as it nears its bound and refuses beside the field:
  at the 60th character "60 of 80" is added under it, and at an 81st that
  line is replaced by "A caption is 1 to 80 characters on one line; this
  one is 81." and the preview does not take it.
- For the GIF: **Storyboard** returns; **Clock corner** lists "top right",
  "bottom left" and "bottom right (the preset’s own)", this preset having
  no shaded parts to keep the clock out of the bottom right; the caption
  and the alt text are the project’s own and stay as they were. It ends with
  "Exported la-metro-rail-instagram-reel-gif.gif."
- **check:** open both files. The post is a still of the map with
  `Rush hour on the Red Line` under its title, the GIF plays with it.

Result: ____

### 13. Outputs, and Reveal

A named gate item **on Windows as much as on a Mac**.

**Do.** Close cell **06 Export**. In the rail's **Outputs**, read the rows,
and press **Reveal** on the newest.

**See.**
- Closing cell 06 takes its preview away; the map, which it never touched,
  is where it was.
- **Outputs** lists three rows, one per export of steps 11 and 12, the
  newest first, each with its preset, when it was made and **Reveal** (a screen reader names
  it "Reveal `<preset>`, `<file>`").
- The platform's own file browser (the Finder, or File Explorer) opens on
  the export folder's `LA Metro Rail` folder, with that export selected.
- The folder is at the place install.md's table gives (on Windows, inside
  OneDrive if OneDrive backs up the desktop) and holds the three files of
  steps 11 and 12, each with a `.json` file of the same name beside it.
- On Windows, **check:** the window comes to the front, and the file is
  selected rather than only its folder opened.
- **check:** open the post’s sidecar, `la-metro-rail-instagram-post.png.json`.
  Its `alt` is `A schematic of the Los Angeles rail lines.`, without the
  space at either end. The reel’s, made before one was typed, holds the
  engine’s own sentence in its place.

Result: ____

### 14. A project from a feed at an address

The feed is **Caltrain**, from
`https://data.trilliumtransit.com/gtfs/caltrain-ca-us/caltrain-ca-us.zip`.
It was chosen because it is small (about 170 KB, so the download is quick
on any connection), public (the agency's official feed, published by its
data vendor without a key), current (its calendar runs from 31 January
2026 to 31 January 2027, and the host was updating it in August 2026), rail
only (five routes, all of route type 2, so the app's `all` mode keeps a
map rather than a city's buses), carries `shapes.txt`, which the engine
draws from, and is not one of the engine's presets, so it lands in
**Your feeds**. Its agency is named "Caltrain", which becomes the feed's
name. If the address has stopped answering, record that and use another
small, rail-only, current GTFS zip, and say which in the notes.

**Do.** Press **Library** at the top of the project, then the **New
project** card.
Under **Start from** choose **A feed at an address**, paste the address
into **Feed address** and press **Add the feed**. When the feed is in,
press **Cancel**, which keeps the feed. Then press **Start a project** on
the new row, leave the name, and press **Create**. Press the new project's
card under **Your projects**, press **Run all**, and wait for it. Go back to the
Library, press **Remove** on the Caltrain row, **Remove** in the
confirmation, and then **Cancel**.

**See.**
- On the front door, **Your projects** holds the **New project** card and
  then "LA Metro Rail", with "Los Angeles · Metro Rail" and "finished up to
  05 Lines" beneath its name and, above it, the engine's small picture of
  the map it drew for this project, in the project's own line colours and
  in the interface's palette, whichever theme the project's map wears; the
  LA Metro Rail sample's card now says "downloaded" in its chip.
- The sheet is titled **New project**, with **Cancel** focused; **Start
  from** offers **A sample city, or a feed you added**, **A GTFS zip on
  this computer** and **A feed at an address**.
- While it runs, a progress line with two stages, `download` and `check`,
  and beside it "downloaded `<n>` of `<n>` bytes" (or "downloaded `<n>`
  bytes"), then "checked the feed's tables". The sheet's left button reads
  **Cancel the add** while it runs.
- When the feed is in, **Name** is filled with "Caltrain" and the primary
  button reads **Create**. After **Cancel**, the front door shows **Your
  feeds** with a row **Caltrain**, "downloaded", with **Start a project**
  and **Remove**.
- **Start a project** opens the sheet on the Caltrain feed, named
  "Caltrain". **Create** closes it and lists **Caltrain** under **Your
  projects**, with focus back on **Start a project**. The project opens with "Nothing has
  been laid out yet." under its heading and **Run all** available; **Run
  all** runs the
  same eight stages as step 4 and ends with "Laid out." Caltrain is this
  checklist's choice of feed, not one the engine's tests lay out, so a
  refusal here is recorded with the engine's sentence (it shows under the
  line) and filed, and the run carries on. Time it.
- The confirmation is titled "Remove Caltrain?", with **Cancel** focused.
  **Remove** is refused in the dialog while the Caltrain project exists:
  "The project “Caltrain” uses this feed; delete it first." After
  **Cancel** the row is still there.

Result: ____

### 15. Another sample's operator, and deleting a project

**Do.** On the front door, press the **New project** card, choose **Mexico City
Metro** under **Feed**, leave the name, and press **Create**. Open it from
**Your projects** and read cell **01 Data**. Then, without laying it out, press **Delete project** at the
foot of the notebook and **Delete** in the confirmation.

**See.**
- The sheet names it "Mexico City Metro". Its fields say Agency `METRO`,
  and **In the feed** has an **Operator** select whose first option is
  "every operator", followed by the feed's operators. The routes table's
  caption reads "Routes of METRO: `<n>`".
- Nothing is laid out: the sentence under the heading is "Nothing has been
  laid out yet." On the front door, after **Create** and before the
  project is opened, its card under **Your projects** has the empty picture
  area, a faint train, because no map has been drawn for it, while the
  **Mexico City Metro** card under **Sample cities** has its picture.
- The confirmation is titled "Delete Mexico City Metro?", says "This
  removes the project and its generated output. The feed stays.", and has
  **Cancel** focused. After **Delete** the app goes back to the front door,
  and the project is gone from **Your projects**.

Result: ____

### 16. The jobs inspector

**Do.** Press **Jobs** in the header. If a job has a **Details**
disclosure, open it, and press **Copy log** on one job. Press **Escape**.

**See.**
- The toggle is read as "Jobs, none running" when nothing runs.
- The inspector's heading **Jobs** takes focus, and lists this session's
  jobs, the newest first and at most the last twenty finished: "Layout run"
  for Caltrain, the feed add ("Feed add of Caltrain"),
  "Export as instagram-reel-gif", "Export as instagram-post",
  "Export as instagram-reel", the rebuilds ("Redraw in a new line order",
  "Redraw in new colours", "Rebuild for `<day>`") and "Layout run" for LA
  Metro Rail, each "finished, started `<time>`", headed by its project's
  name, or by "Feeds" for the feed add. A job that is running says which
  stage, "running `<stage>`, `<n>` of `<total>`, started `<time>`", above a line
  of stations with no labels; the line fits the inspector with no
  sideways scroll, and its title, line and buttons start where the heading
  does.
- **Details** appears only on a failed job whose engine detail says more
  than its hint; a run where every job finished has none.
- **Copy log** says "The log is on the clipboard, with the keys in web
  addresses taken out and your home folder written as ~."
- **Escape** closes it and puts focus back on **Jobs**.

Result: ____

### 17. Quit, reopen, and rename

**Do.** Quit the app (on a Mac, Legible Cities › Quit; on Windows, close the
window). Open it again, and open **LA Metro Rail** from **Your projects**.
Press **Rename** at the foot of the notebook, type `Los Angeles` and press
**Save**. Press **Library**.

**See.**
- The app quits without a dialog, and **check:** no `Legible Cities`,
  `python` or LOOM tool process is left running (Activity Monitor, or Task
  Manager's Details tab).
- On reopening: no first-run dialog; **Your projects** holds the **New
  project** card, then Caltrain and then LA Metro Rail (newest opened
  first), each with the engine's picture of its map, where it runs and
  "finished up to 05 Lines"; **Your feeds** still lists Caltrain.
- LA Metro Rail opens with cells 01 and 02 collapsed and the map after
  them; opening cell 02 shows "Drawn from layout `<8 characters>` for
  `<day>`.", the **same day** you wrote down in step 7, and the same
  **Layout** and **Made** in the cell's footer.
- **Nothing runs:** no progress line appears, the Jobs toggle stays at
  "Jobs, none running", the sentence under the heading is "The map is drawn
  from every cell.", and the diagnostics are absent (they are shown only
  for a map drawn in this session). The line colours and order you left are
  the map's, and **Outputs** still lists the three exports.
- In cell **06 Export**, **Preset** is the GIF, the last choice made.
- **Rename** opens a **New name** field; after **Save** the heading reads
  **Los Angeles**, and the front door lists it first after **New project**
  (a screen reader reads its card as "Open Los Angeles").

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
- The front door shows its introduction again, and **Your projects** holds
  only the **New project** card.
- **check:** by the time the app has started again, **Your feeds** and
  Caltrain are gone (the engine keeps its record of added feeds in the
  removed `data` folder), and the sample cards say "not downloaded yet".
- The exports from steps 11 and 12 are still in the export folder. They
  are outside the engine data folder. Files already inside one of the
  four folders, `data`, `out`, `projects` or `frames`, are removed by a
  reset that goes ahead, exported files included.
- The reset is not refused. Nothing in this checklist gives a project an
  export folder of its own, so a refusal here is a failure: write down the
  sentence the dialog showed.

**What the reset refuses, and what it does not see.** A project can export
to a folder of its own, chosen in cell 06. While a project in this engine
data folder exports to a folder that is inside the engine data folder, is
that folder, or holds it, the reset is refused: the dialog stays open and
says "The project “`<name>`” exports to a folder inside the engine data
folder, or around it, so the reset could remove its exported files; move
them out of the engine data folder and change where the project exports
first." Choosing such a folder as the engine data folder is refused in
Settings on the same rule: "The project “`<name>`” exports to a folder
inside that one, or around it, so “Reset engine data” could remove its
exported files; choose another folder, or move them out of that one and
change where the project exports first." And while a chosen engine data
folder is waiting for a restart, cell 06 refuses a folder inside it or
around it: "that folder is inside the folder the engine data moves to at
the next start, which “Reset engine data” removes from then on". None of
the three sees a project whose record was left behind in an engine data
folder the app used before: projects are kept in the engine data folder
and are not moved when another is chosen, so after the restart the app no
longer reads them. Each sentence asks for the files to be moved as well as
the folder changed, because changing where a project exports moves
nothing, and a reset that then goes ahead removes whatever was exported
into one of the four folders.

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
| 3 | First run: the front door, the engine and the bundled tools | pass / fail | |
| 4 | Open a sample city, and watch it download and lay out (___ s) | pass / fail | |
| 5 | Cell 01, Data: the feed and where its routes run | pass / fail | |
| 6 | Cell 02, Process: the layout and what the build had to fudge | pass / fail | |
| 7 | Cell 03, Frame and service day: pick a day, scrub the clock | pass / fail | |
| 8 | Cell 04, Style: the theme and the sizes | pass / fail | |
| 9 | Cell 05, Lines: colours, by dragging | pass / fail | |
| 10 | Cell 05, Lines: the order | pass / fail | |
| 11 | Cell 06, Export: a reel (___ s) | pass / fail | |
| 12 | Cell 06, Export: a post and a GIF | pass / fail | |
| 13 | Outputs, and Reveal | pass / fail | |
| 14 | A project from a feed at an address (Caltrain: ___ s) | pass / fail | |
| 15 | Another sample's operator, and deleting a project | pass / fail | |
| 16 | The jobs inspector | pass / fail | |
| 17 | Quit, reopen, and rename | pass / fail | |
| 18 | Copy diagnostics | pass / fail | |
| 19 | Licences | pass / fail | |
| 20 | Reset engine data | pass / fail | |
| 21 | Uninstall, and what is left | pass / fail | |

## Versions from Settings

(the six rows of step 3)

## Anything else
```
