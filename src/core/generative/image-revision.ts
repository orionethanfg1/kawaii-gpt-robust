/**
 * Hito 3.3 — Natural-language image revision without losing subject identity.
 *
 * Strategy:
 * 1) Keep a stable identity block (look + name + anchors).
 * 2) Parse user deltas (fondo, pelo, ropa, edad, pose…) into additive tags.
 * 3) Strip conflicting traits from the previous prompt when the user overrides them.
 * 4) Soft revisions can reuse seed; major scene changes get a new seed.
 */

export type ImageRevisionMemory = {
  prompt?: string
  negativePrompt?: string
  width?: number
  height?: number
  seed?: number
  provider?: string
  /** Last image was a self-portrait of the character */
  wasSelf?: boolean
  /** Framing hint from last intent */
  framing?: string
}

export type ImageRevisionResult = {
  prompt: string
  negativePrompt: string
  width?: number
  height?: number
  /** undefined = let generator randomize; number = lock seed */
  seed?: number
  /** Soft = same subject/scene tweak; major = new composition */
  changeLevel: 'soft' | 'major'
  deltas: string[]
  note: string
}

/** Operational / non-image commands must never trigger image revision */
export function isNonImageOperationalCommand(text: string): boolean {
  const t = (text || '').trim()
  return (
    /\b(renombra|cambia(?:r)?\s+(?:el\s+)?(?:nombre|t[ií]tulo)|pon(?:le)?\s+de\s+t[ií]tulo)\b/i.test(
      t
    ) ||
    /\b(nombre|t[ií]tulo)\s+del\s+chat\b/i.test(t) ||
    /\b(limpia|borra|archiva)\s+(?:los\s+)?(?:logs|historial|chats?)\b/i.test(t) ||
    /\b(arranca|inicia|det[eé]n|para|activa|desactiva)\s+(forge|ollama|m[uú]sica|ace|voz)\b/i.test(
      t
    ) ||
    /\b(estado de la app|lista(?:r)? de modelos)\b/i.test(t)
  )
}

export function looksLikeImageRevision(text: string, hasPrev: boolean): boolean {
  if (!hasPrev) return false
  if (isNonImageOperationalCommand(text)) return false
  const t = text || ''
  const samePersonCue =
    /\b(?:la\s+misma\s+persona|mismo\s+personaje|misma\s+cara|mismo\s+rostro|same\s+person|same\s+character|same\s+face|same\s+look)\b/i.test(
      t
    )
  const imageCue =
    /\b(foto|imagen|dibujo|retrato|fondo|pelo|cabello|ojos|cara|rostro|persona|personaje|piel|pose|luz|encuadre|cuerpo|vestido|ropa|sonrisa|maquillaje|escena)\b/i.test(
      t
    ) ||
    /\b(m[aá]s joven|m[aá]s mayor|hazla|hazlo|ponle|quita(?:le)?|otro fondo|misma pose|igual pero|la misma|en la playa|de noche)\b/i.test(
      t
    ) ||
    samePersonCue
  if (!imageCue) return false
  return /\b(m[aá]s|menos|cambia|hazla|hazlo|ponle|quita|otro|otra|mejor|joven|mayor|pelo|cabello|ojos|fondo|igual pero|la misma|la misma persona|mismo personaje|same person|same character|versi[oó]n)\b/i.test(
    t
  )
}

/** Short NL edits that should revise even without explicit image nouns */
export function shouldForceImageRevision(text: string, hasPrev: boolean): boolean {
  if (!hasPrev) return false
  if (isNonImageOperationalCommand(text)) return false
  const t = (text || '').trim()
  if (t.length > 120) return false
  return (
    /^(hazla|hazlo|ponle|qu[ií]tale|c[aá]mbiale|m[aá]s joven|m[aá]s mayor|otro fondo|de noche|de d[ií]a|la misma persona|mismo personaje|same person|same character|same face)\b/i.test(
      t
    ) ||
    /\b(igual pero|la misma pero|la misma persona|mismo personaje|same person|same character|same face|versi[oó]n)\b/i.test(t)
  )
}

export function looksLikeIdentityReject(text: string): boolean {
  return /\b(no eres t[uú]|esa no eres|no te pareces|identidad|no soy yo|wrong person)\b/i.test(
    text
  )
}

