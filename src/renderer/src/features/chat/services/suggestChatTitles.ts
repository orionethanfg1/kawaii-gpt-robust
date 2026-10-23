/**
 * 2–3 title suggestions for rename menu.
 * Heuristic first; optional short LLM call for better labels.
 */

import { suggestConversationTitlesHeuristic } from '@core/conversation'
import { OllamaProvider, OpenAICompatibleProvider } from '@core/providers'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'
import { orderCloudEndpoints } from '@core/models/cloud-rotation'

export async function suggestChatTitles(opts: {
  messages: Array<{ role?: string; content?: string }>
  currentTitle?: string
  useLlm?: boolean
}): Promise<string[]> {
  const heuristic = suggestConversationTitlesHeuristic(opts.messages, opts.currentTitle)
  if (opts.useLlm === false) return heuristic.slice(0, 3)

  try {
    const settings = useSettingsStore.getState().settings
    const snippets = (opts.messages || [])
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(0, 6)
      .map((m) => `${m.role}: ${String(m.content || '').slice(0, 180)}`)
      .join('\n')
    if (snippets.length < 20) return heuristic.slice(0, 3)

    let provider: OllamaProvider | OpenAICompatibleProvider | null = null
    let model = ''
    const localModel = (settings.localModel || '').trim()
    if (localModel) {
      try {
        const local = new OllamaProvider({
          baseUrl: settings.localBaseUrl,
          timeoutMs: 20_000
        })
        const h = await local.healthCheck()
        if (h.ok) {
          provider = local
          model = localModel
        }
      } catch {
        /* */
      }
    }
    if (!provider && settings.providerMode !== 'local') {
      try {
        const keys = (await window.kawaii?.getAllProviderKeys?.()) ?? {}
        const legacy = (await window.kawaii?.getCloudApiKey?.()) ?? ''
        if (legacy && !keys.openrouter) keys.openrouter = legacy
        const eps = orderCloudEndpoints(settings.cloudSlots || [], keys)
        const ep = eps[0]
        if (ep?.apiKey && ep.model) {
          provider = new OpenAICompatibleProvider({
            baseUrl: ep.baseUrl,
            apiKey: ep.apiKey,
            timeoutMs: 25_000
          })
          model = ep.model
        }
      } catch {
        /* */
      }
    }
    if (!provider || !model) return heuristic.slice(0, 3)

    const result = await provider.chat({
      model,
      temperature: 0.4,
      maxTokens: 120,
      messages: [
        {
          role: 'system',
          content:
            'Eres un editor de títulos de chat. Responde SOLO con 3 títulos cortos en español (máx 40 caracteres cada uno), uno por línea, sin numerar ni comillas. ' +
            'Deben resumir el TEMA de la conversación, no copiar el primer mensaje literal. Sin vocativos (linda, mi vida).'
        },
        {
          role: 'user',
          content:
            (opts.currentTitle ? `Título actual: ${opts.currentTitle}\n` : '') +
            `Fragmentos:\n${snippets.slice(0, 1200)}`
        }
      ]
    })
    const lines = String(result.content || '')
      .split(/\n+/)
      .map((l) =>
        l
          .replace(/^[\d\-*.)\s]+/, '')
          .replace(/^["«»']+|["«»']+$/g, '')
          .trim()
          .slice(0, 40)
      )
      .filter((l) => l.length >= 3)

    const merged: string[] = []
    const seen = new Set<string>()
    for (const x of [...lines, ...heuristic]) {
      const k = x.toLowerCase()
      if (seen.has(k)) continue
      if (opts.currentTitle && k === opts.currentTitle.toLowerCase()) continue
      seen.add(k)
      merged.push(x)
      if (merged.length >= 3) break
    }
    return merged.length ? merged : heuristic.slice(0, 3)
  } catch {
    return heuristic.slice(0, 3)
  }
}
