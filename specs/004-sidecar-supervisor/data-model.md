# Data model: Sidecar supervisor

Nothing here is stored. These are the shapes that cross the bridge and the
pin the build carries. Types in `src/shared/engine.ts`; the pin in
`vendor/pins.json`.

## EngineState

```ts
type EngineState =
  | { state: 'starting'; attempt: number }                         // attempt 1 on launch; 2..4 on restarts
  | { state: 'ready'; version: string; protocol: 1 }
  | { state: 'restarting'; attempt: number; reason: string }       // attempt is the one about to run (2, 3, 4); a fourth failure in a row is `stopped`
  | { state: 'unavailable'; reason: string }                       // no interpreter; never retried by itself
  | { state: 'mismatched'; expected: EnginePin; found: { version: string; protocol: number } }
  | { state: 'stopped'; reason: string }                           // gave up, or the app is quitting
```

Transitions (contracts/sidecar.md has the full table): `starting → ready`
on a good handshake; `starting → mismatched` on a bad one; `starting →
restarting` when the process ends or the handshake times out before
`ready` and attempts remain, else `→ stopped`; `ready → restarting` on an
unexpected exit; `restarting → starting` after the wait; anything `→
stopped` on quit; `unavailable` is terminal for the run.

`reason` is one sentence for a person, and always logged too.

## EnginePin

```json
"engine": {
  "repo": "https://github.com/richc117/legible-cities",
  "tag": "v0.2.0",
  "version": "0.2.0",
  "protocol": 1,
  "note": "..."
}
```

`version` and `protocol` are what the handshake compares with
`engine.info`'s `engine` and `protocol`; `tag` is for the vendoring job and
the notices. Validated at build: a unit test reads the file and checks the
four fields' shape and that `tag` is `v` + `version`.

## Request (as the page sees it)

| Field | Type | Meaning |
|---|---|---|
| `id` | string | An opaque token the preload mints (`crypto.randomUUID()`); the page uses it to match progress and log lines and to cancel. |
| `method` | string | The engine's method name; the supervisor forwards it as is. |
| `params` | object or undefined | Forwarded as is. |
| result | `Promise<unknown>` | Resolves with the engine's `result`; rejects with an `EngineError`. |

The main process maps the token to the numeric JSON-RPC id it sent; the
page never sees that id.

## EngineError

The one error shape a rejected request carries, whoever produced it:

```ts
interface EngineError extends Error {
  code: number                  // the engine's JSON-RPC code, or one of the app's below
  data?: { kind: string; detail: string; hint: string }
}
```

The engine's errors pass through with their `code`, `message` and `data`
(`kind` one of `params | feed | loom | schedule | export | io | engine`,
per its schema). The app's own, for a request the engine could not be
asked or did not answer:

| code | when | data.kind | data.hint |
|---|---|---|---|
| `-32001` | the engine is not `ready` | `state` | the state's sentence |
| `-32002` | the engine's process ended while the request was in flight | `exit` | "The engine stopped before answering." |
| `-32003` | no progress or log line for the inactivity bound | `inactive` | "No progress for N minutes; the request was cancelled." |
| `-32600` | the page sent something that is not a method name and an object | `params` | what was wrong |

Codes `-32001` to `-32003` are in JSON-RPC's reserved server range and
below the engine's `-32000`, so they cannot collide with anything the engine
sends now or later; the schema's `ErrorData.kind` enumeration is the
engine's and these three kinds are the app's, which A1-02's generated types
will union.

## Notifications (as the page sees them)

```ts
interface JobProgress { id: string; stage: string; fraction: number; message: string }
interface JobLog      { id: string; level: 'debug' | 'info' | 'warning' | 'error'; line: string }
```

The engine's shapes, with the numeric id replaced by the request's token. A
notification for an id the main process does not know (a previous engine
process, a finished request) is logged and dropped.
