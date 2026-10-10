/**
 * Multi-backend web search (main process). P0.3 — prioritize real hits.
 * Cascade: local SearXNG → public SearX → Wiki REST → DDG → Bing HTML.
 */

export type WebSearchHit = {
  title: string
  snippet: string
  url?: string
  source?: string
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim()
}

async function fetchText(
  url: string,
  init?: RequestInit & { timeoutMs?: number }
): Promise<{ ok: boolean; status: number; text: string }> {
  const timeoutMs = init?.timeoutMs ?? 12_000
  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
        ...(init?.headers || {})
      },
      signal: AbortSignal.timeout(timeoutMs)
    })
    const text = await res.text()
    return { ok: res.ok, status: res.status, text }
  } catch {
    return { ok: false, status: 0, text: "" }
  }
}

/** Wikimedia Core search (more reliable than opensearch under rate limit) */
async function searchWikiRest(
  query: string,
  limit: number,
  lang: "es" | "en"
): Promise<WebSearchHit[]> {
  const url =
    "https://api.wikimedia.org/core/v1/wikipedia/" +
    lang +
    "/search/page?q=" +
    encodeURIComponent(query) +
    "&limit=" +
    limit
  const { ok, text } = await fetchText(url, {
    headers: {
      Accept: "application/json",
      "Api-User-Agent": "KawaiiGPTRobust/0.10 (desktop; web-search-tool)"
    },
    timeoutMs: 12_000
  })
  if (!ok || !text || text.trimStart().startsWith("You are")) return []
  try {
    const data = JSON.parse(text) as {
      pages?: Array<{ title?: string; description?: string; excerpt?: string; key?: string }>
    }
    const out: WebSearchHit[] = []
    for (const p of data.pages || []) {
      if (!p.title) continue
      const slug = encodeURIComponent(p.key || p.title.replace(/ /g, "_"))
      out.push({
        title: p.title,
        snippet: stripTags(p.description || p.excerpt || p.title).slice(0, 400),
        url: "https://" + lang + ".wikipedia.org/wiki/" + slug,
        source: "wiki-rest"
      })
      if (out.length >= limit) break
    }
    return out
  } catch {
    return []
  }
}

async function wikiSummary(title: string, lang: "es" | "en"): Promise<string> {
  const url =
    "https://" +
    lang +
    ".wikipedia.org/api/rest_v1/page/summary/" +
    encodeURIComponent(title.replace(/ /g, "_"))
  const { ok, text } = await fetchText(url, {
    headers: {
      Accept: "application/json",
      "Api-User-Agent": "KawaiiGPTRobust/0.10"
    },
    timeoutMs: 10_000
  })
  if (!ok) return ""
  try {
    const data = JSON.parse(text) as { extract?: string }
    return (data.extract || "").slice(0, 900)
  } catch {
    return ""
  }
}

async function searchDuckDuckGoInstant(query: string, limit: number): Promise<WebSearchHit[]> {
  const url =
    "https://api.duckduckgo.com/?q=" +
    encodeURIComponent(query) +
    "&format=json&no_html=1&skip_disambig=1"
  const { ok, text } = await fetchText(url, {
    headers: { Accept: "application/json" },
    timeoutMs: 12_000
  })
  if (!ok) return []
  try {
    const data = JSON.parse(text) as {
      AbstractText?: string
      AbstractURL?: string
      Heading?: string
      RelatedTopics?: Array<{
        Text?: string
        FirstURL?: string
        Topics?: Array<{ Text?: string; FirstURL?: string }>
      }>
    }
    const results: WebSearchHit[] = []
    if (data.AbstractText) {
      results.push({
        title: data.Heading || "Resumen",
        snippet: data.AbstractText,
        url: data.AbstractURL,
        source: "ddg-instant"
      })
    }
    const flatten = (
      topics: Array<{ Text?: string; FirstURL?: string; Topics?: unknown[] }> | undefined
    ) => {
      for (const t of topics ?? []) {
        if (results.length >= limit) break
        if (t.Text) {
          results.push({
            title: t.Text.slice(0, 100),
            snippet: t.Text,
            url: t.FirstURL,
            source: "ddg-instant"
          })
        }
        if (Array.isArray(t.Topics)) {
          flatten(t.Topics as Array<{ Text?: string; FirstURL?: string }>)
        }
      }
    }
    flatten(data.RelatedTopics)
    return results.slice(0, limit)
  } catch {
    return []
  }
}

