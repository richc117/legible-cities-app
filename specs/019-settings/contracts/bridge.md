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
  /** Remove the engine home and make it again, empty. Rejects with a sentence when it may not run. */
  resetEngineData(): Promise<void>
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
- **The reset** is refused while any export is running or any engine
  request is in flight, with a sentence saying which; refused for a home
  that is not absolute, is a filesystem root, is the user's home folder, or
  contains the user-data folder; and refused when the export folder sits
  inside the home, because the confirmation promises that exported files
  are not touched and removing the folder whole would take them. The folder
  it removes is the configuration's own `home`, never anything the page
  sent. While the removal runs, every engine request and every export is
  refused with "The engine data is being reset; wait for it to finish.", so
  nothing starts writing into a folder being walked away.
