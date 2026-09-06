/**
 * Pick best local SD checkpoint for a prompt without manual selection.
 */

export type CheckpointHint = {
  preferredNames: string[]
  style: 'realistic' | 'anime' | 'any'
}

export function checkpointHintFromPrompt(prompt: string): CheckpointHint {
  const t = prompt.toLowerCase()
  if (/\b(anime|manga|waifu|2d|cel.?shad)/i.test(t)) {
    return {
      style: 'anime',
      preferredNames: ['anime', 'anything', 'counterfeit', 'meina', 'abyss', 'pony']
    }
  }
  if (/\b(photo|realistic|retrato|photoreal|raw photo|chica|woman|girl)\b/i.test(t)) {
    return {
      style: 'realistic',
      preferredNames: [
        'realistic',
        'realvis',
        'realisticvision',
        'epicrealism',
        'juggernaut',
        'photon',
        'dreamshaper'
      ]
    }
  }
  return {
    style: 'any',
    preferredNames: ['realistic', 'realvis', 'dreamshaper', 'sd']
  }
}

/** Match installed checkpoint titles to preferred names */
export function pickBestCheckpoint(
  installed: Array<{ title?: string; model_name?: string; filename?: string }>,
  prompt: string
): string | undefined {
  if (!installed?.length) return undefined
  const hint = checkpointHintFromPrompt(prompt)
  const score = (name: string) => {
    const n = name.toLowerCase()
    for (let i = 0; i < hint.preferredNames.length; i++) {
      if (n.includes(hint.preferredNames[i])) return 100 - i
    }
    return 0
  }
  let best: { s: number; id: string } | null = null
  for (const m of installed) {
    const id = m.model_name || m.title || m.filename || ''
    if (!id) continue
    const s = score(id)
    if (!best || s > best.s) best = { s, id }
  }
  // If nothing preferred matched, first installed
  return best && best.s > 0 ? best.id : installed[0]?.model_name || installed[0]?.title
}
