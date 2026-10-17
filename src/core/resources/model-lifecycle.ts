/**
 * Single entry for switching the resident local LLM (Ollama + LM Studio).
 * Auto routing and conversation initiative must call this — not ad-hoc unload/load.
 */

import { unloadAllExcept, type UnloadResult } from './unload-local'
import { switchLmStudioToModel } from '../providers/lmstudio-lifecycle'

export type ModelLifecycleResult = {
  ok: boolean
  keep: string
  /** Human-readable one-liner for UI route meta */
  detail: string
  ollama?: UnloadResult
  lmStudio?: {
    ok: boolean
    unloaded: string[]
    loaded?: boolean
    error?: string
    detail?: string
  }
  unloaded: string[]
}

export type SwitchToModelOpts = {
  ollamaBaseUrl?: string
  openAIBaseUrl?: string
  lmStudioBaseUrl?: string
  /** C5 LM Studio bearer token */
  lmStudioApiToken?: string
}

function looksLikeLmStudioId(id: string, openAIBase?: string, lmBase?: string): boolean {
  const keep = id || ''
  const bases = `${openAIBase || ''} ${lmBase || ''}`
  return (
    keep.includes('/') ||
    /1234/.test(bases) ||
    /abliterat|lmstudio|mlabonne|bartowski|openai\/|google\//i.test(keep) ||
    /Q[2-8]_K/i.test(keep)
  )
}

/**
 * Ensure only `keepModel` should remain the active local chat model:
 * 1) Ollama: keep_alive 0 on others (if keep exists there)
 * 2) LM Studio: unload others + load keep (API v1)
 */
export async function switchToModel(
  keepModel: string,
  opts?: SwitchToModelOpts
): Promise<ModelLifecycleResult> {
  const keep = (keepModel || '').trim()
  if (!keep) {
    return {
      ok: false,
      keep: '',
      detail: 'sin modelo destino',
      unloaded: []
    }
  }

  const unloaded: string[] = []
  let ollamaRes: UnloadResult | undefined
  let lmRes: ModelLifecycleResult['lmStudio']

  try {
    ollamaRes = await unloadAllExcept(keep, {
      ollamaBaseUrl: opts?.ollamaBaseUrl || 'http://127.0.0.1:11434',
      openAIBaseUrl: (opts?.openAIBaseUrl || '').trim() || undefined
    })
    for (const u of ollamaRes.unloaded || []) unloaded.push(u)
  } catch (e) {
    ollamaRes = {
      ok: false,
      unloaded: [],
      failed: [{ model: keep, error: e instanceof Error ? e.message : String(e) }],
      skipped: [],
      freedEstimateGB: 0,
      detail: 'ollama unload error'
    }
  }

  const lmBase =
    (opts?.lmStudioBaseUrl || '').trim() ||
    (opts?.openAIBaseUrl || '').trim() ||
    'http://127.0.0.1:1234'

  if (looksLikeLmStudioId(keep, opts?.openAIBaseUrl, lmBase)) {
    try {
      const r = await switchLmStudioToModel(keep, lmBase, {
        apiToken: (opts?.lmStudioApiToken || '').trim() || undefined
      })
      lmRes = {
        ok: r.ok,
        unloaded: r.unloaded || [],
        loaded: r.loaded,
        error: r.error,
        detail: r.detail
      }
      for (const u of r.unloaded || []) unloaded.push(u)
    } catch (e) {
      lmRes = {
        ok: false,
        unloaded: [],
        error: e instanceof Error ? e.message : String(e)
      }
    }
  }

  const uniq = [...new Set(unloaded)]
  const parts: string[] = []
  if (uniq.length) parts.push(`liberados: ${uniq.join(', ')}`)
  if (lmRes?.loaded) parts.push(`LMS loaded «${keep}»`)
  else if (lmRes && !lmRes.ok && lmRes.error) parts.push(`LMS: ${lmRes.error}`)
  if (ollamaRes?.detail && ollamaRes.unloaded?.length) parts.push(`Ollama: ${ollamaRes.detail}`)

  const ok = Boolean(lmRes?.ok || ollamaRes?.ok !== false)
  return {
    ok,
    keep,
    detail: parts.length ? parts.join(' · ') : `keep «${keep}» (sin cambios de VRAM reportados)`,
    ollama: ollamaRes,
    lmStudio: lmRes,
    unloaded: uniq
  }
}
