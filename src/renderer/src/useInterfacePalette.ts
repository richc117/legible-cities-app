import { useSyncExternalStore } from 'react'
import { paletteOfTheme, type Palette } from './frontDoorPictures'

// The palette the interface is wearing now, kept current (ADR-047): the
// front door's pictures follow the theme the person chose for the app, and
// a change in Settings, or the system's preference while "Follow the system"
// is the choice, swaps every picture without a reload.
//
// The one source is the document's `data-theme`, which `theme.ts` writes and
// the token stylesheets read, so a picture can never disagree with the
// surface it sits on. Watched rather than passed down: the theme is applied
// from the app's root and the Library is two screens away from where it is
// chosen.

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  return () => observer.disconnect()
}

const current = (): Palette => paletteOfTheme(document.documentElement.dataset.theme)

// Night until a document says otherwise: what a static render of the
// Library (a unit test) is given, and what bare `:root` is.
const night = (): Palette => 'dark'

export function useInterfacePalette(): Palette {
  return useSyncExternalStore(subscribe, current, night)
}
