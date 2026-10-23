/**
 * I0 — OutfitSpec: turn-level clothing only (never permanent identity).
 */
export type OutfitItem = {
  garment: string
  color?: string
  material?: string
  fit?: string
}

export type OutfitSpec = {
  items: OutfitItem[]
  /** Origin of this outfit */
  source: 'user_turn' | 'none' | 'merged'
  rawHints?: string
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
  violeta: 'violet',
  bordo: 'burgundy',
  burdeos: 'burgundy',
  dorado: 'gold',
  plateado: 'silver'
}

function colorFromText(raw: string): string | undefined {
  for (const [es, en] of Object.entries(COLOR_MAP)) {
    if (new RegExp(`\\b${es}\\b`, 'i').test(raw)) return en
  }
  for (const en of Object.values(COLOR_MAP)) {
    if (new RegExp(`\\b${en}\\b`, 'i').test(raw)) return en
  }
  return undefined
}

function pushUnique(items: OutfitItem[], item: OutfitItem): void {
  const key = `${item.garment}|${item.color || ''}`
  if (items.some((x) => `${x.garment}|${x.color || ''}` === key)) return
  items.push(item)
}

/** Parse clothing only from user text for this generation turn. */
export function parseOutfitSpecFromText(userText: string): OutfitSpec {
  const raw = (userText || '').trim()
  if (!raw) return { items: [], source: 'none' }

  const items: OutfitItem[] = []
  const low = raw.toLowerCase()
  const col = colorFromText(low)

  const rules: Array<{ re: RegExp; garment: string }> = [
    { re: /\bvestido\b|\bdress\b/i, garment: 'dress' },
    { re: /\bfalda\b|\bskirt\b/i, garment: 'skirt' },
    { re: /\bblusa\b|\bblouse\b/i, garment: 'blouse' },
    { re: /\bcamiseta\b|t-?shirt/i, garment: 't-shirt' },
    { re: /\bcamisa\b|\bshirt\b/i, garment: 'shirt' },
    { re: /\bchaqueta\b|\bjacket\b/i, garment: 'jacket' },
    { re: /\babrigo\b|\bcoat\b/i, garment: 'coat' },
    { re: /\bhoodie\b|\bsudadera\b/i, garment: 'hoodie' },
    { re: /\bsu[eé]ter\b|\bsweater\b/i, garment: 'sweater' },
    { re: /\bpantal[oó]n|\bjeans\b|\bpants\b/i, garment: 'pants' },
    { re: /\bbikini\b|traje de ba[nñ]o/i, garment: 'bikini' },
    { re: /\buniforme\b|\buniform\b/i, garment: 'uniform' },
    { re: /\barmadura\b|\barmor\b/i, garment: 'armor' },
    { re: /\bdisfraz\b|\bcostume\b|\bcosplay\b/i, garment: 'costume' },
    { re: /\btraje\b|\bsuit\b/i, garment: 'suit' }
  ]

  for (const { re, garment } of rules) {
    if (re.test(raw)) {
      pushUnique(items, { garment, color: col })
    }
  }

  if (
    items.length === 0 &&
    /\b(ropa|vestuario|outfit|clothing|attire)\b/i.test(raw)
  ) {
    pushUnique(items, { garment: 'outfit', color: col })
  }

  // "vestido azul" style: color bound to dress
  const dressColor =
    raw.match(/\b(?:vestido|dress)\s+(rojo|roja|azul|verde|negro|negra|blanco|blanca|rosa|morado)\b/i) ||
    raw.match(/\b(azul|rojo|roja|verde|negro|blanco|rosa)\s+(?:vestido|dress)\b/i)
  if (dressColor) {
    const c = colorFromText(dressColor[1] || '') || dressColor[1]
    const existing = items.find((i) => i.garment === 'dress')
    if (existing) existing.color = c
    else pushUnique(items, { garment: 'dress', color: c })
  }

  return {
    items,
    source: items.length ? 'user_turn' : 'none',
    rawHints: items.length ? raw.slice(0, 160) : undefined
  }
}

export function outfitSpecToPromptBits(outfit: OutfitSpec): string[] {
  if (!outfit.items.length) return []
  const bits: string[] = []
  for (const it of outfit.items) {
    const color = it.color ? `${it.color} ` : ''
    const mat = it.material ? `${it.material} ` : ''
    const fit = it.fit ? `${it.fit} ` : ''
    const phrase = `${fit}${color}${mat}${it.garment}`.replace(/\s+/g, ' ').trim()
    if (it.color && it.garment === 'dress') {
      bits.push(`(${it.color} dress:1.45)`, `wearing ${it.color} dress`)
    } else {
      bits.push(`wearing ${phrase}`)
    }
  }
  return bits
}

export function outfitNegativeBits(outfit: OutfitSpec): string[] {
  if (!outfit.items.length) return []
  const bits = ['wrong clothing', 'unrelated outfit']
  const dress = outfit.items.find((i) => i.garment === 'dress' && i.color)
  if (dress?.color) {
    for (const c of ['red', 'blue', 'green', 'black', 'white', 'pink', 'purple']) {
      if (c !== dress.color) bits.push(`${c} dress`)
    }
    bits.push('wrong clothing color')
  }
  return bits
}

/** Empty outfit for turns without clothing requests */
export function emptyOutfitSpec(): OutfitSpec {
  return { items: [], source: 'none' }
}
