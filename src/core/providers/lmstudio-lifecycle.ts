/**
 * LM Studio v1 REST — load / unload models in memory.
 * Docs: POST /api/v1/models/load  { model }
 *       POST /api/v1/models/unload { instance_id }
 * OpenAI /v1/models lists JIT-visible models; load is required for explicit switch
 * when another model already occupies VRAM.
 */

import { localHttp } from './local-http'

export type LmLoadResult = {
  ok: boolean
  instanceId?: string
  error?: string
  detail?: string
}

export type LmUnloadResult = {
  ok: boolean
  unloaded: string[]
  error?: string
  detail?: string
}

function rootFromBase(baseUrl: string): string {
  // http://127.0.0.1:1234 or .../v1 → strip /v1
  return baseUrl.replace(/\/+$/, '').replace(/\/v1$/i, '')
}

export type LmAuthOpts = {
  /** Bearer token when LMS requires auth (C5) */
  apiToken?: string
}

function authHeaders(opts?: LmAuthOpts): Record<string, string> {
  const token = (opts?.apiToken || '').trim()
  if (token) return { Authorization: `Bearer ${token}` }
  // Default local token many LMS builds accept
  return { Authorization: 'Bearer lm-studio' }
}

/** List models; prefer native APIs that expose loaded vs not-loaded state. */
export async function listLmStudioModels(
  baseUrl: string,
  opts?: LmAuthOpts
): Promise<Array<{ id: string; state?: string; instanceId?: string }>> {
  const root = rootFromBase(baseUrl)
  const headers = authHeaders(opts)
  // v0 exposes state: loaded | not-loaded
  try {
    const res = await localHttp(`${root}/api/v0/models`, {
      method: 'GET',
      timeoutMs: 8_000,
      headers
    })
    if (res.ok) {
      const json = (await res.json()) as {
        data?: Array<{ id?: string; state?: string; instance_id?: string }>
      }
      const rows = json.data || []
      if (rows.length) {
        return rows
          .map((m) => ({
            id: String(m.id || '').trim(),
            state: m.state,
            instanceId: m.instance_id ? String(m.instance_id) : undefined
          }))
          .filter((m) => m.id)
      }
    }
  } catch {
    /* try v1 */
  }
  try {
    const res = await localHttp(`${root}/api/v1/models`, {
      method: 'GET',
      timeoutMs: 8_000,
      headers
    })
    if (res.ok) {
      const json = (await res.json()) as {
        models?: Array<{ id?: string; model?: string; state?: string; instance_id?: string }>
        data?: Array<{ id?: string; state?: string; instance_id?: string }>
      }
      const rows = json.models || json.data || []
      return rows
        .map((m) => ({
          id: String(m.id || (m as { model?: string }).model || '').trim(),
          state: m.state,
          instanceId: m.instance_id ? String(m.instance_id) : undefined
        }))
        .filter((m) => m.id)
    }
  } catch {
    /* fallback */
  }
  // OpenAI /v1/models = often JIT catalog, NOT proof of residency — mark unknown
  try {
    const res = await localHttp(`${root}/v1/models`, {
      method: 'GET',
      timeoutMs: 8_000,
      headers
    })
    if (!res.ok) return []
    const json = (await res.json()) as { data?: Array<{ id?: string }> }
    return (json.data || [])
      .map((m) => ({ id: String(m.id || '').trim(), state: 'unknown' as string }))
      .filter((m) => m.id)
  } catch {
    return []
  }
}

function sameModelFamily(a: string, b: string): boolean {
  const na = a.toLowerCase().replace(/[^a-z0-9]+/g, '')
  const nb = b.toLowerCase().replace(/[^a-z0-9]+/g, '')
  if (!na || !nb) return false
  if (na === nb) return true
  // Require tight match: avoid treating qwen3-14b and abliterated as same
  const stripQuant = (s: string) =>
    s.replace(/q[2-8]k[msl]*/g, '').replace(/gguf/g, '').replace(/abliterated/g, 'ablit')
  return stripQuant(na) === stripQuant(nb)
}

