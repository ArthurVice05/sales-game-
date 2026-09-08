/**
 * Riscos introduzidos pelo efeito sonoro de Sorte & Revés.
 *
 * Não revalida o baralho nem o vídeo: cobre só o áudio — mapeamento pelo kind,
 * uma reprodução por abertura, limpeza no confirmar/desmontar, rejeição de
 * play() e preferência de som. Nada aqui pode encostar no fluxo do jogo.
 *
 * Executar: node --test src/modals/__tests__/sorteRevesRevealSound.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  REVEAL_SOUND_PREFERENCE_KEY,
  createRevealSound,
  openRevealSoundSession,
  readRevealSoundPreference,
  revealSoundSourceFor,
  revealSoundVolumeFor,
  writeRevealSoundPreference,
} from '../sorteRevesRevealSound.js'
import { mediaVariantForCard } from '../sorteRevesPresentation.js'
import { SORTE_REVES_CARDS, resolveCardEffect } from '../sorteRevesDeck.js'

const here = dirname(fileURLToPath(import.meta.url))
const modalsDir = join(here, '..')
const projectRoot = join(here, '..', '..', '..')

const modalSrc = readFileSync(join(modalsDir, 'SorteRevesModal.jsx'), 'utf8')
const mediaSrc = readFileSync(join(modalsDir, 'SorteRevesCardMedia.jsx'), 'utf8')
const soundSrc = readFileSync(join(modalsDir, 'sorteRevesRevealSound.js'), 'utf8')

/** Dublê de HTMLAudioElement: registra tudo o que o controlador faz com ele. */
function fakeAudioFactory({ mode = 'resolve' } = {}) {
  const created = []
  const factory = (src) => {
    if (mode === 'unavailable') return null
    let settle
    const el = {
      src,
      volume: 1,
      loop: false,
      preload: '',
      paused: true,
      calls: 0,
      pauses: 0,
      loads: 0,
      play() {
        this.calls += 1
        this.paused = false
        if (mode === 'throw') throw new Error('sem áudio')
        if (mode === 'pending') return new Promise((res, rej) => { settle = { res, rej } })
        if (mode === 'reject') return Promise.reject(Object.assign(new Error('bloqueado'), { name: 'NotAllowedError' }))
        return Promise.resolve()
      },
      pause() { this.pauses += 1; this.paused = true },
      removeAttribute(name) { if (name === 'src') this.src = '' },
      load() { this.loads += 1 },
      get settle() { return settle },
    }
    created.push(el)
    return el
  }
  factory.created = created
  return factory
}

function memoryStorage(initial = {}) {
  const data = { ...initial }
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v) },
    removeItem: (k) => { delete data[k] },
    get data() { return data },
  }
}

describe('Som escolhido pela carta sorteada', () => {
  it('as 34 cartas existentes mapeiam para o áudio do seu kind', () => {
    assert.equal(SORTE_REVES_CARDS.length, 34)
    for (const card of SORTE_REVES_CARDS) {
      const esperado = card.kind === 'SORTE'
        ? '/media/sorte-reves/sorte.mp3'
        : '/media/sorte-reves/reves.mp3'
      assert.equal(revealSoundSourceFor(mediaVariantForCard(card)), esperado, `carta ${card.id}`)
    }
  })

  it('REVÉS protegido por certificado continua com o som de REVÉS', () => {
    const card = SORTE_REVES_CARDS.find((c) => c.id === 'key_client_at_risk')
    const protegido = resolveCardEffect(card, { am: 1 })
    assert.equal(protegido.payload.clientsDelta ?? 0, 0)
    assert.equal(protegido.payload.cashDelta ?? 0, 0)
    assert.equal(revealSoundSourceFor(mediaVariantForCard(card)), '/media/sorte-reves/reves.mp3')
  })

  it('os dois arquivos de áudio foram publicados', () => {
    for (const name of ['sorte.mp3', 'reves.mp3']) {
      const p = join(projectRoot, 'public', 'media', 'sorte-reves', name)
      assert.ok(existsSync(p), `faltou public/media/sorte-reves/${name}`)
      assert.ok(statSync(p).size > 5000, `${name} parece vazio`)
    }
  })

  it('Revés entra mais baixo que Sorte para equilibrar os níveis', () => {
    assert.equal(revealSoundVolumeFor('sorte'), 0.8)
    assert.equal(revealSoundVolumeFor('reves'), 0.35)
    assert.ok(revealSoundVolumeFor('reves') < revealSoundVolumeFor('sorte'))
  })
})

