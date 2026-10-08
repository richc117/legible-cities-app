import type { Theme } from '../../shared/project'

// The theme the app last wrote to a project's record, kept where the viewer's
// restore can read it at the moment it sends a call (issue 349).
//
// Why it is not read from the screen's state. A press is: the record is
// written over the bridge, its answer arrives, React is told, and a
// scheduler task or two later the render that carries the new theme has run
// its effects. The press sends its own `setTheme` to the page in the tick
// the answer arrives, long before that. A document that loads in the gap -
// a run has just rewritten the page - is given its restore by a handler
// whose closure, or a ref set from an effect, still says the old theme; it
// would send that as its first call after the press's own, and the record
// would say Sepia, the switch would say Sepia, and the map would be Warm dark
// until the next press.
//
// So the memory is written **synchronously, in the write's own callback,
// right after the answer arrives and before `setTheme` is sent**
// (`useProjectState.ts`), and read by the restore **at the moment it sends**
// (`viewerGiveBack.ts`), as the transport's memory is for the speed and the
// pause (`transportState.ts`). Whichever of the two reaches the page last
// then carries the same theme: a restore call sent before the write is
// answered by the press's own after it, and one sent after reads this.
//
// Per project and for the session, like the transport's: it holds only what
// a successful write returned, so it is never ahead of the record, and a
// project nothing was pressed in is answered by its record.

const written = new Map<string, Theme>()

/** Remember the theme a project's record now holds, as soon as its write has returned. */
export function rememberTheme(projectId: string, theme: Theme): void {
  written.set(projectId, theme)
}

/**
 * Forget a project that has been deleted, so the memory holds nothing for a
 * project that is gone. Called where its jobs are forgotten, on the delete's
 * own signal (`useProjectState.ts`), and never because a list missed it.
 */
export function forgetTheme(projectId: string): void {
  written.delete(projectId)
}

/**
 * The project's theme as it stands now: what the last write returned, or,
 * where nothing has been written this session, the record's own.
 */
export function themeAsItStands(projectId: string, recorded: Theme): Theme {
  return written.get(projectId) ?? recorded
}

/**
 * The arguments one call of a restore should carry at the moment it is sent,
 * rather than the ones it was composed with: `setTheme` is given the theme as
 * it stands then, and every other call keeps its own. The restore's first
 * call is the theme's, and the rest of its list takes several round trips
 * (`asDispatched` in `transportState.ts` is the same rule for the speed and
 * the pause).
 */
export function asDispatchedTheme(method: string, args: unknown[], theme: Theme): unknown[] {
  return method === 'setTheme' ? [theme] : args
}
