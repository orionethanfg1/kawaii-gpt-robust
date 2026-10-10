/**
 * Unified model acquire (pull / register / guide).
 * Keeps Ollama and LM Studio as first-class backends with ordered fallbacks.
 * Never assumes only one runtime; records every attempt for the UI/harness.
 */

import { resolveLocalRuntime } from './resolve-local'

export type PullChannel = 'ollama' | 'lmstudio' | 'huggingface' | 'manual'

export type PullAttempt = {
  channel: PullChannel
  action: string
  ok: boolean
  detail?: string
}

export type UnifiedPullResult = {
  ok: boolean
  /** True if download started or model already present */
  acquired: boolean
  modelRef: string
  /** Normalized ref used for Ollama pull when applicable */
  ollamaRef?: string
  activeModel?: string
  attempts: PullAttempt[]
  summary: string
  /** Optional URL the host should open (HF / Ollama library / LM Studio) */
  openUrl?: string
  /** Suggested next step for the user */
  nextStep?: string
}

export type UnifiedPullOptions = {
  model: string
  ollamaBaseUrl?: string
  openAIBaseUrl?: string
  /** Prefer starting Ollama once if pull needs it */
  tryStartOllama?: boolean
  /** When true, only check / select if already installed (no network pull) */
  selectOnly?: boolean
  /** IPC bridges (renderer). Optional in pure unit tests. */
  bridges?: {
    ollamaPull?: (
      model: string,
      baseUrl?: string
    ) => Promise<{ ok?: boolean; error?: string; cancelled?: boolean } | undefined>
    ollamaStart?: (baseUrl?: string) => Promise<{ ok?: boolean; message?: string } | undefined>
    ollamaStatus?: (baseUrl?: string) => Promise<{ reachable?: boolean } | undefined>
    openExternal?: (url: string) => Promise<unknown>
  }
}

