# ADR-063: The 1.0 gate is machines, the assistant's review, and one sitting

- **Status:** Proposed
- **Date:** 2026-11-13
- **Decided by:** the maintainer (issue 694)
- **See also:** [ADR-037](037-the-first-release-is-unsigned.md), whose gate
  this replaces for 1.0 and after; [ADR-054](054-1-0-ships-unsigned-with-no-automatic-update.md)
- **Supersedes:** none
- **Superseded by:** none

## Context

Until now a version was released only after a candidate of it had passed a
gate of four parts, as `docs/releasing.md` described it: the automated run
(`.github/workflows/acceptance.yml`, the acceptance checklist driven over
the Release's own installers on a macOS and a Windows runner), the same
checklist walked by a person on a clean Mac and on a Windows PC, a
stranger's timed run from the release page to a first reel, and the
screen-reader walkthrough in `docs/accessibility.md`, with VoiceOver on the
Mac and Narrator on Windows. No record decided that gate; it grew with the
documents.

**What the person runs recorded for 0.1.0.** The three person runs were
reported done with no issue noted. The macOS and Windows versions, what
Gatekeeper and SmartScreen showed, the readers' versions and the
stranger's times were not written down (ADR-037, "As of 8 Oct 2026"), so
the person runs established that nobody was stopped, and little else that
a later release can compare against. Of the walkthrough's 73 rows, 25 have
changed since and owe a walk before 1.0.

**What a person was doing that a machine now can.** The person runs were
mostly the automated run again, with eyes. Four things change that:

- **The update over 0.1.0** (acceptance step 22) was a person's because a
  runner has never had 0.1.0. The published 0.1.0 can be installed on a
  runner and driven by the role-and-name locators of its own acceptance
  spec, and the candidate then opens the project it made (issue 690; the
  spike record, `docs/adr/spikes/gate-tools-on-hosted-macos.md`).
- **The visual rows**, the checklist's questions of whether a map, a
  colour, a theme or a GIF looks right, can be kept as images with the
  machine checks a picture allows: two shots that should differ do, an
  export frame is not blank (issue 689). Whether the image is right is
  still a judgement, which a reviewer can make from the images, under a
  protocol, without the app in front of them.
- **VoiceOver can be scripted on a hosted macOS runner.** The spike record
  started VoiceOver, launched a published candidate and moved focus with
  Playwright, ten times: Chromium's accessibility tree was on at launch in
  every cycle with nothing asking for it, a spoken phrase was captured for
  49 of 50 focus moves (the one miss the first phrase after a cold start),
  and VoiceOver's cursor followed keyboard focus 50 times in 50 (issue 691).
  What it captures is what was spoken, not whether a listener understood
  it.
- **axe runs against the app in its legacy mode** (the default opens a new
  page, which Electron refuses), and found on its first run a Label in
  Name violation on the sample-city cards that the existing sweeps had not
  (the spike record; issue 692).

**What no machine here can do.** Hear whether an announcement was audible
or made sense, or whether progress sentences flood speech; use the rotor's
lists as a person does; judge native choosers and the Finder; feel a drag;
meet the first open of an app downloaded through a browser, which a runner
never does, since its downloads carry no quarantine attribute and no mark
of the web (`docs/acceptance.md`, "The automated run"); and open a real
project made with real data in an older version. Nothing scripts Narrator.

**Windows ships as a beta** in 1.0: one tag and one Release for both
systems, the Windows build called a beta where the release is described,
not in the app or the file name.

## Options

**Keep the gate as it was.** A person on a clean Mac and on a Windows PC,
the checklist end to end on each; both readers walked; the stranger before
the release. It buys a person's eyes and ears on every step on both
systems, SmartScreen and Narrator included. It costs two long sittings and
two walks on every final candidate, and a stranger who has never seen the
app, found for each one; and 0.1.0 showed how little of what such a run
sees is written down when it is done on the same day as the release.

**Machines alone.** The automated run with the update, the evidence and
its assertions, the scripted VoiceOver run and axe, and no person. It is
repeatable and runs on every candidate. It leaves unmeasured everything in
the paragraph above: a script's `heard` says words were spoken, an
assertion that two shots differ says nothing about whether either looks
right, and the first open of a quarantined download is never seen.

**Machines, the assistant's review and one sitting** (chosen). The machines
take what they can measure, on both systems, on every candidate. The
assistant reads every kept image under a written protocol, with two
control pairs it cannot tell from real ones, and posts its verdicts on the
gate issue. One person, for about 45 minutes on the final candidate, goes
straight to what neither can judge, starting with the assistant's doubtful
rows. The stranger's run is kept, after the release, as feedback.

**The stranger before the release** was weighed on its own. Its measure, a
first reel within fifteen minutes with no help, judges the README, the
install guide and the front door, all of which a later release can
improve; it does not find a defect the other parts miss. Holding a release
for it holds the release on finding a person who has never seen the app.

## Decision

The gate for 1.0, and for the releases after it until a record replaces
this one, is: the automated run green on a macOS and a Windows runner,
over the candidate's own installers, with the update over 0.1.0 and the
visual evidence with its machine assertions once each has landed (issues
690 and 689); the scripted VoiceOver run recorded on the macOS runner
(issue 691), its cells worded as `docs/accessibility.md`'s legend says, or,
where it is not recorded, the VoiceOver rows walked by ear in the sitting;
the assistant's visual review of the kept images, under the reviewer's
protocol in `docs/acceptance.md`, posted on the gate issue with its
images; and one sitting of about 45 minutes by a person on the final
candidate, on a Mac, from `docs/acceptance-sitting.md`, recorded in an
issue of its own and ending in the go or no-go. Windows, a beta, is
accepted on its automated results alone: no person run, no SmartScreen
check, no Narrator walk. The stranger's timed run, `docs/acceptance-stranger.md`,
is made after the release, and what it finds feeds the next one.

## Consequences

**The person's time goes where only a person helps.** The sitting is ten
items with a time each (`docs/acceptance-sitting.md`): the first open
from a browser download, with the network and without; VoiceOver's own
announcements and the rotor; the rows the script could not hear; the
review's doubtful rows and its two control pairs; the feel of the drags;
Reveal, the licences and quitting during an export; one real 0.1.0
project opened after the update; and the versions and the verdict. Each
item is something the machines above cannot establish.

**`heard` is not a pass.** A scripted run appends its own words to a
VoiceOver cell, naming the versions and the run, and never overwrites what
is there; `pass` stays a person's word. A row the script did not hear in
full is the sitting's. A unit test holds the cells to that wording
(`tests/unit/accessibility-record.test.ts`).

**The visual review is not a person's eyes, and is built not to pretend
to be.** Its verdicts are `looks right`, `looks wrong` and `cannot tell`,
never `pass`; it describes what it sees before judging; and the two
control pairs, the same settings asked as if changed, are what the person
reads first: a review that finds a difference in a control has found one
that is not there. The automated record keeps saying "not automated" for
those rows whatever the review concludes.

**Windows carries the risk of a beta.** Nobody watches SmartScreen, the
installer's first open or Narrator for 1.0. `docs/install.md`'s Windows
sentences are checked only where the automated run can check them, and
the Narrator column of the accessibility record keeps the walk of 0.1.0.
A Windows build that leaves beta brings a person run on Windows back, and
that is a new record.

**The fifteen-minute measure is not known at release.** The stranger's
run reports after the release, so a release can ship whose first steps
stall a newcomer; ADR-054's reopening clause (people stopped by the
warnings) applies to what that run finds as it would to a bug report.

**One sitting is one Mac.** One macOS version, one person's VoiceOver
settings, one network. What it records is the versions it ran on; it says
nothing of the others.

**What to watch.** A sitting that finds something a machine part claims
to check means that part checks less than it says, and the part is fixed
before the next candidate rather than the sitting grown. If the scripted
VoiceOver run is not recorded for the final candidate, the sitting walks
the VoiceOver rows that changed since 0.1.0 by ear instead of item 5,
about 20 minutes longer. If the review's control pairs are ever judged as
changed, the review's verdicts on that candidate are not relied on, and
the sitting looks at every image itself.
