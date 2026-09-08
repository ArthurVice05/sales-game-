/**
 * Riscos introduzidos pela apresentação 3D de Sorte & Revés.
 *
 * Não reimplementa nem revalida o baralho (isso vive em sorteRevesDeck.test.mjs):
 * cobre só o que a animação pode quebrar — mídia escolhida pelo `kind`, eventos
 * de mídia sem efeito no jogo, confirmação única e fallback sempre disponível.
 *
 * Executar: node --test src/modals/__tests__/sorteReves3D.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  MEDIA_PHASES,
  SETTLE_SECONDS,
  createOnceGuard,
  initialPresentation,
  mediaSourcesFor,
  mediaVariantForCard,
  reducePresentation,
} from '../sorteRevesPresentation.js'
import { SORTE_REVES_CARDS, resolveCardEffect } from '../sorteRevesDeck.js'

const here = dirname(fileURLToPath(import.meta.url))
const modalsDir = join(here, '..')
const projectRoot = join(here, '..', '..', '..')

const modalSrc = readFileSync(join(modalsDir, 'SorteRevesModal.jsx'), 'utf8')
const mediaSrc = readFileSync(join(modalsDir, 'SorteRevesCardMedia.jsx'), 'utf8')
const css = readFileSync(join(modalsDir, 'sorteReves3D.css'), 'utf8')

const MEDIA_FILES = [
  'sorte.webm', 'reves.webm',
  'sorte.mp4', 'reves.mp4',
  'sorte-poster.png', 'reves-poster.png',
]

describe('Mídia é escolhida pela carta sorteada, nunca pelo efeito', () => {
  it('cada carta do baralho mapeia para a mídia do seu kind', () => {
    assert.equal(SORTE_REVES_CARDS.length, 34)
    for (const card of SORTE_REVES_CARDS) {
      const expected = card.kind === 'SORTE' ? 'sorte' : 'reves'
      assert.equal(mediaVariantForCard(card), expected, `carta ${card.id}`)
    }
  })

  it('efeito condicional nulo ou invertido não muda a mídia', () => {
    // SORTE cujo ganho depende do jogador: sem infraestrutura A/B o cashDelta é 0.
    const sorte = SORTE_REVES_CARDS.find((c) => c.id === 'innovation_invest')
    const semAporte = resolveCardEffect(sorte, { mixProdutos: 'D' })
    assert.equal(semAporte.payload.cashDelta, 0)
    assert.equal(mediaVariantForCard(sorte), 'sorte')

    // REVÉS cuja penalidade some quando o jogador tem certificado amarelo.
    const reves = SORTE_REVES_CARDS.find((c) => c.id === 'key_client_at_risk')
    const protegido = resolveCardEffect(reves, { am: 1 })
    assert.equal(protegido.payload.clientsDelta ?? 0, 0)
    assert.equal(mediaVariantForCard(reves), 'reves')
  })

  it('as três fontes de cada variante apontam para public/media/sorte-reves', () => {
    for (const variant of ['sorte', 'reves']) {
      const src = mediaSourcesFor(variant)
      assert.equal(src.webm, `/media/sorte-reves/${variant}.webm`)
      assert.equal(src.mp4, `/media/sorte-reves/${variant}.mp4`)
      assert.equal(src.poster, `/media/sorte-reves/${variant}-poster.png`)
    }
  })

  it('os seis arquivos de mídia foram publicados', () => {
    for (const name of MEDIA_FILES) {
      const p = join(projectRoot, 'public', 'media', 'sorte-reves', name)
      assert.ok(existsSync(p), `faltou public/media/sorte-reves/${name}`)
      assert.ok(statSync(p).size > 10000, `${name} parece vazio`)
    }
  })
})

describe('Eventos de mídia só alteram apresentação', () => {
  const EVENTS = [
    { type: 'loadeddata' },
    { type: 'timeupdate', currentTime: 0 },
    { type: 'timeupdate', currentTime: SETTLE_SECONDS },
    { type: 'timeupdate', currentTime: 99 },
    { type: 'ended' },
    { type: 'error' },
    { type: 'timeout' },
    { type: 'playRejected' },
    { type: 'inexistente' },
  ]

  it('o estado de apresentação não carrega campos de jogo', () => {
    const states = [initialPresentation(false), initialPresentation(true)]
    for (const start of states) {
      for (const ev of EVENTS) {
        const next = reducePresentation(start, ev)
        assert.deepEqual(Object.keys(next).sort(), ['phase', 'settled'])
        assert.equal(typeof next.settled, 'boolean')
        assert.ok([MEDIA_PHASES.ANIMATING, MEDIA_PHASES.FINAL].includes(next.phase))
        assert.equal(next.action, undefined)
        assert.equal(next.payload, undefined)
      }
    }
  })

  it('falha, timeout ou play() rejeitado levam ao PNG final', () => {
    for (const type of ['error', 'timeout', 'playRejected', 'ended']) {
      const next = reducePresentation(initialPresentation(false), { type })
      assert.equal(next.phase, MEDIA_PHASES.FINAL)
      assert.equal(next.settled, true)
    }
  })

  it('não volta do PNG final para a animação', () => {
    const final = reducePresentation(initialPresentation(false), { type: 'ended' })
    for (const ev of EVENTS) {
      assert.equal(reducePresentation(final, ev).phase, MEDIA_PHASES.FINAL)
    }
  })

  it('o PNG não aparece antes da animação começar', () => {
    const start = initialPresentation(false)
    assert.equal(start.phase, MEDIA_PHASES.ANIMATING)
    assert.equal(start.settled, false)
    assert.equal(reducePresentation(start, { type: 'loadeddata' }).phase, MEDIA_PHASES.ANIMATING)
    assert.equal(reducePresentation(start, { type: 'timeupdate', currentTime: 0.5 }).phase, MEDIA_PHASES.ANIMATING)
  })

  it('a carta assenta em ~1,47 s, sem virar o quadro final', () => {
    assert.ok(Math.abs(SETTLE_SECONDS - 1.47) < 0.005)
    const antes = reducePresentation(initialPresentation(false), { type: 'timeupdate', currentTime: 1.4 })
    assert.equal(antes.settled, false)
    const depois = reducePresentation(initialPresentation(false), { type: 'timeupdate', currentTime: 1.47 })
    assert.equal(depois.settled, true)
    assert.equal(depois.phase, MEDIA_PHASES.ANIMATING)
  })

  it('movimento reduzido começa direto no quadro final', () => {
    const start = initialPresentation(true)
    assert.equal(start.phase, MEDIA_PHASES.FINAL)
    assert.equal(start.settled, true)
  })
})

describe('Confirmação continua única após revelação', () => {
  it('a trava local libera só a primeira confirmação', () => {
    const guard = createOnceGuard()
    assert.equal(guard(), true)
    assert.equal(guard(), false)
    assert.equal(guard(), false)
  })

  it('cada abertura tem a sua própria trava', () => {
    const a = createOnceGuard()
    const b = createOnceGuard()
    assert.equal(a(), true)
    assert.equal(b(), true)
  })

  it('o modal chama onResolve atrás da trava, com o payload intacto', () => {
    assert.match(modalSrc, /resolveCardEffect\(card, player\)/)
    assert.match(modalSrc, /onResolve\?\.\(resolved\.payload\)/)
    assert.match(modalSrc, /onClick=\{resolve\}/)
    assert.match(modalSrc, /createOnceGuard\(\)/)
    // A confirmação exige revelação; a animação pode ser adiantada sem aplicar efeito.
    assert.match(modalSrc, /disabled=\{!revealed\}/)
  })

  it('a mídia não conhece o fluxo do jogo', () => {
    for (const proibido of ['onResolve', 'APPLY_CARD', 'resolveCardEffect', 'player', 'cashDelta']) {
      assert.ok(!mediaSrc.includes(proibido), `mídia não pode referenciar ${proibido}`)
    }
  })
})

describe('Contrato de apresentação do vídeo', () => {
  it('reproduz uma vez, mudo, inline, sem controles', () => {
    assert.match(mediaSrc, /muted/)
    assert.match(mediaSrc, /playsInline/)
    assert.match(mediaSrc, /preload="metadata"/)
    assert.doesNotMatch(mediaSrc, /\bloop\b/)
    assert.doesNotMatch(mediaSrc, /\bcontrols\b/)
  })

  it('a mídia é decorativa e não intercepta cliques', () => {
    assert.match(mediaSrc, /aria-hidden/)
    assert.match(css, /pointer-events:\s*none/)
    assert.match(css, /aspect-ratio:\s*4\s*\/\s*5/)
    assert.match(css, /object-fit:\s*contain/)
  })

  it('webm com alfa primeiro, mp4 opaco como alternativa', () => {
    const webmAt = mediaSrc.indexOf('video/webm')
    const mp4At = mediaSrc.indexOf('video/mp4')
    assert.ok(webmAt >= 0 && mp4At >= 0)
    assert.ok(webmAt < mp4At, 'webm transparente deve vir antes do mp4 opaco')
  })

  it('os estilos ficam restritos a Sorte & Revés', () => {
    const selectors = css
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('}')
      .map((block) => block.split('{')[0])
      .join(',')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s) => !s.startsWith('@') && !/^(from|to|\d+%)$/.test(s))
    for (const sel of selectors) {
      assert.match(sel, /\.sr3d-/, `seletor fora do escopo: ${sel}`)
    }
  })

  it('o modal rola na vertical sem estourar na horizontal', () => {
    assert.match(css, /overflow-y:\s*auto/)
    assert.match(css, /overflow-x:\s*hidden/)
    assert.match(css, /dvh/)
    assert.match(css, /prefers-reduced-motion/)
  })

  it('o conteúdo real continua no React, fora do vídeo', () => {
    assert.match(modalSrc, /<TileContextHint kind="LUCK" \/>/)
    assert.match(modalSrc, /card\.title/)
    assert.match(modalSrc, /resolved\.text/)
    assert.match(modalSrc, /aplicado imediatamente ao confirmar/)
  })
})
