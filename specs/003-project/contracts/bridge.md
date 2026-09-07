# Contract: the bridge, extended

`window.api` gains `projects` with five methods; `library.list()` from the
skeleton is replaced by `projects.list()` (the skeleton's method was a
placeholder for exactly this). Every method is a promise, takes plain data,
and is validated on the main side; the renderer never passes or receives a
filesystem path.

| Method | Params | Result | Errors (as rejected promises, message for a person) |
|---|---|---|---|
| `projects.list()` | none | `ProjectSummary[]`, newest first | none: unreadable records are skipped and logged |
| `projects.get(id)` | `id: string` | `ProjectRecord & { readOnly: boolean }` | `not found`; `invalid id` |
| `projects.create({ name, feed, mode?, agency? })` | as `data-model.md` | the new `ProjectRecord` | `name is required`; `name is too long`; `feed key must be lowercase letters, digits and hyphens`; `mode …`; `agency …` |
| `projects.rename(id, name)` | | the updated `ProjectRecord` | as above, plus `not found`, `read-only` |
| `projects.delete(id)` | | `{ removed: string[]; failed: { folder: 'project' \| 'output'; reason: string }[] }` | `not found`; `invalid id` |

Channels, constants in `src/shared/api.ts`: `projects:list`, `projects:get`,
`projects:create`, `projects:rename`, `projects:delete`.

Error messages are the strings a person sees in the form; they never contain
a path. The `failed` entries of delete name the folder by role, not by path.

The handlers check `event.senderFrame` is the interface's top frame from
this feature on (the bridge contract of `specs/001`). That refuses a call
from any other web contents - a second window, a webview - and nothing
else: a same-origin iframe calling `parent.api` runs the bridge's function
in the top frame that exposed it, so the check does not see it. The viewer
iframe (A3-02) therefore needs its own answer, most likely its own web
contents driven from the main process; this contract does not claim to
protect against it.
