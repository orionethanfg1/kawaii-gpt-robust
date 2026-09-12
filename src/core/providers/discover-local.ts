export type LocalModelEntry = {
  id: string
  name: string
  source: 'ollama' | 'openai-compatible'
  sizeHint?: string
  recommended?: boolean
}

export type LocalModelsSnapshot = {
  models: LocalModelEntry[]
  ollama: boolean
  openAI: null | { baseUrl: string; label: string }
  recommended?: LocalModelEntry
}

export async function discoverLocalModels(opts: {
  ollamaBaseUrl?: string
  openAIBaseUrl?: string
  ramGB?: number
}): Promise<LocalModelsSnapshot> {
  const models: LocalModelEntry[] = []
  let ollama = false
  let openAI: LocalModelsSnapshot['openAI'] = null
  const ollamaBase = (opts.ollamaBaseUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '')

  try {
    const res = await fetch(`${ollamaBase}/api/tags`, { signal: AbortSignal.timeout(4_000) })
    if (res.ok) {
      ollama = true
      const json = (await res.json()) as {
        models?: Array<{ name?: string; model?: string; size?: number }>
      }
      for (const m of json.models || []) {
        const id = m.name || m.model || ''
        if (!id) continue
        models.push({
          id,
          name: id,
          source: 'ollama',
          sizeHint: m.size ? `${(m.size / 1e9).toFixed(1)} GB` : undefined
        })
      }
    }
  } catch {
    /* offline */
  }

  const candidates = [
    opts.openAIBaseUrl,
    'http://127.0.0.1:1234/v1',
    'http://localhost:1234/v1'
  ].filter(Boolean) as string[]

  for (const raw of candidates) {
    const root = raw.replace(/\/+$/, '')
    const base = root.endsWith('/v1') ? root : `${root}/v1`
    try {
      const res = await fetch(`${base}/models`, { signal: AbortSignal.timeout(3_000) })
      if (!res.ok) continue
      openAI = { baseUrl: base, label: 'LM Studio / OpenAI-compatible' }
      const json = (await res.json()) as { data?: Array<{ id?: string }> }
      for (const m of json.data || []) {
        const id = m.id || ''
        if (!id) continue
        if (models.some((x) => x.id === id)) continue
        models.push({ id, name: id, source: 'openai-compatible' })
      }
      break
    } catch {
      /* next */
    }
  }

  const ram = opts.ramGB ?? 16
  const score = (id: string) => {
    const x = id.toLowerCase()
    let s = 0
    if (/instruct|chat/.test(x)) s += 2
    if (ram < 16 && /(3b|3b-|1\.5b|1b)/.test(x)) s += 3
    if (ram >= 16 && ram < 32 && /(7b|8b|9b)/.test(x)) s += 3
    if (ram >= 32 && /(14b|13b|12b)/.test(x)) s += 3
    if (/embed|whisper|llava|vision/.test(x)) s -= 5
    return s
  }
  models.sort((a, b) => score(b.id) - score(a.id))
  const recommended = models[0]
  if (recommended) recommended.recommended = true
  return { models, ollama, openAI, recommended }
}
