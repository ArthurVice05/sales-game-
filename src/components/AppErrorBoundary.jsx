import React from 'react'

export default class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    try {
      window.__SG_REPORT_BOOT_ERROR__?.('CLIENT_RENDER_CRASH', error?.message || String(error), {
        componentStack: String(info?.componentStack || '').slice(0, 500),
      })
    } catch {}
    console.error('[CLIENT_ERROR] React render crash', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <main style={styles.page} role="alert">
        <section style={styles.card}>
          <h1 style={styles.title}>O jogo encontrou um problema</h1>
          <p style={styles.text}>
            Sua sala continua salva. Tente recarregar ou volte à entrada para abrir a sala novamente.
          </p>
          <div style={styles.actions}>
            <button type="button" style={styles.primary} onClick={() => window.location.reload()}>
              Tentar novamente
            </button>
            <button
              type="button"
              style={styles.secondary}
              onClick={() => {
                if (typeof window.__SG_LEAVE_STUCK_ROOM__ === 'function') {
                  window.__SG_LEAVE_STUCK_ROOM__()
                } else {
                  window.location.replace('/')
                }
              }}
            >
              Voltar à entrada
            </button>
          </div>
        </section>
      </main>
    )
  }
}

const styles = {
  page: {
    minHeight: '100%', display: 'grid', placeItems: 'center', padding: 24,
    background: '#071426', color: '#fff', fontFamily: 'Arial, sans-serif',
  },
  card: {
    width: 'min(520px, 100%)', padding: 24, border: '1px solid #334766',
    borderRadius: 16, background: '#101d33', textAlign: 'center',
  },
  title: { margin: '0 0 12px', fontSize: 24 },
  text: { margin: '0 0 18px', lineHeight: 1.5, color: '#d8e2f1' },
  actions: { display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' },
  primary: {
    minHeight: 44, padding: '10px 16px', border: 0, borderRadius: 10,
    background: '#5147e9', color: '#fff', fontWeight: 700, cursor: 'pointer',
  },
  secondary: {
    minHeight: 44, padding: '10px 16px', border: '1px solid #7082a0', borderRadius: 10,
    background: '#1d2a40', color: '#fff', fontWeight: 700, cursor: 'pointer',
  },
}
