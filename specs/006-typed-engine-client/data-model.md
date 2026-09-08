# Data model: Typed engine client

Phase 1. What exists, where it lives, and which of it is written by a
person. Nothing here is stored: this feature adds no file the app writes at
run time.

## The three artefacts on disk

| Artefact             | Path                                       | Written by                   | Committed |
| -------------------- | ------------------------------------------ | ---------------------------- | --------- |
| Protocol description | `vendor/protocol.schema.json`              | the engine, printed verbatim | yes       |
| Fingerprint          | `vendor/pins.json`, `engine.schema_sha256` | the generator                | yes       |
| Generated types      | `src/shared/protocol.ts`                   | the generator                | yes       |

All three change together or not at all. The generator writes all three in
one run so they cannot be committed half-updated; the fingerprint test
fails when the description and the fingerprint disagree, which is what a
half-update looks like, and it needs no engine, so it runs on every machine
that builds the app.

## The generated module

`src/shared/protocol.ts` carries a header saying it is generated, by which
command, from which pinned tag, and that edits are lost. Its exports:

| Export             | Shape                                  | From                      |
| ------------------ | -------------------------------------- | ------------------------- |
| One per definition | an interface, a type alias, or a union | each entry of `$defs`     |
| `Methods`          | `{ [name]: { params; result } }`       | the `methods` map         |
| `Method`           | `keyof Methods`                        | derived                   |
| `Notifications`    | `{ [name]: params }`                   | the `notifications` map   |
| `NotificationName` | `keyof Notifications`                  | derived                   |
| `PROTOCOL`         | the protocol number as a literal       | the document's `protocol` |

The definitions today are `RequestId`, `NoParams`, `Ok`, `FeedKey`,
`Token`, `ServiceDate`, `EngineInfo`, `GraphBuildParams`, `StageSummary`,
`GraphBuildResult`, `MapBuildParams`, `Diagnostics`, `MapBuildResult`,
`JobProgress`, `JobLog`, `CancelParams` and `ErrorData`. Nothing in the
app names that list: the emitter walks whatever the description holds, and
a test counts the methods and notifications against the description so an
addition is visible rather than silent.

### How each construct is emitted

| In the description                                                       | In the module                                                                                              |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `"type": "string" \| "number" \| "integer" \| "boolean" \| "null"`       | `string`, `number`, `number`, `boolean`, `null`                                                            |
| `"type": ["integer", "string"]`                                          | `number \| string`                                                                                         |
| `"type": "array"` with `items`                                           | `T[]`                                                                                                      |
| `"type": "object"` with `properties`                                     | an interface; a property not in `required` is optional                                                     |
| `additionalProperties: false`                                            | nothing: an interface is already closed enough for a caller, and an index signature would defeat the point |
| `$ref: "#/$defs/Name"`                                                   | `Name`                                                                                                     |
| `enum`                                                                   | a union of literals                                                                                        |
| `const`                                                                  | the literal                                                                                                |
| `oneOf`                                                                  | a union of its branches                                                                                    |
| `description`                                                            | a doc comment on the member                                                                                |
| `minimum`, `maximum`, `exclusiveMinimum`, `pattern`, `format`, `default` | nothing: they constrain values, not shapes                                                                 |

Anything else stops the generator with the keyword and its path, rather
than being emitted as `unknown`.

## The client

`src/renderer/src/engine/client.ts`. It holds no engine state: the state
belongs to the supervisor and reaches the interface through
`useEngineState`. What it owns is the map from a method to its types and
the routing of one request's notifications.

| Member                       | Shape                                 | Notes                                                                                                    |
| ---------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `request(method, ...params)` | returns a **request handle**          | the parameters are a rest tuple: absent for a method whose parameters are `NoParams`, required otherwise |
| `dispose()`                  | releases the two global subscriptions | for a test, and for a caller that owns a client's lifetime                                               |

### The request handle

| Field                  | Shape                            | Notes                                                                             |
| ---------------------- | -------------------------------- | --------------------------------------------------------------------------------- |
| `id`                   | `string`                         | the token the bridge minted, not the engine's numbering, which the app never sees |
| `result`               | a promise of the method's result | rejects with the engine's error, unchanged                                        |
| `onProgress(listener)` | returns an unsubscribe           | this request's stages only                                                        |
| `onLog(listener)`      | returns an unsubscribe           | this request's lines only                                                         |
| `cancel()`             | void                             | after the request has settled it does nothing and does not fail                   |

### No divergence from the description

The client neither tightens nor relaxes anything. The one place a
divergence was expected, the map's service day, needed none: the
description already lists `date` as required, because the engine will
never choose a service day itself (ADR-023, research §4).

## What stops being hand-written

`src/shared/engine.ts` declares `JobProgress`, `JobLog` and `ErrorData` by
hand today. The description defines all three, so the hand-written
declarations are **derived from** the generated ones rather than repeated
(FR-012). Derived and not re-exported, because two of the three are
deliberately not quite the engine's:

| At the bridge           | Difference from the engine's, and why                                                                                                    |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `JobProgress`, `JobLog` | the `id` is the token the preload minted, a string, never the engine's own numbering, which the app does not expose                      |
| `ErrorData`             | the `kind` may be one of the app's three (`state`, `inactive`, `exit`) as well as the engine's seven, for a failure the engine never saw |

Everything else in those three shapes comes from the description, so a
stage, a level or a hint changing on the engine's side is a build error
here.

One value stays hand-written: `ENGINE_ERROR_KINDS`, the engine's kinds as
a list rather than a type, because a kind arriving over the wire has to be
checked before it is trusted as one. A test compares that list with the
description's own enum, so it cannot drift either.

`EngineState`, `EnginePin`, `EngineError`, `ERROR_CODES` and
`describeState` stay entirely the app's own: the description says nothing
about them.

## Ownership, in one line each

- The **engine** owns the description. The app never edits it.
- The **generator** owns the fingerprint and the generated module.
- The **client** owns the mapping from a method to its types, and one
  request's notification routing.
- The **bridge** (A1-01) still owns transport, tokens, ordering, bounds
  and cancellation. This feature adds nothing to it and takes nothing away.
