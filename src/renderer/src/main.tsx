import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import CellPreview from './notebook/CellPreview'
import ProgressPreview from './ProgressPreview'
// Order matters: the interface's palette and scale, the kit (its own
// defaults), the adapter that maps the tokens into the kit, then the app's
// own rules on top. The engine page's tokens are not loaded: the app's
// palette is its own (ADR-044), and tokens.css is only a drift-tested
// record of that page now.
//
// The app's own rules are one file per region of the interface, in the
// order they are read against each other: the shell, the panels a project
// is made of, the project's own screen, then the three regions of that
// screen - the notebook's column and the cell's chrome, the rail, the
// pinned preview, and the export's own (A5.5-07, A5.5-08, A5.5-19). No
// component imports a stylesheet; they are all imported here, and this
// block is edited once per region rather than once per issue.
import './styles/theme.css'
import './styles/scale.css'
import './kit'
import './styles/figui-adapter.css'
import './styles/app.css'
import './styles/panels.css'
import './styles/project.css'
import './styles/notebook.css'
import './styles/rail.css'
import './styles/preview.css'
import './styles/export.css'
// The theme, applied before anything is drawn: the system's preference
// until App has read what a person chose in Settings (A1-04).
import './theme'

// The sample pages, for a person or the end-to-end test to look at;
// nothing in the app links to either. The cell's exists because it is built
// a branch before the notebook it goes in (A5.5-05).
const query = new URLSearchParams(window.location.search)
const sample = query.has('progress-preview') ? (
  <ProgressPreview />
) : query.has('cell-preview') ? (
  <CellPreview />
) : null

createRoot(document.getElementById('root')!).render(<StrictMode>{sample ?? <App />}</StrictMode>)
