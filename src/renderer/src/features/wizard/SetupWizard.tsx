import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Check,
  ChevronRight,
  ExternalLink,
  Zap,
  Server,
  Cloud,
  Sparkles,
  AlertCircle,
  Loader2,
  Download,
  Play,
  Cpu,
  Image as ImageIcon
} from 'lucide-react'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'
import type { ProviderMode } from '@shared/types/settings'
import { Button } from '@shared/ui/Button'
import {
  recommendLocalModels,
  pickInstalledOrRecommended,
  type HardwareProfile,
  type ModelRecommendation
} from '@core/models/recommendations'
import {
  FREE_CLOUD_CATALOG,
  modelsForProvider,
  probeCloudProvider
} from '@core/models/free-cloud-catalog'
import { discoverOpenRouterFreeModels } from '@core/models/discover-openrouter'
import { recommendGenerativeStack } from '@core/models/generative-catalog'
import { useDownloadStore } from '@features/models/downloadStore'
import { recommendImageStack } from '@core/image'
import { SdWorkspacePanel } from '@features/image/components/SdWorkspacePanel'

interface ProviderDef {
  id: string
  name: string
  emoji: string
  tagline: string
  description: string
  baseUrl: string
  freeModel: string
  badge: string
  keyUrl: string
}

const CLOUD_PROVIDERS: ProviderDef[] = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    emoji: '🔮',
    tagline: 'Hub multi-modelo gratis',
    description: 'Muchos modelos free (Gemini, Llama, Qwen…) en una sola key.',
    baseUrl: 'https://openrouter.ai/api/v1',
    freeModel: 'openrouter/free',
    badge: '★ Más fácil',
    keyUrl: 'https://openrouter.ai/keys'
  },
  {
    id: 'groq',
    name: 'Groq',
    emoji: '⚡',
    tagline: 'El más rápido',
    description: 'Llama 3.3 70B con latencia muy baja. Tier gratuito generoso.',
    baseUrl: 'https://api.groq.com/openai/v1',
    freeModel: 'llama-3.1-8b-instant',
    badge: '🚀 Velocidad',
    keyUrl: 'https://console.groq.com/keys'
  },
  {
    id: 'gemini',
    name: 'Google AI Studio',
    emoji: '🤖',
    tagline: 'Cuota gratis de Google',
    description: 'Gemini Flash con contexto grande. Key desde AI Studio.',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    freeModel: 'gemini-2.0-flash',
    badge: '🔭 Contexto',
    keyUrl: 'https://aistudio.google.com/app/apikey'
  },
  {
    id: 'openai',
    name: 'OpenAI',
    emoji: '🧠',
    tagline: 'API oficial',
    description: 'GPT-4o mini y familia. Requiere créditos de pago.',
    baseUrl: 'https://api.openai.com/v1',
    freeModel: 'gpt-4o-mini',
    badge: '💼 De pago',
    keyUrl: 'https://platform.openai.com/api-keys'
  }
]

interface Props {
  onComplete: () => void
}

type StepId = 'welcome' | 'mode' | 'local' | 'cloud' | 'images' | 'done'

/** Detected from existing settings / keys / health */
interface SetupStatus {
  loaded: boolean
  hasAnyCloudKey: boolean
  hasOpenRouterKey: boolean
  cloudProvidersReady: string[]
  ollamaReachable: boolean
  hasLocalModel: boolean
  imageCloudOn: boolean
  imageLocalReady: boolean
  modeConfigured: boolean
  characterCustomized: boolean
}

