---
paths:
  - "src/main/**"
  - "src/preload/**"
---

# The main and preload processes

There is no application code yet; these rules exist so the first commit that
adds `src/main/` or `src/preload/` does not have to rediscover them. See
`CLAUDE.md` for the short form and `docs/adr/` for why.

## Child processes

Every spawn, without exception:

- an **argument array**, never a shell string, whatever the arguments look
  like today;
- `windowsHide: true`, or a console window flashes on Windows;
- a **timeout**, because LOOM and ffmpeg can both wedge on bad input;
- **stderr captured to the log**, not dropped - it is the only diagnosis a
  user can send us;
- a **clean shutdown on quit**, so nothing outlives the app.

## Where things are written

Never inside the app bundle: it is read-only on macOS and it is wiped on
update. The engine's home is `SCHEMATIC_HOME` under the user-data folder;
exports go where the user chose. A path that is not one of those two is a
bug. See ADR-016.

## The protocol is a contract

JSON-RPC 2.0 over stdio. The types are generated from the engine's JSON
Schema, so a change on one side is a build error on the other rather than a
runtime surprise. Do not hand-write a method signature, and do not add a
method here before the engine has it and the pin has moved. See ADR-010.

## The preload bridge

The bridge is the whole attack surface between the page and the machine.
Expose named, typed, narrow methods over `contextBridge`; never expose
`ipcRenderer` itself, a path the renderer chose, or anything that takes a
command to run. Validate on the main side, not in the renderer, because only
the main side is trusted.

## Serving `app://local`

One custom scheme, one host, for both the UI and the generated project
pages. It exists to make the iframe same-origin; a second origin breaks the
viewer silently. Resolve every request inside the allowed roots and refuse
anything that escapes them after normalisation.
