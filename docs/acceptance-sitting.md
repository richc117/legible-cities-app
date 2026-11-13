# The sitting

The person's part of the release gate (ADR-063): one person, about 45
minutes, on the final candidate, on a Mac. Everything else in the gate is
done before it, by machines and by the assistant
([`releasing.md`](releasing.md#the-gate)): the automated run on a macOS and
a Windows runner; the scripted VoiceOver run, once issue 691 lands; and,
once issue 689 lands, the assistant's visual review of the images the run
kept, written into the run's record. Where one of those is missing for
the candidate, the item that relies on it says what that means. The
sitting goes straight to what none of those can judge. Windows, a beta, is
not part of it.

Ten items, each with the minutes it should take. Do them in order, since
each leaves the app where the next one starts. Quoted text is the app's
own, word for word, and `<angle brackets>` stand for something that
varies, as in [the acceptance checklist](acceptance.md#how-to-read-a-step).
Where the app says something else, that is a finding: note it and go on.

**Results are recorded in an issue of their own, never committed.** Copy
the [results form](#results-form) into a new issue and fill it in as you
go. File every finding as an issue of its own, as the checklist's
[Failures](acceptance.md#failures) says, and link it from the item's row.

## Before you start

- **The Mac.** One where 0.1.0 is installed and has been used, with at
  least one project of your own made in it (item 9 opens it). If you may
  want 0.1.0 back afterwards, copy its engine data folder first, as
  [Updating from an earlier release](install.md#updating-from-an-earlier-release)
  says.
- **The candidate.** Its Release, published as a pre-release, open in a
  browser. The installer is downloaded in that browser, not with `gh` or
  `curl`: only a browser's download is marked as coming from the internet,
  and item 1 is about what macOS does with that mark.
- **The gate issue**, open in another window, with the automated run's
  records and, where they exist for this candidate, the scripted
  VoiceOver run's and the assistant's visual review.
- **VoiceOver off** to begin with. Its keys are in the walkthrough's
  [table](accessibility.md#turning-the-readers-on-and-off-and-the-few-keys-needed).
- **A clock.** Note the time you start: the form asks how long it took.

## The items

### 1. First open from a browser download

**3 minutes.** Download the disk image for this Mac from the Release page,
as [Which file to download](install.md#which-file-to-download) says.
Install it over 0.1.0 as [Install on a Mac](install.md#install-on-a-mac)
and [Updating from an earlier release](install.md#updating-from-an-earlier-release)
say (choose **Replace**), and open it. Write down, word for word, every
dialog macOS shows before the app's window, and whether `install.md`
describes it. Quit the app.

Then once more with no network: move the app to the Trash, turn Wi-Fi off
(and unplug any network cable), drag the app from the disk image to
Applications again and open it. Write down what macOS showed this time,
and whether the app's window opened. Quit, and turn the network back on.

### 2. VoiceOver's own announcements

**4 minutes.** Turn VoiceOver on, then open the app and touch nothing.
Listen for the engine's status line said by itself, without focus moving
to it: "Starting the engine." and then "Engine ready (`<version>`)."

Press a card under **Sample cities**, one you have no project of, and
listen to the layout run to its end, as the walkthrough's
[Cell 02, Process](accessibility.md#project-the-cells) describes. Write
down whether the progress sentences come faster than VoiceOver can say
them (speech that never catches up, or is cut off sentence after sentence,
floods), and whether the end, "Laid out.", is said once.

### 3. A feed by address

**3 minutes.** Press **New project**, choose **A feed at an address**,
paste the Caltrain address from
[step 14](acceptance.md#14-a-project-from-a-feed-at-an-address) into
"Feed address" and press **Add the feed**. Listen to the download: does
the byte count flood speech? At the end, listen for "The feed is in."
said once, and focus in "Name".

Then clear "Feed address", type `abc` and press **Add the feed**. Listen
for the alert "Use an address that starts with http:// or https://." and
for focus back in the field, read as invalid. Press Escape.

### 4. The rotor

**4 minutes.** On the project item 2 laid out, press VO-U and go through
the rotor's lists with the Left and Right Arrows.

- **Headings:** one at level 1, the project's name; at level 2, the
  project's name again over the rail's steps, the six cells from "01 Data"
  to "06 Export", and "Outputs"; nothing else at level 2.
- **Landmarks:** among them the navigation "Steps" and the regions
  "Outputs" and "Map".

Choose "Map" in the landmarks list and write down what VoiceOver reads on
entering it. The walkthrough expects the frame named "`<project>`,
animated"; what is read inside it is the engine's page.

### 5. By ear, what a script cannot judge

**7 minutes.** Two kinds of row from the
[walkthrough](accessibility.md#walking-it-with-a-screen-reader), with
VoiceOver's own navigation and with Tab:

- **The new parts where a description has to make sense to a listener**:
  **Layout tuning** in cell 02, **Trip** in cell 03, **Sizes** and its
  **Look** in cell 04, **Line options** in cell 05, and the **Caption**,
  the alt text and the **Opening** in cell 06. For each, write down
  whether what was said told you what the control does.
- **Every row the scripted run marked `not heard` or `heard in part`**,
  listed on the gate issue: listen for what the row expects and write
  down what you heard.

If the gate issue has no scripted VoiceOver run for this candidate, walk
instead every row of the
[results by screen](accessibility.md#results-by-screen) whose VoiceOver
cell reads "not yet run: a person's" or "pass as it stood at 0.1.0", each
by its part of the walkthrough. That takes about 20 minutes more, and
the form's row 5 says it was the walk.

### 6. The assistant's visual review

**10 minutes.** The review is the table of verdicts the assistant wrote
into the automated run's record, linked from the gate issue, under the
reviewer's protocol that issue 689 adds to
[`acceptance.md`](acceptance.md#the-reviewers-protocol), with the images
it names. Two control pairs sit among its rows unmarked; which they were
is in a key, a separate artefact the reviewer is not given until every
verdict is written. The evidence the reviewer reads carries no machine
check's result; those are in the run's record, read after the verdicts.
With VoiceOver off:

1. **The two control pairs first.** Open the key and find them: each is
   two images made with the same settings and asked about as if something
   had changed. If the review names a difference in either, or calls
   either `looks right` for the change it was asked about, write that
   down: the review is not relied on for this candidate, and every row is
   yours to look at.
2. **Every row marked `looks wrong` or `cannot tell`.** Look at its images
   and write your own verdict.
3. **Five rows marked `looks right`, chosen at random.** Look at each and
   say whether you agree, and list the five in the form.
4. **The reel and the GIF**, the ones the automated run exported or ones
   you export in cell **06 Export**: play each once at full speed and
   write down anything that stutters, jumps or is cut off.

With no review for this candidate, there is no stand-in: the gate cannot
pass without it ([`releasing.md`](releasing.md#the-gate)). Write in row 6
that the item was not done and why, make step 4 all the same, and the
verdict is no-go.

### 7. The feel of the controls you drag

**4 minutes.** Write down anything that lags, jumps or lands somewhere
other than where you let go:

- In cell 05's **Line colours**, open a line's colour and drag across
  the colour square and along the hue.
- In **Line order**, carry a line by its grip and drop it two rows away.
- Hover over an arrow in **Line order**, then Tab to one: its name, such
  as "Move line `<label>` up", shows as a tooltip each way, and Escape
  sends it away.
- In cell 03's **Transport**, drag the "Time of day" slider back and
  forth while the map plays.

### 8. The system around the app

**4 minutes.**

- In the rail's **Outputs**, press **Reveal** on a row: the Finder comes
  to the front with that file selected.
- In Settings, **Licences**: press **Open the notices**, **Show the
  licence texts** and **Open Chromium's licences**. Each opens somewhere
  a person would expect, as [step 19](acceptance.md#19-licences) says;
  close each.
- In cell 06, start exporting a reel, and while it runs press Command-Q.
  **check:** once issue 552 lands, the app asks before it throws the
  export away, and choosing not to quit leaves the export running; write
  down the question word for word. Until then, or where this candidate
  does not ask, write that it did not ask, and whether the export was
  lost.
- With nothing running, press Command-Q: the app quits at once, asking
  nothing.

### 9. A real project from 0.1.0

**3 minutes.** Open the app, and under **Your projects** open one of your
own projects made in 0.1.0, one this sitting did not make: real data is
the one thing the runners lack. Look for the map redrawn once as it opens,
cell 02's run line reading "Drawn for `<day>` from the stored layout. The
stations have not moved.", the stations where 0.1.0 drew them (the names
may be placed differently, as `install.md` says), and its earlier exports
under **Outputs**. Write down anything else.

### 10. The versions and the verdict

**3 minutes.** Fill in the form's table: the app version (Settings,
**Versions**, "App"), the macOS version, and VoiceOver's version, which is
the `CFBundleShortVersionString` of
`/System/Library/CoreServices/VoiceOver.app/Contents/Info.plist`. Then
write go or no-go on the gate issue, linking this sitting's issue, with
the findings that decided it. The versions go into the walkthrough's
[Reader runs](accessibility.md#reader-runs), and your verdicts on the rows
of item 5 into their VoiceOver cells, in a pull request that changes only
those.

## Results form

Copy everything in the block below into a new issue titled
`Gate sitting: <version>, macOS <version>`.

```markdown
## The sitting

| | |
|---|---|
| Candidate's tag | |
| App version | (item 10: Settings, Versions, "App") |
| Engine version | (Settings, Versions, "Engine") |
| macOS version | |
| VoiceOver version | |
| Machine | (model, chip, memory) |
| Earlier version installed | (0.1.0, with a project of your own) |
| Started, finished | |
| Time taken | |

## Items

| # | Item | Result | Notes and finding issues |
|---|---|---|---|
| 1 | First open from a browser download | fine / finding | |
| 2 | VoiceOver's own announcements | fine / finding | |
| 3 | A feed by address | fine / finding | |
| 4 | The rotor | fine / finding | |
| 5 | By ear, what a script cannot judge | fine / finding | |
| 6 | The assistant's visual review | fine / finding | |
| 7 | The feel of the controls you drag | fine / finding | |
| 8 | The system around the app | fine / finding | |
| 9 | A real project from 0.1.0 | fine / finding | |
| 10 | The versions and the verdict | fine / finding | |

## What macOS showed on first open (item 1)

- With the network:
- Without it:

## The review (item 6)

- The control pairs: (as the review said, or not)
- Rows marked looks wrong or cannot tell, with your verdict:
- The five looks right rows sampled, and whether you agree:

## Verdict

go / no-go, and why
```
