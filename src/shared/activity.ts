// The three sentences main uses to refuse what would break a run that is
// going (spec 037, User Story 4, FR-012), in one place so the screen's own
// re-read at the moment of confirming a deletion says what main would. The
// rule itself is held in main (`src/main/projectActivity.ts`); the screen's
// disabled buttons are the first line and these are the last.

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