type ParsedDeltas = {
  tags: string[]
  removePatterns: RegExp[]
  changeLevel: 'soft' | 'major'
  labels: string[]
}

/** Extract structured scene/appearance deltas from Spanish NL */
export function parseRevisionDeltas(userText: string): ParsedDeltas {
  const t = userText || ''
  const tags: string[] = []
  const remove: RegExp[] = []
  const labels: string[] = []
  let major = false

  if (/\b(?:la\s+misma\s+persona|mismo\s+personaje|misma\s+cara|mismo\s+rostro|same\s+person|same\s+character|same\s+face|same\s+look)\b/i.test(t)) {
    tags.push('same person', 'consistent identity', 'same face', 'same facial structure')
    labels.push('misma persona')
  }
  if (/\bm[aá]s joven\b/i.test(t)) {
    tags.push('younger appearance', 'youthful face')
    labels.push('más joven')
  }
  if (/\bm[aá]s mayor\b|\bm[aá]s adulta?\b/i.test(t)) {
    tags.push('slightly older appearance', 'mature features')
    labels.push('más mayor')
  }

  const hairColor = t.match(
    /\b(?:pelo|cabello)\s+(rubio|casta[nñ]o|negro|rojo|azul|rosa|verde|blanco|plateado)\b/i
  )
  if (hairColor) {
    const map: Record<string, string> = {
      rubio: 'blonde hair',
      'castaño': 'brown hair',
      castano: 'brown hair',
      negro: 'black hair',
      rojo: 'red hair',
      azul: 'blue hair',
      rosa: 'pink hair',
      verde: 'green hair',
      blanco: 'white hair',
      plateado: 'silver hair'
    }
    const raw = hairColor[1].toLowerCase()
    const eng = map[raw] || `${hairColor[1]} hair`
    tags.push(`(${eng}:1.35)`)
    remove.push(/\b(blonde|brown|black|red|blue|pink|green|white|silver)\s+hair\b/gi)
    labels.push(`pelo ${hairColor[1]}`)
  }
  if (/\bpelo\s+corto\b|\bcabello\s+corto\b/i.test(t)) {
    tags.push('(short hair:1.3)')
    remove.push(/\b(long hair|very long hair)\b/gi)
    labels.push('pelo corto')
  }
  if (/\bpelo\s+largo\b|\bcabello\s+largo\b/i.test(t)) {
    tags.push('(long hair:1.3)')
    remove.push(/\bshort hair\b/gi)
    labels.push('pelo largo')
  }

  const eyeColor = t.match(/\bojos?\s+(azules?|verdes?|caf[eé]s?|marrones?|negros?|grises?)\b/i)
  if (eyeColor) {
    const map: Record<string, string> = {
      azul: 'blue eyes',
      azules: 'blue eyes',
      verde: 'green eyes',
      verdes: 'green eyes',
      cafe: 'brown eyes',
      'café': 'brown eyes',
      cafes: 'brown eyes',
      marrones: 'brown eyes',
      negros: 'black eyes',
      grises: 'gray eyes'
    }
    const k = eyeColor[1].toLowerCase()
    tags.push(`(${map[k] || eyeColor[1] + ' eyes'}:1.3)`)
    remove.push(/\b(blue|green|brown|black|gray|hazel)\s+eyes\b/gi)
    labels.push(`ojos ${eyeColor[1]}`)
  }

  if (
    /\bfondo\b|\bescena\b|\ben la playa\b|\bde noche\b|\bde d[ií]a\b|\bciudad\b|\bbosque\b|\bcaf[eé]\b|\boficina\b/i.test(
      t
    )
  ) {
    major = true
    if (/\bplaya\b/i.test(t)) tags.push('beach background', 'ocean', 'sunny')
    if (/\bde noche\b|\bnoche\b/i.test(t)) tags.push('night time', 'moody lighting')
    if (/\bde d[ií]a\b/i.test(t) && !/\bnoche\b/i.test(t)) tags.push('daytime', 'natural daylight')
    if (/\bbosque\b/i.test(t)) tags.push('forest background')
    if (/\bciudad\b/i.test(t)) tags.push('city background', 'urban')
    if (/\bcaf[eé]\b/i.test(t)) tags.push('cafe interior')
    if (/\boficina\b/i.test(t)) tags.push('office interior')
    if (/\botro fondo\b|\bcambia(?:r)?\s+el fondo\b/i.test(t)) {
      tags.push('different background')
      remove.push(/\b(beach|forest|city|office|cafe|night|daytime|ocean)\b/gi)
    }
    labels.push('escena/fondo')
  }

  // Clothing color / garment (critical: reference image often locks previous outfit)
  const dressColor = t.match(
    /\b(?:vestido|ropa|outfit|dress)\s+(rojo|roja|azul|verde|negro|negra|blanco|blanca|rosa|rosado|amarillo|amarilla|morado|morada|bordo|burdeos|vino|dorado|plateado)\b/i
  ) || t.match(
    /\b(rojo|roja|azul|verde|negro|negra|blanco|blanca|rosa|rosado)\s+(?:vestido|dress)\b/i
  )
  if (dressColor) {
    const raw = (dressColor[1] || '').toLowerCase()
    const map: Record<string, string> = {
      rojo: 'red',
      roja: 'red',
      azul: 'blue',
      verde: 'green',
      negro: 'black',
      negra: 'black',
      blanco: 'white',
      blanca: 'white',
      rosa: 'pink',
      rosado: 'pink',
      amarillo: 'yellow',
      amarilla: 'yellow',
      morado: 'purple',
      morada: 'purple',
      bordo: 'burgundy',
      burdeos: 'burgundy',
      vino: 'wine red',
      dorado: 'gold',
      plateado: 'silver'
    }
    const eng = map[raw] || raw
    tags.push(`(${eng} dress:1.45)`, `(wearing ${eng} dress:1.3)`, `${eng} outfit`)
    remove.push(
      /\b(red|blue|black|white|green|pink|yellow|purple|burgundy|wine|gold|silver)\s+(dress|outfit|gown)\b/gi
    )
    remove.push(/\b(velvet dress|red velvet|burgundy|maroon)\b/gi)
    labels.push(`vestido ${raw}`)
    major = true
  }
  const wardrobeCue =
    /\b(vestido|dress|catsuit|uniforme|uniform|traje|suit|ropa|vestuario|outfit|camiseta|camisa|blusa|chaqueta|abrigo|falda|pantal[oó]n|jeans|bikini|armadura|disfraz|cosplay|jacket|coat|skirt|pants|clothing|costume|armor)\b/i.test(
      t
    )
  if (wardrobeCue) {
    if (/\bcatsuit\b/i.test(t)) tags.push('(catsuit:1.45)', 'full-body catsuit', 'covered legs')
    if (/\b(uniforme|uniform)\b/i.test(t)) tags.push('uniform')
    if (/\b(armadura|armor)\b/i.test(t)) tags.push('armor')
    if (/\b(disfraz|costume|cosplay)\b/i.test(t)) tags.push('costume')
    const outfitDescription = t
      .replace(
        /^\s*(?:por favor\s*)?(?:ponle|ponme|cambia(?:le)?|cámbiale|vist[eé]la|viste|dress|put on|wear)\s*/i,
        ''
      )
      .replace(/\b(un|una|el|la|de|con|vestuario|ropa|outfit|clothing|attire)\b/gi, ' ')
      .replace(/\b(rojo|roja|azul|verde|negro|negra|blanco|blanca|rosa|rosado|morado|morada)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (outfitDescription.length > 2) {
      tags.push(`wearing ${outfitDescription}`)
    }
    if (!/\b(vestido|dress|catsuit|uniforme|uniform|traje|suit|armadura|armor|disfraz|costume|cosplay)\b/i.test(t)) {
      if (/\b(camiseta|t-?shirt)\b/i.test(t)) tags.push('t-shirt')
      if (/\b(camisa|shirt)\b/i.test(t)) tags.push('shirt')
      if (/\b(blusa|blouse)\b/i.test(t)) tags.push('blouse')
      if (/\b(chaqueta|jacket)\b/i.test(t)) tags.push('jacket')
      if (/\b(abrigo|coat)\b/i.test(t)) tags.push('coat')
      if (/\b(falda|skirt)\b/i.test(t)) tags.push('skirt')
      if (/\b(pantal[oó]n|jeans|pants)\b/i.test(t)) tags.push('pants')
      if (/\b(bikini|traje de ba[nñ]o)\b/i.test(t)) tags.push('swimwear')
    }
    if (!/\b(primer plano|close[- ]?up|headshot|de cintura|medio cuerpo|waist-up|upper body)\b/i.test(t)) {
      tags.push('(full body:1.4)', 'head to toe', 'entire outfit visible')
      remove.push(/\b(close[- ]?up|headshot|portrait crop|face focus|upper body|waist-up|portrait)\b/gi)
    }
    labels.push('vestuario/ropa')
    major = true
  }
  if (/\bcamiseta\b/i.test(t)) {
    tags.push('t-shirt')
    labels.push('camiseta')
    major = true
  }
  if (/\botro intento\b|\bhaz otro\b|\bde nuevo\b|\breintenta\b|\bregenera\b|\bregenerar\b|\botra (foto|imagen)\b|\bprueba otra\b/i.test(t)) {
    major = true
    labels.push('nuevo intento')
  }
  if (/\bsin\s+maquillaje\b/i.test(t)) {
    tags.push('no makeup', 'natural skin')
    remove.push(/\bmakeup\b/gi)
    labels.push('sin maquillaje')
  }
  if (/\bsonrisa\b|\bsonriendo\b/i.test(t)) {
    tags.push('gentle smile')
    labels.push('sonrisa')
  }

  if (/\bcuerpo completo\b|\bde cuerpo entero\b|\bfull body\b/i.test(t)) {
    tags.push('full body shot', 'head to toe')
    remove.push(/\b(close.?up|portrait|face focus|upper body)\b/gi)
    labels.push('cuerpo completo')
    major = true
  }
  if (/\bprimer plano\b|\bcerca de la cara\b/i.test(t)) {
    tags.push('close-up portrait', 'face focus')
    labels.push('primer plano')
  }

  if (!tags.length) {
    const residual = t
      .replace(
        /\b(hazla|hazlo|ponle|qu[ií]tale|cambia|por favor|please|un poco|m[aá]s|menos)\b/gi,
        ' '
      )
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80)
    if (residual.length > 3) {
      tags.push(residual)
      labels.push('ajuste libre')
    }
  }

  return {
    tags,
    removePatterns: remove,
    changeLevel: major ? 'major' : 'soft',
    labels
  }
}

