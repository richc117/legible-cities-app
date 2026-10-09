import type { Theme } from '../../shared/project'

// The two pictures cell 04 offers a theme by (A7-13, issue 285).
//
// They are files the engine wrote, one drawing of an invented network in each
// of the map's two themes, and this module gives their URLs and nothing else:
// the app never draws a map, a line or a station (constitution, principle I),
// so what is shown is an `<img>` of a file, whatever the file holds.
// `pictures/README.md` says where they came from and how to make them again,
// and `tests/unit/pictures.test.ts` ties each one's colours to
// `styles/tokens.css`, so a retheme on the engine's side fails there until
// the files are made again.
//
// A module of its own, and not part of `ThemeSwitch.tsx`, because
// `import.meta.glob` is something Vite evaluates and Playwright's loader
// cannot: no spec imports this file, or a file that does.

const files = import.meta.glob('./pictures/*.svg', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>

/** The address of the engine's picture of a theme, for an `<img>`'s `src`. */
export function themePicture(theme: Theme): string {
  const url = files[`./pictures/theme-${theme}.svg`]
  if (url === undefined) throw new Error(`there is no picture for the ${theme} theme`)
  return url
}
