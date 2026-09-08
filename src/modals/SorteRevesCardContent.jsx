import React from 'react'

/** Superfície de leitura real. Dados vêm do modal, nunca de textura ou do 3D. */
export default function SorteRevesCardContent({variant,title,text,cashDelta,revealed,frameRef,children}) {
  const fortune=variant==='sorte'
  const amount=Number.isFinite(cashDelta)&&cashDelta!==0
    ? `${cashDelta>0?'+':'−'} ${Math.abs(cashDelta).toLocaleString('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:0})}`
    : null
  return <article ref={frameRef} className={`sr3d-readingCard sr3d-readingCard--${variant}${revealed?' is-revealed':''}`} aria-hidden={!revealed} inert={!revealed?'':undefined}>
    <header className="sr3d-readingHeader">
      <svg className="sr3d-emblem" viewBox="0 0 48 48" aria-hidden="true">
        <path d={fortune?'M24 1 30 18 47 24 30 30 24 47 18 30 1 24 18 18Z':'M26 2 8 27 22 27 17 46 42 18 27 18 35 2Z'} />
      </svg>
      <span className="sr3d-kind">{fortune?'SORTE':'REVÉS'}</span>
    </header>
    <div className="sr3d-readingBody" tabIndex={revealed?0:-1} role="region" aria-label="Conteúdo da carta">
      {title&&<h2 className="sr3d-readingTitle">{title}</h2>}
      {amount&&<p className="sr3d-readingAmount">{amount}</p>}
      <p className="sr3d-readingDescription">{text}</p>
    </div>
    <footer className="sr3d-readingFooter">{children}</footer>
  </article>
}
