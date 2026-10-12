/**
 * Models tab — LLM / Image / Audio by layer.
 * Enable/disable for Auto router, pull/delete Ollama, open model folders.
 */
import { useCallback, useEffect, useState } from 'react'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'
import { discoverLocalModelsFull } from '@core/providers'
import {
  isLocalModelDisabled,
  toggleDisabledLocalModel
} from '@core/models/disabled-local-models'
import { LocalSdModelsPanel } from '../LocalSdModelsPanel'

type LayerModel = {
  id: string
  name: string
  source?: string
  sizeHint?: string
  layer: 'llm' | 'vision' | 'image' | 'audio' | 'other'
}

function classifyModel(id: string, name?: string): LayerModel['layer'] {
  const s = `${id} ${name || ''}`.toLowerCase()
  if (/moondream|llava|vision|mmproj|minicpm-v|qwen2-vl|qwen2\.5-vl/.test(s)) return 'vision'
  if (/embed|nomic-embed|bge-|e5-/.test(s)) return 'other'
  if (/ace|musicgen|audio|tts|whisper|bark/.test(s)) return 'audio'
  if (/\.safetensors|sd15|sdxl|checkpoint|lora|vae|controlnet/.test(s)) return 'image'
  return 'llm'
}


async function openFolder(kind: 'ollama' | 'forge' | 'music' | 'lmstudio') {
  try {
    const r = await window.kawaii?.modelsOpenLayerFolder?.(kind)
    if (r?.ok && r.path) {
      // soft feedback for music pending
      if (kind === 'music' && r.note && /aún no instalado/i.test(r.note)) {
        alert(r.note + '\n\nSe abrió: ' + r.path)
      }
      return
    }
    alert(
      (r?.error || r?.note || 'No se pudo abrir la carpeta') +
        (r?.path ? '\n\nRuta esperada: ' + r.path : '')
    )
  } catch (e) {
    console.warn('[ModelsPanel] openFolder', e)
    alert('No se pudo abrir la carpeta: ' + (e instanceof Error ? e.message : String(e)))
  }
}


