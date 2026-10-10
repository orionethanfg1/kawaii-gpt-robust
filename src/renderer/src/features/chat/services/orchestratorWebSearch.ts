/**
 * E-ORCH-1: web search side-effects for sendChatMessage.
 */
import { focusSearchQuery } from '@core/tools/web-search-intent'
import type { ChatMessage } from '@core/providers'

export type WebSearchHit = { title: string; snippet: string; url?: string }

export async function applyOrchestratorWebSearch(opts: {
  useWebSearch: boolean
  userContent: string
  initialUserContent?: string
  webSearchMaxResults?: number
  searxngBaseUrl?: string
  systemMessages: ChatMessage[]
  onPhase?: (phase: 'searching') => void
}): Promise<{
  usedWebSearch: boolean
  webHitCount: number
  webSearchAttempted: boolean
  lastWebResults: WebSearchHit[]
  userContent: string
  systemMessages: ChatMessage[]
}> {
  let usedWebSearch = false
  let webHitCount = 0
  let webSearchAttempted = false
  let lastWebResults: WebSearchHit[] = []
  let userContent = opts.userContent
  const systemMessages = [...opts.systemMessages]

  if (!opts.useWebSearch) {
    return {
      usedWebSearch,
      webHitCount,
      webSearchAttempted,
      lastWebResults,
      userContent,
      systemMessages
    }
  }

  webSearchAttempted = true
  try {
    opts.onPhase?.('searching')
    const rawQ = (opts.initialUserContent || userContent || '').trim()
    const topic = focusSearchQuery(
      rawQ
        .replace(
          /\b(busca|buscar|búsqueda|busqueda)\s+(en\s+)?(la\s+)?(web|internet|google)\b/gi,
          ' '
        )
        .replace(/\b(por favor|please)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    )
    const searchQuery = topic || focusSearchQuery(rawQ) || rawQ
    let results: WebSearchHit[] = []
    if (typeof window !== 'undefined' && window.kawaii?.webSearch) {
      const webOpts = {
        searxngBaseUrl: opts.searxngBaseUrl || ''
      }
      const max = opts.webSearchMaxResults
      results = await window.kawaii.webSearch(searchQuery, max, webOpts)
      if (!results.length && searchQuery !== rawQ) {
        results = await window.kawaii.webSearch(rawQ.slice(0, 240), max, webOpts)
      }
      if (!results.length) {
        const kw = searchQuery
          .split(/\s+/)
          .filter((w) => w.length > 3)
          .slice(0, 6)
          .join(' ')
        if (kw && kw !== searchQuery) {
          results = await window.kawaii.webSearch(kw, max, webOpts)
        }
      }
    }
    if (results.length > 0) {
      usedWebSearch = true
      webHitCount = results.length
      lastWebResults = results
      const block = results
        .map(
          (r, i) =>
            `[${i + 1}] ${r.title}\n${r.snippet}${r.url ? `\nURL: ${r.url}` : ''}`
        )
        .join('\n\n')
      systemMessages.push({
        role: 'system',
        content:
          `[BÚSQUEDA WEB REALIZADA — ${webHitCount} resultado(s)]\n` +
          `Usa estos datos. NO digas que no puedes navegar: la app ya buscó.\n\n` +
          block
      })
      userContent =
        `[RESULTADOS DE BÚSQUEDA WEB — la app YA buscó; tienes acceso vía la app. Prohibido decir que no puedes navegar o buscar en internet.]\n` +
        block +
        `\n\n---\nPregunta del usuario: ` +
        userContent
    }
  } catch {
    /* best-effort */
  }

  if (opts.useWebSearch && !usedWebSearch) {
    const miss =
      '[Búsqueda web: 0 hits. La app SÍ busca en internet; solo no hubo resultados. PROHIBIDO decir que no puedes navegar.]'
    systemMessages.push({
      role: 'system',
      content:
        miss +
        ' Sé honesta; ofrece tips generales con cautela; no inventes URLs. ' +
        'NO digas que nunca puedes buscar: el sistema sí busca, solo falló este intento.'
    })
    userContent =
      miss +
      '\nNo inventes fuentes. Puedes dar consejos generales si aplica.\n\n' +
      'Pregunta del usuario: ' +
      userContent
  }

  return {
    usedWebSearch,
    webHitCount,
    webSearchAttempted,
    lastWebResults,
    userContent,
    systemMessages
  }
}
