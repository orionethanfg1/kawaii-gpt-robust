/**
 * Hito 3 / I1 — Structured scene specification.
 * Host-owned: NL → SceneSpec (heuristic now; LLM JSON later) → SD prompt hints.
 */
import { describeNonHumanSubject } from './subject-prompt'

export type SceneFraming = 'close' | 'half' | 'full' | 'wide'

export type SceneClothing = {
  garment: string
  color?: string
  material?: string
  fit?: string
}

export type SceneSpec = {
  /** Raw user text */
  raw: string
  isSelf: boolean
  explicitOther: boolean
  framing: SceneFraming
  subject?: string
  pose?: string
  expression?: string
  clothing: SceneClothing[]
  hair?: string
  eyes?: string
  environment?: string
  timeOfDay?: string
  lighting?: string
  camera?: string
  mood?: string
  mustInclude: string[]
  mustAvoid: string[]
}

const COLOR_MAP: Record<string, string> = {
  azul: 'blue',
  rojo: 'red',
  roja: 'red',
  verde: 'green',
  negro: 'black',
  negra: 'black',
  blanco: 'white',
  blanca: 'white',
  rosa: 'pink',
  rosado: 'pink',
  amarillo: 'yellow',
  morado: 'purple',
  bordo: 'burgundy',
  burdeos: 'burgundy',
  dorado: 'gold',
  plateado: 'silver'
}

/**
 * Heuristic SceneSpec from Spanish/English user text (no LLM required).
 */
