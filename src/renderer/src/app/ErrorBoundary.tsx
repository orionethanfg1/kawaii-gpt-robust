import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** Nombre del módulo para mensajes (ej. "Chat", "Asistente") */
  name?: string
  /** UI mínima si falla un módulo secundario */
  fallback?: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Aísla fallos de render: un feature roto no tumba toda la app.
 * Best practice: boundaries por área (shell / chat / wizard / settings).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary${this.props.name ? `:${this.props.name}` : ''}]`, error, info.componentStack)
  }

  private reset = () => {
    this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    if (this.props.fallback) {
      return (
        <div className="p-4">
          {this.props.fallback}
          <button
            type="button"
            className="mt-2 text-sm text-kawaii-pink-deep underline"
            onClick={this.reset}
          >
            Reintentar
          </button>
        </div>
      )
    }

    return (
      <div className="min-h-full flex items-center justify-center p-6 bg-kawaii-cream">
        <div className="max-w-lg w-full rounded-2xl border border-kawaii-border bg-white p-5 shadow-kawaii space-y-3">
          <h2 className="text-lg font-bold text-kawaii-text">
            Algo falló{this.props.name ? ` en ${this.props.name}` : ''}
          </h2>
          <p className="text-sm text-kawaii-text-muted leading-relaxed">
            La interfaz no se pudo dibujar. Puedes reintentar o recargar la ventana.
            Si sigue en blanco, copia el mensaje de error de la terminal donde corre
            <code className="mx-1">npm run dev</code>.
          </p>
          <pre className="text-[11px] bg-kawaii-pink-soft/40 rounded-lg p-3 overflow-auto max-h-40 text-red-800 whitespace-pre-wrap">
            {error.message}
          </pre>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-kawaii text-sm"
              onClick={this.reset}
            >
              Reintentar
            </button>
            <button
              type="button"
              className="btn-kawaii-ghost text-sm"
              onClick={() => window.location.reload()}
            >
              Recargar ventana
            </button>
          </div>
        </div>
      </div>
    )
  }
}
