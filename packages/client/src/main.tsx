import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import App from './App.tsx'
import { loadSourceTypes, registerRuntimePlugins } from './source-types'

// Expose shared deps for dynamically loaded plugins & start async manifest fetch.
// Must import before any plugin bundles load (sets up window.__piTreeDeps).
import { loadPluginUI } from './plugin-loader'

// Load source types from server first, then load & register plugin UI bundles.
// Chained so that SOURCE_TYPE_CONFIGS entries exist when plugin components are merged.
// Non-blocking — app renders immediately with fallbacks.
loadSourceTypes().then(() =>
  loadPluginUI().then((plugins) => {
    registerRuntimePlugins(plugins);
  })
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
