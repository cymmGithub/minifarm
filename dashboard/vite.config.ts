import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  appType: 'spa',
  base: '/',
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      // Proxy API requests to Express server during development
      '/clients': 'http://localhost:3000',
      '/queue': 'http://localhost:3000',
      '/status': 'http://localhost:3000',
      '/cancel': 'http://localhost:3000',
      '/api': 'http://localhost:3000',
      '/purge-old': 'http://localhost:3000',
      '/delete-reports': 'http://localhost:3000',
      '/reports': 'http://localhost:3000',
    },
  },
})
