import { useCallback, useEffect, useState } from 'react'
import {
  discoverLocalModels,
  type LocalModelEntry
} from '@core/providers'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'

export function LocalModelPicker() {
  const settings = useSettingsStore((s) => s.settings)
  const update = useSettingsStore((s) => s.update)
  const [models, setModels] = useState<LocalModelEntry[]>([])
  const [label, setLabel] = useState(settings.localRuntimeLabel || '')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    setBusy(true)
    try {
      let ram = 32
      try {
        const p = await window.kawaii?.machineEnsureProfile?.()
        const mem = (p as { profile?: { totalMemoryGB?: number } })?.profile?.totalMemoryGB
        if (typeof mem === 'number') ram = mem
      } catch {
        /* ignore */
      }
      const snap = await discoverLocalModels({
        ollamaBaseUrl: settings.localBaseUrl,
        openAIBaseUrl: (settings.localOpenAIBaseUrl || '').trim() || undefined,
        ramGB: ram
      })
      setModels(snap.models)
      const rt = [
        snap.ollama ? 'Ollama' : null,
        snap.openAI ? snap.openAI.label : null
      ]
        .filter(Boolean)
        .join(' + ')
      setLabel(rt || 'Ningún runtime local')
      if (snap.openAI?.baseUrl && !(settings.localOpenAIBaseUrl || '').trim()) {
        update({ localOpenAIBaseUrl: snap.openAI.baseUrl })
      }
      if (snap.recommended && !(settings.localModel || '').trim()) {
        update({
          localModel: snap.recommended.id,
          localRuntimeLabel: `${snap.recommended.source}: ${snap.recommended.name}`,
          localRuntimePreference:
            snap.recommended.source === 'ollama' ? 'ollama' : 'openai-compatible'
        })
      }
    } finally {
      setBusy(false)
    }
  }, [settings.localBaseUrl, settings.localOpenAIBaseUrl, settings.localModel, update])

  useEffect(() => {
    void refresh()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-kawaii-text-muted">
          Runtime: {label || '…'}
        </p>
        <button
          type="button"
          className="text-[10px] text-kawaii-pink-deep hover:underline"
          onClick={() => void refresh()}
          disabled={busy}
        >
          {busy ? 'Detectando…' : 'Detectar Ollama / LM Studio'}
        </button>
      </div>
      {models.length > 0 ? (
        <select
          className="input-kawaii w-full text-sm"
          value={settings.localModel || ''}
          onChange={(e) => {
            const id = e.target.value
            const m = models.find((x) => x.id === id)
            update({
              localModel: id,
              localRuntimeLabel: m ? `${m.source}: ${m.name}` : settings.localRuntimeLabel,
              ...(m && m.source !== 'ollama'
                ? {
                    localOpenAIBaseUrl: m.baseUrl,
                    localRuntimePreference: 'openai-compatible' as const
                  }
                : m
                  ? { localRuntimePreference: 'ollama' as const }
                  : {})
            })
          }}
        >
          <option value="">— elegir modelo —</option>
          {models.map((m) => (
            <option key={`${m.source}-${m.id}`} value={m.id}>
              {m.name} · {m.source}
              {m.paramsB ? ` · ~${m.paramsB}B` : ''}
            </option>
          ))}
        </select>
      ) : (
        <input
          className="input-kawaii w-full text-sm"
          value={settings.localModel}
          onChange={(e) => update({ localModel: e.target.value })}
          placeholder="qwen2.5:14b o id de LM Studio"
        />
      )}
      <p className="text-[10px] text-kawaii-text-muted">
        LM Studio: Developer → Start Server (http://127.0.0.1:1234). Bionic es el asistente de LM
        Studio; los modelos se usan vía el mismo servidor API.
      </p>
    </div>
  )
}
