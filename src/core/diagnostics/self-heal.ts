/**
 * Lightweight self-diagnosis + repair attempts.
 */

export type DiagStatus = 'ok' | 'warn' | 'fail'

export interface DiagCheck {
  id: string
  label: string
  status: DiagStatus
  detail: string
  repairAction?: string
  repaired?: boolean
}

export interface DiagReport {
  at: number
  checks: DiagCheck[]
  healthy: boolean
}

import { runNetworkProbe, type NetworkProbeReport } from './network-probe'

export type { NetworkProbeReport }

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

export async function runSelfDiagnosis(opts: {
  localBaseUrl: string
  localModel: string
  cloudBaseUrl: string
  hasCloudKey: boolean
  providerMode: string
  /** OpenAI-compatible / LM Studio base (e.g. http://127.0.0.1:1234) */
  openAIBaseUrl?: string
  lmStudioBaseUrl?: string
  ollamaStart?: () => Promise<{ ok: boolean; message: string }>
  /** Stable Diffusion / Forge API (optional layer) */
  imageGenEnabled?: boolean
  imageProviderMode?: string
  a1111BaseUrl?: string
  cloudflareAccountId?: string
  hasCloudflareToken?: boolean
  /** Repair hooks (main process via preload) */
  forgeStart?: () => Promise<{ ok: boolean; message?: string; baseUrl?: string }>
  forgeRefreshHealth?: () => Promise<{
    ok: boolean
    baseUrl?: string
    error?: string
    apiOk?: boolean
  }>
  cloudflareProbe?: (
    accountId: string
  ) => Promise<{ ok: boolean; latencyMs?: number; error?: string }>
  imageA1111Health?: (
    baseUrl?: string
  ) => Promise<{ ok: boolean; baseUrl?: string; error?: string; latencyMs?: number }>
}): Promise<DiagReport> {
  const checks: DiagCheck[] = []
  const at = Date.now()

  // 0) Real network measurement (not speculation)
  let net: NetworkProbeReport | null = null
  try {
    net = await runNetworkProbe({ timeoutMs: 4000 })
    const status =
      net.level === 'online' ? 'ok' : net.level === 'partial' ? 'warn' : 'fail'
    checks.push({
      id: 'network',
      label: 'Red / Internet',
      status,
      detail: net.summary,
      repairAction:
        net.level === 'offline'
          ? 'Conéctate a Internet o desactiva VPN/proxy que bloquee salidas'
          : net.level === 'partial'
            ? 'Prueba otra red/VPN o espera; hosts AI pueden estar caídos'
            : undefined
    })
    for (const tg of net.targets) {
      checks.push({
        id: `net-${tg.id}`,
        label: tg.label,
        status: tg.ok ? 'ok' : 'warn',
        detail: tg.ok
          ? `OK · ${tg.latencyMs} ms${tg.status ? ` · HTTP ${tg.status}` : ''}`
          : tg.error || 'Sin respuesta'
      })
    }
  } catch (err) {
    checks.push({
      id: 'network',
      label: 'Red / Internet',
      status: 'warn',
      detail: 'No se pudo ejecutar la prueba: ' + (err instanceof Error ? err.message : String(err))
    })
  }

  if (opts.providerMode === 'local' || opts.providerMode === 'smart') {
    let ollamaNames: string[] = []
    let ollamaOk = false
    try {
      const res = await fetchWithTimeout(
        `${opts.localBaseUrl.replace(/\/$/, '')}/api/tags`,
        {},
        4000
      )
      ollamaOk = res.ok
      if (res.ok) {
        const data = (await res.json()) as { models?: Array<{ name?: string }> }
        ollamaNames = (data.models ?? []).map((m) => m.name).filter(Boolean) as string[]
        checks.push({
          id: 'ollama',
          label: 'Ollama',
          status: 'ok',
          detail: `Online · ${ollamaNames.length} modelo(s)`
        })
      }
    } catch {
      ollamaOk = false
    }

    if (!ollamaOk) {
      let repaired = false
      let detail = 'No responde en ' + opts.localBaseUrl
      if (opts.ollamaStart) {
        const r = await opts.ollamaStart()
        if (r.ok) {
          repaired = true
          detail = 'Estaba apagado; se intentó iniciar: ' + r.message
        } else {
          detail += '. Intento de arranque: ' + r.message
        }
      }
      checks.push({
        id: 'ollama',
        label: 'Ollama',
        status: repaired ? 'warn' : 'fail',
        detail,
        repairAction: repaired ? undefined : 'Abre Ollama o pulsa Iniciar en el Asistente',
        repaired
      })
    }

    // LM Studio / OpenAI-compatible local (often the real chat backend)
    let lmsNames: string[] = []
    let lmsOk = false
    const lmsCandidates = [
      (opts.lmStudioBaseUrl || '').trim(),
      (opts.openAIBaseUrl || '').trim(),
      'http://127.0.0.1:1234'
    ].filter((u, i, arr) => u && arr.indexOf(u) === i)
    for (const base of lmsCandidates) {
      const root = base.replace(/\/+$/, '').replace(/\/v1$/i, '')
      try {
        const res = await fetchWithTimeout(`${root}/v1/models`, {}, 4000)
        if (!res.ok) continue
        const data = (await res.json()) as { data?: Array<{ id?: string }> }
        lmsNames = (data.data || []).map((m) => String(m.id || '')).filter(Boolean)
        lmsOk = true
        checks.push({
          id: 'lm-studio',
          label: 'LM Studio / OpenAI local',
          status: 'ok',
          detail: `Online · ${lmsNames.length} modelo(s) · ${root}`
        })
        break
      } catch {
        /* try next */
      }
    }
    if (!lmsOk && lmsCandidates.length) {
      checks.push({
        id: 'lm-studio',
        label: 'LM Studio / OpenAI local',
        status: 'warn',
        detail: 'No responde en ' + lmsCandidates[0],
        repairAction: 'Abre LM Studio → Developer → Start Server'
      })
    }

    const allNames = [...ollamaNames, ...lmsNames]
    const want = (opts.localModel || '').trim()
    const hasModel =
      allNames.length > 0 &&
      (!want ||
        allNames.some(
          (n) =>
            n === want ||
            n.startsWith(want) ||
            want.startsWith(n) ||
            n.toLowerCase().includes(want.toLowerCase().slice(0, 12))
        ))
    checks.push({
      id: 'local-model',
      label: 'Modelo local',
      status: hasModel ? 'ok' : allNames.length > 0 ? 'warn' : 'warn',
      detail: hasModel
        ? `Disponible · pref: ${want || allNames[0]} · catálogo ${allNames.length}`
        : allNames.length > 0
          ? `Catálogo OK (${allNames.length}) pero no coincide «${want || '—'}» — revisa Modelos / Auto`
          : 'Sin modelos en Ollama ni LM Studio',
      repairAction: hasModel
        ? undefined
        : 'Carga un modelo en LM Studio o Ollama; revisa Ajustes → Modelos'
    })
  }

  if (opts.providerMode === 'cloud' || opts.providerMode === 'smart') {
    if (!opts.hasCloudKey) {
      checks.push({
        id: 'cloud-key',
        label: 'API key cloud',
        status: 'warn',
        detail: 'No hay key guardada',
        repairAction: 'Añade una key en Ajustes o el Asistente'
      })
    } else {
      try {
        const res = await fetchWithTimeout(
          `${opts.cloudBaseUrl.replace(/\/$/, '')}/models`,
          { headers: { Authorization: 'Bearer probe' } },
          5000
        )
        checks.push({
          id: 'cloud-host',
          label: 'Proveedor cloud',
          status: net && net.level === 'offline' ? 'fail' : 'ok',
          detail: `Host alcanzable (HTTP ${res.status})`
        })
      } catch {
        checks.push({
          id: 'cloud-host',
          label: 'Proveedor cloud',
          status: 'fail',
          detail:
            net?.level === 'offline'
              ? 'Sin Internet (prueba de red falló)'
              : net?.level === 'partial'
                ? 'Internet OK parcial; este host cloud no respondió'
                : net?.internetOk
                  ? 'Internet OK — el host del proveedor no respondió (no es falta de red general)'
                  : 'Sin respuesta del host cloud',
          repairAction:
            net?.level === 'offline'
              ? 'Revisa Wi‑Fi/VPN'
              : 'Revisa key, modelo free o cambia de proveedor'
        })
      }
      checks.push({
        id: 'cloud-key',
        label: 'API key cloud',
        status: 'ok',
        detail: 'Key presente en almacén seguro'
      })
    }
  }

  if (checks.length === 0) {
    checks.push({
      id: 'noop',
      label: 'Configuración',
      status: 'warn',
      detail: 'Nada que comprobar en este modo'
    })
  }


  // ── Image stack: Forge + Cloudflare + Pollinations ─────────────────
  if (opts.imageGenEnabled !== false) {
    const imgMode = opts.imageProviderMode || 'smart'
    checks.push({
      id: 'image-mode',
      label: 'Modo de imágenes',
      status: 'ok',
      detail: `Motor: ${imgMode} (cadena Smart: Local → Cloudflare FLUX → Pollinations)`
    })

    // Forge / A1111
    let forgeOk = false
    let forgeBase = (opts.a1111BaseUrl || 'http://127.0.0.1:7860').replace(/\/$/, '')
    let forgeDetail = ''
    try {
      if (opts.imageA1111Health) {
        const h = await opts.imageA1111Health(forgeBase)
        forgeOk = !!h.ok
        if (h.baseUrl) forgeBase = h.baseUrl.replace(/\/$/, '')
        forgeDetail = forgeOk
          ? `API OK · ${forgeBase}${h.latencyMs != null ? ` · ${h.latencyMs} ms` : ''}`
          : h.error || `Sin API en ${forgeBase}`
      } else {
        const res = await fetchWithTimeout(`${forgeBase}/sdapi/v1/progress`, {}, 4000)
        forgeOk = res.ok
        forgeDetail = forgeOk
          ? `API OK · ${forgeBase}`
          : `HTTP ${res.status} en ${forgeBase} (¿sin --api?)`
      }
    } catch (err) {
      forgeDetail =
        (err instanceof Error ? err.message : String(err)) + ` @ ${forgeBase}`
    }

    // Auto-repair: start Forge if down
    let forgeRepaired = false
    if (!forgeOk && opts.forgeStart) {
      try {
        const r = await opts.forgeStart()
        if (r.ok) {
          // wait a bit then re-probe
          await new Promise((res) => setTimeout(res, 2500))
          if (opts.forgeRefreshHealth) {
            const h2 = await opts.forgeRefreshHealth()
            forgeOk = !!(h2.ok || h2.apiOk)
            if (h2.baseUrl) forgeBase = h2.baseUrl.replace(/\/$/, '')
            forgeDetail = forgeOk
              ? `API OK tras arranque · ${forgeBase}`
              : `Arrancado pero API aún no lista: ${h2.error || 'espera 1–2 min'}`
            forgeRepaired = forgeOk
          } else if (opts.imageA1111Health) {
            const h2 = await opts.imageA1111Health(r.baseUrl || forgeBase)
            forgeOk = !!h2.ok
            forgeDetail = forgeOk
              ? `API OK tras arranque · ${h2.baseUrl || forgeBase}`
              : h2.error || 'Arrancado; API pendiente'
            forgeRepaired = forgeOk
          } else {
            forgeDetail = r.message || 'Se pidió arranque de Forge'
            forgeRepaired = true
          }
        } else {
          forgeDetail += ` · Arranque: ${r.message || 'falló'}`
        }
      } catch (e) {
        forgeDetail +=
          ' · Repair: ' + (e instanceof Error ? e.message : String(e))
      }
    }

    const forgeStatus: DiagStatus = forgeOk
      ? 'ok'
      : imgMode === 'local'
        ? 'fail'
        : 'warn'
    checks.push({
      id: 'forge-api',
      label: 'Forge / SD local',
      status: forgeStatus,
      detail: forgeDetail,
      repairAction: forgeOk
        ? undefined
        : 'Pulsa «Reparar capa de imágenes» o Arrancar Forge (launcher con --api)',
      repaired: forgeRepaired
    })

    // Cloudflare FLUX
    const acc = (opts.cloudflareAccountId || '').trim()
    const hasTok = opts.hasCloudflareToken === true
    if (!acc || !hasTok) {
      checks.push({
        id: 'cloudflare',
        label: 'Cloudflare FLUX',
        status: 'warn',
        detail: `Account ID ${acc ? 'OK' : 'faltante'} · Token ${hasTok ? 'OK' : 'faltante'}`,
        repairAction:
          'Ajustes → Cloudflare: pega Account ID + token Workers AI → Guardar y probar'
      })
    } else if (opts.cloudflareProbe) {
      try {
        const p = await opts.cloudflareProbe(acc)
        checks.push({
          id: 'cloudflare',
          label: 'Cloudflare FLUX',
          status: p.ok ? 'ok' : 'fail',
          detail: p.ok
            ? `Token OK · ${p.latencyMs ?? '?'} ms`
            : p.error || 'Auth fallida (401: token/cuenta no coinciden)',
          repairAction: p.ok
            ? undefined
            : 'Crea token en Workers AI → Use REST API; Account ID del mismo dashboard'
        })
      } catch (e) {
        checks.push({
          id: 'cloudflare',
          label: 'Cloudflare FLUX',
          status: 'warn',
          detail: e instanceof Error ? e.message : String(e)
        })
      }
    } else {
      checks.push({
        id: 'cloudflare',
        label: 'Cloudflare FLUX',
        status: 'ok',
        detail: 'Credenciales presentes (sin probe)'
      })
    }

    // Pollinations reachability (best-effort HEAD/GET)
    try {
      const res = await fetchWithTimeout(
        'https://image.pollinations.ai/prompt/ping?width=64&height=64&nologo=true',
        {},
        6000
      )
      checks.push({
        id: 'pollinations',
        label: 'Pollinations (fallback)',
        status: res.ok || res.status === 429 ? 'ok' : 'warn',
        detail: res.ok
          ? `Alcanzable · HTTP ${res.status}`
          : `HTTP ${res.status} (si es 500, servicio saturado; reintenta)`
      })
    } catch (e) {
      checks.push({
        id: 'pollinations',
        label: 'Pollinations (fallback)',
        status: 'warn',
        detail: e instanceof Error ? e.message : String(e)
      })
    }
  }

  const healthy = checks.every((c) => c.status !== 'fail')
  
  // Chat history on disk vs in-memory
  try {
    if (typeof window !== 'undefined' && (window as unknown as { kawaii?: { filesListChatBodies?: () => Promise<{ ok: boolean; items?: Array<{ id: string; messageCount?: number }> }> } }).kawaii?.filesListChatBodies) {
      const list = await (window as unknown as { kawaii: { filesListChatBodies: () => Promise<{ ok: boolean; items?: Array<{ id: string; messageCount?: number; title?: string }> }> } }).kawaii.filesListChatBodies()
      const n = list.items?.length || 0
      if (!list.ok) {
        checks.push({
          id: 'chat-history-gap',
          label: 'Historial de chats (disco)',
          status: 'warn',
          detail: list.error || 'no listable',
          repairAction: 'Recuperar chats en la barra lateral'
        })
      } else if (n === 0) {
        checks.push({
          id: 'chat-history-gap',
          label: 'Historial de chats (disco)',
          status: 'ok',
          detail: 'Sin respaldos aún (se crean al conversar)'
        })
      } else {
        checks.push({
          id: 'chat-history-gap',
          label: 'Historial de chats (disco)',
          status: 'ok',
          detail: `${n} respaldo(s) en userData/chats — usa «Recuperar chats» si falta historial`,
          repairAction: 'Sidebar → Recuperar chats'
        })
      }
    }
  } catch (e) {
    checks.push({
      id: 'chat-history-gap',
      label: 'Historial de chats (disco)',
      status: 'warn',
      detail: e instanceof Error ? e.message : String(e)
    })
  }

return { at, checks, healthy }
}