async function searchDuckDuckGoHtml(query: string, limit: number): Promise<WebSearchHit[]> {
  const url = "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query)
  const { ok, text: html } = await fetchText(url, { timeoutMs: 15_000 })
  if (!ok || !html) return []
  const results: WebSearchHit[] = []
  const re =
    /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
  let m: RegExpExecArray | null
  const snippets: string[] = []
  const snRe = /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|td|div)/gi
  let sm: RegExpExecArray | null
  while ((sm = snRe.exec(html)) && snippets.length < limit * 2) {
    snippets.push(stripTags(sm[1]))
  }
  let si = 0
  while ((m = re.exec(html)) && results.length < limit) {
    let href = m[1]
    // DDG redirect
    const uddg = /uddg=([^&]+)/.exec(href)
    if (uddg) {
      try {
        href = decodeURIComponent(uddg[1])
      } catch {
        /* */
      }
    }
    if (!/^https?:\/\//i.test(href)) continue
    if (/duckduckgo\.com/i.test(href)) continue
    results.push({
      title: stripTags(m[2]).slice(0, 120),
      snippet: snippets[si++] || stripTags(m[2]).slice(0, 200),
      url: href,
      source: "ddg-html"
    })
  }
  return results
}

async function searchDuckDuckGoLite(query: string, limit: number): Promise<WebSearchHit[]> {
  const url = "https://lite.duckduckgo.com/lite/?q=" + encodeURIComponent(query)
  const { ok, text: html } = await fetchText(url, { timeoutMs: 12_000 })
  if (!ok || !html) return []
  const results: WebSearchHit[] = []
  const re = /<a[^>]+rel="nofollow"[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) && results.length < limit) {
    const href = m[1]
    if (/duckduckgo\.com/i.test(href)) continue
    results.push({
      title: stripTags(m[2]).slice(0, 120),
      snippet: stripTags(m[2]).slice(0, 200),
      url: href,
      source: "ddg-lite"
    })
  }
  return results
}

async function searchBingHtml(query: string, limit: number): Promise<WebSearchHit[]> {
  const url = "https://www.bing.com/search?q=" + encodeURIComponent(query) + "&setlang=es-es"
  const { ok, text: html } = await fetchText(url, { timeoutMs: 15_000 })
  if (!ok || !html) return []
  const results: WebSearchHit[] = []
  const re =
    /<h2[^>]*>\s*<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h2>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) && results.length < limit) {
    const href = m[1]
    if (/bing\.com|microsoft\.com|msn\.com/i.test(href)) continue
    const title = stripTags(m[2])
    if (title) results.push({ title, snippet: title, url: href, source: "bing-html" })
  }
  return results
}