function stripConflicting(basePrompt: string, patterns: RegExp[]): string {
  let p = basePrompt
  for (const re of patterns) {
    p = p.replace(re, ' ')
  }
  return p.replace(/\s+/g, ' ').replace(/,\s*,/g, ',').trim()
}

/**
 * Build revised prompt: identity first, then cleaned base, then deltas.
 * Never drops character look when provided.
 */
export function reviseImagePrompt(
  base: ImageRevisionMemory,
  userText: string,
  opts?: { characterLook?: string; characterName?: string; forceSelf?: boolean }
): ImageRevisionResult {
  const look = (opts?.characterLook || '').trim()
  const name = (opts?.characterName || '').trim()
  const samePersonCue =
    /\b(?:la\s+misma\s+persona|mismo\s+personaje|misma\s+cara|mismo\s+rostro|same\s+person|same\s+character|same\s+face|same\s+look)\b/i.test(
      userText || ''
    )
  const forceSelf =
    opts?.forceSelf === true ||
    (opts?.forceSelf !== false &&
      (base.wasSelf !== false || samePersonCue) &&
      (Boolean(look) || Boolean(name) || base.wasSelf === true || samePersonCue))
  const deltas = parseRevisionDeltas(userText)
  let baseP = (base.prompt || '').trim()
  if (deltas.removePatterns.length) {
    baseP = stripConflicting(baseP, deltas.removePatterns)
  }

  const identityBits: string[] = []
  if (forceSelf && look) {
    identityBits.push(`(identity lock: ${look}:1.4)`)
  }
  if (forceSelf && name) {
    identityBits.push(
      `portrait of ${name}`,
      `(same person as ${name}:1.45)`,
      'consistent character identity'
    )
  }
  if (forceSelf) {
    identityBits.push(
      'solo, single person, (one face:1.5), (one head:1.5)',
      'photorealistic skin texture, coherent facial structure'
    )
  }

  const prompt = [
    ...identityBits,
    baseP,
    ...deltas.tags,
    'consistent face, same person, coherent anatomy'
  ]
    .filter(Boolean)
    .join(', ')

  const requestedDress = userText.match(
    /\b(?:vestido|dress)\s+(rojo|roja|azul|verde|negro|negra|blanco|blanca|rosa|rosado|morado|morada|bordo|burdeos)\b/i
  )
  const requestedColor = requestedDress?.[1]?.toLowerCase()
  const requestedColorEnglish: Record<string, string> = {
    rojo: 'red',
    roja: 'red',
    azul: 'blue',
    verde: 'green',
    negro: 'black',
    negra: 'black',
    blanco: 'white',
    blanca: 'white',
    rosa: 'pink',
    rosado: 'pink',
    morado: 'purple',
    morada: 'purple',
    bordo: 'burgundy',
    burdeos: 'burgundy'
  }
  const defaultClothingNegatives = ['red dress', 'burgundy dress', 'maroon dress'].filter(
    (item) => !requestedColorEnglish[requestedColor || ''] ||
      !item.startsWith(requestedColorEnglish[requestedColor || ''] + ' ')
  )
  const negParts = [
    base.negativePrompt || '',
    'wrong person, different face, different identity, face mismatch',
    `wrong hair color, wrong clothing color, ${defaultClothingNegatives.join(', ')}, two heads, extra limbs, deformed face, mutated hands`,
    deltas.changeLevel === 'soft' ? 'completely different scene' : ''
  ]
    .filter(Boolean)
    .join(', ')

  const seed =
    deltas.changeLevel === 'soft' && typeof base.seed === 'number' ? base.seed : undefined

  const note =
    deltas.labels.length > 0
      ? `Revisión (${deltas.changeLevel}): ${deltas.labels.join(', ')}` +
        (seed != null ? ` · misma seed ${seed}` : ' · nueva seed')
      : `Revisión ${deltas.changeLevel}`

  return {
    prompt,
    negativePrompt: negParts,
    width: base.width,
    height: base.height,
    seed,
    changeLevel: deltas.changeLevel,
    deltas: deltas.labels,
    note
  }
}

