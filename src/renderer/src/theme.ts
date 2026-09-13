// The interface's theme. The engine's two themes are the tokens' two
// blocks: the warm-dark defaults live on bare `:root`, and `data-theme`
// carries "sepia" for the light one (docs/DESIGN.md, section 3). A person
// chooses which in Settings (A1-04); the default follows the operating
// system, and keeps following it while that is the choice.
//
// The arithmetic is `themeAttribute` in the shared module, which is pure
// and unit-tested; this module is the one place that touches the document.

import { DEFAULT_APP_THEME, themeAttribute, type AppTheme } from '../../shared/settings'

const light = window.matchMedia('(prefers-color-scheme: light)')

let chosen: AppTheme = DEFAULT_APP_THEME

function paint(): void {
  const attribute = themeAttribute(chosen, light.matches)
  if (attribute === null) delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = attribute
}

// The system's preference still matters after a choice, because "follow the
// system" is one of the choices; the listener stays for the app's life.
light.addEventListener('change', paint)

/** Wear this theme from now on. Idempotent, so a re-render costs nothing. */
export function applyTheme(theme: AppTheme): void {
  if (theme === chosen) return
  chosen = theme
  paint()
}

/** The system's preference, applied before anything is drawn. */
paint()
