import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { readFileSync } from 'node:fs'
import { poseAt, createScenePlayback, createCardObjects, disposeCardObjects, SCENE_TIMING } from '../sorteRevesScene.js'
import { SORTE_REVES_CARDS, resolveCardEffect } from '../sorteRevesDeck.js'
import { SORTE_REVES_CARDS as botCards, resolveSorteRevesCard } from '../../game/sorteRevesCards.js'

test('costas na saída, giro adicional de 540 graus e frente estável ao revelar', () => {
  assert.equal(poseAt(0).phase, 'lift')
  assert.equal(poseAt(500).phase, 'approach')
  assert.equal(poseAt(1200).phase, 'flip')
  assert.equal(poseAt(2100).phase, 'settle')
  assert.equal(poseAt(2399).revealed, false)
  const end = poseAt(2400)
  assert.equal(end.revealed, true)
  assert.ok(Math.cos(poseAt(0).ry) < 0)
  assert.ok(Math.cos(end.ry) > .9999)
  assert.ok(Math.abs(end.ry - poseAt(1200).ry - Math.PI * 3) < 1e-9)
  assert.deepEqual(poseAt(10000), end)
})

test('trajetória não dá saltos entre fases e não carrega resultado do jogo', () => {
  for (const t of [500, 1200, 2100, 2400]) {
    const before = poseAt(t - .001), after = poseAt(t)
    for (const k of ['scale','ry','rx','rz','lift','deckOpacity']) assert.ok(Math.abs(before[k] - after[k]) < .001, `${t}/${k}`)
  }
  for (let t=0; t<=2400; t+=10) {
    const p=poseAt(t)
    assert.equal(p.payload, undefined); assert.equal(p.action, undefined)
    assert.ok(Number.isFinite(p.scale) && p.scale > 0)
  }
})

function clock() {
  let time=0, next=0, events=0; const frames=new Map(), poses=[]
  const control=createScenePlayback({now:()=>time, requestFrame:cb=>{frames.set(++next,cb);return next}, cancelFrame:id=>frames.delete(id), update:p=>poses.push(p), onRevealed:()=>events++})
  return { control, frames, poses, get events(){return events}, step(t){time=t;const batch=[...frames.values()];frames.clear();batch.forEach(cb=>cb(t))} }
}
test('conclusão emite uma revelação e encerra RAF, sem resolver carta', () => {
  const c=clock();c.control.start();c.step(500);assert.equal(c.events,0)
  c.step(SCENE_TIMING.total);c.control.finish();c.control.finish()
  assert.equal(c.events,1);assert.equal(c.frames.size,0)
})
test('adiantar revela imediatamente, cancela RAF e não repete', () => {
  const c=clock();c.control.start();c.step(100);c.control.finish();c.control.finish();c.step(4000)
  assert.equal(c.events,1);assert.equal(c.poses.at(-1).revealed,true)
})
test('desmontagem cancela sem revelar; callback já enfileirado fica inerte', () => {
  const c=clock();c.control.start();const late=[...c.frames.values()][0];c.control.dispose();late(9999)
  assert.equal(c.events,0);assert.equal(c.frames.size,0)
})
test('setup/cleanup/setup inicia relógio novo sem conclusão fantasma', () => {
  const a=clock();a.control.start();a.control.dispose()
  const b=clock();b.control.start();b.step(2400)
  assert.equal(a.events,0);assert.equal(b.events,1)
})
test('carta tem espessura, faces distintas e recursos compartilhados descartados uma vez', () => {
  const objects=createCardObjects('sorte',()=>new THREE.Texture())
  const geometries=new Set(), materials=new Set(), textures=new Set()
  objects.group.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const m of (Array.isArray(o.material)?o.material:[o.material]).filter(Boolean)){materials.add(m);if(m.map)textures.add(m.map)}})
  objects.card.children[0].geometry.computeBoundingBox()
  const box=objects.card.children[0].geometry.boundingBox
  assert.ok(box.max.z-box.min.z > .02)
  assert.ok(textures.size >= 2)
  let disposed=0;for(const r of [...geometries,...materials,...textures])r.addEventListener('dispose',()=>disposed++)
  disposeCardObjects(objects.group)
  assert.equal(disposed,geometries.size+materials.size+textures.size)
})
test('34 cartas preservam payload humano/bot em estados condicionais', () => {
  assert.equal(SORTE_REVES_CARDS.length,34);assert.equal(botCards.length,34)
  for(const p of [{},{am:1,az:1,rox:1,cash:18000,gestores:2,mixProdutos:'A'}])for(const c of SORTE_REVES_CARDS){
    const b=botCards.find(b=>b.id===c.id);assert.ok(b,c.id)
    assert.deepEqual(resolveCardEffect(c,p).payload,resolveSorteRevesCard(b,p).payload,c.id)
  }
})
test('snapshot das 34 cartas mantém ids e deltas existentes', () => {
  const frozen=JSON.parse(readFileSync(new URL('./fixtures/sorteRevesPayloads.json',import.meta.url)))
  assert.deepEqual(SORTE_REVES_CARDS.map(c=>resolveCardEffect(c,{}).payload),frozen)
})

test('cancelar durante o desenho não agenda outro frame', () => {
  const pending=new Set(); let control, draws=0
  control=createScenePlayback({now:()=>0,requestFrame:cb=>{pending.add(cb);return cb},cancelFrame:id=>pending.delete(id),update:()=>{draws++;control.dispose()},onRevealed:()=>assert.fail('cancelar não revela')})
  control.start()
  assert.equal(draws,1);assert.equal(pending.size,0)
})
test('adiantar antes do primeiro frame impede início tardio', () => {
  const c=clock();c.control.finish();c.control.start()
  assert.equal(c.events,1);assert.equal(c.frames.size,0)
})

test('constantes somam 2400ms; apresentação não cria state por frame e libera WebGL', () => {
  assert.equal(SCENE_TIMING.lift+SCENE_TIMING.approach+SCENE_TIMING.flip+SCENE_TIMING.settle,SCENE_TIMING.total)
  const scene=readFileSync(new URL('../SorteRevesScene.jsx',import.meta.url),'utf8')
  assert.doesNotMatch(scene,/useState|setState|onResolve|resolved\.payload/)
  assert.match(scene,/clock\?\.dispose\(\)/)
  assert.match(scene,/disposeCardObjects\(objects\.group\)/)
  assert.match(scene,/renderer\?\.forceContextLoss\(\)/)
})
test('CSS preserva layout externo, backdrop translúcido e movimento reduzido', () => {
  const css=readFileSync(new URL('../sorte-reves.css',import.meta.url),'utf8')
  for(const declaration of css.matchAll(/transition\s*:\s*([^;}]+)/g)){
    assert.doesNotMatch(declaration[1],/\b(?:all|width|height|max-width|max-height|grid-template-columns)\b/)
  }
  assert.match(css,/@media\s*\(prefers-reduced-motion:\s*reduce\)/)
  assert.match(css,/background:radial-gradient\([^;]+rgba\(6,12,22,\.16\)/)
  assert.match(css,/\.sr3d-restDeck\s*\{[^}]*position:absolute/)
})
