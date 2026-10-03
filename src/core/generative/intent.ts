export function isMusicCapabilityQuestion(text: string): boolean {
  const t = text || ''
  const asks =
    /\b(puedes|podes|podés|sabes)\b.*\b(m[uú]sica|cancion|canción)\b/i.test(t) ||
    /\b(generas|haces)\b.*\b(m[uú]sica|canciones)\b/i.test(t)
  const concrete =
    /\b(genera|crea|haz|compón|compon)\b.*\b(cancion|canción|m[uú]sica)\b/i.test(t)
  return asks && !concrete
}

export function detectGenerativeIntent(text: string): {
  modality?: 'image' | 'music' | 'video'
  prompt?: string
} {
  const t = (text || '').trim()
  if (!t) return {}

  if (
    /\b(genera|crea|haz|compón|compon)\b[\s\S]{0,60}\b(cancion|canción|m[uú]sica|pista|beat)\b/i.test(
      t
    )
  ) {
    return { modality: 'music', prompt: t }
  }

  if (
    /\b(genera|generame|genérame|dibuja|crea|haz)\b[\s\S]{0,50}\b(imagen|foto|dibujo|retrato)\b/i.test(
      t
    ) ||
    /\b(foto tuya|imagen tuya|autorretrato)\b/i.test(t) ||
    /\b(haz|genera)\s+(una\s+)?foto\b/i.test(t)
  ) {
    return { modality: 'image', prompt: t }
  }

  if (/\b(genera|crea|haz)\b[\s\S]{0,40}\b(video|v[ií]deo)\b/i.test(t)) {
    return { modality: 'video', prompt: t }
  }

  return {}
}
