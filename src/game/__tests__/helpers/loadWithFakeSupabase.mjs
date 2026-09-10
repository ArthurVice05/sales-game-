/**
 * Carrega um módulo real do app com o client Supabase substituído pelo dublê.
 *
 * O módulo é reavaliado a cada chamada — caches de módulo (por exemplo o probe
 * de `last_seen`) não vazam de um cenário para outro.
 */
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const SUPABASE_NS = 'sg-supabase'

export async function loadWithFakeSupabase (relativePath, supabase, importMetaUrl) {
  const entry = fileURLToPath(new URL(relativePath, importMetaUrl))
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    jsx: 'automatic',
    external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
    define: {
      'import.meta.env': JSON.stringify({ DEV: false, MODE: 'test' }),
    },
    plugins: [{
      name: 'sg-fake-supabase',
      setup (b) {
        b.onResolve({ filter: /supabaseClient\.js$/ }, () => ({ path: 'supabase', namespace: SUPABASE_NS }))
        b.onLoad({ filter: /.*/, namespace: SUPABASE_NS }, () => ({
          contents: 'export const supabase = globalThis.__SG_TEST_SUPABASE__ || null\nexport default supabase\n',
          loader: 'js',
        }))
      },
    }],
    logLevel: 'silent',
  })

  const previous = globalThis.__SG_TEST_SUPABASE__
  globalThis.__SG_TEST_SUPABASE__ = supabase
  const module = { exports: {} }
  try {
    new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, module, module.exports)
  } finally {
    if (previous === undefined) delete globalThis.__SG_TEST_SUPABASE__
    else globalThis.__SG_TEST_SUPABASE__ = previous
  }
  return module.exports
}
