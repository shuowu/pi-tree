import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5847,
    host: true,
    proxy: {
      '/api': {
        // All calls go through the Vite dev proxy → localhost:3847
        target: 'http://localhost:3847',
        changeOrigin: true,
      },
    },
  },
})
