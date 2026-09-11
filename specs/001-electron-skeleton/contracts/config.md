# Contract: configuration and the startup log

## The file

`.env.local` at the repository root, read in development only
(`app.isPackaged === false`). Gitignored already (`.env*`); a committed
`.env.example` documents every key. Format: one `KEY=value` per line, `#`
starts a comment, surrounding single or double quotes are stripped, no
variable interpolation. A key already present in the process environment
wins over the file, so a check run can set values without a file.

Keys and defaults are in `data-model.md`. Unknown keys are ignored with a
log line naming them, so a typo is visible.

Packaged builds read only the process environment in this feature; the
settings store (A1-04) replaces that.

## The startup log

The main process writes to stderr through one small logger with a level and
a tag, so A6-03 can redirect it to a file without touching call sites. At
startup, before the window opens, exactly these lines appear:

```
[config] SCHEMATIC_HOME=<resolved path>  (default | .env.local | environment)
[config] SCHEMATIC_LOOM_BIN=<path>       (.env.local | environment)
   or
[config] SCHEMATIC_LOOM_BIN unset - nothing in this build needs it; set it in .env.local
[config] SCHEMATIC_FFMPEG=<path>         (.env.local | environment)
   or
[config] SCHEMATIC_FFMPEG unset - nothing in this build needs it; set it in .env.local
[config] LEGIBLE_EXPORT_FOLDER=<resolved path>  (default | .env.local | environment)   (specs/010; the default is a "Legible Cities" folder on the desktop)
[config] LEGIBLE_ENGINE_CHECKOUT=<path>  (.env.local | environment)   (development only, when set)
[config] LEGIBLE_ENGINE_PYTHON=<path or command>  (.env.local | environment)   (when set; specs/004)
[config] .env.local not found; using defaults   (development only, when absent)
```

Paths are printed as resolved. The log is the diagnosis channel for a
misconfigured run (FR-018); the interface shows none of it.
