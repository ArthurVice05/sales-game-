// src/game/logCapture.js
/**
 * Sistema de captura de logs para análise de problemas
 * Captura todos os console.log, console.warn, console.error relevantes
 */

class LogCapture {
  constructor() {
    this.enabled = false
    this.logs = []
    this.listeners = new Set()
    this.maxLogs = 10000 // Limite de logs para evitar consumo excessivo de memória
    this.originalConsole = {
      log: console.log,
      warn: console.warn,
      error: console.error,
      debug: console.debug,
      info: console.info
    }
    this.prefixes = [
      '[DEBUG]',
      '[NET]',
      '[App]',
      '[SG]',
      '[Controls]',
      '[HUD]',
      '[DEBUG MODE]',
      '[PlayersLobby]',
      '[leaveRoom]',
      '[GameNet]',
      '[useTurnEngine]',
    ]
  }

  /**
   * Verifica se um log deve ser capturado
   */
  shouldCapture(args) {
    if (!this.enabled) return false
    
    // Converte todos os argumentos para string
    const logString = args.map(arg => {
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg)
        } catch {
          return String(arg)
        }
      }
      return String(arg)
    }).join(' ')

    // Captura se contém algum dos prefixos ou se é erro/warn
    return this.prefixes.some(prefix => logString.includes(prefix))
  }

  /**
   * Adiciona log ao histórico
   */
  addLog(level, args) {
    if (this.logs.length >= this.maxLogs) {
      // Remove os logs mais antigos (mantém os 90% mais recentes)
      this.logs = this.logs.slice(-Math.floor(this.maxLogs * 0.9))
    }

    const timestamp = Date.now()
    const logEntry = {
      timestamp,
      time: new Date(timestamp).toISOString(),
      level, // 'log', 'warn', 'error', 'debug', 'info'
      args: args.map(arg => {
        // Serializa objetos de forma segura
        if (typeof arg === 'object' && arg !== null) {
          try {
            // Tenta fazer deep clone para evitar referências mutáveis
            return JSON.parse(JSON.stringify(arg, (key, value) => {
              // Remove funções e undefined
              if (typeof value === 'function') return '[Function]'
              if (value === undefined) return '[undefined]'
              // Limita arrays muito grandes
              if (Array.isArray(value) && value.length > 100) {
                return `[Array(${value.length}) - truncado]`
              }
              return value
            }))
          } catch (e) {
            return String(arg)
          }
        }
        return arg
      }),
      // Mantém string original para busca
      message: args.map(arg => {
        if (typeof arg === 'object') {
          try {
            return JSON.stringify(arg)
          } catch {
            return String(arg)
          }
        }
        return String(arg)
      }).join(' ')
    }

    this.logs.push(logEntry)
    this.listeners.forEach(listener => {
      try {
        listener(logEntry)
      } catch {
        // Telemetria nunca pode interferir no jogo.
      }
    })
  }

  subscribe(listener) {
    if (typeof listener !== 'function') return () => {}
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Intercepta console.log
   */
  interceptLog(...args) {
    if (this.shouldCapture(args)) {
      this.addLog('log', args)
    }
    this.originalConsole.log.apply(console, args)
  }

  /**
   * Intercepta console.warn
   */
  interceptWarn(...args) {
    if (this.shouldCapture(args)) {
      this.addLog('warn', args)
    }
    this.originalConsole.warn.apply(console, args)
  }

  /**
   * Intercepta console.error
   */
  interceptError(...args) {
    // Sempre captura erros
    this.addLog('error', args)
    this.originalConsole.error.apply(console, args)
  }

  /**
   * Intercepta console.debug
   */
  interceptDebug(...args) {
    if (this.shouldCapture(args)) {
      this.addLog('debug', args)
    }
    this.originalConsole.debug.apply(console, args)
  }

  /**
   * Intercepta console.info
   */
  interceptInfo(...args) {
    if (this.shouldCapture(args)) {
      this.addLog('info', args)
    }
    this.originalConsole.info.apply(console, args)
  }

  /**
   * Ativa captura de logs
   */
  enable() {
    if (this.enabled) return
    
    this.enabled = true
    console.log = this.interceptLog.bind(this)
    console.warn = this.interceptWarn.bind(this)
    console.error = this.interceptError.bind(this)
    console.debug = this.interceptDebug.bind(this)
    console.info = this.interceptInfo.bind(this)
    
    console.log('[LogCapture] ✅ Captura de logs ativada')
  }

  /**
   * Desativa captura de logs
   */
  disable() {
    if (!this.enabled) return
    
    this.enabled = false
    console.log = this.originalConsole.log
    console.warn = this.originalConsole.warn
    console.error = this.originalConsole.error
    console.debug = this.originalConsole.debug
    console.info = this.originalConsole.info
    
    console.log('[LogCapture] ❌ Captura de logs desativada')
  }

  /**
   * Limpa histórico de logs
   */
  clear() {
    this.logs = []
    console.log('[LogCapture] 🗑️ Histórico de logs limpo')
  }

  /**
   * Obtém todos os logs
   */
  getLogs() {
    return [...this.logs]
  }

  /**
   * Obtém estatísticas dos logs
   */
  getStats() {
    const total = this.logs.length
    const byLevel = {
      log: 0,
      warn: 0,
      error: 0,
      debug: 0,
      info: 0
    }

    this.logs.forEach(log => {
      byLevel[log.level] = (byLevel[log.level] || 0) + 1
    })

    return {
      total,
      byLevel,
      enabled: this.enabled
    }
  }

  /**
   * Exporta logs em formato texto (para compartilhar)
   */
  exportAsText() {
    const lines = [
      '='.repeat(80),
      'RELATÓRIO DE LOGS - Sales Game',
      '='.repeat(80),
      `Data/Hora: ${new Date().toISOString()}`,
      `Total de logs: ${this.logs.length}`,
      `Estatísticas: ${JSON.stringify(this.getStats(), null, 2)}`,
      '='.repeat(80),
      ''
    ]

    this.logs.forEach(log => {
      const levelSymbol = {
        log: '📝',
        warn: '⚠️',
        error: '❌',
        debug: '🔍',
        info: 'ℹ️'
      }[log.level] || '📝'

      lines.push(`[${log.time}] ${levelSymbol} [${log.level.toUpperCase()}]`)
      log.args.forEach((arg, idx) => {
        if (typeof arg === 'object') {
          lines.push(`  Arg ${idx + 1}: ${JSON.stringify(arg, null, 2)}`)
        } else {
          lines.push(`  Arg ${idx + 1}: ${arg}`)
        }
      })
      lines.push('')
    })

    return lines.join('\n')
  }

  /**
   * Exporta logs em formato JSON (para análise programática)
   */
  exportAsJSON() {
    return {
      timestamp: new Date().toISOString(),
      stats: this.getStats(),
      logs: this.logs
    }
  }

  /**
   * Exporta logs completos (texto + JSON)
   */
  exportFull() {
    return {
      timestamp: new Date().toISOString(),
      stats: this.getStats(),
      text: this.exportAsText(),
      json: this.exportAsJSON()
    }
  }
}

// Instância global
export const logCapture = new LogCapture()

// Funções de conveniência
export const enableLogCapture = () => logCapture.enable()
export const disableLogCapture = () => logCapture.disable()
export const clearLogs = () => logCapture.clear()
export const getLogs = () => logCapture.getLogs()
export const getLogStats = () => logCapture.getStats()
export const exportLogsAsText = () => logCapture.exportAsText()
export const exportLogsAsJSON = () => logCapture.exportAsJSON()
export const exportLogsFull = () => logCapture.exportFull()

