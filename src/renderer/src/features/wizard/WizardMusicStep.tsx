import { useState } from 'react'
import { Music2 } from 'lucide-react'
import { Button } from '@shared/ui/Button'
import { NavRow } from './WizardShared'

export interface MusicSetupStatus {
  musicSummary: string
  musicEligible: boolean
  musicInstalled: boolean
  musicApiRunning: boolean
}

interface Props {
  status: MusicSetupStatus
  onStatusChange: (patch: Partial<MusicSetupStatus>) => void
  musicWanted: boolean
  setMusicWanted: (wanted: boolean) => void
  onBack: () => void
  onNext: () => void
}

export function WizardMusicStep({
  status,
  onStatusChange,
  musicWanted,
  setMusicWanted,
  onBack,
  onNext
}: Props) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  return (
    <div className="card-kawaii p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Music2 className="w-5 h-5 text-violet-600" />
        <div>
          <h2 className="text-xl font-extrabold text-kawaii-text">Música local (ACE-Step)</h2>
          <p className="text-xs text-kawaii-text-muted">
            Genera canciones en el chat. YuE solo si hay ≥16&nbsp;GB VRAM; si no, se omite solo.
          </p>
        </div>
      </div>
      {status.musicSummary ? (
        <p className="text-[11px] rounded-kawaii border border-kawaii-border bg-white p-2">
          {status.musicSummary}
        </p>
      ) : (
        <p className="text-[11px] text-kawaii-text-muted">
          Analiza el PC o instala desde aquí. La primera vez descarga varios GB.
        </p>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={musicWanted}
          onChange={(event) => setMusicWanted(event.target.checked)}
        />
        Quiero generar música desde el chat
      </label>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="ghost"
          className="text-xs"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            setMessage('Analizando…')
            try {
              const result = await window.kawaii?.musicAnalyze?.()
              const resultState = (
                result as {
                  state?: { eligibility?: { summary?: string }; ace?: { present?: boolean } }
                }
              )?.state
              const summary =
                resultState?.eligibility?.summary ||
                (result as { eligibility?: { summary?: string } })?.eligibility?.summary ||
                'Análisis listo'
              setMessage(summary)
              onStatusChange({
                musicSummary: summary,
                musicEligible: true,
                musicInstalled: Boolean(resultState?.ace?.present)
              })
            } catch (error) {
              setMessage(error instanceof Error ? error.message : String(error))
            } finally {
              setBusy(false)
            }
          }}
        >
          Analizar PC
        </Button>
        <Button
          variant="ghost"
          className="text-xs"
          disabled={busy || !musicWanted}
          onClick={async () => {
            setBusy(true)
            setMessage('Instalando ACE-Step (puede tardar mucho)…')
            try {
              await window.kawaii?.musicInstall?.({})
              const result = await window.kawaii?.musicStatus?.()
              onStatusChange({
                musicInstalled: true,
                musicSummary:
                  (result as { eligibility?: { summary?: string } })?.eligibility?.summary ||
                  status.musicSummary
              })
              setMessage('Instalación terminada (o reanudada)')
            } catch (error) {
              setMessage(error instanceof Error ? error.message : String(error))
            } finally {
              setBusy(false)
            }
          }}
        >
          Instalar ACE-Step
        </Button>
        <Button
          variant="ghost"
          className="text-xs"
          disabled={busy || !musicWanted}
          onClick={async () => {
            setBusy(true)
            setMessage('Arrancando API…')
            try {
              const result = await window.kawaii?.musicEnsureReady?.()
              const running = (result as { state?: string })?.state === 'running'
              onStatusChange({ musicApiRunning: running })
              setMessage(String((result as { message?: string })?.message || 'Listo'))
            } catch (error) {
              setMessage(error instanceof Error ? error.message : String(error))
            } finally {
              setBusy(false)
            }
          }}
        >
          Arrancar motor
        </Button>
      </div>
      {message ? (
        <p className="text-[11px] text-violet-900 bg-violet-50 border border-violet-100 rounded p-2">
          {busy ? '⏳ ' : ''}
          {message}
        </p>
      ) : null}
      <p className="text-[10px] text-kawaii-text-muted">
        También puedes hacerlo después en Ajustes → Capas → Música.
      </p>
      <NavRow onBack={onBack} onNext={onNext} nextLabel="Continuar" />
    </div>
  )
}
