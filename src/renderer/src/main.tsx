import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import ProgressPreview from './ProgressPreview'
// Order matters: the brand's tokens, the system's tokens and scale, the
// kit (its own defaults), the adapter that maps the tokens into the kit,
// then the app's own rules on top.
import './styles/tokens.css'
import './styles/theme.css'
import './styles/scale.css'
import './kit'
import './styles/figui-adapter.css'
import './styles/app.css'

// The engine's two themes follow the operating system's preference: sepia
// for light, warm-dark (the :root defaults) otherwise. A toggle arrives
// with A4-03.
const light = window.matchMedia('(prefers-color-scheme: light)')
function applyTheme(matches: boolean): void {
  if (matches) document.documentElement.dataset.theme = 'sepia'
  else delete document.documentElement.dataset.theme
}
applyTheme(light.matches)
light.addEventListener('change', (event) => applyTheme(event.matches))

// The progress line's sample page, for a person or the end-to-end test to
// look at; nothing in the app links to it.
const preview = new URLSearchParams(window.location.search).has('progress-preview')

createRoot(document.getElementById('root')!).render(
  <StrictMode>{preview ? <ProgressPreview /> : <App />}</StrictMode>,
)
