// src/main.jsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import GameNetProvider from './net/GameNetProvider.jsx'

// ✅ importa só o Provider (sem ModalRoot)
import { ModalProvider } from './modals/ModalContext'

import { isVercelDebugEnabled } from './game/debugFlags.js'

// ✅ Funções globais para export de logs
import {
  exportFullDebugReport,
  exportLogsAsText,
  exportLogsAsJSON,
  getLogStats,
  logCapture
} from './game/debugMode.js'
import { useIosVisualViewport } from './hooks/useIosVisualViewport.js'
import { useMobilePinchZoom } from './hooks/useMobilePinchZoom.js'

function initialRoomFromURL () {
  const qs = new URLSearchParams(window.location.search)
  const q = qs.get('room')
  return (q && String(q).trim()) || null   // null = sem sync remoto até escolher uma sala
}

function Root() {
  const [roomCode, setRoomCode] = React.useState(initialRoomFromURL())
  // iOS only: html.sg-ios + --sg-vv-height (não altera Android/desktop)
  useIosVisualViewport()
  // Mobile touch: pinch-zoom + pan quando ampliado
  useMobilePinchZoom()

  // expõe um setter global para o App trocar a sala dinamicamente
  React.useEffect(() => {
    window.__setRoomCode = (code) => {
      const c = String(code || '').trim() || null
      setRoomCode(c)
      // mantém a URL coerente com a sala atual
      const url = new URL(window.location.href)
      if (c) url.searchParams.set('room', c)
      else url.searchParams.delete('room')
      window.history.replaceState({}, '', url)
    }
    return () => { delete window.__setRoomCode }
  }, [])

  // Auto-ativa captura quando VITE_SG_DEBUG_LOGS=1 (Vercel)
  React.useEffect(() => {
    if (!isVercelDebugEnabled()) return
    logCapture.enable()
    console.log('[SG] logCapture auto-ativo (VITE_SG_DEBUG_LOGS=1)')
  }, [])

  // ✅ Expõe funções globais para export de logs
  React.useEffect(() => {
    // Função para exportar logs completos (gera download de arquivo)
    window.exportLogs = () => {
      const fullReport = exportFullDebugReport()
      
      // Exporta como texto
      const textBlob = new Blob([fullReport.text], { type: 'text/plain;charset=utf-8' })
      const textUrl = URL.createObjectURL(textBlob)
      const textA = document.createElement('a')
      textA.href = textUrl
      textA.download = `debug-logs-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`
      textA.click()
      URL.revokeObjectURL(textUrl)
      
      console.log('✅ Logs exportados! Arquivo .txt baixado.')
      return fullReport
    }

    // Função para obter logs como texto (retorna string, não baixa arquivo)
    window.getLogsText = () => {
      return exportLogsAsText()
    }

    // Função para obter logs como JSON (retorna objeto)
    window.getLogsJSON = () => {
      return exportLogsAsJSON()
    }

    // Função para obter estatísticas de logs
    window.getLogStats = () => {
      return getLogStats()
    }

    // Função para ativar/desativar captura de logs
    window.toggleLogCapture = () => {
      if (logCapture.enabled) {
        logCapture.disable()
        console.log('❌ Captura de logs DESATIVADA')
      } else {
        logCapture.enable()
        console.log('✅ Captura de logs ATIVADA')
      }
      return logCapture.enabled
    }

    // Mostra instruções no console
    console.log('%c📥 FUNÇÕES DE EXPORT DE LOGS DISPONÍVEIS:', 'color: #4CAF50; font-weight: bold; font-size: 14px')
    console.log('%cexportLogs()', 'color: #2196F3; font-weight: bold', '- Exporta logs completos (baixa arquivo .txt)')
    console.log('%cgetLogsText()', 'color: #2196F3; font-weight: bold', '- Retorna logs como string de texto')
    console.log('%cgetLogsJSON()', 'color: #2196F3; font-weight: bold', '- Retorna logs como objeto JSON')
    console.log('%cgetLogStats()', 'color: #2196F3; font-weight: bold', '- Retorna estatísticas dos logs')
    console.log('%ctoggleLogCapture()', 'color: #2196F3; font-weight: bold', '- Ativa/desativa captura de logs')

    return () => {
      delete window.exportLogs
      delete window.getLogsText
      delete window.getLogsJSON
      delete window.getLogStats
      delete window.toggleLogCapture
    }
  }, [])

  return (
    <ModalProvider>
      <GameNetProvider roomCode={roomCode}>
        <App />
      </GameNetProvider>
    </ModalProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
)
