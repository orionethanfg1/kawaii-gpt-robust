
/**
 * P0: Force scene/outfit tags to win over checkpoint prior + optional prior-image lock.
 */
import { parseSceneSpecFromText, sceneSpecToSdFragments, type SceneSpec } from './scene-spec'

export function isMajorSceneChange(userText: string, prevPrompt?: string): boolean {
  const s = parseSceneSpecFromText(userText)
  if (s.clothing.length > 0) return true
  if (s.environment || s.timeOfDay) return true
  if (s.framing === 'full') return true
  if (prevPrompt) {
    const prev = prevPrompt.toLowerCase()
    for (const c of s.clothing) {
      if (c.garment && !prev.includes(c.garment.toLowerCase())) return true
      if (c.color && !prev.includes(c.color.toLowerCase())) return true
    }
  }
  return false
}

/** Prepend scene fragments and build anti-prior negatives */
export function applySceneForceToPrompts(
  prompt: string,
  negative: string,
  userText?: string,
  scene?: SceneSpec
): { prompt: string; negative: string; major: boolean; scene: SceneSpec } {
  const spec = scene || parseSceneSpecFromText(userText || prompt)
  const frag = sceneSpecToSdFragments(spec)
  const major =
    spec.clothing.length > 0 ||
    Boolean(spec.environment) ||
    Boolean(spec.timeOfDay) ||
    spec.framing === 'full' ||
    /acabo de llegar|cuando llegu[eé]|al llegar|just (got|arrived)|coming home|at the door/.test(
      (userText || '').toLowerCase()
    )

  const lead = frag.positive.join(', ')
  // Scene tags FIRST — SD attends early tokens more
  let p = lead ? `${lead}, ${prompt}` : prompt
  // Extra outfit emphasis
  for (const c of spec.clothing) {
    if (c.garment === 'catsuit') {
      const col = c.color || 'black'
      p = `(${col} catsuit:1.55), (full body catsuit:1.4), tight catsuit, covered legs, ${p}`
    }
  }
  if (spec.timeOfDay === 'night') {
    p = `(night scene:1.35), dark ambient, ${p}`
  }
  if (spec.environment) {
    p = `(${spec.environment}:1.3), ${p}`
  }

  // "cuando acabo de llegar" / coming home — rich door/interior scene
  const ut = (userText || '').toLowerCase()
  if (
    /acabo de llegar|cuando llegu[eé]|al llegar|llegando a casa|abriendo la puerta|en la puerta|just (got|arrived)|coming home|at the door/.test(
      ut
    )
  ) {
    p =
      '(just arrived home:1.4), (standing in doorway:1.35), open wooden door, cozy interior, warm indoor light, looking at viewer, natural candid moment, ' +
      p
    // treat as major scene
  }

  const requestedColors = new Set(spec.clothing.map((item) => item.color).filter(Boolean))
  const antiPrior = [
    ...frag.negative,
    // Counter common checkpoint priors without contradicting the requested outfit/scene.
    ...(requestedColors.has('green') ? [] : ['green dress']),
    ...(/\b(terciopelo|velvet)\b/i.test(spec.raw) ? [] : ['velvet dress']),
    ...(spec.timeOfDay === 'night' ? ['daylight portrait'] : []),
    ...(/\b(estudio|studio)\b/i.test(spec.raw) ? [] : ['studio softbox only']),
    ...(spec.clothing.length ? ['same outfit as reference', 'copy reference clothing'] : [])
  ]
  if (spec.clothing.some((c) => c.color === 'white' || c.garment === 'catsuit')) {
    antiPrior.push('green dress', 'red dress', 'bare shoulders only', 'nude')
  }
  const n = [negative, ...antiPrior].filter(Boolean).join(', ')

  return { prompt: p, negative: n, major, scene: spec }
}

export function cfgForScene(major: boolean, base = 7): number {
  return major ? Math.max(base, 8.5) : base
}
