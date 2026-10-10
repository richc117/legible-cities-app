# Contract: the bridge, extended

`window.api` gains `projects` with five methods; `library.list()` from the
skeleton is replaced by `projects.list()` (the skeleton's method was a
placeholder for exactly this). Every method is a promise, takes plain data,
and is validated on the main side; the renderer never passes or receives a
filesystem path.

| Method | Params | Result | Errors (as rejected promises, message for a person) |
|---|---|---|---|
| `projects.list()` | none | `ProjectSummary[]`, newest opened first (A5.6-04) | none: unreadable records are skipped and logged |
| `projects.get(id)` | `id: string` | `ProjectRecord & { readOnly: boolean }` | `not found`; `invalid id` |
| `projects.create({ name, feed, mode?, agency? })` | as `data-model.md` | the new `ProjectRecord` | `name is required`; `name is too long`; `feed key must be lowercase letters, digits and hyphens`; `mode …`; `agency …` |
| `projects.rename(id, name)` | | the updated `ProjectRecord` | as above, plus `not found`, `read-only` |
| `projects.delete(id)` | | `{ removed: string[]; failed: { folder: 'project' \| 'output'; reason: string }[] }` | `not found`; `invalid id` |
| `projects.markOpened(id)` (A5.6-04) | `id: string` | the `ProjectRecord` with `opened` set; a read-only one unchanged | `not found`; `invalid id`; refused during a reset |
| `projects.setInputs(id, { mode, agency })` (A2-02) | the mode by the engine's rule; an agency id or none | the updated `ProjectRecord`, unchanged when nothing differs | `mode …`; `agency …`; `not found`; `read-only` |
| `projects.setTuning(id, tuning)` (issue 385) | LOOM's settings in the record's names: a grid of the engine's four and seven numbers, each inside the engine's own range | the updated `ProjectRecord`, holding only the fields away from LOOM's own, and unchanged when nothing differs | the engine's own sentences ("tuning.merge_distance must be from 5 to 500, in metres", "tuning.grid must be one of …"); `the tuning does not take <field>`; `not found`; `read-only`; refused during a reset |
| `projects.completeColors(id, { colors, defaultColor })` (A4-01) | a line label to a `#rrggbb` colour, and the colour of a line the feed leaves uncoloured | the updated `ProjectRecord` | `the colours must be …`; `the colour for <line> …`; `a line label …`; `lay the project out first`; `not found`; `read-only` |
| `projects.completeLines(id, lines, stations?)` (issue 394) | a line label to that line's options in the engine's names (`name`, `hidden`, `width`, `casing: { width, color }`, `dash`), written once the map has been drawn with them; the stations the build answered, as for the colours | the updated `ProjectRecord`, holding only the fields away from the engine's own, with `drawn.lines` the same | the engine's own sentences ("lines['A'].width must be from 0.75 to 1.5, as a multiple of line_width", "lines['A'] does not take colour", …); `a line label …`; `lay the project out first`; `not found`; `read-only`; refused during a reset |

Channels, constants in `src/shared/api.ts`: `projects:list`, `projects:get`,
`projects:create`, `projects:rename`, `projects:delete`; since A3-01
`projects:complete-layout`, since A3-04 `projects:complete-rebuild`, since
A2-02 `projects:set-inputs`, since A4-01 `projects:complete-colors`
(`specs/018-colours/contracts/bridge.md`), since issue 385
`projects:set-tuning`, since issue 394 `projects:complete-lines`.
`projects.completeLayout`'s `done` carries the
tuning the run sent as an optional `tuning`, held to the same rules, since
issue 385.

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
