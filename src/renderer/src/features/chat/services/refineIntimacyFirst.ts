/**
 * Renderer bridge: pick local chat provider + refine INTIMACY_FIRST.
 * Resolves a model that is actually available (loaded / listed), not a stale settings id.
 */
import {
  OllamaProvider,
  OpenAICompatibleProvider,
  type ChatProvider
} from '@core/providers'
import {
  refineIntimacyFirstWithLlm,
  type IntimacyRefineChat
} from '@core/conversation/intimacy-memory'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'

function normalizeModelId(id: string): string {
  return String(id || '')
    .trim()
    .toLowerCase()
    .replace(/^models\//, '')
}

/** Prefer loaded / listed models; map family aliases (gemma-4-26b ↔ abliterated). */
async function resolveAvailableModel(
  provider: ChatProvider,
  preferred: string
): Promise<string | null> {
  const pref = preferred.trim()
  if (!pref) return null

  let ids: string[] = []
  try {
    if (typeof (provider as { listModels?: () => Promise<{ id: string }[]> }).listModels === 'function') {
      const list = await (provider as { listModels: () => Promise<{ id: string }[]> }).listModels()
      ids = (list || []).map((m) => String(m.id || '').trim()).filter(Boolean)
    }
  } catch {
    ids = []
  }

  // Also try raw /v1/models for OpenAI-compat
  if (!ids.length && provider.id) {
    try {
      const base =
        (provider as { baseUrl?: string }).baseUrl ||
        useSettingsStore.getState().settings.localBaseUrl ||
        ''
      const url = String(base).replace(/\/$/, '')
      const candidates = [
        url.includes('/v1') ? `${url}/models` : `${url}/v1/models`,
        `${url}/api/tags`
      ]
      for (const u of candidates) {
        try {
          const r = await fetch(u, { signal: AbortSignal.timeout(4000) })
          if (!r.ok) continue
          const j = (await r.json()) as {
            data?: { id?: string; state?: string }[]
            models?: { name?: string; model?: string }[]
          }
          if (Array.isArray(j.data)) {
            const loaded = j.data.filter((m) => m.state === 'loaded')
            const pool = loaded.length ? loaded : j.data
            ids = pool.map((m) => String(m.id || '')).filter(Boolean)
            break
          }
          if (Array.isArray(j.models)) {
            ids = j.models
              .map((m) => String(m.name || m.model || ''))
              .filter(Boolean)
            break
          }
        } catch {
          /* next */
        }
      }
    } catch {
      /* */
    }
  }

  if (!ids.length) return pref // hope runtime accepts it

  const prefN = normalizeModelId(pref)
  // Exact match
  const exact = ids.find((id) => normalizeModelId(id) === prefN)
  if (exact) return exact

  // Suffix / contains match
  const soft = ids.find(
    (id) =>
      normalizeModelId(id).includes(prefN) || prefN.includes(normalizeModelId(id))
  )
  if (soft) return soft

  // Family: gemma-4-26 / gemma-4-26b-a4b → any gemma 26b listed
  if (/gemma.*26/i.test(pref)) {
    const gem = ids.find((id) => /gemma.*26/i.test(id))
    if (gem) return gem
  }
  if (/qwen.*14/i.test(pref)) {
    const q = ids.find((id) => /qwen.*14/i.test(id))
    if (q) return q
  }

  // Last resort: first listed (usually loaded in LMS)
  return ids[0] || pref
}

async function pickLocalChatProvider(): Promise<{
  provider: ChatProvider
  model: string
} | null> {
  const s = useSettingsStore.getState().settings
  const preferred = String(s.localModel || '').trim()
  const base = String(s.localBaseUrl || 'http://127.0.0.1:11434').replace(/\/$/, '')
  const timeoutMs = Math.min(Number(s.localTimeoutMs) || 90_000, 90_000)

  const isOpenAiStyle =
    /:1234\b/.test(base) ||
    /\/v1$/i.test(base) ||
    /lmstudio/i.test(base) ||
    Boolean((s as { localProvider?: string }).localProvider === 'lmstudio')

  const tryProvider = async (p: ChatProvider): Promise<{ provider: ChatProvider; model: string } | null> => {
    try {
      const h = await p.healthCheck()
      if (!h.ok) return null
      const model = (await resolveAvailableModel(p, preferred || 'local')) || preferred
      if (!model) return null
      return { provider: p, model }
    } catch {
      return null
    }
  }

  if (isOpenAiStyle || /1234/.test(base)) {
    const baseUrl = base.includes('/v1') ? base : base + '/v1'
    const p = new OpenAICompatibleProvider({
      id: 'local-lms',
      displayName: 'Local OpenAI-compat',
      baseUrl,
      apiKey: 'lm-studio',
      timeoutMs
    })
    const hit = await tryProvider(p)
    if (hit) return hit
  }

  try {
    const ollamaBase = base.includes('/v1') ? base.replace(/\/v1$/, '') : base
    const p = new OllamaProvider({ baseUrl: ollamaBase, timeoutMs })
    const hit = await tryProvider(p)
    if (hit) return hit
  } catch {
    /* */
  }

  // Always try common LMS ports if base failed
  for (const port of [1234, 1235, 4891]) {
    try {
      const p = new OpenAICompatibleProvider({
        id: `lms-${port}`,
        displayName: `LM Studio ${port}`,
        baseUrl: `http://127.0.0.1:${port}/v1`,
        apiKey: 'lm-studio',
        timeoutMs
      })
      const hit = await tryProvider(p)
      if (hit) return hit
    } catch {
      /* */
    }
  }

  return null
}

export async function refineIntimacyFirstInApp(opts: {
  draft: string
  messages: Array<{ role?: string; content?: string }>
  userName?: string
  characterName?: string
  signal?: AbortSignal
}): Promise<{ text: string; source: 'llm' | 'heuristic'; error?: string }> {
  const draft = String(opts.draft || '').trim()
  if (draft.length < 40) return { text: draft, source: 'heuristic', error: 'draft_too_short' }

  const pick = await pickLocalChatProvider()
  if (!pick) {
    return { text: draft, source: 'heuristic', error: 'no_local_provider' }
  }

  const chat: IntimacyRefineChat = async (r) => {
    // Use resolved model id (may differ from settings.localModel)
    const model = pick.model || r.model
    try {
      const out = await pick.provider.chat({
        model,
        messages: r.messages,
        maxTokens: r.maxTokens,
        temperature: r.temperature,
        signal: r.signal
      })
      return { content: out.content || '' }
    } catch (e) {
      // One retry with first listed model already in pick; rethrow
      throw e
    }
  }

  return refineIntimacyFirstWithLlm({
    draft,
    messages: opts.messages,
    userName: opts.userName,
    characterName: opts.characterName,
    model: pick.model,
    chat,
    signal: opts.signal,
    timeoutMs: 90_000
  })
}

/** Apply refined text into userMemory facts as INTIMACY_FIRST */
export function commitIntimacyFirstNarrative(text: string): void {
  const s = useSettingsStore.getState().settings
  const facts = [...(s.userMemory?.facts || [])].filter(
    (f) => !String(f).startsWith('INTIMACY_FIRST:')
  )
  facts.push('INTIMACY_FIRST: ' + String(text).trim())
  useSettingsStore.getState().update({
    userMemory: {
      ...(s.userMemory || {}),
      facts,
      updatedAt: Date.now()
    }
  })
}
