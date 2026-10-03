/**
 * Live model discovery — not a hardcoded catalog.
 * Sources: local runtimes (via caller), Hugging Face GGUF, optional Ollama library search.
 */

export type RemoteModelHit = {
  id: string
  /** Pull / load identifier */
  pullName: string
  label: string
  source: 'huggingface-gguf' | 'ollama-library' | 'local-discovered'
  sizeHint?: string
  downloads?: number
  infoUrl?: string
  tags?: string[]
  /** Approximate min RAM for ranking only */
  minRamGB?: number
}

function sizeFromTags(tags: string[]): string | undefined {
  const hit = tags.find((t) => /^\d+(\.\d+)?[bB]$/.test(t) || /params/.test(t))
  return hit
}

function guessMinRam(id: string): number {
  const x = id.toLowerCase()
  if (/(70b|72b)/.test(x)) return 40
  if (/(32b|34b)/.test(x)) return 24
  if (/(27b|28b)/.test(x)) return 20
  if (/(14b|13b|12b)/.test(x)) return 14
  if (/(9b|8b|7b)/.test(x)) return 10
  if (/(4b|3b)/.test(x)) return 6
  if (/(1\.5b|1b|0\.5b)/.test(x)) return 3
  return 8
}

/**
 * Search Hugging Face for GGUF text models (usable via Ollama hf.co/ or LM Studio).
 */
export async function searchHuggingFaceGguf(
  query: string,
  limit = 16
): Promise<{ ok: boolean; results: RemoteModelHit[]; error?: string }> {
  const q = query.trim().slice(0, 80)
  if (q.length < 2) return { ok: true, results: [] }
  const lim = Math.min(24, Math.max(4, limit))
  try {
    const url =
      'https://huggingface.co/api/models?search=' +
      encodeURIComponent(q) +
      '&filter=gguf&sort=downloads&direction=-1&limit=' +
      lim
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(12_000)
    })
    if (!res.ok) return { ok: false, results: [], error: `HF HTTP ${res.status}` }
    const raw = (await res.json()) as Array<{
      id?: string
      modelId?: string
      downloads?: number
      tags?: string[]
      pipeline_tag?: string
    }>
    const results: RemoteModelHit[] = (Array.isArray(raw) ? raw : [])
      .map((m) => {
        const id = String(m.id || m.modelId || '')
        if (!id) return null
        const tags = m.tags || []
        // Prefer instruct / chat flavoured repos
        const label = id.split('/').pop() || id
        return {
          id: `hf:${id}`,
          pullName: `hf.co/${id}`,
          label,
          source: 'huggingface-gguf' as const,
          sizeHint: sizeFromTags(tags),
          downloads: m.downloads,
          infoUrl: `https://huggingface.co/${id}`,
          tags: tags.slice(0, 10),
          minRamGB: guessMinRam(id)
        }
      })
      .filter(Boolean) as RemoteModelHit[]
    return { ok: true, results }
  } catch (e) {
    return { ok: false, results: [], error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Best-effort Ollama library search (public site API when available).
 * Falls back to empty list without throwing.
 */
export async function searchOllamaLibrary(
  query: string,
  limit = 12
): Promise<{ ok: boolean; results: RemoteModelHit[]; error?: string }> {
  const q = query.trim().slice(0, 60)
  if (q.length < 2) return { ok: true, results: [] }
  try {
    // Undocumented but widely used search endpoint; if it breaks, HF still works.
    const url = `https://ollama.com/api/search?q=${encodeURIComponent(q)}`
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000)
    })
    if (!res.ok) {
      return { ok: false, results: [], error: `Ollama search HTTP ${res.status}` }
    }
    const json = (await res.json()) as {
      models?: Array<{ name?: string; description?: string; pulls?: number; tags?: string[] }>
      results?: Array<{ name?: string; description?: string }>
    }
    const rows = json.models || json.results || []
    const results: RemoteModelHit[] = rows
      .slice(0, limit)
      .map((m) => {
        const name = String(m.name || '').trim()
        if (!name) return null
        return {
          id: `ollama:${name}`,
          pullName: name.includes(':') ? name : `${name}:latest`,
          label: name,
          source: 'ollama-library' as const,
          downloads: (m as { pulls?: number }).pulls,
          infoUrl: `https://ollama.com/library/${name.split(':')[0]}`,
          tags: (m as { tags?: string[] }).tags,
          minRamGB: guessMinRam(name)
        }
      })
      .filter(Boolean) as RemoteModelHit[]
    return { ok: true, results }
  } catch (e) {
    return { ok: false, results: [], error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Combined remote search for the catalog UI.
 * Prefer Ollama library names when present; always merge HF GGUF.
 */
export async function searchRemoteModels(
  query: string,
  opts?: { limit?: number }
): Promise<{
  ok: boolean
  results: RemoteModelHit[]
  sources: string[]
  error?: string
}> {
  const limit = opts?.limit ?? 16
  const [ollama, hf] = await Promise.all([
    searchOllamaLibrary(query, Math.ceil(limit / 2)),
    searchHuggingFaceGguf(query, limit)
  ])
  const seen = new Set<string>()
  const results: RemoteModelHit[] = []
  for (const r of [...ollama.results, ...hf.results]) {
    const key = r.pullName.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    results.push(r)
  }
  results.sort((a, b) => (b.downloads || 0) - (a.downloads || 0))
  const sources: string[] = []
  if (ollama.ok && ollama.results.length) sources.push('ollama-library')
  if (hf.ok && hf.results.length) sources.push('huggingface-gguf')
  const ok = results.length > 0 || (ollama.ok && hf.ok)
  const error = !ok
    ? [ollama.error, hf.error].filter(Boolean).join(' · ') || 'sin resultados'
    : undefined
  return { ok, results: results.slice(0, limit), sources, error }
}
