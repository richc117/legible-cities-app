# Contract: the settings bridge

Every method is on the interface's own top frame only; anything else is
refused with `forbidden`, as the projects and the export are. No method
takes a path, and none takes a command to run.

## What crosses

Inward: a theme name, and nothing else. A folder is chosen in the main
process's own dialog and applied there; the page asks for the dialog and
gets the new state back.

Outward: the folders in force and the folder waiting for a restart, as text
for the person to read; a size and a count; and the engine's own answer to
`engine.info`, which the page asks for through the typed client, not here.

## The view

```ts
type AppTheme = 'system' | 'warm-dark' | 'sepia'

interface FolderView {
  /** The folder the running app is using. */
  path: string
  /** Where it came from. `environment` covers .env.local, which is the environment in development. */
  source: 'default' | 'settings' | 'environment'
  /** A folder chosen but not yet in force, so the screen can say a restart applies it; else null. */
  pending: string | null
  /** True when the environment names it: the screen offers no way to change it. */
  locked: boolean
}

interface SettingsView {
  theme: AppTheme
  engine: FolderView
  export: FolderView
}

interface ResetOutcome {
  /** Folder roles that were removed: some of projects, out, data, frames. */
  removed: string[]
  /** A folder that would not go, and why: a filesystem code, or a link the app will not follow. */
  failed: { folder: string; reason: string }[]
}

interface FolderSize {
  bytes: number
  files: number
  /** The walk stopped at its cap: what is reported is a floor. */
  partial: boolean
  /** The folder is not there. Not an error: it is made when something writes. */
  missing: boolean
}
```

## The methods

```ts
settings: {
  read(): Promise<SettingsView>
  /** Refused unless the theme is one of the three. */
  setTheme(theme: AppTheme): Promise<SettingsView>
  /** Opens the platform's folder chooser and applies the answer. The view is unchanged when it was cancelled. */
  chooseEngineFolder(): Promise<SettingsView>
  chooseExportFolder(): Promise<SettingsView>
  /** Forget the stored folder and go back to the default. */
  useDefaultEngineFolder(): Promise<SettingsView>
  useDefaultExportFolder(): Promise<SettingsView>
  /** Walk the engine home. Bounded; never follows a symbolic link. */
  engineSize(): Promise<FolderSize>
  /** Make the platform's log folder for this app if it is missing, and open it. */
  openLogsFolder(): Promise<void>
  /**
   * Remove the four folders the app and the engine keep under the engine's
   * home; the home itself and anything else in it stay. Answers what went
   * and what would not. Rejects with a sentence when it may not run.
   */
  resetEngineData(): Promise<ResetOutcome>
}
```

## The guards, on the main side

- **A folder** is only ever a path the main process's own `showOpenDialog`
  answered and no earlier change has spent, and must be absolute and free of
  control characters. Anything else is refused before the settings file is
  touched: "a folder is chosen in the app's own dialog". The page has no way
  to name one, and this holds the rule for any route added later.
- **A folder inside the app itself** is refused even though the dialog
  answered it: "that folder is inside the app itself; nothing can be kept
  there". The chooser makes a folder anywhere the platform allows, the
  bundle included, and the bundle is read-only on macOS and wiped on update
  (ADR-016).
- **A theme** must be one of the three names: "that is not a theme".
- **A folder the environment names** is not changeable: "`SCHEMATIC_HOME`
  names this folder; the app does not change it here", and the same for
  `LEGIBLE_EXPORT_FOLDER`.
- **The reset** removes four folders beneath the home - `projects`, `out`,
  `data` and `frames` - and never the home itself. Those are everything the
  app and the engine put there; the home is a folder a person can point
  anywhere in one click, so anything else in it is theirs and stays. A
  folder that is a symbolic link is left alone and reported, because
  removing it would unlink it rather than empty it.

  Every comparison is made on real paths: the home is resolved through
  `realpath` before any guard looks at it, and so is everything it is
  compared against. The guards are textual, so a home that is itself a
  symbolic link would pass all of them and then remove four folders from
  wherever it points - the same loss, one level up. The dialog usually
  answers a resolved path; `SCHEMATIC_HOME` and a hand-edited settings file
  do not.

  It is refused while a reset is already running, while an export is
  running, an engine request is in flight or a record is being written, with
  a sentence saying which. The home is resolved through every symbolic link
  before anything judges it, so the guards read the folder the reset would
  really reach; resolving it reads and never creates, because a press that
  is about to be refused must not write to the disk. It is then refused for
  a home that is a filesystem root, is the user's home folder, or contains
  the user-data folder; and refused when the export folder sits inside one of the four, or
  is the home, or holds it - because an export writes to
  `<folder>/<project name>/`, so a project named `out` would land in a
  folder the reset removes, and the confirmation promises that exported
  files are not touched. The home it works on is the configuration's own,
  never anything the page sent.

  The flag goes up before the first `await` - before even the checks that
  need one - because a second reset arriving while the first resolves paths
  would otherwise find it down, and the first to finish would lower it while
  the second was still walking. While it is up, every engine request, every
  export and every write to a project record is refused with "The engine
  data is being reset; wait for it to finish.", so nothing lands in a folder
  being walked away. The engine's gate asks on both sides of the registry's
  own check, because that check reads the project list from disk and the
  loop turns while it does. A multi-step layout run has gaps in which
  nothing is in flight, so the main process does not claim to know one is
  open; the screen, where the runs live, disables the button instead.

  The answer says which folders went and which would not, by role. Never a
  path.
