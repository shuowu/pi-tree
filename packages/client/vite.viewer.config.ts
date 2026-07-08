/**
 * Build config for the standalone export viewer.
 *
 * Produces a single self-contained `dist/viewer.html` (all JS/CSS inlined)
 * that the server uses as the template for "Export as HTML": it injects the
 * session snapshot as `window.__PI_TREE__` and serves the result. Building
 * into the client dist means the template ships wherever the client build
 * ships (Docker, Electron) with no extra packaging.
 *
 * Build: npm run build:viewer -w @pi-tree/client
 */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'
import path from 'node:path'

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  resolve: {
    conditions: ['source'],
    alias: {
      // Diagrams degrade to code blocks in exports — saves ~2.5MB
      mermaid: path.resolve(__dirname, 'src/viewer/mermaid-stub.ts'),
    },
  },
  build: {
    outDir: 'dist',
    // The main client build owns dist/ — don't wipe it
    emptyOutDir: false,
    rollupOptions: {
      input: path.resolve(__dirname, 'viewer.html'),
    },
  },
})
