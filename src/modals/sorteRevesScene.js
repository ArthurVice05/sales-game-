import * as THREE from 'three'

// Somente apresentação. Estes valores nunca entram no sorteio ou no turno.
export const SCENE_TIMING = Object.freeze({ lift: 500, approach: 700, flip: 900, settle: 300, total: 2400, fade: 180 })
export const CARD_SHAPE = Object.freeze({ width: 3, height: 4.5, depth: .045, radius: .18, startScale: .28, startAngle: Math.PI, flipAngle: Math.PI * 3 })
export const SCENE_CAMERA = Object.freeze({ fov: 32, near: .1, far: 80, maxPixelRatio: 2 })
const clamp = v => Math.max(0, Math.min(1, v))
const smooth = t => { const x=clamp(t);return x*x*(3-2*x) }
const mix = (a,b,t) => a+(b-a)*t

export function poseAt(elapsed) {
  const t=Math.max(0,Number(elapsed)||0)
  const {lift,approach,flip,total}=SCENE_TIMING
  const a=smooth(t/lift), b=smooth((t-lift)/approach), c=smooth((t-lift-approach)/flip), d=smooth((t-lift-approach-flip)/SCENE_TIMING.settle)
  return {
    phase:t<lift?'lift':t<lift+approach?'approach':t<lift+approach+flip?'flip':t<total?'settle':'revealed',
    revealed:t>=total,
    scale:mix(mix(CARD_SHAPE.startScale,.38,a),1,b) + .022*Math.sin(d*Math.PI),
    ry:CARD_SHAPE.startAngle+CARD_SHAPE.flipAngle*c,
    rx:mix(-.98,-.08,b)*(1-d), rz:mix(-.18,.025,b)*(1-d),
    lift:(.55*a)*(1-b), approach:b,
    deckOpacity:1-smooth((t-lift)/approach),
    glow:Math.sin(c*Math.PI)*.55+d*.24,
  }
}

/** Relógio cancelável. Dispose nunca é conclusão; adiantar só revela. */
export function createScenePlayback({now,requestFrame,cancelFrame,update,onRevealed}) {
  let frame=0, start=0, done=false, cancelled=false, started=false
  const finish=()=>{
    if(done||cancelled)return
    done=true;cancelFrame(frame);update(poseAt(SCENE_TIMING.total));onRevealed()
  }
  const tick=time=>{
    if(done||cancelled)return
    const elapsed=time-start
    if(elapsed>=SCENE_TIMING.total){finish();return}
    update(poseAt(elapsed));if(!done&&!cancelled)frame=requestFrame(tick)
  }
  return {
    start(){if(started||done||cancelled)return;started=true;start=now();update(poseAt(0));if(!done&&!cancelled)frame=requestFrame(tick)},
    finish,
    dispose(){cancelled=true;cancelFrame(frame)},
  }
}

function roundedShape(w,h,r) {
  const s=new THREE.Shape(),x=-w/2,y=-h/2
  s.moveTo(x+r,y);s.lineTo(x+w-r,y);s.quadraticCurveTo(x+w,y,x+w,y+r)
  s.lineTo(x+w,y+h-r);s.quadraticCurveTo(x+w,y+h,x+w-r,y+h)
  s.lineTo(x+r,y+h);s.quadraticCurveTo(x,y+h,x,y+h-r)
  s.lineTo(x,y+r);s.quadraticCurveTo(x,y,x+r,y)
  return s
}

function star(ctx,x,y,r) {
  ctx.beginPath()
  for(let i=0;i<8;i++){const a=-Math.PI/2+i*Math.PI/4,rad=i%2?r*.25:r;const px=x+Math.cos(a)*rad,py=y+Math.sin(a)*rad;i?ctx.lineTo(px,py):ctx.moveTo(px,py)}
  ctx.closePath();ctx.fill()
}