function classifyRef(raw: string): {
  kind: 'ollama-tag' | 'hf-gguf' | 'lmstudio-id' | 'unknown'
  ollamaRef: string
  display: string
} {
  const model = raw.trim()
  if (!model) {
    return { kind: 'unknown', ollamaRef: '', display: '' }
  }
  if (/^hf\.co\//i.test(model) || /^huggingface\.co\//i.test(model)) {
    const ollamaRef = model.replace(/^huggingface\.co\//i, 'hf.co/')
    return { kind: 'hf-gguf', ollamaRef, display: model }
  }
  if (model.includes('/') && !model.includes(':')) {
    // publisher/name — LM Studio style; Ollama can often pull as hf.co/publisher/name
    return {
      kind: 'lmstudio-id',
      ollamaRef: `hf.co/${model}`,
      display: model
    }
  }
  if (/:[a-z0-9._-]+$/i.test(model) || !model.includes('/')) {
    return {
      kind: 'ollama-tag',
      ollamaRef: model.includes(':') ? model : `${model}:latest`,
      display: model
    }
  }
  return { kind: 'unknown', ollamaRef: model, display: model }
}

function libraryUrl(model: string, kind: string): string {
  if (kind === 'hf-gguf' || kind === 'lmstudio-id') {
    const id = model.replace(/^hf\.co\//i, '').replace(/^huggingface\.co\//i, '')
    return `https://huggingface.co/${id}`
  }
  const name = model.split(':')[0]
  return `https://ollama.com/library/${encodeURIComponent(name)}`
}

/**
 * Acquire a model using every available local channel, with graceful degradation.
 */
export async function unifiedPullModel(opts: UnifiedPullOptions): Promise<UnifiedPullResult> {
  const raw = (opts.model || '').trim()
  const attempts: PullAttempt[] = []
  if (!raw) {
    return {
      ok: false,
      acquired: false,
      modelRef: '',
      attempts,
      summary: 'Falta el nombre del modelo'
    }
  }

  const classified = classifyRef(raw)
  const bridges = opts.bridges || {}
  const ollamaBase = (opts.ollamaBaseUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '')

  // --- 0) Already installed on ANY backend (probe both; never prefer one exclusively) ---
  try {
    const { probeLocalBackends } = await import('./local-backend')
    const probed = await probeLocalBackends({
      ollamaBaseUrl: ollamaBase,
      openAIBaseUrl: opts.openAIBaseUrl
    })
    const matchIn = (
      models: { id: string }[],
      channel: PullChannel,
      label: string
    ): UnifiedPullResult | null => {
      const hit = models.find(
        (m) =>
          m.id === classified.display ||
          m.id === classified.ollamaRef ||
          m.id.toLowerCase() === classified.display.toLowerCase() ||
          m.id.toLowerCase().includes(classified.display.toLowerCase().split(':')[0])
      )
      if (!hit) return null
      attempts.push({
        channel,
        action: 'already-installed',
        ok: true,
        detail: hit.id
      })
      return {
        ok: true,
        acquired: true,
        modelRef: raw,
        ollamaRef: classified.ollamaRef,
        activeModel: hit.id,
        attempts,
        summary: `Ya disponible en ${label}: ${hit.id}`,
        nextStep: `Usar como localModel: ${hit.id}`
      }
    }
    if (probed.ollama?.healthy) {
      const hit = matchIn(probed.ollama.models, 'ollama', probed.ollama.label)
      if (hit) return hit
    }
    if (probed.openAI?.healthy) {
      const hit = matchIn(probed.openAI.models, 'lmstudio', probed.openAI.label)
      if (hit) return hit
    }
  } catch {
    attempts.push({
      channel: 'manual',
      action: 'probe-installed',
      ok: false,
      detail: 'probe failed'
    })
  }

  if (opts.selectOnly) {
    return {
      ok: false,
      acquired: false,
      modelRef: raw,
      attempts,
      summary: 'Modelo no encontrado en runtimes locales (selectOnly)',
      nextStep: 'Descarga con Ollama o importa en LM Studio'
    }
  }

  // --- 1) Ensure Ollama up if we plan to pull ---
  let ollamaUp = false
  try {
    const st = await bridges.ollamaStatus?.(ollamaBase)
    ollamaUp = Boolean(st?.reachable)
  } catch {
    ollamaUp = false
  }
  if (!ollamaUp) {
    try {
      const res = await fetch(`${ollamaBase}/api/tags`, { signal: AbortSignal.timeout(2_000) })
      ollamaUp = res.ok
    } catch {
      ollamaUp = false
    }
  }

  if (!ollamaUp && opts.tryStartOllama !== false && bridges.ollamaStart) {
    try {
      const started = await bridges.ollamaStart(ollamaBase)
      attempts.push({
        channel: 'ollama',
        action: 'start',
        ok: Boolean(started?.ok),
        detail: started?.message
      })
      if (started?.ok) {
        ollamaUp = true
        await new Promise((r) => setTimeout(r, 800))
      }
    } catch (e) {
      attempts.push({
        channel: 'ollama',
        action: 'start',
        ok: false,
        detail: e instanceof Error ? e.message : String(e)
      })
    }
  }

  // --- 2) Primary: Ollama pull (works for tags + hf.co/) ---
  if (ollamaUp && bridges.ollamaPull && classified.ollamaRef) {
    try {
      const r = await bridges.ollamaPull(classified.ollamaRef, ollamaBase)
      const ok = Boolean(r?.ok !== false && !r?.cancelled)
      attempts.push({
        channel: 'ollama',
        action: `pull ${classified.ollamaRef}`,
        ok,
        detail: r?.error || (r?.cancelled ? 'cancelled' : ok ? 'started/done' : 'failed')
      })
      if (ok) {
        return {
          ok: true,
          acquired: true,
          modelRef: raw,
          ollamaRef: classified.ollamaRef,
          activeModel: classified.ollamaRef,
          attempts,
          summary: `Descarga Ollama iniciada/completada: ${classified.ollamaRef}`,
          nextStep: 'Progreso en la barra de descargas. Luego elige el modelo en Ajustes.'
        }
      }
    } catch (e) {
      attempts.push({
        channel: 'ollama',
        action: `pull ${classified.ollamaRef}`,
        ok: false,
        detail: e instanceof Error ? e.message : String(e)
      })
    }
  } else if (!ollamaUp) {
    attempts.push({
      channel: 'ollama',
      action: 'pull-skipped',
      ok: false,
      detail: 'Ollama no reachable'
    })
  }

  // --- 3) LM Studio path: if server is up, point user to load / set active ---
  try {
    const lm = await resolveLocalRuntime({
      preference: 'openai-compatible',
      ollamaBaseUrl: ollamaBase,
      openAIBaseUrl: opts.openAIBaseUrl,
      preferredModel: classified.display
    })
    if (lm?.kind === 'openai-compatible') {
      attempts.push({
        channel: 'lmstudio',
        action: 'server-ok',
        ok: true,
        detail: lm.baseUrl
      })
      // Cannot remote-pull into LM Studio via public OpenAI API; guide + optional HF page
      const openUrl = libraryUrl(classified.display, classified.kind)
      if (bridges.openExternal) {
        try {
          await bridges.openExternal(openUrl)
          attempts.push({ channel: 'huggingface', action: 'open-page', ok: true, detail: openUrl })
        } catch {
          attempts.push({ channel: 'huggingface', action: 'open-page', ok: false, detail: openUrl })
        }
      }
      return {
        ok: true,
        acquired: false,
        modelRef: raw,
        ollamaRef: classified.ollamaRef,
        attempts,
        summary:
          `LM Studio está activo, pero la descarga remota de «${classified.display}» no está en la API pública. ` +
          `Ábrelo en la app LM Studio (Discover) o usa Ollama para pull automático.`,
        openUrl,
        nextStep:
          'En LM Studio: Discover → busca el modelo → Download → Developer → Start Server. ' +
          'Si instalas Ollama, la app puede hacer pull automático de tags y hf.co/…'
      }
    }
  } catch (e) {
    attempts.push({
      channel: 'lmstudio',
      action: 'probe',
      ok: false,
      detail: e instanceof Error ? e.message : String(e)
    })
  }

  // --- 4) Last resort: open library page ---
  const openUrl = libraryUrl(classified.display, classified.kind)
  if (bridges.openExternal) {
    try {
      await bridges.openExternal(openUrl)
      attempts.push({ channel: 'manual', action: 'open-library', ok: true, detail: openUrl })
    } catch {
      attempts.push({ channel: 'manual', action: 'open-library', ok: false, detail: openUrl })
    }
  }

  return {
    ok: false,
    acquired: false,
    modelRef: raw,
    ollamaRef: classified.ollamaRef,
    attempts,
    summary:
      `No se pudo completar el pull de «${raw}». ` +
      `Intentos: ${attempts.map((a) => `${a.channel}:${a.ok ? 'ok' : 'fail'}`).join(', ')}. ` +
      `Instala/inicia Ollama para descargas automáticas, o descarga en LM Studio manualmente.`,
    openUrl,
    nextStep: 'Inicia Ollama (pull automático) o descarga el GGUF en LM Studio'
  }
}

/** Build renderer bridges from window.kawaii when available */
export function bridgesFromWindow(): UnifiedPullOptions['bridges'] {
  if (typeof window === 'undefined' || !window.kawaii) return {}
  const k = window.kawaii
  return {
    ollamaPull: (model, baseUrl) => k.ollamaPull?.(model, baseUrl),
    ollamaStart: (baseUrl) => k.ollamaStart?.(baseUrl),
    ollamaStatus: (baseUrl) => k.ollamaStatus?.(baseUrl),
    openExternal: (url) => k.openExternal?.(url)
  }
}
