---
name: spike
description: Start a timeboxed spike - a branch, a timebox and a report template under docs/adr/spikes/. Use when a question can only be answered by building something, and the deliverable is an answer rather than code.
argument-hint: "<short-name> <the question, in a sentence>"
disable-model-invocation: true
allowed-tools: Read, Write, Edit, Glob, Bash(git switch *), Bash(git branch --show-current), Bash(git status *)
---

# Start a spike

Current branch: !`git branch --show-current`

A spike is a timeboxed experiment whose deliverable is a **report**, not
code. The branch is scaffolding and gets deleted; the report is what
survives and is what the decision is made from.

Set up a spike for: **$ARGUMENTS**

## 1. Agree the question and the timebox first

Do not start until both are written down in one sentence each:

- **The question** has to be answerable and worth the time. "Can LOOM be
  built as a self-contained binary for macOS arm64 and Windows x64 in CI?"
  is a question. "Look into LOOM" is not.
- **The timebox** is a number of hours or days, decided before the work, not
  after. Its purpose is to make stopping a success rather than a failure: a
  spike that ends at the timebox with "we still do not know, and here is
  what we ruled out" has done its job.

Ask the maintainer for either if the arguments did not supply it.

## 2. The branch

```
git switch -c spike/<short-name>
```

Short, kebab-case, matching the report's filename: `spike/loom-native`.

## 3. The report

Copy [report-template.md](report-template.md) to
`docs/adr/spikes/<short-name>.md`, creating the directory if it is not
there, and fill in the question, the timebox and the date before any work
starts. Fill in the rest as you go rather than from memory at the end -
measurements written down a day later are recollections.

## 4. While it runs

Record numbers, not impressions: sizes in MB, times in seconds, versions,
commit hashes, the exact command that produced each. A spike whose report
says "it seemed fast" has to be run again.

Write down what surprised you the day it surprises you. Surprise is the
reliable signal that a decision is being made, and it is the first thing
that is forgotten.

## 5. Ending it

When the timebox is up, or the question is answered, whichever comes first:

1. Finish the report, including the **Recommendation** section, which names
   an option and says what would change your mind.
2. Turn it into a decision record with `/adr`, citing the report. The report
   is the evidence; the record is the decision.
3. Land the report and the record the way `CONTRIBUTING.md` says work
   lands - straight to `main` while that is still the flow, a pull request
   once CI requires one. The branch's code is not merged either way. Then
   delete the branch.

Say this out loud at the end of the spike, because it is the part that gets
skipped: **the branch is deleted and only the report survives.**
