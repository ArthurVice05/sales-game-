import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true
  },
  // ✅ CORREÇÃO: Habilita sourcemaps para facilitar debugging
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const moduleId = id.replaceAll('\\', '/')
          if (moduleId.includes('node_modules/three')) return 'three'
          if (moduleId.includes('node_modules/@supabase')) return 'supabase'
          if (moduleId.includes('node_modules/react')) return 'react-vendor'
        }
      }
    }
  }
})