describe('Uma reprodução por abertura', () => {
  it('toca uma vez mesmo com revelação chamada várias vezes', () => {
    const createAudio = fakeAudioFactory()
    const som = createRevealSound('sorte', { createAudio })
    assert.equal(som.play(), 'started')
    assert.equal(som.play(), 'skipped')
    assert.equal(som.play(), 'skipped')
    assert.equal(createAudio.created.length, 1)
    assert.equal(createAudio.created[0].calls, 1)
  })

  it('timeupdate, ended, error e troca de fonte não duplicam o som', async () => {
    const createAudio = fakeAudioFactory()
    const som = createRevealSound('reves', { createAudio })
    som.play()
    await Promise.resolve()
    // eventos repetidos do vídeo, na ordem em que o navegador os entrega
    for (const _ of ['timeupdate', 'timeupdate', 'ended', 'error', 'source-swap']) som.play()
    assert.equal(createAudio.created.length, 1)
    assert.equal(createAudio.created[0].calls, 1)
  })

  it('aplica o volume e nunca liga repetição', () => {
    const createAudio = fakeAudioFactory()
    createRevealSound('reves', { createAudio }).play()
    const el = createAudio.created[0]
    assert.equal(el.volume, 0.35)
    assert.equal(el.loop, false)
    assert.equal(el.src, '/media/sorte-reves/reves.mp3')
  })

  it('nova abertura nasce com estado sonoro limpo', () => {
    const createAudio = fakeAudioFactory()
    const primeira = createRevealSound('sorte', { createAudio })
    primeira.play()
    primeira.dispose()

    const segunda = createRevealSound('sorte', { createAudio })
    assert.equal(segunda.play(), 'started')
    assert.equal(createAudio.created.length, 2)
  })
})

