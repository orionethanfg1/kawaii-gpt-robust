import { pickBestCheckpoint } from '@core/generative/smart-checkpoint'
import { recommendSdParams } from '@core/generative/prompt-compose'
import { useEffect, useId, useRef, useState } from 'react'
import { FolderOpen, Image as ImageIcon, Loader2, Square, X } from 'lucide-react'
import {
  activityProgress,
  activitySuccess,
  activityError,
  activityInfo
} from '@shared/lib/stores/activityStore'
import { Button } from '@shared/ui/Button'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'
import { useChatStore } from '@shared/lib/stores/chatStore'
import { recommendImageStack, resolveImageRoute } from '@core/image'
import { useDownloadStore } from '@features/models/downloadStore'
import { ModelsStatusPanel } from '@features/models/ModelsStatusPanel'

interface Props {
  open: boolean
  onClose: () => void
  initialPrompt?: string
  bridgedNegative?: string
  bridgedWidth?: number
  bridgedHeight?: number
  bridgedSeed?: number
  promptAlreadyBridged?: boolean
}

const DEFAULT_NEGATIVE =
  'low quality, blurry, deformed hands, extra fingers, watermark, text, logo, bad anatomy, worst quality'

/** Aspect presets — names shown in UI */
const ASPECT_PRESETS: { id: string; label: string; w: number; h: number }[] = [
  { id: '1:1-1024', label: '1:1 · 1024', w: 1024, h: 1024 },
  { id: '1:1-768', label: '1:1 · 768', w: 768, h: 768 },
  { id: '16:9', label: '16:9 landscape', w: 1024, h: 576 },
  { id: '9:16', label: '9:16 portrait', w: 576, h: 1024 },
  { id: '4:3', label: '4:3', w: 1024, h: 768 },
  { id: '3:4', label: '3:4', w: 768, h: 1024 },
  { id: '3:2', label: '3:2', w: 1152, h: 768 },
  { id: '2:3', label: '2:3', w: 768, h: 1152 }
]

function enhancePrompt(raw: string, styleHint?: string): string {
  let p = raw.trim().replace(/\s+/g, ' ')
  if (!p) return p
  // Keep user intent first; append quality/style for precision (English tags work best on SD/Pollinations)
  const lower = p.toLowerCase()
  const isPhoto =
    /\b(foto|photo|realista|realistic|photoreal)\b/i.test(lower) ||
    /\bfoto de\b/i.test(lower)
  const quality = isPhoto
    ? 'photorealistic, natural lighting, detailed skin, high detail, sharp focus'
    : 'masterpiece, best quality, highly detailed, clean lineart, soft lighting'

  // Light Spanish→English subject helpers (does not replace full prompt)
  const hints: string[] = []
  if (/\bpelirroja\b/i.test(p)) hints.push('red hair')
  if (/\bchica\b|\bmujer\b|\bgirl\b/i.test(p)) hints.push('young woman')
  if (/\bhombre\b|\bchico\b/i.test(p)) hints.push('young man')
  if (/\bgato\b/i.test(p)) hints.push('cat')
  if (/\bperro\b/i.test(p)) hints.push('dog')
  if (/\batardecer\b|\bsunset\b/i.test(p)) hints.push('sunset')

  const parts = [p]
  if (hints.length) parts.push(hints.join(', '))
  parts.push(quality)
  if (styleHint) parts.push(styleHint)
  return parts.join(', ')
}