/** Arte estática do verso e selo. Nunca recebe título, descrição ou valores. */
export function createCardTexture(variant,back=false) {
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=768
  const c=canvas.getContext('2d');if(!c)throw new Error('Canvas 2D indisponível')
  const fortune=variant==='sorte', metal=fortune?'#e8c783':'#e9a995'
  const bg=c.createLinearGradient(0,0,512,768)
  bg.addColorStop(0,back?'#182a40':fortune?'#164c39':'#63232b');bg.addColorStop(1,back?'#07121f':fortune?'#071d18':'#260e17')
  c.fillStyle=bg;c.fillRect(0,0,512,768)
  // Trama geométrica discreta, determinística e independente do RNG do jogo.
  c.strokeStyle=back?'rgba(173,193,221,.085)':'rgba(245,220,175,.045)';c.lineWidth=1
  for(let k=-768;k<512;k+=26){c.beginPath();c.moveTo(k,0);c.lineTo(k+768,768);c.stroke();c.beginPath();c.moveTo(k+768,0);c.lineTo(k,768);c.stroke()}
  c.strokeStyle=metal;c.lineWidth=2
  for(const pad of [15,25]){c.beginPath();c.roundRect(pad,pad,512-pad*2,768-pad*2,24);c.stroke()}
  for(const x of [45,467])for(const y of [45,723]){c.fillStyle=metal;star(c,x,y,7)}
  c.textAlign='center';c.textBaseline='middle'
  if(back){
    c.strokeStyle=metal;c.lineWidth=1;c.beginPath();c.arc(256,350,140,0,Math.PI*2);c.stroke()
    c.beginPath();c.arc(256,350,149,0,Math.PI*2);c.stroke()
    c.fillStyle='#f6eee1';c.font='900 62px Arial';c.fillText('Sales',256,307)
    c.fillStyle='#c81e35';c.beginPath();c.roundRect(158,340,196,64,5);c.fill()
    c.fillStyle='#fff';c.font='900 51px Arial';c.fillText('GAME',256,374)
    c.fillStyle=metal;c.font='bold 16px Arial';c.fillText('SORTE & REVÉS',256,551)
    c.font='11px Arial';c.fillStyle='#abb8c9';c.fillText('ESTRATÉGIA • VENDAS • DECISÕES',256,585)
  }else{
    c.fillStyle=metal
    if(fortune)star(c,256,108,37)
    else{c.beginPath();c.moveTo(257,70);c.lineTo(225,113);c.lineTo(249,113);c.lineTo(239,148);c.lineTo(285,98);c.lineTo(259,98);c.lineTo(276,70);c.closePath();c.fill()}
    c.font='bold 26px Arial';c.fillText(fortune?'SORTE':'REVÉS',256,184)
    c.strokeStyle=metal;c.globalAlpha=.5;c.beginPath();c.moveTo(95,226);c.lineTo(417,226);c.stroke();c.globalAlpha=1
  }
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=2
  return texture
}

export function createCardObjects(variant,makeTexture=createCardTexture) {
  const fortune=variant==='sorte', group=new THREE.Group()
  const gold=new THREE.MeshStandardMaterial({color:fortune?0xd8af60:0xc88576,metalness:.82,roughness:.28})
  const shell=new THREE.ExtrudeGeometry(roundedShape(3,4.5,.18),{depth:.045,bevelEnabled:true,bevelSegments:2,steps:1,bevelSize:.024,bevelThickness:.019,curveSegments:8})
  shell.translate(0,0,-.0225)
  const face=new THREE.ShapeGeometry(roundedShape(2.95,4.45,.17),10)
  const positions=face.attributes.position,uv=face.attributes.uv
  for(let i=0;i<uv.count;i++)uv.setXY(i,(positions.getX(i)+1.475)/2.95,(positions.getY(i)+2.225)/4.45)
  const front=new THREE.MeshStandardMaterial({map:makeTexture(variant,false),roughness:.57,metalness:.12})
  const back=new THREE.MeshStandardMaterial({map:makeTexture(variant,true),roughness:.5,metalness:.12})
  const build=()=>{
    const obj=new THREE.Group();obj.add(new THREE.Mesh(shell,gold))
    const f=new THREE.Mesh(face,front);f.position.z=.044;obj.add(f)
    const b=new THREE.Mesh(face,back);b.position.z=-.044;b.rotation.y=Math.PI;obj.add(b)
    return obj
  }
  const card=build();group.add(card)
  const deck=new THREE.Group();group.add(deck)
  // Cartas do monte têm materiais próprios para desaparecer sem apagar a hero.
  const deckMaterials=new Map()
  for(let i=0;i<6;i++){
    const part=build();part.position.set(i*.018,-i*.009,i*.085);part.rotation.z=(i%2?1:-1)*.008
    part.traverse(o=>{if(o.material){if(!deckMaterials.has(o.material)){const m=o.material.clone();m.transparent=true;deckMaterials.set(o.material,m)}o.material=deckMaterials.get(o.material)}})
    deck.add(part)
  }
  const dustPositions=[]
  for(let i=0;i<28;i++){const a=i*2.39996,r=1.7+(i%5)*.17;dustPositions.push(Math.cos(a)*r,Math.sin(a)*r,.15)}
  const dustGeo=new THREE.BufferGeometry();dustGeo.setAttribute('position',new THREE.Float32BufferAttribute(dustPositions,3))
  const dust=new THREE.Points(dustGeo,new THREE.PointsMaterial({color:fortune?0xffd993:0xff8277,size:.019,transparent:true,opacity:0,depthWrite:false,blending:THREE.AdditiveBlending}));group.add(dust)
  return {group,card,deck,dust,deckMaterials:[...deckMaterials.values()]}
}

export function disposeCardObjects(group) {
  const geometries=new Set(),materials=new Set(),textures=new Set()
  group.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const m of (Array.isArray(o.material)?o.material:[o.material]).filter(Boolean)){materials.add(m);for(const v of Object.values(m))if(v?.isTexture)textures.add(v)}})
  textures.forEach(t=>t.dispose());materials.forEach(m=>m.dispose());geometries.forEach(g=>g.dispose())
}
