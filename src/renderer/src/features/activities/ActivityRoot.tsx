import { Component, type ErrorInfo, type ReactNode } from 'react'
import { ChessActivityView } from './ChessActivityView'
import { AdventureActivityView } from './AdventureActivityView'

class ActivityErrorBoundary extends Component<
  { children: ReactNode },
  { error: string | null }
> {
  state = { error: null as string | null }

  static getDerivedStateFromError(err: Error) {
    return { error: err?.message || String(err) }
  }

  componentDidCatch(err: Error, info: ErrorInfo) {
    console.error('[ActivityRoot]', err, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            minHeight: '100vh',
            padding: 24,
            fontFamily: 'system-ui,sans-serif',
            background: '#1c1917',
            color: '#fef3c7'
          }}
        >
          <h1 style={{ fontSize: 18 }}>Error en la actividad</h1>
          <pre
            style={{
              marginTop: 12,
              padding: 12,
              background: '#292524',
              borderRadius: 8,
              fontSize: 12,
              whiteSpace: 'pre-wrap'
            }}
          >
            {this.state.error}
          </pre>
          <button
            type="button"
            style={{
              marginTop: 16,
              padding: '8px 16px',
              borderRadius: 8,
              border: 'none',
              background: '#d97706',
              color: '#1c1917',
              fontWeight: 600,
              cursor: 'pointer'
            }}
            onClick={() => window.location.reload()}
          >
            Recargar ventana
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

export function ActivityRoot({ kind }: { kind: string }) {
  return (
    <ActivityErrorBoundary>
      <div className="min-h-screen bg-stone-950 text-amber-50">
        {kind === 'chess' ? <ChessActivityView /> : <AdventureActivityView />}
      </div>
    </ActivityErrorBoundary>
  )
}

export function readActivityKindFromHash(): string | null {
  if (typeof window === 'undefined') return null
  const h = window.location.hash || ''
  const m = h.match(/#\/activity\/([a-z]+)/i)
  return m ? m[1].toLowerCase() : null
}
