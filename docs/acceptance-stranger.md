# The stranger's timed run

> **This document still describes the project screen as a tab strip, and is
> rewritten once, at the end of the notebook's work, against the interface
> that ships (ADR-045).** A5.5-08 replaced the Map and Export tabs with six
> numbered cells and moved or renamed several of the controls and sentences
> quoted below, so a step here that names a tab will not be found on screen.
> The release gate does not run against this text until that rewrite lands.

Part of the release gate (issue A6-04), beside the
[acceptance checklist](acceptance.md). One person who is not the maintainer,
and has never used Legible Cities, goes from the release on GitHub to a
first exported reel with nothing but the README, the install document and
the app itself, while someone watches, times and writes down, and does not
help.

This page has three parts: [the handout](#the-handout), which is given to
the person and is all they read before starting;
[the observer's notes](#for-the-observer); and
[the results form](#results-form), which goes into an issue. Nothing about
the person goes into the repository or the issue beyond what the form asks
for, and the form asks for no name.

---

## The handout

*Print this part, or show it on a second screen. It is the only
instruction the person gets.*

### What we are asking you to do

Legible Cities is a desktop app that turns a city's public transit
timetable into a moving map, and exports it as a video for social media.

Starting from the web page in front of you, please:

1. **install the app** on this computer, and
2. **make your first reel**: a video of a transit map, exported from the
   app as a file on this computer. Any city will do.

You are finished when the video file exists on this computer. You do not
need to post it anywhere or watch it.

### What you may use

- The web page in front of you, the repository's **README**, and the
  **install guide** it links to.
- The app itself, once it is installed.
- Nothing else: no search engine, no video tutorials, no asking anyone.

### How it works

- **Think aloud.** Say what you are looking at, what you are looking for,
  what you expect to happen and what surprises you. Half-sentences are
  fine. If you go quiet, the observer may remind you to keep talking; that
  is all they will say.
- **Nobody will help you.** The observer will not answer questions, point,
  or tell you whether you are on the right track. That is not rudeness: we
  are testing the app and its documents, not you, and every place you are
  stuck is a place they failed.
- **There is no wrong way.** If something goes wrong, do what you would do
  if you were alone.
- **You may stop at any time**, for any reason. Just say so.
- The app is unsigned, so your computer will warn you when you open it.
  The install guide explains what to do.

Thank you. Say "ready" when you want to start.

---

## For the observer

### Before the run

- **The machine.** A Mac or a Windows PC that has never had Legible Cities
  on it (a fresh user account is enough if the app's folders in
  [install.md](install.md#what-the-app-writes-and-where) are absent), with a
  working internet connection and a browser. Not the maintainer's machine,
  unless it is a fresh account on it.
- **The release.** Published, or a draft the person can reach while signed
  in. Note the tag.
- **The screen.** A browser open on the release's page, and nothing else
  open. Do not open the README or the install guide for them.
- **Consent.** If you record the screen or the voice, ask first, and keep
  the recording off the repository and out of the issue. Refer to the
  person as "Participant A" (B, C for later runs) everywhere.
- **Your kit.** A clock that shows minutes and seconds from zero, this
  page's results form, and something to write on.

### The clock

- **Start** when the person says "ready" with the release page in front of
  them.
- **Stop** when the reel's file is on disk: the app says
  "Exported `<file>`." on its Export tab, which it says only once the file
  has been written. Confirm the file is there afterwards (press **Reveal**
  yourself once the clock has stopped, or look in the export folder), and
  write down its name.
- Also note three split times: the installer downloaded, the app's window
  first open, and the first press of **Export**.

The issue's measure is "installer to first reel"; this run starts the clock
earlier, at the release page, so the time includes choosing and
downloading the installer. The split time at "installer downloaded" gives
the issue's figure as well.

### The success measure

**A reel on disk within 15 minutes of the start, with no help.**

- Under 15 minutes and unassisted: the measure is met.
- Over 15 minutes, or assisted at any point, or stopped: the measure is not
  met. Record the time anyway, and where it went.

For scale, when you judge where the minutes went, and not as a promise:
the reel alone took about two minutes to export on an Apple silicon laptop
in development, against engine v0.3.0 and a development ffmpeg rather than
the bundled one (`specs/010-export/spec.md`, SC-003), and the engine has to download its
first feed and lay the map out before that (see the acceptance checklist,
step 7).

### What not to say

- Do not answer a question, even a small one, even "is this right?". Say
  "What would you do if I weren't here?" and write the question down.
- Do not point, nod, wince, lean in or reach for the mouse. Sit beside and
  slightly behind them.
- Do not say "almost", "nearly", "good", "not that one", or anything that
  says whether they are on track.
- Do not explain a warning, a word or a screen, and do not apologise for
  the app.
- You may say only: "Please keep thinking aloud.", "Take your time.", "What
  would you do if I weren't here?", and, if they ask to stop, "Of course."

### When to step in

Only if the person asks to stop, or has been stuck on the same thing for
**five minutes** with nothing changing. Write down the time and what they
were stuck on first. Then you may give **one** hint, the smallest that
unsticks them, and write it down word for word. From then on the run is
**assisted**: carry on timing to the reel if they want to continue, but the
measure is not met. A crash, a hang or anything that stops the app working
is not a person being stuck: record it, and step in to restart the app if
they cannot.

If the person opens anything beyond the README, `docs/install.md` and the
app itself - another page of the repository, a search engine, a video, an
AI assistant, or a question to someone else in the room - do not stop them.
Write down the time and what they opened or asked, and count the run as
**assisted** from that moment, exactly as if you had given a hint. Links
that the README and the install guide themselves lead to on the same page
(the Releases page, the install guide's own sections) are within bounds;
following a link out of them to any other document is not.

### What to write down

Everything, with the clock time beside it. In particular:

- **Every hesitation**: a pause of ten seconds or more, or a "hmm", and
  what was on the screen.
- **Every wrong turn**: a button pressed, a link followed or a file opened
  that did not lead towards the reel, and how they found their way back.
- **Every question** they ask aloud, even rhetorical ones, word for word.
- **What they read**: which parts of the README and the install guide they
  opened, and which parts they skipped.
- **The unsigned-app warning**: how long it took them to get past it, and
  whether the install guide's instructions matched what they saw.
- **Words they did not know**, or read differently from what the app means
  (feed, layout, preset, storyboard, schematic).
- **Anything they said they liked**, or that went quicker than you expected.

Stop writing at the stop time, then spend five minutes asking what was
hardest and what they expected to find where they got stuck. Write their
answers down in their words.

After the run, file an issue for every place they got stuck that the app or
a document could fix, and link each one from the run's issue. Do not file
the person's mistakes; file what led to them.

---

## Results form

Copy everything in the block below into a new issue titled
`A6-04 stranger's run: <macOS or Windows>, <date>`.

```markdown
## The stranger's timed run

| | |
|---|---|
| Participant | Participant A |
| Has used Legible Cities before? | no |
| Comfortable installing apps? | (their own words: often / sometimes / rarely) |
| Machine and OS version | |
| Clean machine or fresh account? | |
| Release tag | |
| App version | (from Copy diagnostics, after the run) |
| Date | |
| Observer | |
| Start (release page) | 00:00 |
| Installer downloaded | mm:ss |
| App window first open | mm:ss |
| First press of Export | mm:ss |
| Stop (reel on disk) | mm:ss |
| Reel file name | |
| **Total time** | mm:ss |
| **Measure met** (reel within 15 minutes, no help) | yes / no |
| Assisted? | no / yes, at mm:ss: (the hint, word for word) |
| Stopped before the reel? | no / yes, at mm:ss: (why) |

## Timeline

| Time | What happened | Kind |
|---|---|---|
| mm:ss | | hesitation / wrong turn / question / comment / crash |

## Where they got stuck

1. (the longest first: where, for how long, and what got them out)
2.
3.

## What they read

- README: (sections opened, sections skipped)
- install.md: (sections opened, sections skipped)

## In their words

(the questions they asked, the words they did not know, and what they said
afterwards about what was hardest)

## Issues filed

- (one line each, linked)
```