export function ImageGenPanel({
  open,
  onClose,
  initialPrompt = '',
  bridgedNegative,
  bridgedWidth,
  bridgedHeight,
  bridgedSeed,
  promptAlreadyBridged = false
}: Props) {
  const settings = useSettingsStore((s) => s.settings)
  const updateSettings = useSettingsStore((s) => s.update)
  const { activeId, create, addMessage } = useChatStore()

  const [prompt, setPrompt] = useState(initialPrompt)
  const [negative, setNegative] = useState(bridgedNegative || DEFAULT_NEGATIVE)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [busy, setBusy] = useState(false)
  // busy-watchdog: never lock generate button forever
  useEffect(() => {
    if (!busy) return
    const id = window.setTimeout(() => setBusy(false), 240_000)
    return () => window.clearTimeout(id)
  }, [busy])
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{
    dataUrl: string
    meta: string
    filePath?: string
  } | null>(null)
  const jobIdRef = useRef<string | null>(null)
  const inputId = useId()
  const [checkpoints, setCheckpoints] = useState<{ title: string; modelName: string }[]>([])
  const [checkpoint, setCheckpoint] = useState(settings.a1111Checkpoint || '')
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [modelsLoading, setModelsLoading] = useState(false)
  const [localOk, setLocalOk] = useState<boolean | null>(null)
  const [imagesDir, setImagesDir] = useState<string | null>(null)
  const [healthDetail, setHealthDetail] = useState<string | null>(null)
  const [catalog, setCatalog] = useState<
    Array<{
      id: string
      label: string
      approxGB: number
      safety: string
      notes: string
      styles?: string[]
      bestFor?: string
      mergeFriendly?: boolean
    }>
  >([])
  const [stylePref, setStylePref] = useState<'any' | 'photo' | 'anime' | 'art' | 'general'>(
    'any'
  )
  const [safetyPref, setSafetyPref] = useState<'any' | 'safe' | 'flexible'>('any')
  const [dlId, setDlId] = useState<string | null>(null)
  const [dlPct, setDlPct] = useState(0)
  const [installedIds, setInstalledIds] = useState<Record<string, number>>({})
  const [sdRecovery, setSdRecovery] = useState<
    Array<{
      id: string
      label: string
      status: string
      pct: number
      error?: string
    }>
  >([])

  const [width, setWidth] = useState(bridgedWidth || settings.imageWidth || 1024)
  const [height, setHeight] = useState(bridgedHeight || settings.imageHeight || 1024)
  const [aspectId, setAspectId] = useState('1:1-1024')
  const [steps, setSteps] = useState(settings.a1111Steps ?? 20)
  const [cfg, setCfg] = useState(settings.a1111CfgScale ?? 7)
  const [seed, setSeed] = useState<string>(
    bridgedSeed != null ? String(bridgedSeed) : ''
  )
  const [mode, setMode] = useState<'cloud' | 'local' | 'smart'>(
    settings.imageProviderMode === 'local' ||
      settings.imageProviderMode === 'smart' ||
      settings.imageProviderMode === 'cloud'
      ? settings.imageProviderMode
      : 'cloud'
  )

  useEffect(() => {
    if (open && initialPrompt) setPrompt(initialPrompt)
  }, [open, initialPrompt])

  useEffect(() => {
    if (bridgedNegative) setNegative(bridgedNegative)
  }, [bridgedNegative])

  useEffect(() => {
    if (bridgedWidth) setWidth(bridgedWidth)
    if (bridgedHeight) setHeight(bridgedHeight)
  }, [bridgedWidth, bridgedHeight])

  useEffect(() => {
    if (!open) return
    void window.kawaii?.imageGetFolder?.().then((r) => {
      if (r?.ok && r.path) setImagesDir(r.path)
    })
    void window.kawaii?.sdListCheckpointsCatalog?.().then((r) => {
      if (r?.ok && r.models) {
        const seen = new Set<string>()
        const unique = r.models.filter((m) => {
          if (seen.has(m.id)) return false
          seen.add(m.id)
          return true
        })
        setCatalog(unique)
      }
    })
    void window.kawaii?.sdListInstalled?.().then((r) => {
      if (r?.ok && r.models) {
        const map: Record<string, number> = {}
        for (const m of r.models) map[m.id] = m.sizeBytes
        setInstalledIds(map)
      }
    })
    void window.kawaii?.sdListRecovery?.().then((r) => {
      if (r?.ok && r.jobs) {
        setSdRecovery(r.jobs)
        for (const j of r.jobs) {
          const st =
            j.status === 'failed' || j.status === 'cancelled'
              ? 'error'
              : 'paused'
          useDownloadStore.getState().upsert({
            model: `SD:${j.id}`,
            status:
              st === 'error'
                ? j.error || `Falló · ${Math.round(j.pct)}%`
                : `Pausado en disco · ${Math.round(j.pct)}%`,
            progress: j.pct,
            state: st,
            kind: 'sd',
            error: j.error
          })
        }
      }
    })
    const off = window.kawaii?.onSdDownloadProgress?.((p) => {
      const pct = typeof p.pct === 'number' ? p.pct : 0
      setDlPct(pct)
      const label = `SD:${p.modelId || 'checkpoint'}`
      useDownloadStore.getState().upsert({
        model: label,
        status: `Descarga SD · ${Math.round(pct)}%`,
        progress: pct,
        state: 'running',
        kind: 'sd'
      })
    })
    return () => {
      off?.()
    }
  }, [open])

  const probeLocal = async () => {
    try {
      // Prefer live Forge runtime (port may differ from settings)
      let live =
        settings.a1111BaseUrl || 'http://127.0.0.1:7860'
      try {
        const refreshed = await window.kawaii?.forgeRefreshHealth?.()
        if (refreshed?.state === 'running' && refreshed.baseUrl) {
          live = refreshed.baseUrl
          if (live !== settings.a1111BaseUrl) {
            updateSettings({ a1111BaseUrl: live })
          }
        } else {
          const st = await window.kawaii?.forgeStatus?.()
          if (st?.state === 'running' && st.baseUrl) {
            live = st.baseUrl
            if (live !== settings.a1111BaseUrl) {
              updateSettings({ a1111BaseUrl: live })
            }
          }
        }
      } catch {
        /* fall through */
      }
      const h = await window.kawaii?.imageA1111Health?.(live)
      const ok = Boolean(h?.ok)
      setLocalOk(ok)
      if (ok) {
        const url = (h as { baseUrl?: string })?.baseUrl || live
        setHealthDetail(`API OK · ${url}`)
        if (url && url !== settings.a1111BaseUrl) {
          updateSettings({ a1111BaseUrl: url })
        }
      } else {
        setHealthDetail(
          (h as { error?: string })?.error ||
            'Sin respuesta — ¿Forge con --api? Prueba Detectar de nuevo.'
        )
      }
      return ok
    } catch (err) {
      setLocalOk(false)
      setHealthDetail(err instanceof Error ? err.message : String(err))
      return false
    }
  }

  const loadCheckpoints = async () => {
    if (mode !== 'local' && mode !== 'smart') {
      setCheckpoints([])
      return
    }
    setModelsLoading(true)
    setModelsError(null)
    try {
      const live =
        (await window.kawaii?.forgeStatus?.())?.baseUrl || settings.a1111BaseUrl
      const ok = await probeLocal()
      if (!ok) {
        setCheckpoints([])
        setModelsError('Forge/A1111 no responde. Arranca Forge en Ajustes → Runtime.')
        return
      }
      const res = await window.kawaii.imageA1111Models?.(live)
      if (!res?.ok) {
        setCheckpoints([])
        setModelsError(res?.error || 'No se pudo listar checkpoints')
        return
      }
      setCheckpoints(res.models || [])
      const preferred =
        settings.a1111Checkpoint || res.current || res.models?.[0]?.title || ''
      if (preferred) setCheckpoint(preferred)
    } catch (err) {
      setModelsError(err instanceof Error ? err.message : String(err))
      setCheckpoints([])
    } finally {
      setModelsLoading(false)
    }
  }

  useEffect(() => {
    if (open) void loadCheckpoints()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, settings.a1111BaseUrl])

  // Keep Forge status in sync while the panel is open
  useEffect(() => {
    if (!open) return
    let cancelled = false
    const tick = async () => {
      if (cancelled) return
      await probeLocal()
      if (mode === 'local' || mode === 'smart') await loadCheckpoints()
    }
    void tick()
    const id = window.setInterval(() => void tick(), 8000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode])

  if (!open) return null

  const persistSize = (w: number, h: number) => {
    setWidth(w)
    setHeight(h)
    updateSettings({ imageWidth: w, imageHeight: h })
  }

  const applyAspect = (id: string) => {
    const preset = ASPECT_PRESETS.find((p) => p.id === id)
    if (!preset) return
    setAspectId(id)
    persistSize(preset.w, preset.h)
  }

  const setModeAndPersist = (m: 'cloud' | 'local' | 'smart') => {
    setMode(m)
    updateSettings({
      imageProviderMode: m,
      imageGenEnabled: true
    })
  }

  const buildPrompt = (raw: string) => {
    if (promptAlreadyBridged) return raw.trim()
    let styleHint = ''
    if (settings.imageUseCharacterStyle && settings.character) {
      const c = settings.character
      styleHint = [c.style, c.visualDescription?.slice(0, 80), 'kawaii aesthetic']
        .filter(Boolean)
        .join(', ')
    }
    return enhancePrompt(raw, styleHint || undefined)
  }

  const generate = async () => {
    const raw = prompt.trim()
    if (!raw || busy) return
    setBusy(true)
    const actId = activityProgress('Generando imagen', 'Preparando…', 5)
    setError(null)
    setResult(null)
    const id = crypto.randomUUID()
    jobIdRef.current = id

    try {
      // Persist size choices for next time
      updateSettings({
        imageWidth: width,
        imageHeight: height,
        a1111Steps: steps,
        a1111CfgScale: cfg,
        a1111Checkpoint: checkpoint || settings.a1111Checkpoint,
        imageProviderMode: mode,
        imageGenEnabled: true
      })

      let hw = {
        totalMemoryGB: 8,
        vramGB: null as number | null,
        hasDiscreteGpu: null as boolean | null,
        gpuName: null as string | null
      }
      try {
        const profile = await window.kawaii.getHardwareProfile()
        hw = {
          totalMemoryGB: profile.totalMemoryGB,
          vramGB: profile.vramGB ?? null,
          hasDiscreteGpu: profile.hasDiscreteGpu ?? null,
          gpuName: profile.gpuName ?? null
        }
      } catch {
        /* defaults */
      }

      const rec = recommendImageStack(hw)
      let liveBase = settings.a1111BaseUrl
      try {
        const st = await window.kawaii?.forgeStatus?.()
        if (st?.baseUrl) liveBase = st.baseUrl
      } catch {
        /* ignore */
      }

      const route = resolveImageRoute(mode, localOk === true, hw)

      if (route === 'none') {
        const msg =
          mode === 'local'
            ? 'Forge no está listo. En Ajustes → Runtime: Arrancar Forge API y Health OK.'
            : 'Activa generación de imágenes (cloud o local) en Ajustes.'
        setError(msg)
        activityError('Sin generador', msg)
        return
      }

      const provider =
        route === 'a1111' ? (mode === 'smart' ? 'smart' : 'a1111') : 'pollinations'

      const finalPrompt = buildPrompt(raw)
      const seedNum =
        seed.trim() === '' ? undefined : Number.parseInt(seed.trim(), 10)

      {
        const { useActivityStore } = await import('@shared/lib/stores/activityStore')
        useActivityStore.getState().update(actId, {
          detail:
            provider === 'pollinations'
              ? 'Cloud (Pollinations)…'
              : 'Local (Forge/SD)…',
          progress: 20
        })
      }

      const res = await window.kawaii.imageGenerate({
        prompt: finalPrompt,
        negativePrompt: negative.trim() || DEFAULT_NEGATIVE,
        width,
        height,
        seed: Number.isFinite(seedNum) ? seedNum : bridgedSeed,
        timeoutMs: settings.imageTimeoutMs ?? 120_000,
        jobId: id,
        provider,
        a1111BaseUrl: liveBase,
        steps: Math.min(steps, rec.maxSteps ?? 30),
        cfgScale: cfg,
        checkpoint:
          provider === 'pollinations'
            ? undefined
            : checkpoint || settings.a1111Checkpoint || undefined
      })

      if (!res.ok) {
        const msg =
          res.code === 'IMAGE_CANCELLED'
            ? 'Generación cancelada'
            : res.error || 'Error al generar'
        setError(msg)
        if (res.code === 'IMAGE_CANCELLED') activityInfo('Imagen cancelada')
        else activityError('Error al generar imagen', msg)
        return
      }

      const meta = `${res.providerId} · ${res.width}×${res.height} · ${res.latencyMs} ms`
      setResult({
        dataUrl: res.dataUrl,
        meta,
        filePath: res.filePath
      })
      activitySuccess('Imagen lista', meta)

      let convId = activeId
      if (!convId) convId = create('Imagen')
      addMessage(convId, { role: 'user', content: `🎨 ${raw}` })
      addMessage(convId, {
        role: 'assistant',
        content: `Imagen generada (${res.providerId}).\n\n*${meta}*${
          res.filePath ? `\n\nGuardada en disco.` : ''
        }`,
        attachments: [
          {
            id: `att_${id.slice(0, 8)}`,
            name: 'generated.png',
            mimeType: 'image/png',
            sizeBytes: Math.floor((res.dataUrl.length * 3) / 4),
            dataUrl: res.dataUrl
          }
        ],
        meta: {
          provider: res.providerId,
          model: res.model,
          latencyMs: res.latencyMs,
          imageProvider: res.providerId,
          imageModel: res.model,
          imageWidth: res.width,
          imageHeight: res.height,
          imageSeed: res.seed,
          imageFilePath: res.filePath
        }
      })
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err)
      setError(m)
      activityError('Error al generar imagen', m)
    } finally {
      setBusy(false)
      jobIdRef.current = null
    }
  }

  const cancel = async () => {
    await window.kawaii.imageCancel(jobIdRef.current ?? undefined)
    setBusy(false)
  }

  return (
    <div className="border-t border-kawaii-border bg-white/95 backdrop-blur px-4 py-3 max-h-[62vh] overflow-y-auto">
      <div className="max-w-4xl mx-auto space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-sm font-semibold text-kawaii-text flex items-center gap-1.5">
            <ImageIcon className="w-4 h-4 text-kawaii-pink-deep" />
            Opciones de imagen
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="text-[11px] text-kawaii-pink-deep hover:underline flex items-center gap-1"
              onClick={() => void window.kawaii?.imageOpenFolder?.()}
              title={imagesDir || 'Carpeta de imágenes'}
            >
              <FolderOpen className="w-3.5 h-3.5" />
              Abrir carpeta
            </button>
            <button type="button" onClick={onClose} className="text-kawaii-text-muted">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {imagesDir && (
          <p className="text-[10px] text-kawaii-text-muted break-all">
            Se guardan en: <code className="text-[10px]">{imagesDir}</code>
          </p>
        )}

        <div className="rounded-kawaii border border-kawaii-border bg-kawaii-pink-soft/40 px-2.5 py-2 text-[11px] text-kawaii-text space-y-1">
          <p className="font-semibold">Chat primero (como ChatGPT / Grok)</p>
          <p className="text-kawaii-text-muted">
            Escribe en el chat: «hazme una imagen de…», «el doble de grande», «cambia el fondo a playa».
            Este panel es solo para tamaño, motor y checkpoints avanzados.
          </p>
        </div>
        {/* Provider */}
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-[11px] font-semibold text-kawaii-text">Motor:</span>
          {(
            [
              ['cloud', 'Cloud (CF FLUX / Pollinations)'],
              ['local', 'Local (Forge/SD)'],
              ['smart', 'Smart (OpenAI→local→CF→Pollinations)']
            ] as const
          ).map(([id, label]) => (
            <button
              key={`motor-${id}`}
              type="button"
              onClick={() => setModeAndPersist(id)}
              className={`text-[11px] px-2.5 py-1 rounded-full border transition ${
                mode === id
                  ? 'bg-kawaii-pink-deep text-white border-kawaii-pink-deep'
                  : 'bg-white border-kawaii-border text-kawaii-text-muted hover:border-kawaii-pink'
              }`}
            >
              {label}
            </button>
          ))}
          {(mode === 'local' || mode === 'smart') && (
            <span
              className={`text-[10px] max-w-[280px] ${
                localOk === true
                  ? 'text-emerald-700'
                  : localOk === false
                    ? 'text-amber-700'
                    : 'text-kawaii-text-muted'
              }`}
              title={healthDetail || ''}
            >
              {localOk === true
                ? `✓ Forge API OK${healthDetail ? ` · ${healthDetail}` : ''}`
                : localOk === false
                  ? `○ ${healthDetail || 'Forge no responde'}`
                  : 'Comprobando Forge…'}
            </span>
          )}
          {(mode === 'local' || mode === 'smart') && (
            <button
              type="button"
              className="text-[10px] text-kawaii-pink-deep hover:underline"
              onClick={() => {
                void probeLocal().then((ok) => {
                  if (ok) void loadCheckpoints()
                })
              }}
            >
              Detectar Forge
            </button>
          )}
        </div>

        <textarea
          id={inputId}
          className="input-kawaii w-full min-h-[72px] text-sm resize-y"
          placeholder="Describe la imagen con detalle (sujeto, ropa, fondo, estilo…)"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={busy}
        />

        {/* Aspect / size — full controls only in advanced */}
        {settings.uiComplexity === 'smart' && !showAdvanced && (
          <p className="text-[10px] text-kawaii-text-muted px-0.5">
            Modo simple: tamaño, checkpoint y CFG se eligen solos al generar (como ChatGPT/Grok).
            Usa «Más opciones…» o UI Avanzado para control manual.
          </p>
        )}
        {(settings.uiComplexity === 'advanced' || showAdvanced) && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold text-kawaii-text">Tamaño / aspecto</p>
          <div className="flex flex-wrap gap-1.5">
            {ASPECT_PRESETS.map((p) => (
              <button
                key={`aspect-${p.id}`}
                type="button"
                onClick={() => applyAspect(p.id)}
                className={`text-[10px] px-2 py-1 rounded-full border ${
                  aspectId === p.id
                    ? 'border-kawaii-pink-deep bg-kawaii-pink-soft text-kawaii-pink-deep'
                    : 'border-kawaii-border text-kawaii-text-muted'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="text-[10px] text-kawaii-text-muted">Escala rápida:</span>
            {(
              [
                [0.5, '½'],
                [1, '1×'],
                [1.5, '1½'],
                [2, '2× doble']
              ] as const
            ).map(([s, lab]) => (
              <button
                key={`scale-${s}`}
                type="button"
                className="text-[10px] px-2 py-0.5 rounded-full border border-kawaii-border text-kawaii-text-muted hover:border-kawaii-pink"
                onClick={() => {
                  const w0 = width || 1024
                  const h0 = height || 1024
                  setAspectId('custom')
                  const nw = Math.min(2048, Math.max(256, Math.round((w0 * s) / 64) * 64))
                  const nh = Math.min(2048, Math.max(256, Math.round((h0 * s) / 64) * 64))
                  persistSize(nw, nh)
                }}
              >
                {lab}
              </button>
            ))}
            <button
              type="button"
              className="text-[10px] px-2 py-0.5 rounded-full border border-kawaii-border text-kawaii-text-muted hover:border-kawaii-pink"
              onClick={() => {
                setAspectId('1-1024')
                persistSize(1024, 1024)
              }}
            >
              Reset 1024
            </button>
            <span className="text-[10px] text-kawaii-text-muted">
              Máx 2048px · en el chat: «el doble», «más grande», «4k»
            </span>
          </div>
          <div className="flex gap-2 items-center text-xs flex-wrap">
            <label className="text-kawaii-text-muted">
              Ancho
              <input
                type="number"
                min={256}
                max={2048}
                step={64}
                className="input-kawaii ml-1 w-20 text-xs"
                value={width}
                onChange={(e) => {
                  setAspectId('custom')
                  const nw = Number(e.target.value) || 512
                  persistSize(nw, height)
                }}
              />
            </label>
            <label className="text-kawaii-text-muted">
              Alto
              <input
                type="number"
                min={256}
                max={2048}
                step={64}
                className="input-kawaii ml-1 w-20 text-xs"
                value={height}
                onChange={(e) => {
                  setAspectId('custom')
                  const nh = Number(e.target.value) || 512
                  persistSize(width, nh)
                }}
              />
            </label>
            <span className="text-[10px] text-kawaii-text-muted">
              {width}×{height}
            </span>
          </div>
        </div>
        )}

        {/* Local checkpoint — advanced only; chat auto-picks in smart mode */}
        {(mode === 'local' || mode === 'smart') &&
          (settings.uiComplexity === 'advanced' || showAdvanced) && (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold">Checkpoint local (SD)</p>
              <button
                type="button"
                className="text-[10px] text-kawaii-pink-deep hover:underline"
                onClick={() => void loadCheckpoints()}
              >
                {modelsLoading ? 'Cargando…' : 'Actualizar lista'}
              </button>
            </div>
            {modelsError && (
              <p className="text-[10px] text-amber-800">{modelsError}</p>
            )}
            {checkpoints.length > 0 ? (
              <select
                className="input-kawaii text-xs w-full"
                value={checkpoint}
                onChange={(e) => setCheckpoint(e.target.value)}
              >
                {checkpoints.map((c, i) => (
                  <option key={`ckpt-${c.title}-${i}`} value={c.title}>
                    {c.title}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-[10px] text-kawaii-text-muted">
                Sin checkpoints visibles. Descarga uno abajo o espera a Forge.
              </p>
            )}
            {(mode === 'local' || mode === 'smart') && (
              <ModelsStatusPanel />
            )}
            {catalog.length > 0 && (
              <div className="rounded-kawaii border border-kawaii-border p-2 space-y-2 bg-white/80">
                {sdRecovery.length > 0 && (
                  <div className="rounded-kawaii border border-amber-200 bg-amber-50 p-2 space-y-1 mb-1">
                    <p className="text-[11px] font-semibold text-amber-900">
                      Descargas incompletas (recovery)
                    </p>
                    {sdRecovery.map((j) => (
                      <div
                        key={`recovery-${j.id}`}
                        className="flex flex-wrap items-center gap-2 text-[10px] text-amber-900"
                      >
                        <span className="flex-1 min-w-[120px]">
                          {j.label} · {j.status} · {Math.round(j.pct)}%
                          {j.error ? ` · ${j.error}` : ''}
                        </span>
                        <button
                          type="button"
                          className="text-kawaii-pink-deep hover:underline"
                          onClick={() => {
                            void (async () => {
                              setDlId(j.id)
                              setDlPct(j.pct)
                              useDownloadStore.getState().upsert({
                                model: `SD:${j.id}`,
                                status: 'Reanudando…',
                                progress: j.pct,
                                state: 'running',
                                kind: 'sd'
                              })
                              const r = await window.kawaii?.sdDownloadCheckpoint?.(j.id)
                              if (r && 'ok' in r && r.ok) {
                                activitySuccess('Modelo listo', j.label)
                                useDownloadStore.getState().remove(`SD:${j.id}`)
                                setSdRecovery((prev) => prev.filter((x) => x.id !== j.id))
                                await loadCheckpoints()
                              } else {
                                activityError(
                                  'Recovery',
                                  (r && 'error' in r && r.error) || 'falló'
                                )
                              }
                              setDlId(null)
                              const again = await window.kawaii?.sdListRecovery?.()
                              if (again?.ok) setSdRecovery(again.jobs || [])
                            })()
                          }}
                        >
                          Reanudar
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-[11px] font-semibold">Descargar modelos SD</p>
                <p className="text-[10px] text-kawaii-text-muted">
                  Puedes elegir cualquiera (DreamShaper, anime, realista…). Si uno falla,
                  usa Reiniciar en la barra de descargas. Una descarga activa a la vez.
                </p>
                <p className="text-[10px] text-kawaii-text-muted leading-relaxed">
                  Un solo checkpoint activo en Forge a la vez (no se “fusionan” al generar).
                  Puedes tener varios instalados y cambiar en el selector de arriba. LoRAs
                  (más adelante) sí se combinan encima de un checkpoint.
                </p>
                <div className="flex flex-wrap gap-1 items-center">
                  <span className="text-[10px] text-kawaii-text-muted">Estilo:</span>
                  {(
                    [
                      ['any', 'Todos'],
                      ['photo', 'Realismo'],
                      ['anime', 'Anime'],
                      ['art', 'Arte'],
                      ['general', 'General']
                    ] as const
                  ).map(([id, lab]) => (
                    <button
                      key={`style-${id}`}
                      type="button"
                      onClick={() => setStylePref(id)}
                      className={`text-[10px] px-2 py-0.5 rounded-full border ${
                        stylePref === id
                          ? 'border-kawaii-pink-deep bg-kawaii-pink-soft text-kawaii-pink-deep'
                          : 'border-kawaii-border text-kawaii-text-muted'
                      }`}
                    >
                      {lab}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1 items-center">
                  <span className="text-[10px] text-kawaii-text-muted">Filtro:</span>
                  {(
                    [
                      ['any', 'Cualquiera'],
                      ['safe', 'Más seguro / base'],
                      ['flexible', 'Flexible / sin sesgo fuerte']
                    ] as const
                  ).map(([id, lab]) => (
                    <button
                      key={`safety-${id}`}
                      type="button"
                      onClick={() => setSafetyPref(id)}
                      className={`text-[10px] px-2 py-0.5 rounded-full border ${
                        safetyPref === id
                          ? 'border-kawaii-pink-deep bg-kawaii-pink-soft text-kawaii-pink-deep'
                          : 'border-kawaii-border text-kawaii-text-muted'
                      }`}
                    >
                      {lab}
                    </button>
                  ))}
                </div>
                {(() => {
                  const filtered = catalog
                    .filter((m) => {
                      if (safetyPref !== 'any' && m.safety !== safetyPref) return false
                      if (stylePref === 'any') return true
                      return (m.styles || []).includes(stylePref)
                    })
                    .slice()
                    .sort((a, b) => {
                      // Prefer matching style tags
                      const sa = (a.styles || []).includes(stylePref) ? 1 : 0
                      const sb = (b.styles || []).includes(stylePref) ? 1 : 0
                      return sb - sa
                    })
                  const list = filtered.length ? filtered : catalog
                  return list.map((m, idx) => (
                    <div
                      key={`catalog-${m.id}-${idx}`}
                      className="text-[11px] border-t border-kawaii-border/50 pt-1.5 space-y-0.5"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium flex-1 min-w-[140px]">
                          {idx === 0 && stylePref !== 'any' ? '★ ' : ''}
                          {m.label}{' '}
                          <span className="text-kawaii-text-muted font-normal">
                            ~{m.approxGB} GB ·{' '}
                            {m.safety === 'safe' ? 'más seguro' : 'flexible'}
                            {(m.styles || []).length
                              ? ` · ${(m.styles || []).join(', ')}`
                              : ''}
                          </span>
                          {installedIds[m.id] ? (
                            <span className="ml-1 text-[10px] text-emerald-700 font-semibold">
                              · Instalado (
                              {(installedIds[m.id] / 1e9).toFixed(1)} GB)
                            </span>
                          ) : sdRecovery.some((j) => j.id === m.id) ? (
                            <span className="ml-1 text-[10px] text-amber-700 font-semibold">
                              · Incompleto — reanudar
                            </span>
                          ) : null}
                        </span>
                        <div className="flex flex-col items-end gap-1 shrink-0 min-w-[100px]">
                          <button
                            type="button"
                            className="text-kawaii-pink-deep hover:underline disabled:opacity-50 disabled:no-underline"
                            disabled={Boolean(installedIds[m.id]) || dlId === m.id}
                            onClick={() => {
                              void (async () => {
                                setDlId(m.id)
                                setDlPct(0)
                                try {
                                  useDownloadStore.getState().upsert({
                                    model: `SD:${m.id}`,
                                    status: 'Iniciando descarga…',
                                    progress: 0,
                                    state: 'running',
                                    kind: 'sd'
                                  })
                                  const r = await window.kawaii?.sdDownloadCheckpoint?.(m.id)
                                  if (r && 'ok' in r && r.ok) {
                                    activitySuccess('Modelo listo', m.label)
                                    useDownloadStore.getState().upsert({
                                      model: `SD:${m.id}`,
                                      status: 'Completado',
                                      progress: 100,
                                      state: 'done'
                                    })
                                    window.setTimeout(
                                      () => useDownloadStore.getState().remove(`SD:${m.id}`),
                                      4000
                                    )
                                    await loadCheckpoints()
                                    const inst = await window.kawaii?.sdListInstalled?.()
                                    if (inst?.ok && inst.models) {
                                      const map: Record<string, number> = {}
                                      for (const x of inst.models) map[x.id] = x.sizeBytes
                                      setInstalledIds(map)
                                    }
                                  } else {
                                    const err =
                                      (r && 'error' in r && r.error) || 'falló'
                                    activityError('Descarga', err)
                                    useDownloadStore.getState().upsert({
                                      model: `SD:${m.id}`,
                                      status: err,
                                      state: 'error',
                                      error: err
                                    })
                                  }
                                } finally {
                                  setDlId(null)
                                }
                              })()
                            }}
                          >
                            {installedIds[m.id]
                              ? 'Ya instalado'
                              : dlId === m.id
                                ? `Bajando ${Math.round(dlPct)}%…`
                                : sdRecovery.some((j) => j.id === m.id)
                                  ? 'Reanudar'
                                  : 'Descargar'}
                          </button>
                          {dlId === m.id && (
                            <>
                              <div className="w-full h-1.5 rounded-full bg-kawaii-border overflow-hidden">
                                <div
                                  className="h-full bg-kawaii-pink-deep transition-all"
                                  style={{
                                    width: `${Math.min(100, Math.max(1, dlPct))}%`
                                  }}
                                />
                              </div>
                              <button
                                type="button"
                                className="text-[10px] text-amber-800 hover:underline"
                                onClick={() => {
                                  void window.kawaii?.sdPauseDownload?.().then(() => {
                                    useDownloadStore.getState().markPaused(`SD:${m.id}`)
                                    activityInfo(
                                      'Descarga pausada',
                                      'El progreso queda en disco. Pulsa Reanudar o Descargar de nuevo.'
                                    )
                                    void window.kawaii?.sdListInstalled?.().then((r) => {
      if (r?.ok && r.models) {
        const map: Record<string, number> = {}
        for (const m of r.models) map[m.id] = m.sizeBytes
        setInstalledIds(map)
      }
    })
    void window.kawaii?.sdListRecovery?.().then((r) => {
                                      if (r?.ok) setSdRecovery(r.jobs || [])
                                    })
                                  })
                                }}
                              >
                                Pausar (recovery)
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                      <p className="text-[10px] text-kawaii-text-muted">
                        {m.bestFor ? `Mejor para: ${m.bestFor}. ` : ''}
                        {m.notes}
                        {(m as { mergeFriendly?: boolean }).mergeFriendly
                          ? ' · Compatible con LoRAs / estilo mixto.'
                          : ''}
                      </p>
                    </div>
                  ))
                })()}
              </div>
            )}
          </div>
        )}

        {(settings.uiComplexity === 'advanced' || showAdvanced) && (
        <button
          type="button"
          className="text-[11px] text-kawaii-text-muted hover:underline"
          onClick={() => setShowAdvanced((v) => !v)}
        >
          {showAdvanced ? '▾ Ocultar avanzado' : '▸ Prompt negativo, steps, seed…'}
        </button>
        )}
        {settings.uiComplexity === 'smart' && !showAdvanced && (
          <button
            type="button"
            className="text-[10px] text-kawaii-text-muted hover:underline"
            onClick={() => setShowAdvanced(true)}
          >
            Más opciones…
          </button>
        )}

        {showAdvanced && (
          <div className="space-y-2 rounded-kawaii border border-kawaii-border p-2 bg-kawaii-cream/40">
            <label className="block text-[11px]">
              Prompt negativo
              <textarea
                className="input-kawaii w-full text-xs mt-0.5 min-h-[48px]"
                value={negative}
                onChange={(e) => setNegative(e.target.value)}
              />
            </label>
            <div className="flex flex-wrap gap-3 text-xs">
              <label>
                Steps (local)
                <input
                  type="number"
                  min={5}
                  max={40}
                  className="input-kawaii ml-1 w-16 text-xs"
                  value={steps}
                  onChange={(e) => setSteps(Number(e.target.value) || 20)}
                />
              </label>
              <label>
                CFG
                <input
                  type="number"
                  min={1}
                  max={15}
                  step={0.5}
                  className="input-kawaii ml-1 w-16 text-xs"
                  value={cfg}
                  onChange={(e) => setCfg(Number(e.target.value) || 7)}
                />
              </label>
              <label>
                Seed (vacío = aleatorio)
                <input
                  type="text"
                  className="input-kawaii ml-1 w-28 text-xs"
                  value={seed}
                  onChange={(e) => setSeed(e.target.value)}
                  placeholder="auto"
                />
              </label>
            </div>
            <p className="text-[10px] text-kawaii-text-muted">
              La app enriquece el prompt (detalle, iluminación) sin borrar tu descripción.
              Cloud = Pollinations (gratis). Local = Forge con el checkpoint elegido.
            </p>
          </div>
        )}

        <div className="flex flex-wrap gap-2 items-center">
          {!busy ? (
            <Button
              className="px-4"
              onClick={() => void generate()}
              disabled={!prompt.trim()}
            >
              <ImageIcon className="w-4 h-4" />
              Generar
            </Button>
          ) : (
            <Button className="px-4" variant="ghost" onClick={() => void cancel()}>
              <Square className="w-3.5 h-3.5" />
              Cancelar
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            </Button>
          )}
          {error && <p className="text-xs text-red-600 flex-1">{error}</p>}
        </div>

        {result && (
          <div className="space-y-1.5">
            <img
              src={result.dataUrl}
              alt="generada"
              className="max-h-72 rounded-xl border border-kawaii-border object-contain bg-black/5"
            />
            <p className="text-[10px] text-kawaii-text-muted">{result.meta}</p>
            <div className="flex gap-3">
              {result.filePath && (
                <button
                  type="button"
                  className="text-[11px] text-kawaii-pink-deep hover:underline"
                  onClick={() =>
                    void window.kawaii?.imageShowInFolder?.(result.filePath)
                  }
                >
                  Mostrar en carpeta
                </button>
              )}
              <button
                type="button"
                className="text-[11px] text-kawaii-pink-deep hover:underline"
                onClick={() => void window.kawaii?.imageOpenFolder?.()}
              >
                Abrir carpeta de imágenes
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
