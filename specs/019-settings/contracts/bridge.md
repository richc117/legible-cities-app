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
  files are not touched unless they are inside one of the four folders
  _(so qualified 2026-09-29, issue 206: a reset that goes ahead removes
  what was already exported into one of them)_. The home it works on is
  the configuration's own, never anything the page sent.

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

- **A project's own export folder** _(added 2026-09-29, issue 206)_ is
  kept out of the reset's reach at three doors. Two are here and ask one
  rule, `destinationsInTheWay` in `src/main/settings.ts`, which answers the
  projects whose export folder is inside a home, is it, or holds it. No
  method is added to the bridge and none takes anything new: a refusal is a
  rejection the existing calls already carry.

  `chooseEngineFolder()` and `useDefaultEngineFolder()` reject, and store
  nothing, while any project's export folder is inside the folder asked
  for or around it: "The project “Los Angeles” exports to a folder inside
  that one, or around it, so “Reset engine data” could remove its exported
  files; choose another folder, or move them out of that one and change
  where the project exports first." For the default: "... inside the
  default folder, or around it, so “Reset engine data” could remove its
  exported files; move them out of the default folder and change where the
  project exports first." A path the dialog answered is spent by a refusal
  as by any other outcome. The engine folder's changes are applied one
  after another, in the order they were asked for.

  `resetEngineData()` rejects on the same condition for the projects under
  the home in force, after every check above and before anything is
  removed, with the flag up: "The project “Los Angeles” exports to a folder
  inside the engine data folder, or around it, so the reset could remove
  its exported files; move them out of the engine data folder and change
  where the project exports first."

  Two or three projects are all named; past that, two and how many more.
  Never a path. The folder asked about and every project's export folder
  are resolved through their symbolic links before the comparison, which
  is textual. The list is the project store's, handed in so this service
  never holds the store, and is read once at each press; a project made by
  a newer version of the app is read-only here and still counts.

  **Every sentence asks for two things, the files before the folder.**
  Changing a folder moves nothing, so a person who did only that would
  lose what they had exported to the reset that then ran. The two refusals
  over the app's own export folder, which are older than this note, were
  reworded with it: "Your export folder holds the engine data folder, so
  the reset could remove your exported files; move them out of the engine
  data folder and choose another export folder first." and "Your export
  folder is inside the `out` folder, which the reset removes, so your
  exported files would go with it; move them out of the engine data folder
  and choose another export folder first." (`out`, `data`, `projects` or
  `frames`, whichever it is inside).

  **The third door is the project's own chooser**, not this bridge:
  `destinationRefusal` in `src/main/export.ts` judges a folder a project
  is being given against the home in force and against the folder waiting
  for a restart, which is this view's `engine.pending`, read each time a
  folder is judged and never kept. The exporter asks it again before every
  export. Its sentence does not call the folder waiting the engine data
  folder: "that folder is inside the folder the engine data moves to at
  the next start, which “Reset engine data” removes from then on", or
  "that folder holds the folder the engine data moves to at the next
  start; an export goes into a folder named after the project, which could
  be that folder itself". So whichever of the two folders is chosen second
  is the one refused.

  A project's name is shown whole up to 120 characters, the most a name
  may be when it is written, and past that as its beginning and an
  ellipsis: a record edited by hand can carry a name of any length.

  **What a reset that goes ahead removes.** The rule is over where a
  project exports now. Files already exported into one of the four folders
  are removed by a reset that goes ahead, and changing where a project
  exports moves nothing; that is why each sentence asks for the files
  first.

  **Which failure of the list's read refuses, and which does not.** If the
  projects folder cannot be listed, for any reason but its not being there
  (no permission, a disk error, too many files open, a file where the
  folder should be), the call rejects and nothing is stored or removed:
  "The projects folder could not be read, so the app cannot tell where the
  projects export, and nothing was changed or removed; look in the engine
  data folder, which Settings shows, at “projects”, which is what cannot
  be read." A folder that cannot be listed hides every project, so nothing
  at all is known. If one
  record cannot be read or parsed, it is skipped as the project list skips
  it, logged by its folder's name and the failure's code, and the call
  goes ahead on the rest: one bad record hides one project, and the reset
  is the remedy for bad records. The project list itself still answers
  over a folder it cannot list, so the front door opens.

  **The deadline.** Each call puts one deadline of five seconds over its
  whole check, because resolving a folder asks the disk and a folder on a
  network share can stall rather than fail. When it lapses the call
  rejects, with nothing stored or removed, and the reset's flag comes
  down with it. The sentence says which folder did not answer. For a
  project's: "The folder the project “Los Angeles” exports to did not
  answer in time, so nothing was changed or removed; change where the
  project exports, or try again when it can be reached." For the others,
  the same sentence begins "The engine data folder", "That folder" (one
  chosen, which adds "choose another folder, or"), "The default folder",
  "Your export folder" (which adds "choose another export folder, or"),
  "Your home folder" or "The folder the app keeps its settings in"; and
  where it was the reading of the records that did not end, "The projects
  in the engine data folder could not be read in time, so nothing was
  changed or removed; try again." The project's own chooser and the
  exporter are bounded the same way and say which folder it was: "that
  folder did not answer in time, so it could not be checked and nothing
  was changed or written; choose another folder, or try again when it can
  be reached", or, of the app itself, the engine data folder or the folder
  the engine data moves to at the next start, that it "did not answer in
  time, so that folder could not be checked against it and nothing was
  changed or written".

  A check that lapsed is abandoned, not stopped, so what acts on its
  answer - the removal, the write of the engine's folder - is made after
  it and only on an answer that came in time: a folder that answers a
  minute after the refusal changes nothing. And a folder that has not
  answered is not asked about again: every door asks through one
  resolver, which answers a second asking with the first one's promise
  until that has settled, because each unanswered question holds one of
  the few threads files are read with.

  **What no door sees.** Records live under the engine's home and are not
  moved with it, so a record left behind in a home the app used before is
  read by nobody, and a reset of the folder its project exports into is
  not refused; that is why the choice is guarded, while the record is
  still in reach. That, and any one record the store could not read, are
  all that is out of reach.
