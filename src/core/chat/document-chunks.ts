/**
 * Chapter-aware splitting for long documents (books, reports).
 * Progressive reading: first slice + pointer for follow-up turns.
 */

export type DocChapter = {
  title: string
  start: number
  end: number
  text: string
}

/** Matches Capitulo / Chapter / Parte / Section headers */
const CHAPTER_RE =
  /(?:^|\n)\s*(?:capitulo|cap\u00edtulo|chapter|parte|part|seccion|secci\u00f3n|section)\s+[\dIVXLCivxlc]+[^\n]{0,80}/gi

export const PROGRESSIVE_SLICE_CHARS = 14_000
export const MAX_DOC_INJECT_CHARS = 28_000

export function splitIntoChapters(full: string): DocChapter[] {
  const text = full || ""
  if (text.length < 800) {
    return [{ title: "Documento", start: 0, end: text.length, text }]
  }
  const hits: { index: number; title: string }[] = []
  let m: RegExpExecArray | null
  const re = new RegExp(CHAPTER_RE.source, CHAPTER_RE.flags)
  while ((m = re.exec(text)) !== null) {
    const title = m[0].replace(/^\n/, "").trim().slice(0, 80)
    hits.push({ index: m.index, title })
  }
  if (hits.length < 2) {
    const out: DocChapter[] = []
    const win = PROGRESSIVE_SLICE_CHARS
    for (let i = 0, n = 1; i < text.length; i += win, n++) {
      const end = Math.min(text.length, i + win)
      out.push({
        title: "Parte " + n,
        start: i,
        end,
        text: text.slice(i, end)
      })
    }
    return out
  }
  const chapters: DocChapter[] = []
  for (let i = 0; i < hits.length; i++) {
    const start = hits[i].index
    const end = i + 1 < hits.length ? hits[i + 1].index : text.length
    chapters.push({
      title: hits[i].title || "Capitulo " + (i + 1),
      start,
      end,
      text: text.slice(start, end)
    })
  }
  if (hits[0].index > 200) {
    chapters.unshift({
      title: "Inicio / prologo",
      start: 0,
      end: hits[0].index,
      text: text.slice(0, hits[0].index)
    })
  }
  return chapters
}

export type ProgressiveSlice = {
  body: string
  /** First chapter included in this slice */
  chapterIndex: number
  /** Last chapter included (use this as cursor for next «sigue») */
  lastChapterIndex: number
  chapterCount: number
  chapterTitle: string
  titles: string[]
  totalChars: number
  truncated: boolean
  hint: string
}

export function progressiveSlice(
  full: string,
  opts?: { chapterIndex?: number; maxChars?: number }
): ProgressiveSlice {
  const chapters = splitIntoChapters(full)
  const max = opts?.maxChars ?? PROGRESSIVE_SLICE_CHARS
  let idx = Math.max(0, Math.min(chapters.length - 1, opts?.chapterIndex ?? 0))
  let body = ""
  let lastIdx = idx
  const titles: string[] = []
  for (let i = idx; i < chapters.length; i++) {
    const piece = chapters[i].text
    if (body.length + piece.length > max && body.length > 0) break
    body += (body ? String.fromCharCode(10, 10) : "") + piece
    titles.push(chapters[i].title)
    lastIdx = i
    if (body.length >= max * 0.85) break
  }
  if (!body) {
    body = (chapters[idx]?.text || full).slice(0, max)
  }
  const truncated = full.length > body.length
  const remaining = chapters.length - lastIdx - 1
  let hint: string
  if (!truncated) {
    hint = "Documento completo en contexto."
  } else if (remaining > 0) {
    hint =
      "Extracto progresivo: " +
      titles.join(" · ") +
      " (indice " +
      (idx + 1) +
      "-" +
      (lastIdx + 1) +
      " de " +
      chapters.length +
      "). Si el usuario pide sigue, siguiente capitulo o un numero, continua sin inventar lo no leido."
  } else {
    hint = "Extracto parcial (" + body.length + " de " + full.length + " caracteres)."
  }
  return {
    body,
    chapterIndex: idx,
    lastChapterIndex: lastIdx,
    chapterCount: chapters.length,
    chapterTitle: titles[0] || chapters[idx]?.title || "Documento",
    titles,
    totalChars: full.length,
    truncated,
    hint
  }
}

export function parseReadingAdvance(
  userText: string,
  currentIndex: number,
  chapterCount: number
): number | null {
  const t = (userText || "").trim()
  if (!t) return null
  if (/\b(sigue|continua|contin\u00faa|siguiente (capitulo|cap\u00edtulo|parte)|next chapter)\b/i.test(t)) {
    return Math.min(chapterCount - 1, currentIndex + 1)
  }
  const m = t.match(/\b(?:capitulo|cap\u00edtulo|chapter|parte)\s+(\d+)\b/i)
  if (m) {
    const n = parseInt(m[1], 10)
    if (n >= 1 && n <= chapterCount) return n - 1
  }
  return null
}

