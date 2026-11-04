import { getLiveDocSliceChars } from '../conversation/dynamic-context-budget'
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

export const PROGRESSIVE_SLICE_CHARS = 32_000

/** Effective slice: dynamic budget when set, else default constant. */
export function effectiveProgressiveSliceChars(): number {
  try {
    const n = getLiveDocSliceChars()
    if (typeof n === 'number' && n >= 4000) return n
  } catch {
    /* */
  }
  return PROGRESSIVE_SLICE_CHARS
}
export const MAX_DOC_INJECT_CHARS = 72_000

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
    const win = effectiveProgressiveSliceChars()
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
  /** Absolute start offset in full text */
  streamOffset?: number
  /** Absolute end offset (next read starts here) */
  nextStreamOffset?: number
}

export function progressiveSlice(
  full: string,
  opts?: { chapterIndex?: number; maxChars?: number; streamOffset?: number }
): ProgressiveSlice {
  const chapters = splitIntoChapters(full)
  const max = opts?.maxChars ?? effectiveProgressiveSliceChars()
  const rawIdx = opts?.chapterIndex ?? 0
  const startOffEarly = Number(opts?.streamOffset)
  if (
    rawIdx >= chapters.length &&
    (Number.isNaN(startOffEarly) || startOffEarly < 0 || startOffEarly >= full.length)
  ) {
    return {
      body: '',
      chapterIndex: chapters.length,
      lastChapterIndex: Math.max(0, chapters.length - 1),
      chapterCount: chapters.length,
      chapterTitle: 'Completo',
      titles: [],
      totalChars: full.length,
      truncated: false,
      hint: 'Documento completo: no queda tramo nuevo por presentar.',
      streamOffset: full.length,
      nextStreamOffset: full.length
    }
  }
  // Absolute offset only when we already advanced (>0). Offset 0 + chapterIndex uses chapter start.
  let absOff = Math.max(0, Math.min(full.length, Number(opts?.streamOffset ?? 0)))
  let useAbs = Number(opts?.streamOffset) > 0

  let idx = Math.max(0, Math.min(chapters.length - 1, rawIdx))
  if (!useAbs && rawIdx > 0 && chapters[idx]) {
    absOff = chapters[idx].start
    useAbs = true
  }
  let body = ""
  let lastIdx = idx
  const titles: string[] = []
  let sliceStart = 0
  let sliceEnd = 0

  if (useAbs) {
    sliceStart = absOff
    // Map offset → chapter index for labels
    for (let i = 0; i < chapters.length; i++) {
      if (chapters[i].start <= absOff && absOff < chapters[i].end) {
        idx = i
        break
      }
      if (absOff >= chapters[i].end) idx = Math.min(chapters.length - 1, i + 1)
    }
    body = full.slice(absOff, Math.min(full.length, absOff + max))
    sliceEnd = absOff + body.length
    // Titles covered by this byte range
    for (let i = 0; i < chapters.length; i++) {
      const ch = chapters[i]
      if (ch.end <= absOff) continue
      if (ch.start >= sliceEnd) break
      titles.push(ch.title)
      lastIdx = i
    }
    if (!titles.length) {
      titles.push(chapters[idx]?.title || 'Tramo')
      lastIdx = idx
    }
  } else {
    for (let i = idx; i < chapters.length; i++) {
      let piece = chapters[i].text
      // Never inject a whole mega-chapter in one go
      if (piece.length > max) {
        piece = piece.slice(0, max)
        body = (body ? body + String.fromCharCode(10, 10) : '') + piece
        titles.push(chapters[i].title)
        lastIdx = i
        sliceStart = chapters[i].start
        sliceEnd = chapters[i].start + piece.length
        break
      }
      if (body.length + piece.length > max && body.length > 0) break
      body += (body ? String.fromCharCode(10, 10) : '') + piece
      titles.push(chapters[i].title)
      lastIdx = i
      sliceStart = chapters[idx].start
      sliceEnd = chapters[i].start + piece.length
      if (body.length >= max * 0.92) break
    }
    if (!body) {
      body = (chapters[idx]?.text || full).slice(0, max)
      sliceStart = chapters[idx]?.start || 0
      sliceEnd = sliceStart + body.length
    } else if (body.length < max * 0.4 && idx < chapters.length) {
      const extraStart = chapters[lastIdx].end
      const need = max - body.length
      if (need > 500 && extraStart < full.length) {
        const extra = full.slice(extraStart, extraStart + need)
        body += (body ? String.fromCharCode(10, 10) : '') + extra
        sliceEnd = extraStart + extra.length
      }
    }
  }
  const truncated = full.length > (useAbs ? sliceEnd : body.length)
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
  const nextOff = Math.min(full.length, Math.max(sliceEnd, (useAbs ? absOff : sliceStart) + body.length))
  return {
    body,
    chapterIndex: idx,
    lastChapterIndex: lastIdx,
    chapterCount: chapters.length,
    chapterTitle: titles[0] || chapters[idx]?.title || "Documento",
    titles,
    totalChars: full.length,
    truncated,
    hint,
    streamOffset: useAbs ? absOff : sliceStart,
    nextStreamOffset: nextOff
  }
}

export function parseReadingAdvance(
  userText: string,
  currentIndex: number,
  chapterCount: number
): number | null {
  const t = (userText || "").trim()
  if (!t) return null
  const m = t.match(/\b(?:capitulo|cap[ií]tulo|chapter|parte)\s+(\d+)\b/i)
  if (m) {
    const n = parseInt(m[1], 10)
    if (n >= 1 && n <= chapterCount) return n - 1
  }
  // Cursor already = next unread after markSliceRead; «sigue» keeps it
  if (
    /\b(sigue|continua|contin[uú]a|siguiente|next chapter)\b/i.test(t)
  ) {
    return Math.min(chapterCount - 1, Math.max(0, currentIndex))
  }
  return null
}

