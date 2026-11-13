# Spike: the gate's person-only checks on a hosted macOS runner

- **Question:** Can three checks the release gate leaves to a person be
  driven by a machine on a GitHub-hosted macOS runner, against an installed
  release? They are the screen-reader walkthrough with VoiceOver (issue
  691), a rules engine as a second accessibility net (issue 692), and the
  update over a real 0.1.0 project (issue 690).
- **Timebox:** five rounds of push and read.
- **Started:** 2026-11-13 (round 1's run)
- **Ended:** 2026-11-13 (round 4's run), in four rounds; all three
  questions are answered.
- **Branch:** `spike-gate-tools`, a throwaway, named for the workflow it
  carried rather than `spike/<name>` as the other spikes' branches are:
  one workflow, `.github/workflows/spike-gate-tools.yml`, triggered by a
  push to that branch, and the probes under `spike/`. Deleted when this
  record lands; the record is the deliverable.

## Method

Every job ran on `macos-15` (the `macos-15-arm64` image, version
20261104.0514.1, macOS 15.8.2), on Node 24. Each downloaded a published
Release's Mac disk image for the runner's architecture with `gh release
download`, copied `Legible Cities.app` out of it with `ditto` as
`acceptance.yml` does, and launched it with Playwright's
`_electron.launch` the way `tests/acceptance/acceptance.spec.ts` does: a
fresh `--user-data-dir`, `LEGIBLE_EXPORT_FOLDER` set to a temporary folder,
no development variables, the window raised and focused before anything
else. The tools went into a temporary folder on the runner with `npm
install --no-save`; nothing was added to the repository's dependencies.

| Tool | Version |
| --- | --- |
| Playwright (`playwright-core`) | 1.64.1, the repository's own pin |
| `@guidepup/setup` | 0.29.3 (`setup --ci`, then `install voiceover`) |
| `@guidepup/guidepup` | 0.40.0 |
| `@axe-core/playwright` | 4.14.0 (axe-core 4.14.0) |
| The app | `v1.0.0-rc.3` (1.0.0); `v0.1.0` for the update |

The runs, all of the spike-gate-tools workflow:

| Round | Commit | Run | What it changed |
| --- | --- | --- | --- |
| 1 | 1c9a56f | 43397139455 | the three probes |
| 2 | efbdf7d | 43398383995 | guidepup's VoiceOver assets installed; axe also prints the rules passed, each rule's tags, the first node and its summary, and the theme as launched; rc.3 opens the 0.1.0 profile. Cancelled before it started: hosted Mac runners were saturated |
| 3 | 929448c | 43399898553 | round 2's changes, first run here; and axe prints each card's name beside its text |
| 4 | c698d9c | 43408453875 | axe's own view of a card; Chromium's accessibility support with no screen reader; `project.json` before and after rc.3 |

A green job in this table means only that its script exited 0. Every
answer below is read from the job's own output: failure counts, phrases,
rule results.

## VoiceOver against the app (issue 691)

**The probe.** Ten cycles in one job. Each cycle starts VoiceOver with
guidepup, launches rc.3 with a fresh profile, raises its window, waits for
the Library, and sends five Tabs through Playwright's keyboard. Each Tab is
wrapped in guidepup's `voiceOver.capture()`, its hook for an action another
tool performs, which polls VoiceOver for the last spoken phrase and for the
text under VoiceOver's cursor once the action returns. The first and last
cycles also take six steps of VoiceOver's own navigation (`next()`, VO
with the right arrow).

**Round 1 failed all ten cycles before VoiceOver started.** `setup --ci`
reported success, but `voiceOver.start()` then refused with "Failed to
mount Guidepup preferences", and asked for `npx @guidepup/setup install`
to have been run "at least once for this project to install screen
reader assets". It named neither an argument nor a folder. The step
added in round 2 and first run in round 3 was `npx @guidepup/setup install
voiceover`, in the temporary folder that holds `@guidepup/guidepup`; it
downloaded guidepup's VoiceOver preferences
asset into `~/Library/Caches/guidepup`. The folder matters: `@guidepup/setup`
0.29.3's `lib/commands/install/resolve-manifest.js` resolves
`@guidepup/guidepup/package.json` from the working directory and reads the
`manifest.json` beside it. Whether a bare `install` would have done the
same was not tried. With that one step added, round 3:

| Measure | Round 3 | Round 4 |
| --- | --- | --- |
| Cycles clean (no error, a phrase for every Tab) | 9 of 10 | 10 of 10 |
| Tabs with a spoken phrase captured | 49 of 50 | 50 of 50 |
| Tabs where VoiceOver's cursor was on the focused control | 50 of 50 | 50 of 50 |
| VoiceOver start | 8.7 to 12.8 s | 3.7 to 7.5 s |
| One cycle, start to stop | 15 to 24 s | 10 to 19 s |
| Chromium's accessibility support, VoiceOver on | on at launch, every cycle | on at launch, every cycle |
| The same, no screen reader running (the axe job) | not measured | off at launch, and still off at the Library |

The one miss, in round 3, was the first Tab of the first cycle: the phrase
came back empty though the cursor had moved to "New project button". In
every later cycle, and in all ten of round 4, the same Tab was heard as
"New project button list Projects 1 item". Round 3's miss came on
VoiceOver's first start on a fresh runner; round 4's first cycle was also
a first start on a fresh runner, and did not miss. So it is one miss in
two cold starts, not something every cold start does. Across the two runs:
19 of 20 cycles clean, 99 of 100 Tabs heard, 100 of 100 followed.

What was heard, word for word the same in every clean cycle of both runs:

```
tab 1  New project button list Projects 1 item
tab 2  LA Metro Rail, Los Angeles · Metro Rail, not downloaded yet button LA Metro Rail group (1 of 22)
tab 3  BART, San Francisco Bay Area · BART, not downloaded yet button BART group (2 of 22)
tab 4  TriMet MAX, Portland · MAX Light Rail, not downloaded yet button TriMet MAX group (3 of 22)
tab 5  New York City Subway, New York · Subway, not downloaded yet button New York City Subway group (4 of 22)
```

VoiceOver's own navigation, from the fourth card, where the fifth Tab left it:

```
next 1  end of New York City Subway group (4 of 22)
next 2  Chicago 'L' group (5 of 22) 5 of 22
next 3  Chicago 'L', Chicago · The 'L', not downloaded yet button
next 4  end of Chicago 'L' group (5 of 22)
next 5  MBTA Subway group (6 of 22) 6 of 22
next 6  MBTA Subway, Boston · MBTA Subway, not downloaded yet button
```

Keyboard focus followed VoiceOver's cursor onto each button it landed on,
and stayed put while the cursor was on a group.

**The answers.**

- *Does Chromium turn its accessibility tree on by itself under
  VoiceOver?* Yes. With VoiceOver started before the app, Electron's
  `isAccessibilitySupportEnabled()` was already true at the first window in
  every cycle, with nothing in the app or the probe asking for it. The
  control, the same app launched the same way with no screen reader (the
  axe job, round 4), had it off at launch and still off at the Library.
  So it is VoiceOver, with guidepup's setup applied, that turns it on (the
  control skipped the setup), and a probe needs nothing of its own.