describe('Confirmação e desmontagem cortam o áudio', () => {
  it('parar interrompe imediatamente e solta o recurso', () => {
    const createAudio = fakeAudioFactory()
    const som = createRevealSound('sorte', { createAudio })
    som.play()
    som.stop()
    const el = createAudio.created[0]
    assert.equal(el.pauses, 1)
    assert.equal(el.src, '')
    assert.ok(el.loads >= 1, 'load() cancela o download pendente')
  })

  it('confirmar antes da revelação não deixa som atrasado', async () => {
    const createAudio = fakeAudioFactory({ mode: 'pending' })
    const som = createRevealSound('reves', { createAudio })
    som.dispose()                       // confirmou/desmontou antes de revelar
    assert.equal(som.play(), 'skipped')
    assert.equal(createAudio.created.length, 0)
  })

  it('desmontar durante o carregamento invalida a conclusão assíncrona', async () => {
    const createAudio = fakeAudioFactory({ mode: 'pending' })
    const som = createRevealSound('sorte', { createAudio })
    som.play()
    const el = createAudio.created[0]
    som.dispose()                       // promise de play() ainda pendente
    el.settle.res()                     // navegador conclui depois do unmount
    await Promise.resolve()
    await Promise.resolve()
    assert.equal(el.paused, true)
    assert.equal(el.src, '')
    assert.equal(som.state.heard, false, 'conclusão tardia não pode marcar como ouvido')
  })

  it('a sessão do modal faz setup/cleanup em par, inclusive em StrictMode', () => {
    // Reproduz o protocolo de efeito do React: setup → cleanup → setup.
    const createAudio = fakeAudioFactory()
    const listeners = []
    const doc = {
      visibilityState: 'visible',
      addEventListener: (t, fn) => listeners.push([t, fn]),
      removeEventListener: (t, fn) => {
        const i = listeners.findIndex(([lt, lf]) => lt === t && lf === fn)
        if (i >= 0) listeners.splice(i, 1)
      },
    }
    const revealed = { current: false }

    const primeira = openRevealSoundSession({ variant: 'sorte', createAudio, doc, revealed })
    primeira.cleanup()                          // StrictMode desmonta o primeiro efeito
    assert.equal(listeners.length, 0, 'cleanup remove o listener de visibilidade')

    const segunda = openRevealSoundSession({ variant: 'sorte', createAudio, doc, revealed })
    revealed.current = true
    segunda.sound.play()
    segunda.sound.play()
    assert.equal(createAudio.created.length, 1, 'StrictMode não pode duplicar a reprodução')

    segunda.cleanup()
    assert.equal(listeners.length, 0)
    assert.equal(createAudio.created[0].paused, true)
  })

  it('revelação ocorrida antes do efeito do modal ainda toca uma vez só', () => {
    const createAudio = fakeAudioFactory()
    const doc = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} }
    // filho revela no mount (movimento reduzido/fallback) antes do efeito do pai
    const revealed = { current: true }
    const sessao = openRevealSoundSession({ variant: 'reves', createAudio, doc, revealed })
    sessao.sound.play()
    assert.equal(createAudio.created.length, 1)
    sessao.cleanup()
  })

  it('ocultar a página interrompe e não repete ao voltar', () => {
    const createAudio = fakeAudioFactory()
    let handler = null
    const doc = {
      visibilityState: 'visible',
      addEventListener: (t, fn) => { if (t === 'visibilitychange') handler = fn },
      removeEventListener: () => { handler = null },
    }
    const sessao = openRevealSoundSession({ variant: 'sorte', createAudio, doc, revealed: { current: false } })
    sessao.sound.play()
    doc.visibilityState = 'hidden'
    handler()
    assert.equal(createAudio.created[0].paused, true)
    doc.visibilityState = 'visible'
    handler()
    assert.equal(createAudio.created.length, 1, 'voltar para a aba não pode reproduzir som antigo')
    sessao.cleanup()
  })
})

describe('Permissão, preferência e falhas', () => {
  it('play() rejeitado não estoura e não bloqueia o jogo', async () => {
    const createAudio = fakeAudioFactory({ mode: 'reject' })
    const som = createRevealSound('reves', { createAudio })
    assert.equal(som.play(), 'started')
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    assert.equal(som.state.heard, false)
    assert.equal(som.state.blocked, true)
  })

  it('play() que lança de forma síncrona é tratado', () => {
    const createAudio = fakeAudioFactory({ mode: 'throw' })
    const som = createRevealSound('sorte', { createAudio })
    assert.equal(som.play(), 'blocked')
    assert.equal(som.state.heard, false)
  })

  it('sem elemento de áudio disponível a abertura segue normal', () => {
    const createAudio = fakeAudioFactory({ mode: 'unavailable' })
    const som = createRevealSound('sorte', { createAudio })
    assert.equal(som.play(), 'unavailable')
  })

  it('bloqueado permite uma ativação explícita, nunca retentativa automática', async () => {
    const createAudio = fakeAudioFactory({ mode: 'reject' })
    const som = createRevealSound('sorte', { createAudio })
    som.play()
    await Promise.resolve(); await Promise.resolve()
    assert.equal(som.play(), 'skipped', 'sem retentativa automática')
    assert.equal(som.play({ explicit: true }), 'started', 'controle de som reativa')
    assert.equal(createAudio.created.length, 2)
  })

  it('efeito já ouvido nunca é reproduzido de novo', async () => {
    const createAudio = fakeAudioFactory()
    const som = createRevealSound('sorte', { createAudio })
    som.play()
    await Promise.resolve(); await Promise.resolve()
    assert.equal(som.state.heard, true)
    assert.equal(som.play({ explicit: true }), 'skipped')
    assert.equal(createAudio.created.length, 1)
  })

  it('preferência desligada não cria nem toca áudio', () => {
    const createAudio = fakeAudioFactory()
    const som = createRevealSound('reves', { createAudio, isEnabled: () => false })
    assert.equal(som.play(), 'off')
    assert.equal(createAudio.created.length, 0)
  })

  it('preferência persiste e vem ligada por padrão', () => {
    const store = memoryStorage()
    assert.equal(readRevealSoundPreference(store), true)
    writeRevealSoundPreference(false, store)
    assert.equal(store.data[REVEAL_SOUND_PREFERENCE_KEY], '0')
    assert.equal(readRevealSoundPreference(store), false)
    writeRevealSoundPreference(true, store)
    assert.equal(readRevealSoundPreference(store), true)
  })

  it('storage indisponível não derruba o modal', () => {
    const quebrado = {
      getItem() { throw new Error('bloqueado') },
      setItem() { throw new Error('bloqueado') },
    }
    assert.equal(readRevealSoundPreference(quebrado), true)
    assert.doesNotThrow(() => writeRevealSoundPreference(false, quebrado))
  })
})