/** Find last image revision memory walking messages newest-first */
export function extractRevisionMemoryFromMessages(
  messages: Array<{
    meta?: Record<string, unknown>
    attachments?: Array<{ mimeType?: string }>
    content?: string
  }>
): ImageRevisionMemory | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    const hasImg =
      Boolean(m.meta?.imageFilePath) ||
      Boolean(m.attachments?.some((a) => a.mimeType?.startsWith('image/')))
    if (!hasImg) continue
    const mem: ImageRevisionMemory = {
      prompt: String(m.meta?.imagePrompt || m.meta?.reason || ''),
      negativePrompt: m.meta?.imageNegative ? String(m.meta.imageNegative) : undefined,
      width: typeof m.meta?.imageWidth === 'number' ? (m.meta.imageWidth as number) : undefined,
      height: typeof m.meta?.imageHeight === 'number' ? (m.meta.imageHeight as number) : undefined,
      seed: typeof m.meta?.imageSeed === 'number' ? (m.meta.imageSeed as number) : undefined,
      provider: m.meta?.imageProvider ? String(m.meta.imageProvider) : undefined,
      wasSelf: m.meta?.imageWasSelf === true,
      framing: m.meta?.imageFraming ? String(m.meta.imageFraming) : undefined
    }
    if (!mem.prompt && m.content) {
      const line = m.content.split('\n').find((l) => l.startsWith('Prompt:'))
      if (line) mem.prompt = line.replace(/^Prompt:\s*/i, '')
    }
    return mem
  }
  return null
}


export function looksLikeRegenerate(text: string): boolean {
  return /\b(otro intento|haz otro|de nuevo|reintenta|regenera(?:r)?|otra (?:foto|imagen)|prueba otra)\b/i.test(
    text || ''
  )
}