- *Is a phrase captured for focus moved by Playwright?* Yes: 99 of 100
  over two runs. The one miss was the first Tab after a cold start, in one
  of the two cold starts. A warm-up Tab before the walkthrough's first row
  is the proposed fix; it was not tried.
- *Does VoiceOver's cursor follow keyboard focus?* Yes, 100 of 100, with
  the VoiceOver preferences guidepup installs.
- *How long?* 4 to 13 s to start VoiceOver, 10 to 24 s for a cycle with
  five Tabs, four to five minutes for the whole job including the download
  and the setup.

## axe on the Library (issue 692)

`new AxeBuilder({ page }).options({ iframes: false }).withTags(['wcag2a',
'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).setLegacyMode().analyze()`
on the Library of rc.3, as launched (the runner is light, so the
interface came up in Parchment through "Follow the system"), then in Night
and in Parchment, switched through Settings.

**It runs against Electron in legacy mode**, in 0.3 to 1.1 s an analysis.
The result was the same in every theme:

- 23 rules passed, among them `color-contrast` on 78 nodes,
  `target-size`, `nested-interactive`, `image-alt`, `button-name` and
  `label-content-name-mismatch` on three elements; 41 inapplicable;
  **nothing incomplete**.
- **One violation**: `label-content-name-mismatch` (serious; WCAG 2.5.3,
  Label in Name, level A) on 21 of the 22 sample-city cards.

The cards' accessible names are set by `aria-label` (`Card.tsx`, from
`sampleName` in `SampleCities.tsx`). Each name holds every visible line of
its card, in order, joined by ", ":

