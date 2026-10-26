// The sentences main uses to refuse what would break a run that is going
// (spec 037, User Story 4, FR-012): the spec's three, then the ones it did
// not foresee. In one place so the screen's own re-read at the moment of
// confirming a deletion says what main would. The rule itself is held in
// main (`src/main/projectActivity.ts`, and the engine bridge for a project
// with no record); the screen's disabled buttons are the first line and
// these are the last.

/** An export of the project cannot start while its map is being written. */
export const EXPORT_WHILE_DRAWING =
  "This project's map is being drawn. Wait for it to finish, then export."

/** The project cannot be deleted under its own export. */
export const DELETE_WHILE_EXPORTING =
  'This project is exporting. Wait for the export to finish or cancel it, then delete the project.'

/** The project cannot be deleted under a request that is writing its folder. */
export const DELETE_WHILE_DRAWING =
  'This project is being drawn. Wait for it to finish or cancel it, then delete the project.'

/**
 * A map.build for a project whose deletion is under way would write into a
 * folder that is being removed. Not one of the spec's three sentences: a
 * refusal it did not foresee, so a plain one.
 */
export const REQUEST_WHILE_DELETING = 'This project is being deleted.'

/**
 * A map.build for a project whose export is running would rewrite the page
 * the export plans against and captures (issue 505). Said where the run that
 * sent it says why it stopped, which is not always a delete button, so it
 * ends on "try again" where DELETE_WHILE_EXPORTING ends on the deletion.
 */
export const DRAW_WHILE_EXPORTING =
  'This project is exporting. Wait for the export to finish or cancel it, then try again.'

/**
 * A map.build whose `out` names no project record. In the app that is a run
 * whose project was deleted under it, whose closing map.build would make
 * `out/<id>` again for a project that is not there (issue 505). Plain, like
 * the one above it.
 */
export const REQUEST_FOR_NO_PROJECT = 'This project has been deleted.'

/**
 * The same question, when the disk did not answer it within the deadline
 * every check over folders keeps (`FOLDERS_TIMEOUT_MS`).
 */
export const REQUEST_UNCHECKED = 'This project could not be found in time. Try again.'
