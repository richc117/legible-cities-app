# Contract: the typed engine client

What app code may rely on. The client is renderer code over
`window.api.engine`; it imports nothing from `src/main`.

## Types, from the generated module

```ts
type Method = keyof Methods
type Params<M extends Method> = Methods[M]['params']
type Result<M extends Method> = Methods[M]['result']
```

`Methods` is generated from the engine's description. Today it holds
`engine.info`, `engine.shutdown`, `graph.build` and `map.build`; the client
names none of them, so a method added to the engine is available as soon as
the types are regenerated.

## Calling

```ts
const client = new EngineClient(window.api.engine)

const info = await client.request('engine.info').result
//    ^ EngineInfo, no cast

const build = client.request('graph.build', { key: 'la-metro-rail' })
build.onProgress((p) => setStage(p.stage, p.fraction))
const { stages, paths } = await build.result
```

The parameters are a rest tuple, so a method whose parameters are
`NoParams` is called with none and every other method must pass an object:

```ts
client.request('engine.info') // compiles
client.request('graph.build') // does not compile
client.request('graph.build', { feed: 'x' }) // does not compile: no such parameter
client.request('map.build', { key: 'x' }) // does not compile: the description requires a date
```

## The request handle

| Member       | Type                                                 | Behaviour                                                                                              |
| ------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `id`         | `string`                                             | the bridge's token for this request                                                                    |
| `result`     | `Promise<Result<M>>`                                 | resolves with the engine's result; rejects with `EngineErrorShape`, code, message and `data` unchanged |
| `onProgress` | `(listener: (p: JobProgress) => void) => () => void` | this request's notifications only; returns its unsubscribe                                             |
| `onLog`      | `(listener: (l: JobLog) => void) => () => void`      | as above                                                                                               |
| `cancel`     | `() => void`                                         | asks the bridge to cancel; after the request has settled it does nothing and does not throw            |

Guarantees:

- A listener hears only its own request. Two requests in flight never cross.
- A request's listeners are released when its promise settles, and not
  before: the bridge delivers the answer after the last notification, and
  the client must not undo that ordering.
- A listener added after the request has settled is never called, and
  leaves nothing behind.
- Rejection is the engine's error shape, never an `Error` whose message is
  all that survived: `data.hint` is the sentence an interface shows.

## What the client must not do

- Add, rename or reinterpret a method, a parameter or a result.
- Send a parameter the description does not define.
- Relax a constraint the description states, or tighten one. The client is
  a projection of the description with no exception: the map's service day
  is required here because the description requires it, the engine having
  been built never to choose a day (ADR-023).
- Treat a path in a result as safe to show. `EngineInfo.home`, `.python`,
  `.ffmpeg`, `GraphBuildResult.paths.*` and `MapBuildResult.files.*` are
  absolute machine paths, and this feature is what first makes them a typed
  value the page can reach. They address files for the app, not text for a
  screen, a log, a screenshot or an export's provenance block; the
  supervisor already strips paths out of anything it shows (ADR-015 and the
  hygiene principle).
- Hold the engine's state, retry a request, or queue one while the engine
  is not ready. The supervisor refuses at once and says why; that is its
  job and the client passes the refusal through.
- Import from `src/main`, or reach anything but `window.api.engine`.

## The bridge it speaks to

Unchanged from A1-01, and this feature changes nothing about it:

```ts
interface EngineBridge {
  request(
    method: string,
    params?: Record<string, unknown>,
  ): { id: string; result: Promise<unknown> }
  cancel(id: string): Promise<void>
  onProgress(listener: (p: JobProgress) => void): () => void
  onLog(listener: (l: JobLog) => void): () => void
}
```

The client takes this as a constructor argument rather than reaching for
`window`, so a test passes a stub and the unit tests need no Electron.
