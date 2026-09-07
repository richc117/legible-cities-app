# Data model: Electron skeleton

There is almost no data in this feature, and that is the point: the entities
below are the ones every later feature builds on, fixed here so they are
addressed the same way from the first commit.

## Application origin

One custom scheme and host, `app://local`, registered as a standard, secure,
privileged origin before the app is ready. Two path prefixes:

| Prefix | Serves | Source |
|---|---|---|
| `/ui/` | The interface | Built renderer assets in a packaged app; the Vite dev server, proxied through the same handler, in development. The document origin is `app://local` in both. |
| `/projects/<id>/` | Generated project output | `<engine home>/out/<id>/`, read-only, one directory per project |

Anything else on the origin is a clean 404. There is no second origin and no
`file://` fallback (FR-008, FR-009, FR-013).

## Project identifier

An opaque token naming a project's output directory. This feature creates
none; it fixes how one is addressed and validated (FR-010, FR-011, A-004).

- Permitted form here: `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`, and never `.` or
  `..`. The feature that creates projects (A1-05) may narrow this; it cannot
  widen it without changing the validator and its tests together.
- Treated as untrusted input from another process. Validation happens on the
  main side, before any path is built.

## Project asset path

The remainder of a `/projects/<id>/` URL, mapped to a file under the
project's output directory.

Validation, in order, all on the main side:

1. Percent-decode once; reject if decoding fails or yields a control
   character or a backslash.
2. Split on `/`; reject any segment that is empty, `.` or `..`.
3. Join under the project directory; resolve real paths for both the project
   directory and the target; require the target to equal the root or start
   with the root followed by the platform separator. On Windows the
   comparison is case-insensitive.
4. Refuse directories (no listing), and anything that fails to stat.

Refusals are 403 for an escape and 404 for a missing project or file, with a
plain one-line body that never contains a filesystem path (FR-012).

## Library

The list of projects the application knows about. In this feature its only
behaviour is the empty state (FR-002). The bridge method that returns it
always returns an empty list; A1-05 gives it content and defines the project
record. An output directory with no recognisable project inside it is
therefore never shown (edge case).

## Engine home

The writable directory the engine owns (`SCHEMATIC_HOME`): `feeds/`,
`graphs/`, `projects/`, `out/`, `logs/` beneath it, per the architecture.
Defaults to `<userData>/engine`; overridable by configuration; never inside
the application bundle (FR-016, A-002). This feature reads only `out/<id>/`
from it and writes nothing.

## Configuration

Three locations plus one development-only pointer, read at startup
(FR-017 to FR-019). See `contracts/config.md` for the file format and the
log lines.

| Key | Meaning | Default |
|---|---|---|
| `SCHEMATIC_HOME` | The engine home | `<userData>/engine` |
| `SCHEMATIC_LOOM_BIN` | Directory holding `gtfs2graph`, `topo`, `loom`, `octi` | unset |
| `SCHEMATIC_FFMPEG` | Path to the ffmpeg executable | unset |
| `LEGIBLE_ENGINE_CHECKOUT` | The engine's source checkout, development only: the tokens drift test reads the animation page from it | unset |

## Design tokens

One committed stylesheet, `src/renderer/src/styles/tokens.css`, holding exactly
the two theme blocks of the engine's animation page (`:root`, warm-dark, and
`:root[data-theme="sepia"]`) plus a header comment naming their origin.
Every component consumes tokens; no colour, type or spacing value is written
at a use site (FR-007). Type and spacing are not in the engine's blocks, so
`app.css` declares them as its own small token set. A unit test compares the copy with the engine's page
and fails on any difference; where no engine is reachable it skips and says
so (see `research.md`).

## Window

Exactly one, titled `Legible Cities` (FR-001, FR-003). Context isolation on,
Node integration off, sandbox on (FR-014). The application holds a
single-instance lock; a second launch focuses this window (FR-035).
