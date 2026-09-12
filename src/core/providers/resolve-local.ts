export type LocalRuntimeKind = 'ollama' | 'openai-compatible'

export type ResolvedLocalRuntime = {
  kind: LocalRuntimeKind
  baseUrl: string
  label: string
  defaultModel?: string
}

export async function resolveLocalRuntime(opts: {
  preference?: 'auto' | 'ollama' | 'openai-compatible'
  ollamaBaseUrl?: string
  openAIBaseUrl?: string
}): Promise<ResolvedLocalRuntime | null> {
  const pref = opts.preference || 'auto'
  const ollama = (opts.ollamaBaseUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '')
  const openAI = (opts.openAIBaseUrl || '').replace(/\/+$/, '')

  const tryOllama = async (): Promise<ResolvedLocalRuntime | null> => {
    try {
      const res = await fetch(`${ollama}/api/tags`, { signal: AbortSignal.timeout(3_000) })
      if (!res.ok) return null
      return { kind: 'ollama', baseUrl: ollama, label: 'Ollama' }
    } catch {
      return null
    }
  }

  const tryOpenAI = async (): Promise<ResolvedLocalRuntime | null> => {
    if (!openAI) {
      // LM Studio default
      const candidates = [
        'http://127.0.0.1:1234/v1',
        'http://localhost:1234/v1',
        'http://127.0.0.1:1234'
      ]
      for (const base of candidates) {
        try {
          const root = base.endsWith('/v1') ? base : `${base}/v1`
          const res = await fetch(`${root}/models`, { signal: AbortSignal.timeout(2_500) })
          if (res.ok) {
            let defaultModel: string | undefined
            try {
              const j = (await res.json()) as { data?: Array<{ id?: string }> }
              defaultModel = j.data?.[0]?.id
            } catch {
              /* ignore */
            }
            return {
              kind: 'openai-compatible',
              baseUrl: root,
              label: 'LM Studio / local OpenAI',
              defaultModel
            }
          }
        } catch {
          /* next */
        }
      }
      return null
    }
    try {
      const root = openAI.endsWith('/v1') ? openAI : `${openAI}/v1`
      const res = await fetch(`${root}/models`, { signal: AbortSignal.timeout(3_000) })
      if (!res.ok) return null
      let defaultModel: string | undefined
      try {
        const j = (await res.json()) as { data?: Array<{ id?: string }> }
        defaultModel = j.data?.[0]?.id
      } catch {
        /* ignore */
      }
      return {
        kind: 'openai-compatible',
        baseUrl: root,
        label: 'Local OpenAI-compatible',
        defaultModel
      }
    } catch {
      return null
    }
  }

  if (pref === 'ollama') return tryOllama()
  if (pref === 'openai-compatible') return tryOpenAI()
  return (await tryOllama()) || (await tryOpenAI())
}
