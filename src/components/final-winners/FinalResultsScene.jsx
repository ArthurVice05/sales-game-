import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { mountResultsScene } from './resultsRuntime.js'
import { countPatrimonio, createResultsScale, formatResultsMoney } from './resultsPresentation.js'

const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

export function ResultsCounter({ value, timeline }) {
  const progress = useSyncExternalStore(timeline.subscribe, timeline.getSnapshot, timeline.getServerSnapshot)
  return <span aria-hidden="true">{formatResultsMoney(countPatrimonio(value, progress))}</span>
}

export default function FinalResultsScene({ entries, timeline }) {
  const hostRef = useRef(null), runtimeRef = useRef(null), previousRef = useRef(null)
  const [ready, setReady] = useState(false)
  // A value signature ignores equivalent parent renders, but detects real result changes.
  // Only presentation fields cross this boundary; no game payload is retained by Three.
  const signature = JSON.stringify(entries.map(({ player, place }) => ({
    place, id: player.id, name: player.name, patrimonio: Number.isFinite(player.patrimonio) ? player.patrimonio : null,
    cash: Number.isFinite(player.cash) ? player.cash : null, bens: Number.isFinite(player.bens) ? player.bens : null,
    isBankrupt: player.isBankrupt,
  })))
  const sceneEntries = useMemo(() => JSON.parse(signature).map(({ place, ...player }) => ({ place, player })), [signature])
  const scale = useMemo(() => createResultsScale(sceneEntries.map(entry => entry.player.patrimonio)), [sceneEntries])

  useBrowserLayoutEffect(() => {
    // Corrected results settle immediately: never replay or keep an old snapshot.
    if (previousRef.current !== null && previousRef.current !== signature) timeline.finish()
    previousRef.current = signature
    runtimeRef.current = mountResultsScene({
      host: hostRef.current, entries: sceneEntries, timeline,
      onReady: () => setReady(true), onFallback: () => setReady(false),
    })
    return () => { runtimeRef.current?.dispose(); runtimeRef.current = null }
  }, [signature, sceneEntries, timeline])

  const extent = scale.max - scale.min || 4
  return <div className="fwr3d-visual" data-renderer={ready ? 'three' : 'dom'} aria-hidden="true">
    <div className="fwr3d-fallback" hidden={ready} style={{ '--fwr3d-count': entries.length || 1 }}>
      <div className="fwr3d-zero" style={{ bottom: `${-scale.min / extent * 100}%` }} />
      {sceneEntries.map(({ player, place }, index) => {
        const height = scale.height(player.patrimonio)
        return <div className="fwr3d-fallbackSlot" key={index}>
          <div className={`fwr3d-bar fwr3d-place-${place}`} style={{
            height: `${Math.abs(height) / extent * 100}%`,
            bottom: `${(Math.min(0, height) - scale.min) / extent * 100}%`,
          }} />
        </div>
      })}
    </div>
    <div className="fwr3d-canvas" ref={hostRef} />
  </div>
}
