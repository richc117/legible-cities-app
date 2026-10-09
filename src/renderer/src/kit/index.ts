// The only module that imports FigUI3, and only its MIT core (ADR-026):
// the stylesheet and the script that registers the custom elements. The
// editor and lab bundles are PolyForm licensed and the build refuses them
// (scripts/figui-guard.ts). Contract: specs/005-design-system-foundations/contracts/kit.md.

import '@rogieking/figui3/fig.css'
import '@rogieking/figui3/fig.js'

// The one wrapper that is not FigUI3's (issue 272): the platform's own field
// as an editable combobox, because the kit's field cannot carry the
// pattern's attributes (`Combobox.tsx` says why). Components import it from
// its own file, as they do the kit's wrappers.
export { default as Combobox } from './Combobox'
export type { ComboboxOption } from './comboboxModel'