| | |
| --- | --- |
| Accessible name | `LA Metro Rail, Los Angeles · Metro Rail, not downloaded yet` |
| Visible lines | `LA Metro Rail` / `Los Angeles · Metro Rail` / `not downloaded yet` |

**Every word of the visible text is in the name, in order; axe flags the
cards because of how it joins the text, not because a word is missing.**
Round 4 asked the copy of axe the analysis left in the page what it
compares (`axe.commons.text.subtreeText`, then the rule's own clean-up:
punctuation removed, whitespace collapsed, lower case). A card is a button
holding a picture with `alt=""`, then `span.card-name`, then
`span.card-facts`, which holds `span.card-fact` and `span.card-chip`; the
stylesheet stacks the three texts as lines. axe concatenates the spans'
text with nothing between them:

| | What axe compares |
| --- | --- |
| Visible text, as axe takes it | `la metro raillos angeles · metro railnot downloaded yet` |
| Accessible name | `la metro rail los angeles · metro rail not downloaded yet` |

"raillos" and "railnot" are not in the name, so the rule fails. The same
holds for every card printed (`bartsan francisco bay area`, `trimet
maxportland`, and so on). The one card the violation leaves out is Chicago
'L', whose text holds the single letter L in quotes; the probe's own
reproduction of the comparison fails it too, so why axe passes it was not
established.