async function searchSearxPublic(
  query: string,
  limit: number,
  customBase?: string
): Promise<WebSearchHit[]> {
  const instances = [
    ...(customBase ? [customBase.replace(/\/$/, "")] : []),
    "http://127.0.0.1:8080",
    "http://localhost:8080",
    "https://searx.be",
    "https://search.sapti.me",
    "https://searx.tiekoetter.com",
    "https://searx.prvcy.eu",
    "https://search.ononoki.org",
    "https://searx.work"
  ]
  // de-dupe
  const seen = new Set<string>()
  for (const base of instances) {
    const b = base.replace(/\/$/, "")
    if (seen.has(b)) continue
    seen.add(b)
    for (const path of ["/search", "/"]) {
      if (path === "/" && !customBase && !b.includes("127.0.0.1") && !b.includes("localhost")) {
        continue
      }
      const url =
        b +
        "/search?q=" +
        encodeURIComponent(query) +
        "&format=json&language=es-ES&categories=general"
      const { ok, status, text } = await fetchText(url, {
        headers: { Accept: "application/json" },
        timeoutMs: 11_000
      })
      if (!ok || status === 429 || !text) continue
      if (text.trimStart().startsWith("<")) continue
      try {
        const data = JSON.parse(text) as {
          results?: Array<{ title?: string; content?: string; url?: string }>
        }
        const out: WebSearchHit[] = []
        for (const r of data.results ?? []) {
          if (out.length >= limit) break
          if (r.title)
            out.push({
              title: r.title,
              snippet: r.content || r.title,
              url: r.url,
              source: b.includes("127.0.0.1") || b.includes("localhost") ? "searx-local" : "searx"
            })
        }
        if (out.length) return out
      } catch {
        /* next */
      }
    }
  }
  return []
}

function mergeHits(lists: WebSearchHit[][], limit: number): WebSearchHit[] {
  const seen = new Set<string>()
  const out: WebSearchHit[] = []
  for (const list of lists) {
    for (const h of list) {
      const key = (h.url || h.title).toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(h)
      if (out.length >= limit) return out
    }
  }
  return out
}

export type SearchWebOptions = {
  maxResults?: number
  searxngBaseUrl?: string
}

function extractKeywords(q: string): string {
  return q
    .replace(/[¿?¡!.,;:"']/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .filter((w) => !/^(busca|buscar|web|internet|google|amor|por|favor|información|informacion|sobre)$/i.test(w))
    .slice(0, 8)
    .join(" ")
}

export async function searchWeb(
  query: string,
  maxResultsOrOpts: number | SearchWebOptions = 5
): Promise<WebSearchHit[]> {
  const opts: SearchWebOptions =
    typeof maxResultsOrOpts === "number"
      ? { maxResults: maxResultsOrOpts }
      : maxResultsOrOpts || {}
  const q = (query || "").trim()
  if (!q) return []
  const limit = Math.max(1, Math.min(opts.maxResults ?? 5, 10))
  const kw = extractKeywords(q) || q

  // 1) SearX (local first if configured) + DDG instant in parallel
  const [searx, instant] = await Promise.all([
    searchSearxPublic(q, limit, opts.searxngBaseUrl),
    searchDuckDuckGoInstant(q, limit)
  ])
  let merged = mergeHits([searx, instant], limit)
  if (merged.length >= Math.min(2, limit)) return merged

  // 2) Wikipedia REST es + en
  const [wikiEs, wikiEn] = await Promise.all([
    searchWikiRest(kw, limit, "es"),
    searchWikiRest(kw, Math.min(3, limit), "en")
  ])
  if (wikiEs[0]?.title) {
    const ex = await wikiSummary(wikiEs[0].title, "es")
    if (ex) wikiEs[0] = { ...wikiEs[0], snippet: ex }
  }
  merged = mergeHits([merged, wikiEs, wikiEn], limit)
  if (merged.length >= Math.min(2, limit)) return merged

  // 3) HTML scrapers
  const [ddgHtml, ddgLite, bing] = await Promise.all([
    searchDuckDuckGoHtml(q, limit),
    searchDuckDuckGoLite(kw, limit),
    searchBingHtml(q, limit)
  ])
  merged = mergeHits([merged, ddgHtml, ddgLite, bing], limit)
  if (merged.length) return merged

  // 4) Keyword-only retry
  if (kw !== q) {
    const [s2, w2] = await Promise.all([
      searchSearxPublic(kw, limit, opts.searxngBaseUrl),
      searchWikiRest(kw, limit, "es")
    ])
    merged = mergeHits([s2, w2], limit)
  }
  return merged
}
