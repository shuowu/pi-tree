import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

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
        // Dev proxy → dev server on :3947 (Docker keeps :3847)
        target: 'http://localhost:3947',
        changeOrigin: true,
      },
    },
  },
})
