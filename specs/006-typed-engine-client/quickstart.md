# Quickstart: Typed engine client

How to see for yourself that the boundary is checked. Every step runs on a
developer machine; the ones needing an engine say so.

## Prerequisites

- `npm ci && npx install-electron --no`
- For the steps marked _engine_: a checkout of the engine beside this one,
  its virtual environment holding the engine at the pinned version, and
  `LEGIBLE_ENGINE_CHECKOUT` in `.env.local`. Docker is **not** needed:
  nothing here runs the layout tools.

## 1. The types exist and match the engine

```
npm run typecheck
npm test
```

Expected: everything passes. Among the unit tests, three concern this
feature and none needs an engine:

- the fingerprint in `vendor/pins.json` matches `vendor/protocol.schema.json`;
- regenerating `src/shared/protocol.ts` from that description reproduces the
  committed file byte for byte;
- every method and notification the description names is present in the
  generated types, counted rather than listed.

## 2. The compiler refuses a call the engine would refuse

Add this line to any renderer file and run `npm run typecheck`:

```ts
client.request('map.build', { key: 'la-metro-rail' })
```

Expected: a type error saying `date` is missing. The engine refuses that
request at run time; here it never gets built. Remove the line.

Then try a parameter the engine does not define:

```ts
client.request('graph.build', { key: 'la-metro-rail', mode: 'rail' })
```

Expected: a type error. `mode` arrives with E04, and until then the engine
refuses it too.

## 3. A renamed parameter stops the build _(engine)_

In the engine checkout, edit `src/schematic/protocol/v1.json` and rename
`GraphBuildParams`'s `key` to `feed`. Then, here:

```
npm test
```

Expected: the drift test fails, naming the difference and telling you to
run `npm run typegen`. Do that, and `npm run typecheck` then fails at every
call site that says `key`, which is the point of the feature.

Undo the edit in the engine, run `npm run typegen` again, and confirm
`git status` is clean: the regenerated files match what is committed.

## 4. Without an engine, nothing lies _(no engine)_

Point the checkout at somewhere that does not exist. An **empty** value
will not do: the app treats an empty environment variable as unset and
falls back to `.env.local`, so the tests would find the real checkout and
run.

```
LEGIBLE_ENGINE_CHECKOUT=/nonexistent npm test
```

Expected: the drift test and the contract tests report themselves
**skipped**, with a sentence saying why, and every other test still runs.
No test that needs an engine reports as passed.

## 5. The client against the real engine _(engine)_

```
npm test -- protocol-real
```

Expected: `engine.info` returns the pinned version and protocol 1;
`engine.shutdown` answers and the process ends; `graph.build` with an
unregistered feed key and `map.build` without a date are both refused, each
with a code, a `kind`, a `detail` and a `hint` that reads as a sentence.
The two refusals are what prove the parameter names; neither long method is
run, because that needs the layout tools.

## 6. Progress reaches only its own request

Covered by the unit tests against a stub bridge, and worth reading once:
`tests/unit/engine-client.test.ts` drives two requests at the same time and
asserts each subscriber hears only its own, that listeners are released when
a request settles, and that cancelling a settled request does nothing.

## What this feature does not show you

No screen changes. The client has no interface of its own: the layout run
(A3-01) and the jobs drawer (A1-03) are the first things a person will see
through it.
