// src/supabaseClient.js
import { createClient } from '@supabase/supabase-js'

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL
const supabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY

// Sem .env (que é gitignored) createClient lança "supabaseUrl is required" no
// escopo do módulo. Como main.jsx → App/GameNetProvider → este arquivo é uma
// cadeia eager, o throw derrubava o grafo inteiro e o React nunca montava:
// #root vazio = tela preta. O contrato do app já é "sem client → online
// desabilitado" (ver GameNetProvider: `!!supabase && !!roomCode`).
const hasSupabaseConfig = !!supabaseUrl && !!supabaseAnon

if (!hasSupabaseConfig) {
  console.warn(
    '[SG] Supabase não configurado (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY ausentes). ' +
    'Multiplayer online e modo espectador ficam indisponíveis; o jogo local continua funcionando.'
  )
}

// Garante instância única mesmo com HMR/StrictMode/múltiplos imports
const g = globalThis
export const supabase = !hasSupabaseConfig
  ? null
  : (g.__sg_supabase ||
    (g.__sg_supabase = createClient(supabaseUrl, supabaseAnon, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // chave própria evita colisão com outros apps/instâncias
        storageKey: 'salesgame-auth'
      },
      realtime: { params: { eventsPerSecond: 10 } },
    })))