describe('O áudio não encosta no fluxo do jogo', () => {
  it('o módulo de som desconhece carta, efeito e turno', () => {
    for (const proibido of ['onResolve', 'APPLY_CARD', 'resolveCardEffect', 'payload', 'cashDelta', 'clientsDelta', 'certDelta']) {
      assert.ok(!soundSrc.includes(proibido), `o som não pode referenciar ${proibido}`)
    }
  })

  it('o controlador só expõe estado de apresentação', () => {
    const som = createRevealSound('sorte', { createAudio: fakeAudioFactory() })
    som.play()
    assert.deepEqual(Object.keys(som.state).sort(), ['attempted', 'blocked', 'disposed', 'heard'])
    assert.equal(som.state.payload, undefined)
    assert.equal(som.state.action, undefined)
  })

  it('a confirmação corta o som antes de resolver, e uma vez só', () => {
    assert.match(modalSrc, /createOnceGuard\(\)/)
    assert.match(modalSrc, /onResolve\?\.\(resolved\.payload\)/)
    assert.match(modalSrc, /onClick=\{resolve\}/)
    // stop() do som precisa vir depois da trava e antes do callback do jogo
    const corpo = modalSrc.slice(modalSrc.indexOf('const resolve = ()'), modalSrc.indexOf('const resolve = ()') + 320)
    const guardaEm = corpo.indexOf('confirmGuard.current()')
    const stopEm = corpo.indexOf('.stop()')
    const resolveEm = corpo.indexOf('onResolve?.(resolved.payload)')
    assert.ok(guardaEm >= 0 && stopEm > guardaEm && resolveEm > stopEm)
  })

  it('o botão de confirmação não é usado como tentativa tardia de áudio', () => {
    const corpo = modalSrc.slice(modalSrc.indexOf('const resolve = ()'), modalSrc.indexOf('const resolve = ()') + 320)
    assert.ok(!/\.play\(/.test(corpo), 'confirmar não pode tentar tocar áudio')
  })

  it('a falha de áudio não muda o vídeo nem trava a confirmação', () => {
    // o vídeo não conhece o som: a revelação é reportada para cima, só isso
    assert.ok(!mediaSrc.includes('Audio'))
    assert.ok(!mediaSrc.includes('.mp3'))
    assert.match(mediaSrc, /onReveal/)
    assert.match(modalSrc, /disabled=\{!revealed\}/)
  })

  it('movimento reduzido não desliga o som (são preferências diferentes)', () => {
    assert.ok(!soundSrc.includes('prefers-reduced-motion'))
    assert.ok(!modalSrc.includes('prefers-reduced-motion'))
  })
})
