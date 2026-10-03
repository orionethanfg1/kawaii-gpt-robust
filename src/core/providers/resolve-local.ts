import { localHttp } from './local-http'
import { discoverLmStudioServer } from './lmstudio-ports'
export type LocalRuntimeKind = 'ollama' | 'openai-compatible'

export type ResolvedLocalRuntime = {
  kind: LocalRuntimeKind
  baseUrl: string
  label: string
  defaultModel?: string
  /** Both probed in auto mode */
  alsoAvailable?: LocalRuntimeKind[]
}

function modelLooksOllama(id: string): boolean {
  // qwen2.5:14b, llama3.2:3b — classic Ollama tags
  return /:[a-z0-9._-]+$/i.test(id) && !id.includes('/')
}

function modelLooksLmStudio(id: string): boolean {
  // qwen/qwen3.8-27b, publisher/name
  return id.includes('/') || (!id.includes(':') && id.length > 2)
}

export async function resolveLocalRuntime(opts: {
  preference?: 'auto' | 'ollama' | 'openai-compatible'
  ollamaBaseUrl?: string
  openAIBaseUrl?: string
  /** Active model id helps auto pick the matching runtime */
  preferredModel?: string
}): Promise<ResolvedLocalRuntime | null> {
  let pref = opts.preference || 'auto'
  const ollama = (opts.ollamaBaseUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '')
  const openAI = (opts.openAIBaseUrl || '').replace(/\/+$/, '')
  const model = (opts.preferredModel || '').trim()

  if (pref === 'auto' && model) {
    if (modelLooksLmStudio(model) && !modelLooksOllama(model)) pref = 'openai-compatible'
    else if (modelLooksOllama(model)) pref = 'ollama'
  }

  const tryOllama = async (): Promise<ResolvedLocalRuntime | null> => {
    try {
      const res = await localHttp(`${ollama}/api/tags`, { timeoutMs: 3_000 })
      if (!res.ok) return null
      let defaultModel: string | undefined
      try {
        const j = (await res.json()) as { models?: Array<{ name?: string }> }
        defaultModel = j.models?.[0]?.name
      } catch {
        /* ignore */
      }
      return { kind: 'ollama', baseUrl: ollama, label: 'Ollama', defaultModel }
    } catch {
      return null
    }
  }

  const tryOpenAI = async (): Promise<ResolvedLocalRuntime | null> => {
    const probe = await discoverLmStudioServer({
      preferredBaseUrl: openAI || undefined,
      timeoutMs: 1_200
    })
    if (!probe.ok || !probe.baseUrl) return null
    return {
      kind: 'openai-compatible',
      baseUrl: probe.baseUrl,
      label: probe.label,
      defaultModel: probe.modelsSample?.[0]
    }
  }

  if (pref === 'ollama') {
    return (await tryOllama()) || (await tryOpenAI())
  }
  if (pref === 'openai-compatible') {
    return (await tryOpenAI()) || (await tryOllama())
  }

  // auto: probe both; prefer the one that matches the model, else either
  const [o, lm] = await Promise.all([tryOllama(), tryOpenAI()])
  if (o && lm) {
    const also: LocalRuntimeKind[] = ['ollama', 'openai-compatible']
    if (model && modelLooksLmStudio(model)) {
      return { ...lm, alsoAvailable: also }
    }
    if (model && modelLooksOllama(model)) {
      return { ...o, alsoAvailable: also }
    }
    // Both up, no strong signal: prefer Ollama for classic tags, else LM if it has a loaded model
    if (lm.defaultModel) return { ...lm, alsoAvailable: also }
    return { ...o, alsoAvailable: also }
  }
  return o || lm
}
