# Contract: the preload bridge (`window.api`)

The only way the renderer reaches anything privileged (FR-014, FR-015).
Exposed through `contextBridge.exposeInMainWorld("api", …)` from the preload
script; typed in `src/shared/api.ts`, which both sides import, so a change to
the shape is a type error on whichever side did not follow.

Every method returns a promise, carries no callbacks, and takes only plain
data. The renderer never sees `ipcRenderer`, a path it chose, or anything
that takes a command to run. Validation is on the main side.

## Methods in this feature

| Method | Params | Result | Notes |
|---|---|---|---|
| `api.library.list()` | none | `Promise<ProjectSummary[]>` | Always `[]` in this feature. A1-05 fills it and defines `ProjectSummary`; here it is `{ id: string; name: string }` so the empty state has a type to render against. |

Replaced by `projects.*` in `specs/003-project/contracts/bridge.md`.

That is the whole surface. Each later addition is a reviewed change to
`src/shared/api.ts`, the preload and the main-side handler together. When
the viewer iframe arrives (A3-02) it is same-origin by design and can reach
`parent.api`; from then on main-side handlers check `event.senderFrame` and
serve only the interface's frame.

## IPC channels behind it

| Channel | Direction | Payload |
|---|---|---|
| `library:list` | renderer → main (invoke) | none → `ProjectSummary[]` |

Channel names are constants in `src/shared/api.ts`; neither side spells them
inline.

## What is deliberately absent

- No `app.locations()` or `app.versions()`: the three configured locations are
  logged (FR-018), not shown; Settings (A1-04) adds a method when a screen
  needs it.
- No engine methods: the sidecar arrives with A1-01 and its own contract.
- No file dialogs, no shell operations, no clipboard.