export function parseSceneSpecFromText(userText: string): SceneSpec {
  const raw = (userText || '').trim()
  const low = raw.toLowerCase()
  const samePersonCue =
    /\b(?:la\s+misma\s+persona|mismo\s+personaje|misma\s+cara|mismo\s+rostro|same\s+person|same\s+character|same\s+face|same\s+look)\b/i.test(
      low
    )

  const explicitOther =
    /\b(no seas t[uú]|otra persona|de otra|alguien m[aá]s|un desconocid|not you|different person|someone else|una chica|un chico|una mujer|un hombre|not the same person|no es la misma persona)\b/i.test(
      low
    ) && !/\b(tuya|tuyo|de ti|autorretrato|foto tuya|la\s+misma\s+persona|mismo\s+personaje|same\s+person|same\s+character)\b/i.test(low)
  const explicitFraming =
    /\b(cuerpo completo|cuerpo entero|full body|full-body|de pie|plano entero|head to toe|de la cabeza a los pies|de cintura|medio cuerpo|waist-up|upper body|primer plano|close[- ]?up|headshot|solo (?:la )?cara)\b/i.test(
      low
    )

  const isSelfBySamePerson =
    !explicitOther && samePersonCue && !/\b(otra persona|different person|someone else)\b/i.test(low)

  const isSelf =
    !explicitOther &&
    ( /\b(tuya|tuyo|de ti|como te ves|autorretrato|selfie|tu foto|foto tuya|imagen tuya|tu misma|t[uú] misma|la\s+misma\s+persona|mismo\s+personaje|misma\s+cara|mismo\s+rostro|same\s+person|same\s+character|same\s+face|same\s+look)\b/i.test(low) ||
      isSelfBySamePerson )
  const nonHumanSubject = describeNonHumanSubject(raw)

  let framing: SceneFraming = 'close'
  if (
    /\b(cuerpo completo|cuerpo entero|full body|full-body|de pie|plano entero|head to toe|de la cabeza a los pies)\b/i.test(
      low
    )
  ) {
    framing = 'full'
  } else if (/\b(de cintura|medio cuerpo|half|waist|upper body)\b/i.test(low)) {
    framing = 'half'
  } else if (/\b(paisaje|wide|escena amplia|ambiente)\b/i.test(low)) {
    framing = 'wide'
  } else if (isSelf) {
    framing = 'half'
  }
  if (!explicitFraming && nonHumanSubject) framing = 'wide'

  const clothing: SceneClothing[] = []
  if (/\bcatsuit\b/i.test(raw)) {
    clothing.push({
      garment: 'catsuit',
      material: 'stretch fabric',
      fit: 'tight full-body'
    })
  }
  const dress = raw.match(
    /\b(?:vestido|dress)\s+(rojo|roja|azul|verde|negro|negra|blanco|blanca|rosa)\b/i
  ) || raw.match(/\b(azul|rojo|verde|negro|blanco|rosa)\s+(?:vestido|dress)\b/i)
  if (dress) {
    const c = (dress[1] || '').toLowerCase()
    clothing.push({
      garment: 'dress',
      color: COLOR_MAP[c] || c
    })
  } else if (/\bvestido\b|\bdress\b/i.test(raw)) {
    clothing.push({ garment: 'dress' })
  }
  if (/\bcamiseta\b|t-?shirt/i.test(raw)) clothing.push({ garment: 't-shirt' })
  if (/\bcamisa\b|\bshirt\b/i.test(raw)) clothing.push({ garment: 'shirt' })
  if (/\bblusa\b|\bblouse\b/i.test(raw)) clothing.push({ garment: 'blouse' })
  if (/\bchaqueta\b|jacket/i.test(raw)) clothing.push({ garment: 'jacket' })
  if (/\babrigo\b|\bcoat\b/i.test(raw)) clothing.push({ garment: 'coat' })
  if (/\bfalda\b|skirt/i.test(raw)) clothing.push({ garment: 'skirt' })
  if (/\bpantal[oó]n|jeans|pants/i.test(raw)) clothing.push({ garment: 'pants' })
  if (/\bbikini\b|traje de ba[nñ]o/i.test(raw)) clothing.push({ garment: 'bikini' })
  if (/\buniforme\b|\buniform\b/i.test(raw)) clothing.push({ garment: 'uniform' })
  if (/\barmadura\b|\barmor\b/i.test(raw)) clothing.push({ garment: 'armor' })
  if (/\bdisfraz\b|\bcostume\b|\bcosplay\b/i.test(raw)) clothing.push({ garment: 'costume' })
  if (
    clothing.length === 0 &&
    /\b(ropa|vestuario|outfit|clothing|attire)\b/i.test(raw)
  ) {
    clothing.push({ garment: 'outfit' })
  }

  let eyes: string | undefined
  if (/\bojos?\s+azules?\b|blue eyes/i.test(raw)) eyes = 'blue eyes'
  if (/\bojos?\s+verdes?\b|green eyes/i.test(raw)) eyes = 'green eyes'

  let environment: string | undefined
  if (/\bplaya\b|beach/i.test(raw)) environment = 'beach, ocean'
  if (/\bbosque\b|forest/i.test(raw)) environment = 'forest'
  if (/\bciudad\b|city|calle/i.test(raw)) environment = 'city street'
  if (/\bcaf[eé]\b/i.test(raw)) environment = 'cafe interior'
  if (/\boficina\b|office/i.test(raw)) environment = 'office'
  if (/\bparque\b|park/i.test(raw)) environment = 'park'
  if (/\bcasa\b|home|living room/i.test(raw)) environment = 'cozy home interior'
  if (/\bmonta[nñ]a\b|mountain/i.test(raw)) environment = 'mountain landscape'
  if (/\brestaurante\b|restaurant/i.test(raw)) environment = 'restaurant interior'
  if (/\bhabitaci[oó]n\b|bedroom/i.test(raw)) environment = 'bedroom interior'
  if (/\bestudio\b|studio/i.test(raw)) environment = 'studio setting'
  if (/\bjard[ií]n\b|garden/i.test(raw)) environment = 'garden'
  if (/\bnatural lifestyle setting\b|natural setting/i.test(raw)) {
    environment = 'natural lifestyle setting'
  }

  let timeOfDay: string | undefined
  if (/\bde noche\b|night|nocturn/i.test(raw)) timeOfDay = 'night'
  if (/\bde d[ií]a\b|daytime|ma[nñ]ana/i.test(raw) && !timeOfDay) timeOfDay = 'daytime'

  let lighting: string | undefined
  if (/\bluz suave\b|soft light/i.test(raw)) lighting = 'soft lighting'
  if (/\bneon\b|ne[oó]n/i.test(raw)) lighting = 'neon lights'
  if (timeOfDay === 'night' && !lighting) lighting = 'moody night lighting'

  let pose: string | undefined
  if (/\bde pie\b|standing/i.test(raw)) pose = 'standing'
  if (/\bsentad[oa]\b|sitting/i.test(raw)) pose = 'sitting'
  if (/\bcaminando\b|walking/i.test(raw)) pose = 'walking'

  if (!explicitFraming) {
    if (clothing.length > 0) framing = 'full'
    else if (environment) framing = 'wide'
  }

  const mustInclude: string[] = []
  const mustAvoid: string[] = []
  if (framing === 'full') {
    mustInclude.push('full body', 'feet visible', 'head to toe')
    mustAvoid.push('close-up', 'headshot', 'cropped legs')
  }
  for (const c of clothing) {
    mustInclude.push(c.color ? `${c.color} ${c.garment}` : c.garment)
  }

  let subject: string | undefined
  if (nonHumanSubject) {
    subject = nonHumanSubject.prompt
  } else if (explicitOther || !isSelf) {
    if (/\bchica\b|mujer|girl|woman/i.test(raw)) subject = 'beautiful young woman'
    if (/\bchico\b|hombre|man|boy/i.test(raw)) subject = 'young man'
  }

  return {
    raw,
    isSelf,
    explicitOther,
    framing,
    subject,
    pose,
    clothing,
    eyes,
    environment,
    timeOfDay,
    lighting,
    camera: framing === 'full' ? 'full length shot' : undefined,
    mustInclude,
    mustAvoid
  }
}

