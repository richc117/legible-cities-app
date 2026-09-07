import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/tokens.css'
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
