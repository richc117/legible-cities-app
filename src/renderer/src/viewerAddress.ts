import type { ProjectRecord, Theme } from '../../shared/project'

// The address the map's frame is sent to, and when it is sent somewhere new.
//
// Pure, so the rule that matters is tested without a window: **a theme
// change alone never changes the address.** Until issue 349 it did - the
// theme rode on the address, so a press was a navigation, and a navigation
// is a new document that loses the page's clock, its view, its labels and
// its scrub position. Since engine v0.11.0 the page restyles in place
// through `setTheme` (`Viewer.tsx` and `themeWrites.ts` send it), and the
// address carries the theme **of the moment it was made** and nothing
// later, for the next load: a page a run has rewritten, and a project
// opened again, boot in the project's theme before their first paint.

/** What an address is made from: the project's page, and how many runs have rewritten it. */
type Page = Pick<ProjectRecord, 'id' | 'feed'>

/**
 * Where the engine wrote the page: named after the feed, not the project.
 *
 * The theme is the project's own (A4-03), not the interface's: a theme
 * belongs to the map being made, which is exported and published, rather
 * than to the room the maker is sitting in. The page reads `theme=` before
 * its first paint, so the frame never shows one theme and then the other.
 * It is the theme **at navigation**, as the parameter's name says; the
 * viewer gives the live theme to the page on every load, so an address that
 * is a press behind is put right when its document arrives.
 *
 * `controls=1` is the app's own word, and the main process reads it as the
 * mark of the map's frame: the engine's planned addresses never carry it
 * (`roleOfAddress` in `src/main/viewer.ts`).
 *
 * `redraw` is how many runs have rewritten this page while the screen has
 * been open. It is on the address because a run writes the same file again:
 * without it the address after a run is the address before it, React
 * changes nothing, and the frame goes on showing a document that no longer
 * matches the file behind it. present.js reads the keys it knows and
 * ignores the rest, and the protocol handler resolves the path alone, so it
 * costs the page nothing.
 */
export function addressFor(project: Page, redraw: number, themeAtNavigation: Theme): string {
  return (
    `app://local/projects/${project.id}/${project.feed}.html` +
    `?present=1&controls=1&theme=${encodeURIComponent(themeAtNavigation)}&redraw=${redraw}`
  )
}

/** The address the frame is to be on, and what it was made from. */
export interface Wanted {
  id: string
  feed: string
  redraw: number
  address: string
}

/**
 * The address the frame is wanted on now, given the one wanted before.
 *
 * The same object comes back while the project, its feed and the number of
 * redraws are the same, **whatever the theme has become**; a change in any
 * of the three makes a new one, and the theme it carries is the project's
 * at that moment. That is the whole rule, and it is why a press is not a
 * navigation.
 */
export function wantedAddress(
  previous: Wanted | null,
  project: Page & Pick<ProjectRecord, 'theme'>,
  redraw: number,
): Wanted {
  if (
    previous !== null &&
    previous.id === project.id &&
    previous.feed === project.feed &&
    previous.redraw === redraw
  )
    return previous
  return {
    id: project.id,
    feed: project.feed,
    redraw,
    address: addressFor(project, redraw, project.theme),
  }
}