So the finding is real as axe states it, and narrower than it reads. The
name does carry the visible words in order and begins with the card's
first line, so a person who says "LA Metro Rail" to speech control should
reach the button; what fails is the rule's string comparison, which sees
the lines run together because the separation exists only in the layout.
Either way a sweep would fail on it on every release. A likely fix is a
space in the markup at two levels, between `span.card-name` and
`span.card-facts`, and between `span.card-fact` and `span.card-chip`
inside it, which would make axe's string read `la metro rail los angeles ·
metro rail not downloaded yet`; it was not tried here. It is a change to
`Card.tsx`, filed as issue 707, not part of the sweep's.

**Contrast is checked and clean.** `color-contrast` ran on 78 nodes in
each theme and passed them all, with nothing left incomplete.

## The update over 0.1.0 (issue 690)

The probe drove the published 0.1.0 with the role-and-name locators of its
own acceptance spec's steps 4 and 12 (`git show
v0.1.0:tests/acceptance/acceptance.spec.ts`, with `tests/support/project.ts`
at the same tag): the Presets list's "LA Metro Rail" item and its button,
the "Layout run" region until "Laid out.", the Layout and Made rows of cell
02's provenance strip, cell 06's group, the Preset select set to
`instagram-post`, Export until "Exported …", quit. The profile was isolated
as that spec isolated it, with `--user-data-dir` and
`LEGIBLE_EXPORT_FOLDER`. Then rc.3 was launched on the same two folders.

**The locators drive 0.1.0 as they are**, in both runs:

| | Round 1 | Round 3 |
| --- | --- | --- |
| Library ready after launch | 5 s | 4 s |
| Card pressed to "Laid out." (download included) | 28 s | 33 s |
| Layout, Made in cell 02 | a4da3f11, "11/13/2026, 8:57:19 AM" | c7d405e8, "11/13/2026, 9:57:17 AM" |
| `instagram-post` exported | 4 s | 4 s |
| Quit | 1 s | 1 s |
| Launch to quit | 40 s | 44 s |

Round 4 ran it a third time: 3 s, 27 s, Layout c7d405e8, 4 s, 1 s, 37 s.

**Where 0.1.0 wrote.** It honours `--user-data-dir`: its `userData` was the
folder given. The project went to
`<profile>/engine/projects/<id>/project.json` (1136 bytes), the engine's
home being `engine` under the profile; the export and its sidecar went to
`<LEGIBLE_EXPORT_FOLDER>/LA Metro Rail/la-metro-rail-instagram-post.png`
and `.png.json`. A search for `project.json` and the export's name found
neither in a Legible Cities folder under Application Support, on the
Desktop or in Documents.

**rc.3 opens it.** Launched on the same profile, rc.3's Library had "Your
projects" with one button, "Open LA Metro Rail"; the project opened to
"The map is drawn from every cell.", and cell 02's strip read Layout
c7d405e8, the layout 0.1.0 had made, with Engine now 0.21.1. rc.3's
session (launch, open, quit, nothing else pressed) rewrote `project.json`
(round 4): version 1 before, version 2 after; its keys gained `revision`;
the values were not compared.

Two things the automated step 22 must allow for:

- **Made is written differently by the two versions**: 0.1.0 says
  "11/13/2026, 9:57:17 AM", rc.3 "13 November 2026 at 9:57 AM" for the
  same moment. "Made unchanged" has to be compared as a moment (from
  `project.json`, or parsed), never as the strip's text.
- **The layout id is not the same in every run** (a4da3f11 once,
  c7d405e8 twice, from the feed as each run downloaded it, not hashed): topo
  is not deterministic (loom#44). The seed phase has to write down its own
  id for the later phases to compare against; no id can be written into
  the spec.

Not tried: the default profile. Issue 690 has each phase use each version's
own default profile, so each version's own path resolution links them; this
spike gave both versions the same `--user-data-dir`, which says that the
data carries over, not that 0.1.0 and 1.0 resolve the same default folder.

## Recommendations

**VoiceOver (issue 691): build it.** The three premises the issue named
hold on a hosted runner. For the probe's five Tabs, the issue's bar, the
transcript matching on two runs in a row, was met outright by round 4 (10
of 10 cycles) and in 9 of 10 cycles by round 3, whose miss was cycle 1's
first Tab; every clean cycle of both was word for word the same. Build it
as the issue describes, with what this spike found:

- `npx @guidepup/setup setup --ci` **and** `npx @guidepup/setup install
  voiceover`, the second run in the folder where `@guidepup/guidepup` is
  installed; without it nothing starts, and the error names `install` but
  neither its `voiceover` argument nor where to run it.
- Node 24 for the setup step.
- One warm-up Tab, not recorded, before the first row, as the proposed
  fix for the cold-start miss (one in two cold starts here). It was not
  tried; the lane's first run proves it or not.
- Each row's action wrapped in `voiceOver.capture()`, which returns the
  phrase and the cursor's text together; nothing has to turn the app's
  accessibility tree on.
- A row records what was heard, never a pass, as the issue says: the
  phrases here are exact strings and a person still judges whether they
  made sense.

What the probe did not try, and the lane should expect to meet: rows
inside the notebook, the map's frame (the sandboxed viewer), live-region
announcements while a run progresses, and the rotor, which issue 694 keeps
for the person's sitting.

**axe (issue 692): build it**, as the issue describes: legacy mode,
`options()` before `withTags()`, `iframes: false`, inside the sweep's theme
loop. It costs about a second at most an analysis. Its first run will fail on the
sample cards' `label-content-name-mismatch`, so either the card change
lands first (issue 707, against `Card.tsx`) or the known-findings
list starts with that one entry, keyed by rule and selector and naming that
issue. The first is better: the fix looks small, and the finding will be
the rule's to make on every release until it is made.

**The update over 0.1.0 (issue 690): build it, with two changes to its
checks.** The seed phase is proven: 0.1.0's own locators drive the
published 0.1.0 unchanged on a hosted runner in under a minute, and rc.3
opens what it left, keeps its layout and moves `project.json` to version
2. The two changes:

- "Made unchanged" compares the moment, not the strip's text, since the
  two versions format it differently; and the lane checks that `made`
  survives the rewrite to version 2, which this spike did not compare.
- The seed writes down its own layout id; nothing assumes one.

And one thing to settle in the lane rather than assume: the issue's
default profiles. This spike linked the versions by giving both the same
`--user-data-dir`; whether 0.1.0's default folder is the one 1.0 reads is
the question the default-profile design rests on, and the first `after`
phase run on a runner will answer it.

## Follow-up

- Issue 707: separate the sample cards' lines in their visible text, so
  the name contains the label (the axe finding above).
- Issue 691: the scripted VoiceOver run of the walkthrough, built as
  recommended.
- Issue 692: axe in the sweeps, after issue 707 or with its one known
  finding.
- Issue 690: the automated update over 0.1.0, with the two changes to its
  checks and the default profile settled in the lane.
- No decision record follows from this record by itself: ADR-063, the 1.0
  gate (issue 694), cites it.

## What would change this

- A guidepup release that changes how `capture()` polls, or a macOS image
  whose VoiceOver no longer answers AppleScript, would undo the first
  answer; the pins are exact for that reason.
- A run where the first-phrase miss happens after a warm-up Tab would mean
  the miss is not a cold start, and the walkthrough would need a retry
  policy rather than a warm-up.
- If hosted Mac runners stay as scarce as they were for round 2, a lane of
  its own in `acceptance.yml` costs queue time, not runner time: the three
  jobs ran in 1 to 5 minutes each once they started.
