// The only module that imports FigUI3, and only its MIT core (ADR-026):
// the stylesheet and the script that registers the custom elements. The
// editor and lab bundles are PolyForm licensed and the build refuses them
// (scripts/figui-guard.ts). Contract: specs/005-design-system-foundations/contracts/kit.md.

import '@rogieking/figui3/fig.css'
import '@rogieking/figui3/fig.js'
