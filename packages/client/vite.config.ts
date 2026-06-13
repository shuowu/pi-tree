import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Allow overriding ports via env vars (for worktrees with separate port ranges)
const apiPort = process.env.VITE_API_PORT ?? '3947';
const clientPort = Number(process.env.VITE_PORT ?? '5947');

export default defineConfig({
  plugins: [react()],
  resolve: {
    conditions: ['source'],
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