/** Convert SceneSpec → positive/negative tag fragments for SD */
export function sceneSpecToSdFragments(spec: SceneSpec): {
  positive: string[]
  negative: string[]
  framing: SceneFraming
} {
  const positive: string[] = []
  const negative: string[] = [...spec.mustAvoid]

  if (spec.framing === 'full') {
    positive.push(
      '(full body:1.5)',
      '(head to toe:1.45)',
      'feet visible',
      'shoes visible',
      'standing on floor',
      'entire figure in frame'
    )
    negative.push(
      'close-up',
      'headshot',
      'portrait crop',
      'upper body only',
      'missing feet',
      'cropped legs'
    )
  } else if (spec.framing === 'half') {
    positive.push('upper body', 'waist-up')
  } else if (spec.framing === 'wide') {
    positive.push('wide shot', 'environment visible')
  } else {
    positive.push('portrait', 'face focus')
  }

  if (spec.subject && !spec.isSelf) positive.push(spec.subject)
  if (spec.pose) positive.push(spec.pose)
  if (spec.eyes && !spec.isSelf) positive.push(`(${spec.eyes}:1.3)`)

  for (const c of spec.clothing) {
    const bits = [
      c.fit,
      c.color,
      c.material,
      c.garment === 'catsuit' ? '(catsuit:1.45)' : c.garment
    ].filter(Boolean)
    positive.push(bits.join(' '))
    if (c.garment === 'catsuit') {
      positive.push('tight full-body suit', 'legs covered', 'sleeves')
      negative.push('nude', 'bare shoulders only', 'topless')
    }
    if (c.color === 'blue') negative.push('red dress', 'burgundy dress')
  }

  if (spec.environment) positive.push(spec.environment)
  if (spec.timeOfDay) positive.push(spec.timeOfDay)
  if (spec.lighting) positive.push(spec.lighting)
  if (spec.camera) positive.push(spec.camera)
  for (const m of spec.mustInclude) {
    if (!positive.some((p) => p.includes(m))) positive.push(m)
  }

  return { positive, negative, framing: spec.framing }
}


/** Prompt for optional LLM director (reason/instruct model). Returns JSON only. */
export function buildSceneDirectorPrompt(userText: string): string {
  return (
    'Eres un director de fotografía para Stable Diffusion. ' +
    'Convierte la petición del usuario en UN objeto JSON (sin markdown) con campos: ' +
    'isSelf (bool), framing (close|half|full|wide), subject, pose, expression, ' +
    'clothing (array de {garment,color,material,fit}), eyes, environment, timeOfDay, lighting, camera, mood, ' +
    'mustInclude (string[]), mustAvoid (string[]). ' +
    'Sé concreto en ropa, luz y encuadre. Petición:\n' +
    userText.slice(0, 500)
  )
}

