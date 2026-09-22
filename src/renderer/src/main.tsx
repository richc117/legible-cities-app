import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import ProgressPreview from './ProgressPreview'
// Order matters: the interface's palette and scale, the kit (its own
// defaults), the adapter that maps the tokens into the kit, then the app's
// own rules on top. The engine page's tokens are not loaded: the app's
// palette is its own (ADR-044), and tokens.css is only a drift-tested
// record of that page now.
//
// The app's own rules are three files, one per region of the interface and
// in the order they are read against each other: the shell, the panels a
// project is made of, then the notebook's own chrome (A5.5-07). No
// component imports a stylesheet; they are all imported here.
import './styles/theme.css'
import './styles/scale.css'
import './kit'
import './styles/figui-adapter.css'
import './styles/app.css'
import './styles/panels.css'
import './styles/notebook.css'
// The theme, applied before anything is drawn: the system's preference
// until App has read what a person chose in Settings (A1-04).
import './theme'

// The progress line's sample page, for a person or the end-to-end test to
// look at; nothing in the app links to it.
const preview = new URLSearchParams(window.location.search).has('progress-preview')

createRoot(document.getElementById('root')!).render(
  <StrictMode>{preview ? <ProgressPreview /> : <App />}</StrictMode>,
)
