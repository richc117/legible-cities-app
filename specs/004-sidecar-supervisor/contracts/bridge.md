# Contract: `window.api.engine`

Exposed by the preload beside `window.api.projects`. Typed in
`src/shared/api.ts`; the shapes in `src/shared/engine.ts`. Deliberately
untyped beyond "a method name and an object": A1-02 generates the methods
from the engine's schema and wraps this.

```ts
engine: {
  state(): Promise<EngineState>
  request(method: string, params?: Record<string, unknown>): { id: string; result: Promise<unknown> }
  cancel(id: string): Promise<void>
  onState(listener: (state: EngineState) => void): () => void      // returns unsubscribe
  onProgress(listener: (p: JobProgress) => void): () => void
  onLog(listener: (l: JobLog) => void): () => void
}
```

## Behaviour

- `request()` returns synchronously with the token so the page can subscribe
  before anything arrives. `result` resolves with the engine's `result`
  exactly as sent, or rejects with an `EngineError` (data-model.md) whose
  `code`, `message` and `data` are the engine's when the engine answered,
  and the app's own when it could not be asked or did not answer.
- `request()` with a `method` that is not a non-empty string, or `params`
  that is not a plain object or undefined, rejects with `-32600` and sends
  nothing.
- `cancel(id)` for a request in flight forwards `$/cancelRequest` to the
  engine; the request then ends with the engine's cancelled error
  (`-32800`). For an id that is unknown or finished it resolves and does
  nothing.
- Listeners receive every notification for every request from this window,
  in the order the engine sent them; `onState` fires once with the current
  state on subscription is **not** promised (call `state()` for that), and
  then on every change.
- The page is never handed a path it did not ask the engine for, a process
  id, or an interpreter; the state's `reason` sentences are written for a
  person and name a configuration key at most.

## Channels

| Channel | Direction | Arguments | Answer |
|---|---|---|---|
| `engine:state` | invoke | — | `EngineState` |
| `engine:request` | invoke | `token, method, params` | `{ ok: true, result }` or `{ ok: false, error: { code, message, data? } }` (resolved, never rejected, so `data` survives the trip) |
| `engine:cancel` | invoke | `token` | `undefined` |
| `engine:state-changed` | send | `EngineState` | — |
| `engine:progress` | send | `JobProgress` | — |
| `engine:log` | send | `JobLog` | — |

Every invoke handler refuses a caller that is not the window's top frame,
as the projects handlers do; a project page in a frame shares the origin
and must not reach the engine.
