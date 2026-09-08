# Quickstart: the layout run

How to watch a real map come out, and how to see the run behave when things
go wrong.

## Prerequisites

- `npm ci && npx install-electron --no`
- An engine checkout named by `LEGIBLE_ENGINE_CHECKOUT` in `.env.local`, with the engine installed in its virtual environment.
- For a **cached** layout, nothing else. For a **cold** one, Docker running with the layout image built; the first stage then takes about thirteen seconds rather than a fraction of a second.

## 1. Lay a project out

```
npm run dev
```

Create a project on `la-metro-rail`, open it, press **Lay out**.

Expected: eight stages appear one after another as each finishes, each with
the engine's own sentence about what it produced, ending with the folder it
wrote. The project then shows a layout identifier and a service day. On this
machine, with the stages cached, the whole run takes under a second, so
watch for the sentences rather than for a slow bar.

Then confirm the page is where the viewer will look for it:

```
ls "$(node -e "console.log(require('os').homedir())")/Library/Application Support/legible-cities-app/engine/out/<project id>/"
```

Expected: an `.html`, an `.svg` and a `.positions.json`, named after the feed.

## 2. Two projects, one layout

Create a second project on the same feed and lay it out. Read both records:

```
cat "<engine home>/projects/<id>/project.json"
```

Expected: **the same** layout identifier in both, and each project's own
service day. That is not a bug: they were drawn from the same four stage
graphs, and saying so is the point of deriving the identifier from their
contents.

## 3. A layout that changed underneath a project

With a project laid out, change one of the stage graphs by hand:

```
printf '\n' >> "<engine home>/data/graphs/la-metro-rail/03_octi.json"
```

Lay out a **different** project on the same feed. Expected: it reports that
the layout differs from the one that project had stored. Nothing checks on
open, deliberately, because asking the engine would rebuild whatever is
missing. Undo the edit afterwards, or lay out again with a clean cache.

## 4. Cancelling

Delete the cached stages so the run is slow enough to catch:

```
rm -rf "<engine home>/data/graphs/la-metro-rail"
```

Press **Lay out**, then **Cancel** during the first stage, which is the one
long enough to hit. Expected: the run says it was cancelled, the project's
record is untouched, and no Python or layout-tool process remains:

```
pgrep -fl "schematic.serve|gtfs2graph|topo|loom|octi"
```

Expected: nothing.

## 5. Without an engine

```
LEGIBLE_ENGINE_PYTHON=/nowhere/python npm run dev
```

Expected: the status line says the engine is unavailable with a sentence,
and **Lay out** refuses with that same sentence rather than failing
silently or appearing to start.

## 6. The tests

```
npm test
npm run test:e2e
```

The unit tests cover the identifier, the path refusals, the store's write
and the run's state machine against a stub, and need no engine. The gated
test lays a project out against the real engine and asserts the eight stage
names in order; it skips, saying why, where no checkout is configured.

## What you will not find here

No re-layout button. The specification's Assumptions say why: forcing a
rebuild at this engine overwrites three of the four stage files before the
fourth runs, so a cancelled re-layout leaves a layout that later builds
read as valid. That is the engine's to fix, in E04.
