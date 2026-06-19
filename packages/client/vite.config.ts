import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// Allow overriding ports via env vars (for worktrees with separate port ranges)
const apiPort = process.env.VITE_API_PORT ?? '3947';
const clientPort = Number(process.env.VITE_PORT ?? '5947');

// Plugin packages aren't npm workspace packages, so we alias them for Vite
const pluginsDir = path.resolve(__dirname, '../plugins');

export default defineConfig({
  plugins: [react()],
  resolve: {
    conditions: ['source'],
    alias: {
      'pi-tree-book': path.join(pluginsDir, 'book'),
      'pi-tree-news': path.join(pluginsDir, 'news'),
      'pi-tree-paper': path.join(pluginsDir, 'paper'),
      'pi-tree-youtube': path.join(pluginsDir, 'youtube'),
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
