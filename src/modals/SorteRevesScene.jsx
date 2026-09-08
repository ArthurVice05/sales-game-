import React, { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { CARD_SHAPE, SCENE_CAMERA, SCENE_TIMING, createCardObjects, createScenePlayback, disposeCardObjects } from './sorteRevesScene.js'
import './sorte-reves.css'

// Pilha decorativa em repouso: nenhum WebGL/RAF fica ativo entre as cartas.
export function SorteRevesDeck() {
  return <div className="sr3d-restDeck" aria-hidden="true">
    {[5,4,3,2,1,0].map(i=><span className="sr3d-restLeaf" key={i} style={{'--sr-layer':i}}>
      {i===0&&<span className="sr3d-restBrand">Sales<strong>GAME</strong><small>SORTE & REVÉS</small></span>}
    </span>)}
  </div>
}

/** Cena decorativa. Recebe apenas variante e posição da superfície de leitura. */
export default function SorteRevesScene({variant,frameRef,advanceRef,onRevealed}) {
  const hostRef=useRef(null), callbackRef=useRef(onRevealed), resourcesRef=useRef(null)
  callbackRef.current=onRevealed
  useEffect(()=>{
    const host=hostRef.current
    let cancelled=false, completed=false, clock=null, renderer=null, objects=null, observer=null, watchdog=0, finishTimer=0
    const motion=window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const idle=document.querySelector('.sr3d-restDeck'), oldVisibility=idle?.style.visibility
    if(idle)idle.style.visibility='hidden'
    const reveal=()=>{if(cancelled||completed)return;completed=true;clearTimeout(watchdog);callbackRef.current?.()}
    const finish=()=>{if(cancelled||completed)return;clock?clock.finish():reveal()}
    advanceRef.current=finish
    const lost=e=>{e?.preventDefault?.();finish()}
    const motionChange=e=>{if(e.matches)finish()}
    let resize=()=>{}
    try {
      if(!host||motion?.matches){finishTimer=setTimeout(reveal,0)}
      else {
        renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power'})
        renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,SCENE_CAMERA.maxPixelRatio))
        renderer.setClearColor(0x000000,0)
        renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.25
        host.appendChild(renderer.domElement)
        renderer.domElement.addEventListener('webglcontextlost',lost)
        const scene=new THREE.Scene(), camera=new THREE.PerspectiveCamera(SCENE_CAMERA.fov,1,SCENE_CAMERA.near,SCENE_CAMERA.far)
        scene.add(new THREE.AmbientLight(0xc4d4e7,1.5))
        const key=new THREE.DirectionalLight(0xffecd2,3.5);key.position.set(-3,5,6)
        const fill=new THREE.DirectionalLight(0xadcfff,1.6);fill.position.set(4,1,4)
        const rim=new THREE.PointLight(variant==='sorte'?0xf6c871:0xff5961,14,20);rim.position.set(0,2,-2)
        scene.add(key,fill,rim)
        objects=createCardObjects(variant);scene.add(objects.group)
        resourcesRef.current={renderer,camera,scene,objects}
        let worldHeight=10, worldWidth=10, targetX=0,targetY=0,startX=0,startY=0,stretch=1,latest=null
        const draw=p=>{
          latest=p;if(cancelled)return
          const {card,deck,dust,deckMaterials}=objects
          card.position.set(startX+(targetX-startX)*p.approach,startY+(targetY-startY)*p.approach+p.lift,0)
          card.rotation.set(p.rx,p.ry,p.rz);card.scale.set(p.scale*(1+(stretch-1)*p.approach),p.scale,p.scale)
          deck.position.set(startX,startY,-.28);deck.rotation.set(-.98,Math.PI,-.18);deck.scale.setScalar(CARD_SHAPE.startScale)
          deck.visible=p.deckOpacity>.001;deckMaterials.forEach(m=>{m.opacity=p.deckOpacity})
          dust.position.set(targetX,targetY,0);dust.material.opacity=p.glow;dust.rotation.z=p.ry*.04
          // Context loss follows the DOM fallback; no exception can hold the card.
          try{renderer.render(scene,camera)}catch{clock?.dispose();reveal()}
          host.dataset.phase=p.phase
        }
        resize=()=>{
          const w=host.clientWidth||window.innerWidth,h=host.clientHeight||window.innerHeight
          const rect=frameRef.current?.getBoundingClientRect()
          if(!rect||!w||!h)return
          stretch=(rect.width/rect.height)/(CARD_SHAPE.width/CARD_SHAPE.height)
          renderer.setSize(w,h,false)
          worldHeight=CARD_SHAPE.height*h/Math.max(1,rect.height);worldWidth=worldHeight*w/h
          camera.aspect=w/h;camera.position.z=worldHeight/(2*Math.tan(THREE.MathUtils.degToRad(camera.fov/2)));camera.far=Math.max(80,camera.position.z+20);camera.updateProjectionMatrix()
          const hostRect=host.getBoundingClientRect()
          const project=(x,y)=>[(x-hostRect.left-w/2)/w*worldWidth,-(y-hostRect.top-h/2)/h*worldHeight]
          ;[targetX,targetY]=project(rect.left+rect.width/2,rect.top+rect.height/2)
          const anchor=idle?.getBoundingClientRect()||document.querySelector('.boardWrap')?.getBoundingClientRect()
          const x=anchor?anchor.left+anchor.width/2:rect.left+rect.width/2
          const y=anchor?anchor.top+anchor.height/2:rect.top+rect.height*.64
          ;[startX,startY]=project(Math.max(40,Math.min(w-40,x)),Math.max(40,Math.min(h-40,y)))
          if(latest)draw(latest)
        }
        resize()
        clock=createScenePlayback({now:()=>performance.now(),requestFrame:cb=>requestAnimationFrame(cb),cancelFrame:id=>cancelAnimationFrame(id),update:draw,onRevealed:reveal})
        watchdog=setTimeout(finish,SCENE_TIMING.total+2000)
        clock.start()
        if(typeof ResizeObserver==='function'){observer=new ResizeObserver(resize);observer.observe(host);if(frameRef.current)observer.observe(frameRef.current)}
        window.addEventListener('resize',resize)
        window.addEventListener('scroll',resize,true)
      }
    }catch{finishTimer=setTimeout(reveal,0)}
    motion?.addEventListener?.('change',motionChange)
    return ()=>{
      cancelled=true;clock?.dispose();clearTimeout(watchdog);clearTimeout(finishTimer)
      observer?.disconnect();window.removeEventListener('resize',resize);window.removeEventListener('scroll',resize,true)
      motion?.removeEventListener?.('change',motionChange)
      if(advanceRef.current===finish)advanceRef.current=null
      renderer?.domElement.removeEventListener('webglcontextlost',lost)
      if(objects)disposeCardObjects(objects.group)
      renderer?.dispose();renderer?.forceContextLoss();renderer?.domElement.remove()
      if(idle)idle.style.visibility=oldVisibility||''
      resourcesRef.current=null
    }
  },[variant,frameRef,advanceRef])
  return <div ref={hostRef} className="sr3d-scene" aria-hidden="true" />
}
