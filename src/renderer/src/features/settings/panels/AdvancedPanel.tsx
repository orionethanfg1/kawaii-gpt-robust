/**
 * M3 — AdvancedPanel
 */
import { Stethoscope, Loader2 } from 'lucide-react'
import { Button } from '@shared/ui/Button'
import { AppMemoryPanel } from '../AppMemoryPanel'
import { useSettingsUi } from './SettingsUiContext'

export function AdvancedPanel() {
  const {
    settings,
    update,
    diag,
    diagRunning,
    runDiag,
    repairImageStack,
    probeNetworkOnly
  } = useSettingsUi()

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-kawaii-border p-3 space-y-2 bg-white/70">
        <p className="text-xs font-semibold">Búsqueda web · SearXNG</p>
        <p className="text-[10px] text-kawaii-text-muted">
          Opcional: URL de SearXNG local (p. ej. http://127.0.0.1:8080). Mejora hits reales. Ver
          docs/SEARXNG.md.
        </p>
        <input
          className="input-kawaii text-sm w-full"
          placeholder="http://127.0.0.1:8080"
          value={(settings as { searxngBaseUrl?: string }).searxngBaseUrl || ''}
          onChange={(e) => update({ searxngBaseUrl: e.target.value } as never)}
        />
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={settings.webSearchEnabled !== false}
            onChange={(e) => update({ webSearchEnabled: e.target.checked })}
          />
          Búsqueda web habilitada
        </label>
      </div>

      <div
        id="settings-advanced"
        className="scroll-mt-4 border border-kawaii-border rounded-kawaii p-3 space-y-2"
      >
        <div className="flex items-center justify-between flex-wrap gap-1">
          <h3 className="font-bold text-sm flex items-center gap-1">
            <Stethoscope className="w-4 h-4" /> Autodiagnóstico
          </h3>
          <div className="flex items-center gap-1 flex-wrap">
            <Button
              variant="ghost"
              className="text-xs"
              disabled={diagRunning}
              onClick={() => void probeNetworkOnly()}
            >
              Probar red
            </Button>
            <Button
              variant="ghost"
              className="text-xs"
              disabled={diagRunning}
              onClick={() => void runDiag()}
            >
              {diagRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              Ejecutar
            </Button>
            <Button
              variant="ghost"
              className="text-xs"
              disabled={diagRunning}
              onClick={() => void repairImageStack()}
            >
              Reparar capa de imágenes
            </Button>
          </div>
        </div>
        {diag && (
          <ul className="space-y-1 text-xs">
            {diag.checks.map((c) => (
              <li key={c.id} className="flex gap-2">
                <span>
                  {c.status === 'ok' ? '✅' : c.status === 'warn' ? '⚠️' : '❌'}
                </span>
                <span>
                  <strong>{c.label}</strong>: {c.detail}
                  {c.repaired ? ' (reparado)' : ''}
                  {c.repairAction ? (
                    <span className="block text-kawaii-text-muted">→ {c.repairAction}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <AppMemoryPanel />
    </div>
  )
}
