import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import App from './App.tsx'
import { loadSourceTypes } from './source-types'

// Expose shared deps for dynamically loaded plugins & start async manifest fetch.
// Must import before any plugin bundles load (sets up window.__piTreeDeps).
import { loadPluginUI } from './plugin-loader'

// Load source types from server (non-blocking — app renders with fallbacks)
loadSourceTypes();

// Load plugin UI bundles from server (non-blocking — plugins register when ready)
loadPluginUI().then((plugins) => {
  if (plugins.length > 0) {
    console.log(`[main] ${plugins.length} runtime plugin(s) loaded:`,
      plugins.map(p => p.sourceType).join(', '));
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