function isValidHttpUrl(value: string): boolean {
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

export function SetupWizard({ onComplete }: Props) {
  const { settings, update } = useSettingsStore()
  const [step, setStep] = useState<StepId>('welcome')
  const [mode, setMode] = useState<ProviderMode>(settings.providerMode || 'smart')
  const [localUrl, setLocalUrl] = useState(settings.localBaseUrl || 'http://localhost:11434')
  const [localModel, setLocalModel] = useState(settings.localModel || '')
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([])
  const [ollamaOk, setOllamaOk] = useState<boolean | null>(null)
  const [ollamaChecking, setOllamaChecking] = useState(false)
  const [ollamaError, setOllamaError] = useState<string | null>(null)
  const [startingOllama, setStartingOllama] = useState(false)
  const [hw, setHw] = useState<HardwareProfile | null>(null)
  const [recs, setRecs] = useState<ReturnType<typeof recommendLocalModels> | null>(null)
  /** model -> { progress?, status } for background downloads */
  const [pullJobs, setPullJobs] = useState<
    Record<string, { progress?: number; status: string }>
  >({})
  const [deleting, setDeleting] = useState<string | null>(null)
  const [selectedCloudId, setSelectedCloudId] = useState('openrouter')
  const [selectedCloudModel, setSelectedCloudModel] = useState(
    CLOUD_PROVIDERS[0].freeModel
  )
  const [apiKey, setApiKey] = useState('')
  const [keyTesting, setKeyTesting] = useState(false)
  const [keyTestResult, setKeyTestResult] = useState<'ok' | 'fail' | null>(null)
  const [keyTestDetail, setKeyTestDetail] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  /** Image setup (wizard step) */
  const [imageWanted, setImageWanted] = useState(false)
  const [imageMode, setImageMode] = useState<'cloud' | 'smart' | 'local'>('cloud')
  const [a1111Url, setA1111Url] = useState(settings.a1111BaseUrl || 'http://127.0.0.1:7860')
  const [a1111Probe, setA1111Probe] = useState<'idle' | 'loading' | 'ok' | 'fail'>('idle')
  const [a1111Detail, setA1111Detail] = useState<string | null>(null)
  const [imageRecSummary, setImageRecSummary] = useState<string>('Detectando hardware…')
  const [liveFreeModels, setLiveFreeModels] = useState<{ id: string; name: string }[]>([])
  const [freeDiscoverMsg, setFreeDiscoverMsg] = useState<string | null>(null)
  const [freeDiscovering, setFreeDiscovering] = useState(false)
  const upsertDownload = useDownloadStore((s) => s.upsert)
  const [setupStatus, setSetupStatus] = useState<SetupStatus>({
    loaded: false,
    hasAnyCloudKey: false,
    hasOpenRouterKey: false,
    cloudProvidersReady: [],
    ollamaReachable: false,
    hasLocalModel: false,
    imageCloudOn: false,
    imageLocalReady: false,
    modeConfigured: false,
    characterCustomized: false
  })
  const [existingKeyHint, setExistingKeyHint] = useState('')
  /** Skip steps already satisfied when continuing the wizard */
  const [skipDoneSteps, setSkipDoneSteps] = useState(true)

  const selectedCloud = CLOUD_PROVIDERS.find((p) => p.id === selectedCloudId) ?? CLOUD_PROVIDERS[0]
  const needsLocal = mode === 'local' || mode === 'smart'
  const needsCloud = mode === 'cloud' || mode === 'smart'

  // Detect existing configuration so we don't repeat completed work
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const status: SetupStatus = {
        loaded: true,
        hasAnyCloudKey: false,
        hasOpenRouterKey: false,
        cloudProvidersReady: [],
        ollamaReachable: false,
        hasLocalModel: false,
        imageCloudOn:
          settings.imageGenEnabled === true &&
          (settings.imageProviderMode === 'cloud' ||
            settings.imageProviderMode === 'smart'),
        imageLocalReady: false,
        modeConfigured: settings.hasCompletedSetup === true,
        characterCustomized: Boolean(
          (settings.character?.name && settings.character.name !== 'Kawaii') ||
            (settings.character?.relationshipRole &&
              settings.character.relationshipRole !==
                'asistente amigable y de confianza')
        )
      }
      try {
        const keys = (await window.kawaii?.getAllProviderKeys?.()) ?? {}
        const main = (await window.kawaii?.getCloudApiKey?.()) ?? ''
        if (main && main.length >= 8) {
          keys.openrouter = keys.openrouter || main
        }
        for (const [id, k] of Object.entries(keys)) {
          if ((k || '').trim().length >= 8) {
            status.hasAnyCloudKey = true
            status.cloudProvidersReady.push(id)
            if (id === 'openrouter') status.hasOpenRouterKey = true
          }
        }
        if (status.hasOpenRouterKey || (keys.openrouter || '').length >= 8) {
          setExistingKeyHint('Key de OpenRouter ya guardada en este equipo')
          setSelectedCloudId('openrouter')
          // Don't put real key in the input; mark as present
          setApiKey('')
          setKeyTestResult('ok')
          setKeyTestDetail('Key ya configurada (no hace falta volver a pegarla)')
        }
        const slot = (settings.cloudSlots || []).find((s) => s.enabled && s.id === 'openrouter')
        if (slot?.model) setSelectedCloudModel(slot.model)
        else if (settings.cloudModel) setSelectedCloudModel(settings.cloudModel)
      } catch {
        /* ignore */
      }
      try {
        const url = (settings.localBaseUrl || 'http://localhost:11434').replace(/\/$/, '')
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 3500)
        const res = await fetch(`${url}/api/tags`, { signal: controller.signal })
        clearTimeout(timer)
        if (res.ok) {
          status.ollamaReachable = true
          const data = (await res.json()) as { models?: { name: string }[] }
          const names = (data.models || []).map((m) => m.name)
          if (names.length) {
            status.hasLocalModel = true
            setDiscoveredModels(names)
            setOllamaOk(true)
            if (!localModel && names[0]) setLocalModel(names[0])
          }
        }
      } catch {
        /* ollama down */
      }
      try {
        const h = await window.kawaii?.imageA1111Health?.(settings.a1111BaseUrl)
        if (h?.ok) status.imageLocalReady = true
      } catch {
        /* ignore */
      }
      if (!cancelled) setSetupStatus(status)
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const cloudModels = useMemo(
    () => modelsForProvider(selectedCloudId),
    [selectedCloudId]
  )

  const stepOrder = useMemo((): StepId[] => {
    const s: StepId[] = ['welcome', 'mode']
    const localDone =
      skipDoneSteps &&
      setupStatus.loaded &&
      needsLocal &&
      setupStatus.ollamaReachable &&
      setupStatus.hasLocalModel
    const cloudDone =
      skipDoneSteps &&
      setupStatus.loaded &&
      needsCloud &&
      setupStatus.hasAnyCloudKey
    const imagesDone =
      skipDoneSteps &&
      setupStatus.loaded &&
      (setupStatus.imageCloudOn || setupStatus.imageLocalReady || settings.imageGenEnabled === false)

    if (needsLocal && !localDone) s.push('local')
    if (needsCloud && !cloudDone) s.push('cloud')
    // Images always optional: skip if already configured or user finished setup once
    if (!imagesDone || !setupStatus.modeConfigured) s.push('images')
    s.push('done')
    return s
  }, [
    needsLocal,
    needsCloud,
    skipDoneSteps,
    setupStatus,
    settings.imageGenEnabled
  ])

  const stepIndex = stepOrder.indexOf(step)
  const stepTotal = stepOrder.length

  const openLink = (url: string) => {
    void window.kawaii?.openExternal?.(url)
  }

  // Load hardware profile once
  useEffect(() => {
    void window.kawaii?.getHardwareProfile?.().then((p) => {
      setHw(p)
      setRecs(recommendLocalModels(p, []))
      const img = recommendImageStack({
        totalMemoryGB: p.totalMemoryGB,
        vramGB: p.vramGB ?? null,
        hasDiscreteGpu: p.hasDiscreteGpu ?? null,
        gpuName: p.gpuName ?? null
      })
      setImageRecSummary(img.summary)
      if (!img.preferLocal) setImageMode('cloud')
      else setImageMode('smart')
    })
  }, [])

  // Pull progress subscription (supports multiple background jobs)
  useEffect(() => {
    const unsub = window.kawaii?.onOllamaPullProgress?.((p) => {
      if (p.status === 'success') {
        setPullJobs((prev) => {
          const next = { ...prev }
          delete next[p.model]
          return next
        })
        void checkOllama()
        return
      }
      if (p.status === 'error' || p.status === 'cancelled') {
        setPullJobs((prev) => {
          const next = { ...prev }
          delete next[p.model]
          return next
        })
        if (p.status === 'error') {
          setOllamaError(p.error || 'Error al descargar el modelo')
        }
        return
      }
      setPullJobs((prev) => ({
        ...prev,
        [p.model]: { progress: p.progress, status: p.status }
      }))
    })
    return () => {
      unsub?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localUrl])

  const checkOllama = useCallback(async (url = localUrl) => {
    if (!isValidHttpUrl(url)) {
      setOllamaOk(false)
      setOllamaError('URL inválida. Usa http://localhost:11434')
      setDiscoveredModels([])
      return
    }
    setOllamaChecking(true)
    setOllamaError(null)
    setOllamaOk(null)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    try {
      const res = await fetch(`${url.replace(/\/$/, '')}/api/tags`, {
        signal: controller.signal
      })
      if (!res.ok) {
        setOllamaOk(false)
        setOllamaError(`Ollama respondió HTTP ${res.status}`)
        setDiscoveredModels([])
        return
      }
      const data = (await res.json()) as { models?: Array<{ name?: string }> }
      const names = (data.models ?? [])
        .map((m) => m.name)
        .filter((n): n is string => Boolean(n))
      setDiscoveredModels(names)
      setOllamaOk(true)

      const profile = hw ?? (await window.kawaii?.getHardwareProfile?.())
      if (profile) {
        const r = recommendLocalModels(profile, names)
        setRecs(r)
        setLocalModel((prev) => {
          if (prev && names.includes(prev)) return prev
          return pickInstalledOrRecommended(names, profile) || prev
        })
      } else if (names[0]) {
        setLocalModel((prev) => prev || names[0])
      }

      if (names.length === 0) {
        setOllamaError(null) // soft: we show download UI instead
      }
    } catch (err) {
      setOllamaOk(false)
      setDiscoveredModels([])
      setOllamaError(
        err instanceof Error && err.name === 'AbortError'
          ? 'Timeout. ¿Ollama está en marcha?'
          : 'No hay conexión con Ollama en ese puerto.'
      )
    } finally {
      clearTimeout(timer)
      setOllamaChecking(false)
    }
  }, [localUrl, hw])

  useEffect(() => {
    if (step === 'local') void checkOllama()
  }, [step, checkOllama])

  // Live free model list (OpenRouter)
  useEffect(() => {
    if (step !== 'cloud' || selectedCloudId !== 'openrouter') return
    let cancelled = false
    setFreeDiscovering(true)
    void discoverOpenRouterFreeModels({ apiKey: apiKey || undefined }).then((r) => {
      if (cancelled) return
      setLiveFreeModels(r.models.map((m) => ({ id: m.id, name: m.name })))
      setFreeDiscoverMsg(r.ok ? `Modelos free detectados: ${r.models.length}` : r.error || null)
      if (!selectedCloudModel || selectedCloudModel.includes('llama-3.3-70b-instruct:free')) {
        setSelectedCloudModel(r.recommendedId)
      }
      setFreeDiscovering(false)
    })
    return () => {
      cancelled = true
    }
  }, [step, selectedCloudId, apiKey])

  useEffect(() => {
    const opts = modelsForProvider(selectedCloudId)
    if (opts[0]) setSelectedCloudModel(opts[0].modelId)
  }, [selectedCloudId])

  const startOllama = async () => {
    setStartingOllama(true)
    setOllamaError(null)
    try {
      const result = await window.kawaii.ollamaStart(localUrl)
      if (result.ok) {
        await checkOllama()
      } else {
        setOllamaError(result.message)
      }
    } catch (err) {
      setOllamaError(err instanceof Error ? err.message : 'No se pudo iniciar Ollama')
    } finally {
      setStartingOllama(false)
    }
  }

  const pullModel = async (model: string) => {
    upsertDownload({
      model,
      state: 'running',
      status: 'Iniciando descarga…',
      progress: 0
    })
    setOllamaError(null)
    setPullJobs((prev) => ({
      ...prev,
      [model]: { progress: 0, status: 'starting' }
    }))
    // Fire-and-forget: user can continue the wizard while it downloads
    void window.kawaii.ollamaPull(model, localUrl).then((result) => {
      if (!result.ok && !result.cancelled) {
        setOllamaError(result.error || 'Falló la descarga')
      }
      setPullJobs((prev) => {
        const next = { ...prev }
        delete next[model]
        return next
      })
      if (result.ok) void checkOllama()
    })
  }

  const cancelPull = async (model?: string) => {
    await window.kawaii.ollamaPullCancel(model)
    setPullJobs((prev) => {
      if (!model) return {}
      const next = { ...prev }
      delete next[model]
      return next
    })
  }

  const deleteModel = async (model: string) => {
    if (!confirm(`¿Eliminar el modelo "${model}" de Ollama?`)) return
    setDeleting(model)
    setOllamaError(null)
    try {
      const result = await window.kawaii.ollamaDelete(model, localUrl)
      if (!result.ok) {
        setOllamaError(result.error || 'No se pudo eliminar')
      } else {
        if (localModel === model) setLocalModel('')
        await checkOllama()
      }
    } finally {
      setDeleting(null)
    }
  }

  const testCloudKey = async () => {
    if (apiKey.trim().length < 8) {
      setKeyTestResult('fail')
      setKeyTestDetail('La key parece demasiado corta')
      return
    }
    setKeyTesting(true)
    setKeyTestResult(null)
    setKeyTestDetail(null)
    const probe = await probeCloudProvider({
      providerId: selectedCloud.id,
      baseUrl: selectedCloud.baseUrl,
      apiKey: apiKey.trim()
    })
    if (probe.ok) {
      setKeyTestResult('ok')
      setKeyTestDetail(
        (probe.modelsSample?.length ?? 0) > 0
          ? `OK · ${probe.latencyMs} ms · ${probe.modelsSample!.length} modelos listados`
          : `OK · ${probe.latencyMs} ms`
      )
    } else {
      setKeyTestResult('fail')
      setKeyTestDetail(probe.error || 'Sin conexión')
    }
    setKeyTesting(false)
  }

  const canProceedLocal =
    !needsLocal ||
    ollamaOk === true ||
    localModel.trim().length > 0

  const canProceedCloud =
    !needsCloud ||
    apiKey.trim().length >= 8 ||
    setupStatus.cloudProvidersReady.includes(selectedCloudId) ||
    (selectedCloudId === 'openrouter' && setupStatus.hasOpenRouterKey) ||
    (setupStatus.hasAnyCloudKey && keyTestResult === 'ok')

  const goNext = () => {
    const i = stepOrder.indexOf(step)
    if (i >= 0 && i < stepOrder.length - 1) setStep(stepOrder[i + 1])
  }
  const goBack = () => {
    const i = stepOrder.indexOf(step)
    if (i > 0) setStep(stepOrder[i - 1])
  }

  const handleFinish = async () => {
    setSaving(true)
    try {
      if (apiKey.trim().length >= 8 && needsCloud) {
        await window.kawaii?.setCloudApiKey?.(apiKey.trim())
        await window.kawaii?.setProviderKey?.(selectedCloud.id, apiKey.trim())
      }
      // Keep existing keys if user skipped re-entry
      const slots = (settings.cloudSlots || []).map((s) => {
        if (s.id === selectedCloud.id) {
          return {
            ...s,
            enabled: true,
            baseUrl: selectedCloud.baseUrl,
            model: selectedCloudModel || selectedCloud.freeModel,
            priority: 0
          }
        }
        // keep others; bump priority
        return { ...s, priority: s.id === selectedCloud.id ? 0 : s.priority + 1 }
      })
      // ensure selected exists
      const has = slots.some((s) => s.id === selectedCloud.id)
      const nextSlots = has
        ? slots
        : [
            {
              id: selectedCloud.id,
              name: selectedCloud.name,
              baseUrl: selectedCloud.baseUrl,
              model: selectedCloudModel || selectedCloud.freeModel,
              enabled: true,
              priority: 0
            },
            ...slots
          ]
      update({
        providerMode: mode,
        localBaseUrl: localUrl.trim() || 'http://localhost:11434',
        localModel: localModel.trim(),
        cloudBaseUrl: selectedCloud.baseUrl,
        cloudModel: selectedCloudModel || selectedCloud.freeModel,
        cloudSlots: nextSlots,
        cloudAutoRotate: true,
        imageGenEnabled: imageWanted,
        imageProviderMode: imageWanted ? imageMode : 'off',
        a1111BaseUrl: a1111Url.trim() || 'http://127.0.0.1:7860',
        hasCompletedSetup: true
      })
      onComplete()
    } finally {
      setSaving(false)
    }
  }

  const skip = () => {
    update({ hasCompletedSetup: true })
    onComplete()
  }

  const activePullCount = Object.keys(pullJobs).length

  const renderRecCard = (m: ModelRecommendation, primary?: boolean) => {
    const installed = discoveredModels.some(
      (n) => n === m.pullName || n.startsWith(m.pullName)
    )
    const job = pullJobs[m.pullName]
    const isPulling = Boolean(job)

    return (
      <div
        key={m.id}
        className={`rounded-kawaii border p-3 text-left ${
          primary ? 'border-kawaii-pink-deep bg-kawaii-pink-soft/40' : 'border-kawaii-border bg-white'
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-bold text-sm text-kawaii-text">
              {m.label}{' '}
              {primary && (
                <span className="text-[10px] text-kawaii-pink-deep font-semibold">Recomendado</span>
              )}
            </p>
            <p className="text-[11px] text-kawaii-text-muted">
              {m.sizeHint} · min ~{m.minRamGB} GB RAM
            </p>
            <p className="text-[11px] text-kawaii-text-muted mt-0.5">{m.reason}</p>
          </div>
          <div className="flex flex-col gap-1 shrink-0">
            {installed ? (
              <>
                <Button
                  variant="ghost"
                  className="text-xs"
                  onClick={() => setLocalModel(m.pullName)}
                >
                  <Check className="w-3.5 h-3.5" /> Usar
                </Button>
                <Button
                  variant="ghost"
                  className="text-xs text-red-600 hover:bg-red-50"
                  disabled={deleting === m.pullName}
                  onClick={() => void deleteModel(m.pullName)}
                >
                  {deleting === m.pullName ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : null}
                  Eliminar
                </Button>
              </>
            ) : isPulling ? (
              <Button
                variant="ghost"
                className="text-xs text-amber-700"
                onClick={() => void cancelPull(m.pullName)}
              >
                Pausar
              </Button>
            ) : (
              <Button
                className="text-xs"
                disabled={ollamaOk !== true}
                onClick={() => void pullModel(m.pullName)}
              >
                <Download className="w-3.5 h-3.5" />
                Descargar
              </Button>
            )}
          </div>
        </div>
        {isPulling && (
          <div className="mt-2">
            <div className="h-1.5 rounded-full bg-kawaii-border overflow-hidden">
              <div
                className="h-full bg-kawaii-pink-deep transition-all"
                style={{ width: `${job?.progress ?? 5}%` }}
              />
            </div>
            <p className="text-[10px] text-kawaii-text-muted mt-1">
              {job?.status}
              {job?.progress != null ? ` · ${job.progress}%` : ''}
              {' · '}puedes seguir el asistente mientras descarga
            </p>
          </div>
        )}
      </div>
    )
  }


  return (
    <div className="fixed inset-0 z-[100] bg-kawaii-cream/95 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-2xl">
        {step !== 'welcome' && (
          <div className="mb-4 px-1">
            <div className="flex justify-between text-[11px] text-kawaii-text-muted mb-1">
              <span>
                Paso {Math.min(stepIndex + 1, stepTotal)} de {stepTotal}
              </span>
              <button type="button" className="hover:underline" onClick={skip}>
                Saltar configuración
              </button>
            </div>
            <div className="h-1.5 rounded-full bg-kawaii-border overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-kawaii-pink to-kawaii-pink-deep transition-all duration-300"
                style={{ width: `${((stepIndex + 1) / stepTotal) * 100}%` }}
              />
            </div>
          </div>
        )}

        {step === 'welcome' && (
          <div className="max-w-lg mx-auto text-center space-y-6 py-6">
            <div className="text-7xl">🌸</div>
            <div>
              <h1 className="text-3xl font-extrabold text-kawaii-text mb-2">
                KawaiiGPT <span className="text-kawaii-pink-deep">Robust</span>
              </h1>
              <p className="text-kawaii-text-muted text-sm leading-relaxed max-w-sm mx-auto">
                Detectamos tu hardware, te sugerimos modelos locales y te ayudamos a conectar
                proveedores cloud gratuitos.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3 text-left">
              <FeatureCard emoji="🏠" title="Local" desc="Ollama + modelos a medida" />
              <FeatureCard emoji="☁️" title="Cloud free" desc="OpenRouter, Groq, Gemini…" />
              <FeatureCard emoji="✨" title="Smart" desc="Router inteligente" />
            </div>

            {setupStatus.loaded && (
              <div className="rounded-kawaii border border-kawaii-border bg-white/90 p-3 text-left space-y-1.5 text-xs">
                <p className="font-semibold text-kawaii-text">Estado en este equipo</p>
                <ul className="space-y-1 text-kawaii-text-muted">
                  <li>
                    {setupStatus.hasAnyCloudKey ? '✓' : '○'} Cloud / API key
                    {setupStatus.cloudProvidersReady.length
                      ? ` (${setupStatus.cloudProvidersReady.join(', ')})`
                      : ''}
                  </li>
                  <li>
                    {setupStatus.ollamaReachable ? '✓' : '○'} Ollama
                    {setupStatus.hasLocalModel
                      ? ' + modelo local'
                      : setupStatus.ollamaReachable
                        ? ' (sin modelos)'
                        : ''}
                  </li>
                  <li>
                    {setupStatus.imageLocalReady
                      ? '✓ Forge/A1111 API'
                      : setupStatus.imageCloudOn
                        ? '✓ Imagen cloud activa'
                        : '○ Imágenes (opcional)'}
                  </li>
                  <li>
                    {setupStatus.characterCustomized ? '✓' : '○'} Personalidad personalizada
                  </li>
                </ul>
                <p className="text-[11px] text-kawaii-text-muted pt-1">
                  El asistente omite pasos ya listos y solo te pide lo que falta.
                </p>
                <label className="flex items-center gap-2 text-[11px] pt-1">
                  <input
                    type="checkbox"
                    checked={skipDoneSteps}
                    onChange={(e) => setSkipDoneSteps(e.target.checked)}
                  />
                  Saltar pasos completados
                </label>
              </div>
            )}

            <Button
              className="w-full py-3 text-base"
              onClick={() => {
                const order = stepOrder.filter((id) => id !== 'welcome')
                setStep(order[0] || 'mode')
              }}
            >
              Empezar configuración <ChevronRight className="w-4 h-4" />
            </Button>
            <button
              type="button"
              onClick={skip}
              className="text-kawaii-text-muted text-xs hover:underline"
            >
              Saltar y configurar después
            </button>
          </div>
        )}

        {step === 'mode' && (
          <div className="max-w-lg mx-auto space-y-5 py-4">
            <div className="text-center">
              <h2 className="text-2xl font-extrabold text-kawaii-text">¿Cómo quieres usarlo?</h2>
              <p className="text-kawaii-text-muted text-sm mt-1">El resto del asistente se adapta a tu elección.</p>
            </div>
            <div className="space-y-3">
              <ModeCard
                active={mode === 'smart'}
                icon={<Sparkles className="w-5 h-5" />}
                title="Smart (recomendado)"
                desc="Local para lo corto; cloud + web cuando hace falta."
                onClick={() => setMode('smart')}
              />
              <ModeCard
                active={mode === 'local'}
                icon={<Server className="w-5 h-5" />}
                title="Solo local"
                desc="Privacidad total con Ollama. Sin API keys."
                onClick={() => setMode('local')}
              />
              <ModeCard
                active={mode === 'cloud'}
                icon={<Cloud className="w-5 h-5" />}
                title="Solo cloud"
                desc="Solo proveedores online. Sin instalar modelos."
                onClick={() => setMode('cloud')}
              />
            </div>
            <NavRow onBack={goBack} onNext={goNext} />
          </div>
        )}

        {step === 'local' && needsLocal && (
          <div className="max-w-xl mx-auto space-y-4 py-4">
            <div className="text-center">
              <h2 className="text-2xl font-extrabold text-kawaii-text">Ollama (local)</h2>
              {hw && (
                <p className="text-xs text-kawaii-text-muted mt-1 flex items-center justify-center gap-1">
                  <Cpu className="w-3.5 h-3.5" />
                  {recs?.profileSummary ?? `${hw.totalMemoryGB} GB RAM`}
                </p>
              )}
            </div>
            {setupStatus.ollamaReachable && setupStatus.hasLocalModel && (
              <div className="rounded-kawaii border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                ✓ Ollama responde y hay modelos instalados. Puedes continuar o cambiar el modelo.
              </div>
            )}

            <div className="space-y-2">
              <label className="block text-sm font-semibold">URL de Ollama</label>
              <input
                className="input-kawaii"
                value={localUrl}
                onChange={(e) => {
                  setLocalUrl(e.target.value)
                  setOllamaOk(null)
                }}
                onBlur={() => void checkOllama()}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="ghost"
                  className="text-xs"
                  onClick={() => void checkOllama()}
                  disabled={ollamaChecking}
                >
                  {ollamaChecking ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : null}
                  Probar conexión
                </Button>
                {ollamaOk === false && (
                  <Button
                    className="text-xs"
                    onClick={() => void startOllama()}
                    disabled={startingOllama}
                  >
                    {startingOllama ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Play className="w-3.5 h-3.5" />
                    )}
                    Iniciar Ollama
                  </Button>
                )}
                <button
                  type="button"
                  className="text-xs text-kawaii-pink-deep underline"
                  onClick={() => openLink('https://ollama.com/download')}
                >
                  Descargar Ollama
                </button>
              </div>
            </div>

            {ollamaOk === true && (
              <p className="text-sm text-green-700 flex items-center gap-1.5">
                <Check className="w-4 h-4" />
                Conectado
                {discoveredModels.length > 0
                  ? ` · ${discoveredModels.length} modelo(s)`
                  : ' · sin modelos aún'}
              </p>
            )}
            {ollamaError && (
              <p className="text-sm text-amber-800 flex items-start gap-1.5 bg-amber-50 border border-amber-200 rounded-kawaii px-3 py-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{ollamaError}</span>
              </p>
            )}

            {/* Hardware recommendations + one-click pull */}
            {recs && (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-kawaii-text">
                  Modelos sugeridos para tu PC
                </p>
                {renderRecCard(recs.primary, true)}
                {recs.alternatives.slice(0, 2).map((m) => renderRecCard(m))}
              </div>
            )}

            <div>
              <label className="block text-sm font-semibold mb-1">Modelo local activo</label>
              {discoveredModels.length > 0 ? (
                <select
                  className="input-kawaii"
                  value={localModel}
                  onChange={(e) => setLocalModel(e.target.value)}
                >
                  {discoveredModels.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="input-kawaii"
                  placeholder={recs?.primary.pullName || 'llama3.2:3b'}
                  value={localModel}
                  onChange={(e) => setLocalModel(e.target.value)}
                />
              )}
            </div>


            {discoveredModels.length > 0 && (
              <div className="space-y-1">
                <p className="text-sm font-semibold text-kawaii-text">Modelos instalados</p>
                <ul className="max-h-28 overflow-y-auto space-y-1">
                  {discoveredModels.map((name) => (
                    <li
                      key={name}
                      className="flex items-center justify-between gap-2 text-xs bg-white border border-kawaii-border rounded-lg px-2 py-1.5"
                    >
                      <button
                        type="button"
                        className={`truncate text-left flex-1 hover:text-kawaii-pink-deep ${
                          localModel === name ? 'font-bold text-kawaii-pink-deep' : ''
                        }`}
                        onClick={() => setLocalModel(name)}
                      >
                        {name}
                      </button>
                      <button
                        type="button"
                        className="text-red-600 hover:underline shrink-0 disabled:opacity-50"
                        disabled={deleting === name || Boolean(pullJobs[name])}
                        onClick={() => void deleteModel(name)}
                      >
                        {deleting === name ? '…' : 'Eliminar'}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {activePullCount > 0 && (
              <p className="text-[11px] text-kawaii-text-muted bg-kawaii-blue-soft/50 border border-kawaii-border rounded-kawaii px-3 py-2">
                {activePullCount} descarga(s) en segundo plano. Puedes pulsar{' '}
                <strong>Siguiente</strong> y seguir configurando; al terminar el modelo
                aparecerá en la lista. Usa <strong>Pausar</strong> para cancelar (Ollama suele
                reanudar al volver a descargar).
              </p>
            )}

            <NavRow
              onBack={goBack}
              onNext={goNext}
              nextDisabled={!canProceedLocal}
              nextLabel={
                activePullCount > 0
                  ? 'Seguir (descarga en curso)'
                  : ollamaOk === true && discoveredModels.length === 0
                    ? 'Continuar sin modelo'
                    : 'Siguiente'
              }
            />
          </div>
        )}

        {step === 'cloud' && needsCloud && (
          <>
          <div className="space-y-4 py-4">
            <div className="text-center">
              <h2 className="text-2xl font-extrabold text-kawaii-text">Cloud + modelos free</h2>
              <p className="text-kawaii-text-muted text-sm mt-1 max-w-md mx-auto">
                Elige proveedor, verifica la key y el modelo free. El router Smart usará este
                endpoint cuando haga falta.
              </p>
            </div>

            {(setupStatus.hasOpenRouterKey || setupStatus.hasAnyCloudKey) && (
              <div className="rounded-kawaii border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                ✓ API key ya guardada
                {setupStatus.cloudProvidersReady.length > 0
                  ? ` (${setupStatus.cloudProvidersReady.join(', ')})`
                  : ''}
                . Puedes continuar sin volver a pegarla; solo rellénala si quieres cambiarla.
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {CLOUD_PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setSelectedCloudId(p.id)
                    setKeyTestResult(null)
                    setKeyTestDetail(null)
                  }}
                  className={`text-left rounded-kawaii border-2 p-3 transition ${
                    selectedCloudId === p.id
                      ? 'border-kawaii-pink-deep bg-kawaii-pink-soft/50 shadow-kawaii'
                      : 'border-kawaii-border bg-white hover:border-kawaii-pink'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xl">{p.emoji}</span>
                    <span className="font-bold text-sm">{p.name}</span>
                    {selectedCloudId === p.id && (
                      <Check className="w-3.5 h-3.5 text-kawaii-pink-deep ml-auto" />
                    )}
                  </div>
                  <p className="text-[10px] font-semibold text-kawaii-pink-deep">{p.badge}</p>
                  <p className="text-[11px] text-kawaii-text-muted mt-1">{p.description}</p>
                </button>
              ))}
            </div>

            <div className="max-w-lg mx-auto space-y-2">
              <button
                type="button"
                onClick={() => openLink(selectedCloud.keyUrl)}
                className="flex items-center gap-1 text-sm text-kawaii-pink-deep hover:underline"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Crear / copiar API key en {selectedCloud.name}
              </button>
              <input
                className="input-kawaii"
                type="password"
                autoComplete="off"
                placeholder="Pega tu API key…"
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value)
                  setKeyTestResult(null)
                }}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="ghost"
                  className="text-xs"
                  disabled={apiKey.trim().length < 8 || keyTesting}
                  onClick={() => void testCloudKey()}
                >
                  {keyTesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  Verificar conexión
                </Button>
                {keyTestResult === 'ok' && (
                  <span className="text-xs text-green-700 flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" /> {keyTestDetail}
                  </span>
                )}
                {keyTestResult === 'fail' && (
                  <span className="text-xs text-red-600 flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5" /> {keyTestDetail}
                  </span>
                )}
              </div>

              {selectedCloudId === 'openrouter' && (
              <div className="rounded-kawaii border border-kawaii-border bg-white p-2 space-y-1">
                <p className="text-[11px] font-semibold text-kawaii-text">
                  Modelos free en vivo (OpenRouter)
                </p>
                <p className="text-[10px] text-kawaii-text-muted">
                  {freeDiscovering
                    ? 'Consultando catálogo…'
                    : freeDiscoverMsg || 'Lista de respaldo si no hay red'}
                </p>
                <p className="text-[10px] text-kawaii-text-muted">
                  Recomendado: <code>openrouter/free</code> — evita slugs free que dejan de
                  existir. El asistente lo selecciona solo cuando puede.
                </p>
                {liveFreeModels.length > 0 && (
                  <select
                    className="input-kawaii text-xs w-full"
                    value={selectedCloudModel}
                    onChange={(e) => setSelectedCloudModel(e.target.value)}
                  >
                    {liveFreeModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({m.id})
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}
            {cloudModels.length > 0 && (
                <div>
                  <label className="block text-sm font-semibold mb-1">Modelo cloud</label>
                  <select
                    className="input-kawaii"
                    value={selectedCloudModel}
                    onChange={(e) => setSelectedCloudModel(e.target.value)}
                  >
                    {cloudModels.map((m) => (
                      <option key={m.modelId} value={m.modelId}>
                        {m.free ? '🆓 ' : '💳 '}
                        {m.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-kawaii-text-muted mt-1">
                    {cloudModels.find((m) => m.modelId === selectedCloudModel)?.notes}
                  </p>
                </div>
              )}

              <div className="text-[11px] text-kawaii-text-muted bg-white/70 border border-kawaii-border rounded-kawaii p-2">
                <strong className="text-kawaii-text">Router interno:</strong> en modo Smart, los
                prompts cortos van a local; noticias/web y prompts largos a este cloud. Si el
                proveedor falla, el circuit breaker evita reintentos inútiles.
              </div>
            </div>

            <NavRow
              onBack={goBack}
              onNext={goNext}
              nextDisabled={!canProceedCloud}
              nextLabel="Siguiente"
            />
          </div>
          </>
        )}

        {step === 'images' && (
          <div className="card-kawaii space-y-4 animate-in">
            <div className="flex items-center gap-2">
              <ImageIcon className="w-6 h-6 text-kawaii-pink-deep" />
              <h2 className="text-xl font-bold text-kawaii-text">Imágenes (opcional)</h2>
            </div>
            <p className="text-sm text-kawaii-text-muted leading-relaxed">
              Puedes generar imágenes desde el chat sin tocar el flujo de texto. Si no las
              necesitas ahora, déjalo desactivado y actívalo después en Ajustes.
            </p>
            <div className="rounded-kawaii border border-kawaii-border bg-kawaii-pink-soft/30 px-3 py-2 text-xs text-kawaii-text">
              <span className="font-semibold">Tu equipo: </span>
              {imageRecSummary}
              {hw?.gpuName ? (
                <span className="block text-kawaii-text-muted mt-0.5 truncate">
                  GPU: {hw.gpuName}
                  {hw.vramGB != null ? ` · ~${hw.vramGB} GB VRAM` : ''}
                </span>
              ) : null}
            </div>

            {hw && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-kawaii-text">Qué puede instalar / usar</p>
                {recommendGenerativeStack({
                  totalMemoryGB: hw.totalMemoryGB,
                  vramGB: hw.vramGB ?? null,
                  hasDiscreteGpu: hw.hasDiscreteGpu ?? null
                }).map((g) => (
                  <div
                    key={g.id}
                    className="rounded-kawaii border border-kawaii-border bg-white p-2 text-xs"
                  >
                    <p className="font-semibold text-kawaii-text">{g.title}</p>
                    <p className="text-kawaii-text-muted mt-0.5">{g.summary}</p>
                    <ul className="list-disc ml-4 mt-1 text-kawaii-text-muted space-y-0.5">
                      {g.steps.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                    {g.learnMoreUrl && (
                      <button
                        type="button"
                        className="text-kawaii-pink-deep font-semibold mt-1 hover:underline"
                        onClick={() => openLink(g.learnMoreUrl!)}
                      >
                        Abrir guía / descarga →
                      </button>
                    )}
                    {g.ollamaPull && (
                      <button
                        type="button"
                        className="block text-kawaii-pink-deep font-semibold mt-1 hover:underline"
                        onClick={() => void pullModel(g.ollamaPull!)}
                      >
                        Descargar en segundo plano: {g.ollamaPull}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            <label className="flex items-start gap-3 rounded-kawaii border-2 p-3 cursor-pointer transition border-kawaii-border bg-white hover:border-kawaii-pink">
              <input
                type="checkbox"
                className="mt-1"
                checked={imageWanted}
                onChange={(e) => setImageWanted(e.target.checked)}
              />
              <span>
                <span className="font-semibold text-sm text-kawaii-text block">
                  Activar generación de imágenes
                </span>
                <span className="text-xs text-kawaii-text-muted">
                  Botón en el chat y comando <code>/image …</code>
                </span>
              </span>
            </label>
            {imageWanted && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-kawaii-text">¿Cómo generar?</p>
                <ModeCard
                  active={imageMode === 'cloud'}
                  icon={<Cloud className="w-5 h-5" />}
                  title="Cloud gratis (Pollinations)"
                  desc="Sin instalar nada ni API key. Ideal para empezar."
                  onClick={() => setImageMode('cloud')}
                />
                <ModeCard
                  active={imageMode === 'smart'}
                  icon={<Sparkles className="w-5 h-5" />}
                  title="Smart (local → cloud)"
                  desc="Usa Forge/A1111 si está en marcha; si no, Pollinations."
                  onClick={() => setImageMode('smart')}
                />
                <ModeCard
                  active={imageMode === 'local'}
                  icon={<Server className="w-5 h-5" />}
                  title="Solo local (Forge / A1111)"
                  desc="Requiere WebUI con --api y un checkpoint SD. Mejor con GPU."
                  onClick={() => setImageMode('local')}
                />
                {(imageMode === 'local' || imageMode === 'smart') && (
                  <div className="space-y-2 rounded-kawaii border border-kawaii-border p-3 bg-white">
                    <SdWorkspacePanel compact />
                    <label className="text-xs font-semibold text-kawaii-text">
                      URL de Forge / Automatic1111
                    </label>
                    <input
                      className="input-kawaii text-sm w-full"
                      value={a1111Url}
                      onChange={(e) => setA1111Url(e.target.value)}
                      placeholder="http://127.0.0.1:7860"
                    />
                    <p className="text-[10px] text-kawaii-text-muted">
                      Arranca el WebUI con <code>--api</code>. Checkpoints en la carpeta models
                      del WebUI (SD 1.5 si poca VRAM; SDXL si 8 GB o mas).
                    </p>
                    <Button
                      variant="ghost"
                      className="text-xs"
                      disabled={a1111Probe === 'loading'}
                      onClick={async () => {
                        setA1111Probe('loading')
                        setA1111Detail(null)
                        try {
                          const h = await window.kawaii.imageA1111Health?.(a1111Url)
                          if (h?.ok) {
                            setA1111Probe('ok')
                            const models = await window.kawaii.imageA1111Models?.(a1111Url)
                            const n = models?.models?.length ?? h.modelsCount ?? 0
                            setA1111Detail(
                              `Conectado · ${n} checkpoint(s)${
                                models?.current ? ` · actual: ${models.current}` : ''
                              }`
                            )
                            if (models?.current) {
                              update({ a1111Checkpoint: models.current })
                            } else if (models?.models?.[0]?.title) {
                              update({ a1111Checkpoint: models.models[0].title })
                            }
                          } else {
                            setA1111Probe('fail')
                            setA1111Detail(h?.error || 'No responde')
                          }
                        } catch (err) {
                          setA1111Probe('fail')
                          setA1111Detail(err instanceof Error ? err.message : String(err))
                        }
                      }}
                    >
                      {a1111Probe === 'loading' ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : null}
                      Probar WebUI
                    </Button>
                    {a1111Probe === 'ok' && (
                      <p className="text-xs text-green-700 flex items-center gap-1">
                        <Check className="w-3.5 h-3.5" /> {a1111Detail}
                      </p>
                    )}
                    {a1111Probe === 'fail' && (
                      <p className="text-xs text-amber-800 flex items-start gap-1">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        {a1111Detail || 'WebUI no disponible'} — puedes seguir; Smart usará
                        cloud si hace falta.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
            <NavRow onBack={goBack} onNext={goNext} nextLabel="Continuar" />
          </div>
        )}

        {step === 'done' && (
          <div className="max-w-md mx-auto text-center space-y-6 py-6">
            <div className="text-6xl">✨</div>
            <div>
              <h2 className="text-3xl font-extrabold text-kawaii-text mb-2">¡Listo!</h2>
              <p className="text-kawaii-text-muted text-sm">
                Configuración guardada. Prueba un mensaje para activar el router.
              </p>
            </div>
            <div className="card-kawaii p-4 text-left space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-kawaii-pink-deep" />
                <span>
                  Modo: <strong>{mode}</strong>
                </span>
              </div>
              {needsLocal && (
                <div className="text-kawaii-text-muted text-xs pl-6">
                  Local: {localModel || '(pendiente)'} ·{' '}
                  {ollamaOk === true ? 'online' : 'offline'}
                </div>
              )}
              {needsCloud && (
                <div className="text-kawaii-text-muted text-xs pl-6">
                  Cloud: {selectedCloud.name} · {selectedCloudModel}
                </div>
              )}
            </div>
            <div className="text-left bg-white/80 border border-kawaii-border rounded-kawaii p-3 text-xs text-kawaii-text-muted space-y-1">
              <p className="font-semibold text-kawaii-text text-sm mb-1">Prueba con:</p>
              <p>«Explícame closures en JavaScript»</p>
              <p>«Busca noticias de IA de hoy y resúmelas»</p>
              {imageWanted ? (
                <p className="mt-1">«/image gato kawaii rosa» o el botón Generar imagen</p>
              ) : null}
            </div>
            <div className="text-left text-xs text-kawaii-text-muted rounded-kawaii border border-kawaii-border bg-white/80 p-2 space-y-1">
              <p className="font-semibold text-kawaii-text">Resumen</p>
              <p>Modo: {mode}</p>
              {setupStatus.hasAnyCloudKey && <p>✓ Cloud con key lista</p>}
              {setupStatus.ollamaReachable && <p>✓ Ollama reachable</p>}
              {needsLocal && !setupStatus.ollamaReachable && <p>○ Local pendiente (puedes configurarlo luego en Ajustes)</p>}
              {!needsCloud && <p>Cloud no requerido en este modo</p>}
            </div>
            <Button className="w-full py-3 text-base" onClick={handleFinish} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              🌸 Empezar a chatear
            </Button>
            <button type="button" className="text-xs text-kawaii-text-muted hover:underline" onClick={goBack}>
              ← Volver a editar
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function FeatureCard({ emoji, title, desc }: { emoji: string; title: string; desc: string }) {
  return (
    <div className="bg-white border border-kawaii-border rounded-kawaii p-3 shadow-kawaii">
      <div className="text-2xl mb-1">{emoji}</div>
      <div className="font-bold text-xs text-kawaii-text">{title}</div>
      <div className="text-[11px] text-kawaii-text-muted mt-0.5">{desc}</div>
    </div>
  )
}

function ModeCard({
  active,
  icon,
  title,
  desc,
  onClick
}: {
  active: boolean
  icon: ReactNode
  title: string
  desc: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-kawaii border-2 p-4 flex gap-3 transition ${
        active
          ? 'border-kawaii-pink-deep bg-kawaii-pink-soft/40 shadow-kawaii'
          : 'border-kawaii-border bg-white hover:border-kawaii-pink'
      }`}
    >
      <div className="text-kawaii-pink-deep mt-0.5">{icon}</div>
      <div>
        <div className="font-bold text-sm text-kawaii-text flex items-center gap-2">
          {title}
          {active && <Check className="w-3.5 h-3.5" />}
        </div>
        <p className="text-xs text-kawaii-text-muted mt-0.5 leading-relaxed">{desc}</p>
      </div>
    </button>
  )
}

function NavRow({
  onBack,
  onNext,
  nextDisabled,
  nextLabel = 'Siguiente'
}: {
  onBack: () => void
  onNext: () => void
  nextDisabled?: boolean
  nextLabel?: string
}) {
  return (
    <div className="flex justify-between items-center pt-2">
      <button type="button" className="text-sm text-kawaii-text-muted hover:underline" onClick={onBack}>
        ← Atrás
      </button>
      <Button onClick={onNext} disabled={nextDisabled}>
        {nextLabel} <ChevronRight className="w-4 h-4" />
      </Button>
    </div>
  )
}
