import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Allow overriding the API server port via env var (e.g., for e2e tests)
const apiPort = process.env.VITE_API_PORT ?? '3947';

export default defineConfig({
  plugins: [react()],
  resolve: {
    conditions: ['source'],
  },
  server: {
    port: 5947,
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
