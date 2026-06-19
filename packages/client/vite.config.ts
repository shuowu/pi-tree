import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// Allow overriding ports via env vars (for worktrees with separate port ranges)
const apiPort = process.env.VITE_API_PORT ?? '3947';
const clientPort = Number(process.env.VITE_PORT ?? '5947');

// Plugin packages use plugin-* naming convention
const packagesDir = path.resolve(__dirname, '..');

export default defineConfig({
  plugins: [react()],
  resolve: {
    conditions: ['source'],
    alias: {
      'pi-tree-book': path.join(packagesDir, 'plugin-book'),
      'pi-tree-news': path.join(packagesDir, 'plugin-news'),
      'pi-tree-paper': path.join(packagesDir, 'plugin-paper'),
      'pi-tree-youtube': path.join(packagesDir, 'plugin-youtube'),
    },
  },
  server: {
    port: clientPort,
    host: true,
    proxy: {
      '/api': {
        target: `http://localhost:${apiPort}`,
        changeOrigin: true,
      },
      '/health': {
        target: `http://localhost:${apiPort}`,
        changeOrigin: true,
      },
    },
  },
})