export function ModelsPanel() {
  const settings = useSettingsStore((s) => s.settings)
  const update = useSettingsStore((s) => s.update)
  const disabled = settings.disabledLocalModels || []
  const [llmModels, setLlmModels] = useState<LayerModel[]>([])
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [pullId, setPullId] = useState('')
  const [actionMsg, setActionMsg] = useState<string | null>(null)
  const [layerPaths, setLayerPaths] = useState<
    Array<{ layer: string; path: string; exists: boolean; note: string; pendingSetup?: boolean }>
  >([])

  const refresh = useCallback(async () => {
    setBusy(true)
    setNote(null)
    try {
      let ram = 32
      try {
        const p = await window.kawaii?.machineEnsureProfile?.()
        const mem = (p as { profile?: { totalMemoryGB?: number } })?.profile?.totalMemoryGB
        if (typeof mem === 'number') ram = mem
      } catch {
        /* */
      }
      const snap = await discoverLocalModelsFull({
        ollamaBaseUrl: settings.localBaseUrl,
        openAIBaseUrl: (settings.localOpenAIBaseUrl || '').trim() || undefined,
        ramGB: ram
      })
      const list: LayerModel[] = (snap.models || []).map((m) => ({
        id: m.id,
        name: m.name || m.id,
        source: m.source,
        sizeHint: m.sizeHint,
        layer: classifyModel(m.id, m.name)
      }))
      setLlmModels(list)
      const bits = [
        snap.ollama ? 'Ollama OK' : null,
        snap.openAI ? 'LM Studio OK' : null,
        snap.diskCount ? `${snap.diskCount} en disco` : null
      ].filter(Boolean)
      setNote(bits.join(' · ') || 'Sin runtime local detectado')
    } catch (e) {
      setNote(String(e))
    } finally {
      setBusy(false)
    }
  }, [settings.localBaseUrl, settings.localOpenAIBaseUrl])

  const refreshPaths = useCallback(async () => {
    try {
      const r = await window.kawaii?.modelsGetLayerPaths?.()
      if (r?.layers) setLayerPaths(r.layers)
    } catch {
      /* */
    }
  }, [])

  useEffect(() => {
    void refresh()
    void refreshPaths()
  }, [refresh, refreshPaths])

  const setEnabled = (id: string, enabled: boolean) => {
    update({
      disabledLocalModels: toggleDisabledLocalModel(disabled, id, enabled)
    })
  }

  const pullModel = async (id: string) => {
    const ref = id.trim()
    if (!ref) return
    setActionMsg('Descargando ' + ref + '…')
    try {
      const r = await window.kawaii?.ollamaPull?.(ref, settings.localBaseUrl)
      setActionMsg(
        r ? `Pull iniciado: ${ref}` : `Pull solicitado: ${ref} (mira la barra de descargas)`
      )
      void refresh()
    } catch (e) {
      setActionMsg('Error al descargar: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  const deleteModel = async (id: string) => {
    if (!confirm(`¿Eliminar el modelo «${id}» del disco (Ollama)? Esta acción no se puede deshacer.`)) {
      return
    }
    setActionMsg('Eliminando…')
    try {
      const r = await window.kawaii?.ollamaDelete?.(id, settings.localBaseUrl)
      setActionMsg(
        (r as { ok?: boolean })?.ok !== false
          ? `Eliminado: ${id}`
          : `No se pudo eliminar: ${JSON.stringify(r).slice(0, 100)}`
      )
      void refresh()
    } catch (e) {
      setActionMsg('Error: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  const byLayer = (layer: LayerModel['layer']) => llmModels.filter((m) => m.layer === layer)

  const renderLlmList = (models: LayerModel[], title: string, folderKind?: 'ollama' | 'lmstudio') => (
    <div className="border border-kawaii-border rounded-kawaii p-3 space-y-2 bg-white/60">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-semibold text-sm text-kawaii-text">{title}</h4>
        <div className="flex flex-wrap gap-1.5">
          {folderKind ? (
            <button
              type="button"
              className="text-[11px] px-2 py-0.5 rounded-full border border-kawaii-border hover:bg-pink-50"
              onClick={() => void openFolder(folderKind)}
            >
              Abrir carpeta
            </button>
          ) : null}
        </div>
      </div>
      {models.length === 0 ? (
        <p className="text-[11px] text-kawaii-text-muted">Ningún modelo en esta capa (o runtime apagado).</p>
      ) : (
        <ul className="space-y-1.5 max-h-56 overflow-y-auto">
          {models.map((m) => {
            const on = !isLocalModelDisabled(m.id, disabled)
            return (
              <li
                key={m.id}
                className="flex flex-wrap items-center gap-2 text-[11px] border border-kawaii-border/60 rounded-lg px-2 py-1.5 bg-white"
              >
                <label className="flex items-center gap-1.5 min-w-0 flex-1">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) => setEnabled(m.id, e.target.checked)}
                    title={on ? 'Auto puede usarlo' : 'Excluido del selector Auto'}
                  />
                  <span className="font-medium truncate" title={m.id}>
                    {m.name || m.id}
                  </span>
                  <span className="text-kawaii-text-muted shrink-0">
                    {m.source || ''}
                    {m.sizeHint ? ` · ${m.sizeHint}` : ''}
                  </span>
                </label>
                <button
                  type="button"
                  className="text-[10px] px-1.5 py-0.5 rounded border border-kawaii-border text-kawaii-text-muted hover:text-red-600"
                  onClick={() => void deleteModel(m.id)}
                >
                  Desinstalar
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <p className="text-[10px] text-kawaii-text-muted">
        Desmarcar = el modo <strong>Auto</strong> del chat no lo elige. El modelo fijado en Proveedores sigue
        respetándose.
      </p>
    </div>
  )

  return (
    <div id="settings-models" className="scroll-mt-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-bold text-sm text-kawaii-text">Modelos por capa</h3>
          <p className="text-[10px] text-kawaii-text-muted max-w-xl mt-0.5">
            LLM y visión alimentan el chat. Imagen es Forge/SD. Audio es música/voz cuando la capa esté
            activa. Habilitar/deshabilitar solo afecta al selector inteligente.
          </p>
          {note ? <p className="text-[10px] text-violet-700 mt-1">{note}</p> : null}
          {actionMsg ? <p className="text-[10px] text-kawaii-text mt-1">{actionMsg}</p> : null}
        </div>
        <button
          type="button"
          className="text-[11px] px-2.5 py-1 rounded-full border border-kawaii-border bg-white hover:bg-pink-50"
          disabled={busy}
          onClick={() => void refresh()}
        >
          {busy ? 'Actualizando…' : 'Actualizar lista'}
        </button>
      </div>

      {layerPaths.length > 0 ? (
        <div className="text-[10px] text-kawaii-text-muted border border-kawaii-border/60 rounded-lg p-2 space-y-1 bg-white/50">
          <div className="font-semibold text-kawaii-text text-[11px]">Rutas detectadas</div>
          {layerPaths.map((L) => (
            <div key={L.layer} className="flex flex-wrap gap-1 items-baseline">
              <span className="font-medium text-kawaii-text w-16">{L.layer}</span>
              <span className={L.exists && !L.pendingSetup ? 'text-emerald-700' : 'text-amber-700'}>
                {L.exists ? (L.pendingSetup ? 'workspace' : 'OK') : 'no encontrado'}
              </span>
              <span className="truncate max-w-[28rem]" title={L.path}>
                {L.path || '—'}
              </span>
              <span className="text-kawaii-text-muted">{L.note}</span>
            </div>
          ))}
        </div>
      ) : null}

      {/* Download */}
      <div className="flex flex-wrap gap-2 items-center border border-kawaii-border rounded-kawaii p-2 bg-violet-50/40">
        <input
          className="input-kawaii text-[11px] flex-1 min-w-[12rem]"
          placeholder="Descargar (Ollama): qwen2.5:14b"
          value={pullId}
          onChange={(e) => setPullId(e.target.value)}
        />
        <button
          type="button"
          className="text-[11px] px-2.5 py-1 rounded-full bg-kawaii-pink-soft border border-kawaii-pink-deep/30 font-semibold"
          onClick={() => void pullModel(pullId)}
        >
          Descargar
        </button>
      </div>

      {renderLlmList(byLayer('llm'), '💬 LLM (Ollama + LM Studio)', 'ollama')}
      <div className="flex flex-wrap gap-1.5 -mt-1">
        <button
          type="button"
          className="text-[11px] px-2 py-0.5 rounded-full border border-kawaii-border hover:bg-pink-50"
          onClick={() => void openFolder('ollama')}
        >
          Carpeta Ollama
        </button>
        <button
          type="button"
          className="text-[11px] px-2 py-0.5 rounded-full border border-kawaii-border hover:bg-pink-50"
          onClick={() => void openFolder('lmstudio')}
        >
          Carpeta LM Studio
        </button>
      </div>
      {renderLlmList(byLayer('vision'), '👁 Visión (multimodal)')}
      {byLayer('other').length > 0
        ? renderLlmList(byLayer('other'), '📎 Otros (embeddings, etc.)')
        : null}

      <div className="border border-kawaii-border rounded-kawaii p-3 space-y-2 bg-white/60">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="font-semibold text-sm">🖼 Imagen (Forge / SD)</h4>
          <button
            type="button"
            className="text-[11px] px-2 py-0.5 rounded-full border border-kawaii-border hover:bg-pink-50"
            onClick={() => void openFolder('forge')}
          >
            Abrir carpeta
          </button>
        </div>
        <LocalSdModelsPanel />
      </div>

      <div className="border border-kawaii-border rounded-kawaii p-3 space-y-2 bg-white/60">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="font-semibold text-sm">🎵 Audio / música</h4>
          <button
            type="button"
            className="text-[11px] px-2 py-0.5 rounded-full border border-kawaii-border hover:bg-pink-50"
            onClick={() => void openFolder('music')}
          >
            Abrir carpeta
          </button>
        </div>
        <p className="text-[11px] text-kawaii-text-muted">
          Los pesos de ACE / música se gestionan desde la pestaña Capas (arrancar/detener). Aquí puedes abrir
          la carpeta del workspace cuando esté configurada.
        </p>
      </div>

      <div className="border border-kawaii-border rounded-kawaii p-3 space-y-1 bg-white/50">
        <h4 className="font-semibold text-sm">LM Studio</h4>
        <p className="text-[11px] text-kawaii-text-muted">
          Los modelos listados arriba con origen LM Studio se habilitan/deshabilitan igual. Para
          instalar/desinstalar pesos de LM Studio usa su propia app; aquí puedes abrir la carpeta de
          caché.
        </p>
        <button
          type="button"
          className="text-[11px] px-2 py-0.5 rounded-full border border-kawaii-border hover:bg-pink-50"
          onClick={() => void openFolder('lmstudio')}
        >
          Abrir carpeta LM Studio
        </button>
      </div>
    </div>
  )
}
