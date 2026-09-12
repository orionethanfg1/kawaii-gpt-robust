/** Score and classify local SD weights; pick best checkpoint for a prompt. */

export function classifyLocalWeight(
  filename: string,
  sizeBytes?: number
): 'checkpoint' | 'lora' | 'unknown' {
  const low = filename.toLowerCase()
  if (/lora|lycoris|locon|lohan/.test(low)) return 'lora'
  if (sizeBytes != null && sizeBytes > 0 && sizeBytes < 200_000_000) return 'lora'
  if (/\.(safetensors|ckpt)$/i.test(filename)) return 'checkpoint'
  return 'unknown'
}

export function familyFromFilename(filename: string): string {
  const low = filename.toLowerCase()
  if (/realistic.?vision/.test(low)) return 'realistic-vision'
  if (/dreamshaper/.test(low)) return 'dreamshaper'
  if (/ultra/.test(low)) return 'ultra'
  if (/anything|counterfeit|anime/.test(low)) return 'anime'
  if (/sdxl|xl[-_]?base/.test(low)) return 'sdxl'
  return 'general'
}

export function pickBestCheckpoint(
  models: Array<{ title?: string; model_name?: string; name?: string; filename?: string }>,
  prompt?: string
): string | undefined {
  if (!models?.length) return undefined
  const names = models
    .map((m) => m.model_name || m.title || m.name || m.filename || '')
    .filter(Boolean)
  const score = (n: string) => {
    const low = n.toLowerCase()
    if (/lora|lycoris|embedding/.test(low)) return -100
    let s = 0
    if (/realistic.?vision/i.test(low)) s += 50
    if (/ultra/i.test(low)) s += 45
    if (/dreamshaper/i.test(low)) s += 35
    if (/realism|photoreal|epicreal|juggernaut/i.test(low)) s += 30
    if (/sdxl|xl/i.test(low)) s += 15
    if (prompt && /anime|manga/i.test(prompt) && /anime|anything|counterfeit/i.test(low)) s += 55
    if (prompt && /photo|retrato|realista|foto/i.test(prompt) && /realistic|vision|realism/i.test(low))
      s += 20
    return s
  }
  const sorted = [...names].sort((a, b) => score(b) - score(a))
  return sorted[0]
}

/** Prefer disk weights (kind checkpoint) when API list is empty */
export function pickBestFromDiskWeights(
  weights: Array<{ filename: string; kind?: string; sizeBytes?: number }>,
  prompt?: string
): string | undefined {
  const cps = weights.filter((w) => w.kind !== 'lora' && !/lora/i.test(w.filename))
  return pickBestCheckpoint(
    cps.map((w) => ({ model_name: w.filename, filename: w.filename })),
    prompt
  )
}
