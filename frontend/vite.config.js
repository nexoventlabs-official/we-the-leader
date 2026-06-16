import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:5000',
      '/admin/api': 'http://localhost:5000',
    }
  },
  build: {
    // Always output to dist — Vercel picks this up via outputDirectory in vercel.json.
    // For local backend-served builds, copy dist/ to backend/public/ manually.
    outDir: 'dist',
    emptyOutDir: true,
  }
})