/** Vision / embedding helpers — never share VRAM with the chat LLM */
function isAuxiliaryModelId(id: string): boolean {
  return /embed|mmproj|clip|moondream|llava|bakllava|minicpm-v|vision|whisper/i.test(id)
}

function isVisionOnlyId(id: string): boolean {
  return /moondream|llava|bakllava|minicpm-v|\bvision\b/i.test(id) && !/gemma-?4|gemma4|qwen.*vl/i.test(id)
}

export async function loadLmStudioModel(
  modelId: string,
  baseUrl: string,
  opts?: { contextLength?: number; apiToken?: string; disabledLocalModels?: string[] }
): Promise<LmLoadResult> {
  const model = (modelId || '').trim()
  if (!model) return { ok: false, error: 'empty model' }
  try {
    const { isLocalModelDisabled } = await import('../models/disabled-local-models')
    if (isLocalModelDisabled(model, opts?.disabledLocalModels)) {
      return { ok: false, error: `modelo desactivado en la app: ${model}` }
    }
  } catch {
    /* optional */
  }
  const root = rootFromBase(baseUrl)
  try {
    const body: Record<string, unknown> = { model }
    if (opts?.contextLength) body.context_length = opts.contextLength
    const res = await localHttp(`${root}/api/v1/models/load`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(opts) },
      body: JSON.stringify(body),
      timeoutMs: 300_000
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      return {
        ok: false,
        error: t.slice(0, 200) || `HTTP ${res.status}`,
        detail: 'LM Studio load falló'
      }
    }
    const json = (await res.json()) as { instance_id?: string; status?: string }
    return {
      ok: true,
      instanceId: json.instance_id || model,
      detail: `LM Studio cargó ${json.instance_id || model}`
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function unloadLmStudioModel(
  instanceId: string,
  baseUrl: string,
  opts?: LmAuthOpts
): Promise<{ ok: boolean; error?: string }> {
  const id = (instanceId || '').trim()
  if (!id) return { ok: false, error: 'empty instance' }
  const root = rootFromBase(baseUrl)
  try {
    const res = await localHttp(`${root}/api/v1/models/unload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(opts) },
      body: JSON.stringify({ instance_id: id }),
      timeoutMs: 60_000
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      return { ok: false, error: t.slice(0, 160) || `HTTP ${res.status}` }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Serialize LMS load/unload so chat + initiative never race-load two models. */
let lmSwitchChain: Promise<unknown> = Promise.resolve()

function withLmSwitchLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = lmSwitchChain.then(fn, fn)
  lmSwitchChain = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

/**
 * Ensure `keepModel` is the only loaded LLM in LM Studio.
 * Unloads every other loaded/active instance (except embed/mmproj), then loads keep.
 * Never leaves two chat models resident.
 */
export async function switchLmStudioToModel(
  keepModel: string,
  baseUrl: string,
  auth?: LmAuthOpts
): Promise<LmUnloadResult & { loaded?: boolean }> {
  return withLmSwitchLock(async () => {
    const keep = (keepModel || '').trim()
    if (!keep) {
      return { ok: false, unloaded: [], error: 'empty keep', detail: 'sin modelo destino' }
    }

    const listed = await listLmStudioModels(baseUrl, auth)
    // C4: only explicit loaded/active — never treat full JIT catalog as resident
    const loaded = listed.filter((m) => m.state && /^(loaded|active)$/i.test(m.state))

    const unloaded: string[] = []
    const keepIsVision = isVisionOnlyId(keep)
    const tryUnload = async (id: string, instanceId?: string) => {
      // Always free pure vision/embed when the target is a chat LLM
      const mustDropVision = !keepIsVision && isVisionOnlyId(id)
      if (/embed|mmproj|clip/i.test(id) && !mustDropVision) return
      // Unload anything that is not the keep target
      if (!mustDropVision && (id === keep || sameModelFamily(id, keep))) return
      for (const key of [instanceId, id].filter(Boolean) as string[]) {
        const r = await unloadLmStudioModel(key, baseUrl, auth)
        if (r.ok) {
          unloaded.push(id)
          return
        }
      }
    }

    // First pass: free everyone else (and vision auxiliaries) before load
    for (const m of loaded) {
      await tryUnload(m.id, m.instanceId)
    }

    const alreadyKeep = loaded.some(
      (m) =>
        (m.id === keep || sameModelFamily(m.id, keep)) &&
        m.state &&
        /^(loaded|active)$/i.test(m.state)
    )

    let loadOk = alreadyKeep
    let loadErr: string | undefined
    if (!alreadyKeep) {
      const keepInCatalog = listed.some(
        (m) => m.id === keep || sameModelFamily(m.id, keep)
      )
      // Don't eject the only resident model to chase a stale settings id
      if (!keepInCatalog && loaded.length >= 1) {
        const resident = loaded.find((m) => !/embed|mmproj|clip/i.test(m.id))
        return {
          ok: true,
          loaded: true,
          unloaded: [],
          detail: resident
            ? `LMS conserva «${resident.id}» (pedido «${keep}» no está en catálogo — no se carga un segundo modelo)`
            : `LMS sin cambio (pedido «${keep}» ausente)`
        }
      }
      const load = await loadLmStudioModel(keep, baseUrl, auth)
      loadOk = load.ok
      loadErr = load.error
    }

    // Second + third pass: never leave 2+ chat models
    for (let pass = 0; pass < 2; pass++) {
      try {
        const after = await listLmStudioModels(baseUrl, auth)
        const still = after.filter((m) => m.state && /^(loaded|active)$/i.test(m.state))
        const chatLoaded = still.filter((m) => !/embed|mmproj|clip/i.test(m.id))
        for (const m of chatLoaded) {
          if (m.id === keep || sameModelFamily(m.id, keep)) continue
          await tryUnload(m.id, m.instanceId)
        }
        // If still >1 distinct chat models, unload non-keep aggressively
        const still2 = (await listLmStudioModels(baseUrl, auth)).filter(
          (m) => m.state && /^(loaded|active)$/i.test(m.state) && !/embed|mmproj|clip/i.test(m.id)
        )
        if (still2.length <= 1) break
        for (const m of still2) {
          if (sameModelFamily(m.id, keep)) continue
          await tryUnload(m.id, m.instanceId)
        }
      } catch {
        /* */
      }
    }

    return {
      ok: loadOk,
      loaded: loadOk,
      unloaded: [...new Set(unloaded)],
      error: loadOk ? undefined : loadErr,
      detail: loadOk
        ? `LMS solo «${keep}»` +
          (unloaded.length ? `; liberados: ${[...new Set(unloaded)].join(', ')}` : '')
        : loadErr || 'load falló'
    }
  })
}

/**
 * Call before every LMS chat completion: if another model is resident, unload it
 * and ensure `modelId` is the single resident (or skip load if already keep).
 */
export async function ensureLmStudioSingleResident(
  modelId: string,
  baseUrl: string,
  auth?: LmAuthOpts
): Promise<{ ok: boolean; detail: string }> {
  const keep = (modelId || '').trim()
  if (!keep) return { ok: false, detail: 'sin modelo' }
  try {
    const listed = await listLmStudioModels(baseUrl, auth)
    const loaded = listed.filter(
      (m) =>
        m.state &&
        /^(loaded|active)$/i.test(m.state) &&
        !/embed|mmproj|clip/i.test(m.id)
    )
    const visionExtra = loaded.filter(
      (m) => isVisionOnlyId(m.id) && !isVisionOnlyId(keep) && !sameModelFamily(m.id, keep)
    )
    const onlyKeep =
      loaded.length === 1 &&
      (loaded[0].id === keep || sameModelFamily(loaded[0].id, keep)) &&
      visionExtra.length === 0
    const none = loaded.length === 0
    if (onlyKeep) return { ok: true, detail: 'ya único residente' }
    // 0 or 2+ or wrong model or leftover moondream → full switch
    const r = await switchLmStudioToModel(keep, baseUrl, auth)
    // Settle: LMS state lags; re-check dual load once
    try {
      await new Promise((res) => setTimeout(res, 400))
      const again = await listLmStudioModels(baseUrl, auth)
      const chatAgain = again.filter(
        (m) =>
          m.state &&
          /^(loaded|active)$/i.test(m.state) &&
          !/embed|mmproj|clip/i.test(m.id) &&
          !isVisionOnlyId(m.id)
      )
      if (chatAgain.length > 1) {
        await switchLmStudioToModel(keep, baseUrl, auth)
      }
    } catch {
      /* */
    }
    return {
      ok: r.ok || none,
      detail: r.detail || r.error || (none ? 'sin residentes previos' : 'switch')
    }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) }
  }
}


/** Id of the single loaded chat model, if any (for Auto / describe — avoid load). */
export async function preferLmStudioResidentId(
  baseUrl: string,
  auth?: LmAuthOpts
): Promise<string | null> {
  try {
    const listed = await listLmStudioModels(baseUrl, auth)
    const loaded = listed.filter(
      (m) => m.state && /^(loaded|active)$/i.test(m.state) && !/embed|mmproj|clip/i.test(m.id)
    )
    if (loaded.length === 1) return loaded[0]!.id
    if (loaded.length > 1) {
      // Prefer non-abliterated for utility; first otherwise
      const light = loaded.find((m) => !/abliterat|uncensored|heretic/i.test(m.id))
      return (light || loaded[0])!.id
    }
  } catch {
    /* */
  }
  return null
}


/**
 * Pick the model id to send to LMS for this turn.
 * Prefer the single already-loaded chat model to avoid dual-load + unload thrash.
 * If preferred is the resident (or same family), use resident's exact catalog id.
 * If something else is resident, keep it unless `forcePreferred` (pinned / intimacy switch).
 */
export async function resolveLmStudioChatModelId(
  preferred: string,
  baseUrl: string,
  opts?: LmAuthOpts & { forcePreferred?: boolean }
): Promise<{ modelId: string; detail: string }> {
  const pref = (preferred || '').trim()
  try {
    const listed = await listLmStudioModels(baseUrl, opts)
    const loaded = listed.filter(
      (m) =>
        m.state &&
        /^(loaded|active)$/i.test(m.state) &&
        !/embed|mmproj|clip/i.test(m.id)
    )
    const chatLoaded = loaded.filter((m) => !isVisionOnlyId(m.id))

    // Dual-load hygiene first
    if (chatLoaded.length > 1) {
      const keep =
        (pref && chatLoaded.find((m) => m.id === pref || sameModelFamily(m.id, pref))) ||
        chatLoaded.find((m) => !/abliterat|uncensored|heretic/i.test(m.id)) ||
        chatLoaded[0]
      if (keep) {
        await ensureLmStudioSingleResident(keep.id, baseUrl, opts)
        return {
          modelId: keep.id,
          detail: `había ${chatLoaded.length} cargados → solo «${keep.id}»`
        }
      }
    }

    if (chatLoaded.length === 1) {
      const res = chatLoaded[0]!
      if (!pref) {
        return { modelId: res.id, detail: 'único residente' }
      }
      if (res.id === pref || sameModelFamily(res.id, pref)) {
        return { modelId: res.id, detail: 'residente = pedido' }
      }
      if (!opts?.forcePreferred) {
        // Stick to VRAM resident — Auto must not thrash
        return {
          modelId: res.id,
          detail: `conservar residente «${res.id}» (pedido «${pref}» sin force)`
        }
      }
    }

    if (pref) {
      return { modelId: pref, detail: chatLoaded.length ? 'force preferred' : 'sin residente → preferred' }
    }
    return { modelId: '', detail: 'sin modelo' }
  } catch (e) {
    return {
      modelId: pref,
      detail: e instanceof Error ? e.message : 'resolve falló'
    }
  }
}
