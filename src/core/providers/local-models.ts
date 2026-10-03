/**
 * Unified discovery of local chat models: Ollama + LM Studio / OpenAI-compatible.
 */

import { OllamaProvider } from './ollama'
import { OpenAICompatibleProvider } from './openai-compatible'
import {
  LOCAL_OPENAI_CANDIDATES,
  probeOpenAICompatible,
  probeOllama,
  type ResolvedLocalRuntime
} from './local-runtime-probe'

export type LocalModelSource = 'ollama' | 'lmstudio' | 'openai-compatible'

export interface LocalModelEntry {
  id: string
  name: string
  source: LocalModelSource
  baseUrl: string
  /** Rough size hint from name (billions of params) if parseable */
  paramsB?: number
  capabilities: Array<'chat' | 'vision' | 'tools' | 'code'>
}

export interface LocalRuntimeSnapshot {
  ollama: ResolvedLocalRuntime | null
  openAI: ResolvedLocalRuntime | null
  models: LocalModelEntry[]
  recommended?: LocalModelEntry
}

function parseParamsB(id: string): number | undefined {
  const m = id.match(/(\d{1,2})[bB]\b/) || id.match(/[-_](\d{1,2})b/i)
  if (m) return Number(m[1])
  return undefined
}

function inferCaps(id: string): LocalModelEntry['capabilities'] {
  const n = id.toLowerCase()
  const caps: LocalModelEntry['capabilities'] = ['chat']
  if (/vision|llava|vl-|vl_|moondream|minicpm-v|qwen.*vl/i.test(n)) caps.push('vision')
  if (/code|coder|deepseek-coder/i.test(n)) caps.push('code')
  if (/tool|qwen3|gpt-oss|nemotron/i.test(n)) caps.push('tools')
  return caps
}

function sourceFromLabel(label: string): LocalModelSource {
  if (/lm studio/i.test(label)) return 'lmstudio'
  if (/ollama/i.test(label)) return 'ollama'
  return 'openai-compatible'
}

/** Score higher = better default for general chat given RAM */
export function scoreLocalModel(m: LocalModelEntry, ramGB: number): number {
  let s = 0
  const p = m.paramsB ?? 7
  // Fit in RAM (rough: 2GB per B for Q4)
  const need = p * 1.2
  if (need > ramGB * 0.7) s -= 50
  else s += Math.min(p, 32) // prefer smarter until too big
  if (/qwen3|qwen2\.5|llama-?3|gemma-?3|mistral|deepseek/i.test(m.id)) s += 10
  if (/instruct|chat/i.test(m.id)) s += 3
  if (m.source === 'lmstudio') s += 2 // user explicitly installed
  if (m.capabilities.includes('tools')) s += 4
  if (m.capabilities.includes('vision')) s += 1
  return s
}

export async function discoverLocalModels(opts?: {
  ollamaBaseUrl?: string
  openAIBaseUrl?: string
  ramGB?: number
}): Promise<LocalRuntimeSnapshot> {
  const ollamaUrl = opts?.ollamaBaseUrl || 'http://127.0.0.1:11434'
  const ram = opts?.ramGB ?? 32
  const models: LocalModelEntry[] = []

  const ollama = await probeOllama(ollamaUrl)
  if (ollama) {
    try {
      const list = await ollama.provider.listModels()
      for (const m of list) {
        models.push({
          id: m.id,
          name: m.name || m.id,
          source: 'ollama',
          baseUrl: ollamaUrl,
          paramsB: parseParamsB(m.id),
          capabilities: inferCaps(m.id)
        })
      }
    } catch {
      /* ignore */
    }
  }

  let openAI: ResolvedLocalRuntime | null = null
  const tried = new Set<string>()
  const candidates = [
    ...(opts?.openAIBaseUrl
      ? [{ baseUrl: opts.openAIBaseUrl, label: 'Local OpenAI-compatible' }]
      : []),
    ...LOCAL_OPENAI_CANDIDATES
  ]
  for (const c of candidates) {
    if (tried.has(c.baseUrl)) continue
    tried.add(c.baseUrl)
    const hit = await probeOpenAICompatible(c.baseUrl, c.label)
    if (!hit) continue
    if (!openAI) openAI = hit
    try {
      const list = await hit.provider.listModels()
      for (const m of list) {
        // Avoid dup if same id from ollama shim
        if (models.some((x) => x.id === m.id && x.source === 'ollama')) continue
        models.push({
          id: m.id,
          name: m.name || m.id,
          source: sourceFromLabel(hit.label),
          baseUrl: hit.baseUrl,
          paramsB: parseParamsB(m.id),
          capabilities: inferCaps(m.id)
        })
      }
    } catch {
      /* ignore */
    }
    // Prefer first healthy LM Studio; still scan others for models
  }

  let recommended: LocalModelEntry | undefined
  if (models.length) {
    recommended = [...models].sort(
      (a, b) => scoreLocalModel(b, ram) - scoreLocalModel(a, ram)
    )[0]
  }

  return { ollama, openAI, models, recommended }
}
