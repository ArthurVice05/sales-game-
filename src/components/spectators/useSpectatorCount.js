/**
 * Assina a presença de espectadores da sala.
 *
 * Canal próprio, separado do que transporta o estado da partida — nada aqui
 * escreve no jogo. Jogadores apenas LEEM o contador; só quem está assistindo
 * se anuncia. Falha de rede nunca quebra a partida: o contador fica em zero.
 */
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient.js'
import {
  SPECTATOR_PRESENCE_ROLE,
  countSpectators,
  spectatorChannelName,
} from '../../game/spectatorPresence.js'

export function useSpectatorCount ({ roomCode, isSpectator = false, enabled = true } = {}) {
  const [count, setCount] = useState(0)
  const channelName = spectatorChannelName(roomCode)

  useEffect(() => {
    if (!enabled || !channelName || !supabase) {
      setCount(0)
      return undefined
    }
    let alive = true
    let channel = null

    try {
      channel = supabase.channel(channelName, { config: { presence: { key: '' } } })
      const sync = () => {
        if (!alive || !channel) return
        try { setCount(countSpectators(channel.presenceState())) } catch { setCount(0) }
      }
      channel
        .on('presence', { event: 'sync' }, sync)
        .on('presence', { event: 'join' }, sync)
        .on('presence', { event: 'leave' }, sync)
        .subscribe((status) => {
          if (!alive || status !== 'SUBSCRIBED') return
          if (isSpectator) {
            Promise.resolve(channel.track({ role: SPECTATOR_PRESENCE_ROLE })).catch(() => {})
          }
          sync()
        })
    } catch {
      setCount(0)
    }

    return () => {
      alive = false
      try { channel?.untrack?.() } catch { /* canal já encerrado */ }
      try { if (channel) supabase.removeChannel(channel) } catch { /* idem */ }
    }
  }, [channelName, isSpectator, enabled])

  return count
}
