import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import packageJson from './package.json' with { type: 'json' }

const buildVersion = process.env.VERCEL_GIT_COMMIT_SHA
  || process.env.GITHUB_SHA
  || packageJson.version

export default defineConfig({
  plugins: [react()],
  define: {
    __SALES_GAME_BUILD_VERSION__: JSON.stringify(buildVersion),
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true
  },
  // ✅ CORREÇÃO: Habilita sourcemaps para facilitar debugging
  build: {
    // Windows 7 parou no Chrome/Edge 109. O alvo padrão do Vite 8 começa no
    // Chrome 111 e pode produzir uma tela vazia antes de o React/log iniciar.
    target: ['chrome109', 'edge109', 'firefox102', 'safari15.6'],
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
