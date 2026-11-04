import { useCallback, useEffect, useState } from 'react'
import {
  discoverLocalModelsFull,
  type LocalModelEntry
} from '@core/providers'
import { applySmartLocalModelAuto } from '@features/chat/services/appAgent'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'

export function LocalModelPicker() {
  const settings = useSettingsStore((s) => s.settings)
  const update = useSettingsStore((s) => s.update)
  const [models, setModels] = useState<LocalModelEntry[]>([])
  const [label, setLabel] = useState(settings.localRuntimeLabel || '')
  const [busy, setBusy] = useState(false)
  const [lmNote, setLmNote] = useState<string | null>(null)

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
      const snap = await discoverLocalModelsFull({
        ollamaBaseUrl: settings.localBaseUrl,
        openAIBaseUrl: (settings.localOpenAIBaseUrl || '').trim() || undefined,
        ramGB: ram
      })
      setModels(snap.models)
      const lm = snap.lmStudio
      setLmNote(lm ? lm.message : null)
      const rt = [
        snap.ollama ? 'Ollama' : null,
        snap.openAI
          ? `LM Studio${lm?.port ? ` :${lm.port}` : ''}`
          : lm && !lm.ok
            ? null
            : null,
        snap.diskCount ? `${snap.diskCount} en disco` : null
      ]
        .filter(Boolean)
        .join(' + ')
      setLabel(rt || 'Ningún runtime local')
      if (snap.openAI?.baseUrl) {
        // Always sync detected port so chat uses the live server
        update({ localOpenAIBaseUrl: snap.openAI.baseUrl })
      }
      if (snap.recommended && !(settings.localModel || '').trim()) {
        update({
          localModel: snap.recommended.id,
          localRuntimeLabel: `${snap.recommended.source}: ${snap.recommended.name}`,
          localRuntimePreference:
            snap.recommended.source === 'ollama' || snap.recommended.source === 'ollama-disk'
              ? 'ollama'
              : 'openai-compatible'
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
      <div className="flex flex-wrap gap-1.5">
        {(
          [
            { id: 'auto' as const, label: 'Auto' },
            { id: 'ollama' as const, label: 'Solo Ollama' },
            { id: 'openai-compatible' as const, label: 'Solo LM Studio' }
          ]
        ).map((o) => (
          <button
            key={o.id}
            type="button"
            className={
              'text-[10px] px-2 py-0.5 rounded-full border ' +
              ((settings.localRuntimePreference || 'auto') === o.id
                ? 'border-kawaii-pink-deep bg-kawaii-pink-soft/50 text-kawaii-text'
                : 'border-kawaii-border text-kawaii-text-muted')
            }
            onClick={() => update({ localRuntimePreference: o.id })}
          >
            {o.label}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-kawaii-text-muted">
          Runtime: {label || '…'}{settings.localModelPinned ? ' · fijado' : ' · auto-ruta'}
        </p>
        <button
          type="button"
          className="text-[10px] text-kawaii-pink-deep hover:underline"
          onClick={() => void refresh()}
          disabled={busy}
        >
          {busy ? 'Detectando…' : 'Detectar Ollama / LM Studio / disco'}
        </button>
        <button
          type="button"
          className="text-[10px] text-kawaii-pink-deep hover:underline font-semibold"
          disabled={busy}
          onClick={() => {
            void (async () => {
              setBusy(true)
              try {
                const r = await applySmartLocalModelAuto()
            try {
              update({ localModelPinned: false })
            } catch {
              /* */
            }
                setLabel(
                  r.ok
                    ? `Auto → ${r.model}${settings.localModelPinned ? '' : ''}`
                    : r.reason
                )
                await refresh()
              } finally {
                setBusy(false)
              }
            })()
          }}
          title="Elige el local más apto para chat según tu RAM (no siempre el más grande)"
        >
          Auto (mejor local)
        </button>
      </div>
      {models.length > 0 ? (
        <select
          className="input-kawaii w-full text-sm"
          value={settings.localModel || ''}
          onChange={(e) => {
            const id = e.target.value
            const m = models.find((x) => x.id === id)
            const isOllama = m?.source === 'ollama' || m?.source === 'ollama-disk'
            update({
              localModel: id,
              localModelPinned: Boolean(id),
              localRuntimeLabel: m ? `${m.source}: ${m.name}` : settings.localRuntimeLabel,
              ...(m && !isOllama
                ? {
                    ...(m.baseUrl ? { localOpenAIBaseUrl: m.baseUrl } : {}),
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
              {m.name}
              {m.source.includes('disk') ? ' · disco' : ` · ${m.source}`}
              {m.sizeHint ? ` · ${m.sizeHint}` : ''}
            </option>
          ))}
        </select>
      ) : (
        <input
          className="input-kawaii w-full text-sm"
          value={settings.localModel}
          onChange={(e) =>
            update({
              localModel: e.target.value,
              localModelPinned: Boolean(e.target.value.trim())
            })
          }
          placeholder="qwen2.5:14b o id de LM Studio"
        />
      )}
      {lmNote ? (
        <p
          className={
            'text-[10px] ' +
            (lmNote.includes('no está') || lmNote.includes('detenido')
              ? 'text-amber-700'
              : 'text-emerald-700')
          }
        >
          {lmNote}
        </p>
      ) : null}
      <p className="text-[10px] text-kawaii-text-muted">
        Ollama y LM Studio se detectan en vivo (puerto de LM Studio automático). También se listan
        modelos en disco aunque el servidor esté parado.
      </p>
    </div>
  )
}