/**
 * Merge LLM JSON into a base SceneSpec (heuristic). Fail-soft on bad JSON.
 */
export function parseSceneSpecFromLlmJson(
  jsonText: string,
  base?: SceneSpec
): SceneSpec | null {
  const raw = (jsonText || '').trim()
  if (!raw) return null
  let obj: Record<string, unknown>
  try {
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    obj = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    return null
  }
  const foundation =
    base ||
    parseSceneSpecFromText(typeof obj.raw === 'string' ? obj.raw : '')
  const protectedSubject = describeNonHumanSubject(foundation.raw)
  const framingRaw = String(obj.framing || foundation.framing || 'close')
  const parsedFramingValue =
    framingRaw === 'full' || framingRaw === 'half' || framingRaw === 'wide' || framingRaw === 'close'
      ? framingRaw
      : foundation.framing
  const framing = protectedSubject && !foundation.raw.match(
    /\b(cuerpo completo|cuerpo entero|full body|full-body|de pie|head to toe|de cintura|medio cuerpo|waist-up|upper body|primer plano|close[- ]?up|headshot|wide|paisaje)\b/i
  )
    ? 'wide'
    : parsedFramingValue

  const clothing: SceneClothing[] = []
  if (Array.isArray(obj.clothing)) {
    for (const item of obj.clothing) {
      if (!item || typeof item !== 'object') continue
      const g = item as Record<string, unknown>
      const garment = String(g.garment || '').trim()
      if (!garment) continue
      clothing.push({
        garment,
        color: g.color ? String(g.color) : undefined,
        material: g.material ? String(g.material) : undefined,
        fit: g.fit ? String(g.fit) : undefined
      })
    }
  }
  if (!clothing.length) clothing.push(...foundation.clothing)

  const asStrArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : []

  return {
    raw: foundation.raw,
    isSelf: foundation.isSelf,
    explicitOther: foundation.explicitOther,
    framing,
    subject: protectedSubject
      ? protectedSubject.prompt
      : obj.subject
        ? String(obj.subject)
        : foundation.subject,
    pose: obj.pose ? String(obj.pose) : foundation.pose,
    expression: obj.expression ? String(obj.expression) : foundation.expression,
    clothing,
    hair: obj.hair ? String(obj.hair) : foundation.hair,
    eyes: obj.eyes ? String(obj.eyes) : foundation.eyes,
    environment: obj.environment ? String(obj.environment) : foundation.environment,
    timeOfDay: obj.timeOfDay ? String(obj.timeOfDay) : foundation.timeOfDay,
    lighting: obj.lighting ? String(obj.lighting) : foundation.lighting,
    camera: obj.camera ? String(obj.camera) : foundation.camera,
    mood: obj.mood ? String(obj.mood) : foundation.mood,
    mustInclude: asStrArr(obj.mustInclude).length
      ? asStrArr(obj.mustInclude)
      : foundation.mustInclude,
    mustAvoid: asStrArr(obj.mustAvoid).length ? asStrArr(obj.mustAvoid) : foundation.mustAvoid
  }
}

/**
 * Optional LLM refine with timeout. llmFn returns raw model text; on fail → base.
 */
export async function refineSceneSpecWithLlm(
  userText: string,
  llmFn: (prompt: string) => Promise<string>,
  timeoutMs = 4000
): Promise<{ spec: SceneSpec; source: 'llm' | 'heuristic' }> {
  const base = parseSceneSpecFromText(userText)
  try {
    const prompt = buildSceneDirectorPrompt(userText)
    const text = await Promise.race([
      llmFn(prompt),
      new Promise<string>((_, rej) =>
        setTimeout(() => rej(new Error('scene-director-timeout')), timeoutMs)
      )
    ])
    const merged = parseSceneSpecFromLlmJson(text, base)
    if (merged) return { spec: merged, source: 'llm' }
  } catch {
    /* fall through */
  }
  return { spec: base, source: 'heuristic' }
}
