/**
 * User visual identity — how the companion “sees” the human.
 * Policy: up to **two** refs — face + body — or **one** if the same photo
 * covers both (role `full` / high-res single shot).
 */

export type UserVisualItem = {
  id?: string
  filePath?: string
  dataUrl?: string
  label?: string
  note?: string
  role?: 'face' | 'full' | 'body' | 'scene' | 'other' | string
  /** Longest edge in px when known (hydration / upload) */
  maxEdgePx?: number
}

export type UserVisualMemorySlice = {
  appearanceNotes?: string
  visualGallery?: UserVisualItem[]
  visualPrimaryPath?: string
  preferredName?: string
}

/** Enough resolution to read face + upper body in one frame */
export const USER_VISUAL_SINGLE_MIN_EDGE = 1024

function hasMedia(g: UserVisualItem): boolean {
  return !!(g.filePath || g.dataUrl)
}

function roleOf(g: UserVisualItem): string {
  return String(g.role || 'other').toLowerCase()
}

/**
 * Prefer at most 2 refs: face + body.
 * One ref if:
 * - single gallery item, or
 * - item marked `full`, or
 * - known maxEdgePx >= USER_VISUAL_SINGLE_MIN_EDGE and only one strong shot
 */
export function selectUserVisualRefs(
  mem: UserVisualMemorySlice | null | undefined
): UserVisualItem[] {
  if (!mem) return []
  const gal = (mem.visualGallery || []).filter(hasMedia)
  if (!gal.length) return []

  if (gal.length === 1) return [gal[0]]

  const face = gal.find((g) => roleOf(g) === 'face')
  const body = gal.find((g) => roleOf(g) === 'body' || roleOf(g) === 'full')
  const fullOnly = gal.find((g) => roleOf(g) === 'full')

  // Prefer face + body/full together so the model sees both identity and physique
  if (face && fullOnly && face !== fullOnly) return [face, fullOnly]
  if (face && body && face !== body) return [face, body]
  if (fullOnly) {
    const edge = fullOnly.maxEdgePx || 0
    if (edge >= USER_VISUAL_SINGLE_MIN_EDGE || !face) return [fullOnly]
  }

  if (face && body && face !== body) return [face, body]
  if (face && fullOnly && face !== fullOnly) return [face, fullOnly]
  if (face) return [face]
  if (body) return [body]

  return gal.slice(0, 2)
}

/**
 * System block: physical facts about the USER (not the assistant).
 */
export function buildUserVisualPrompt(
  mem: UserVisualMemorySlice | null | undefined,
  opts?: { maxChars?: number }
): string {
  if (!mem) return ''
  const max = opts?.maxChars ?? 1000
  const bits: string[] = []
  const name = (mem.preferredName || '').trim()
  const notes = (mem.appearanceNotes || '').trim()
  const selected = selectUserVisualRefs(mem)
  const gal = Array.isArray(mem.visualGallery) ? mem.visualGallery.filter(hasMedia) : []

  if (!notes && selected.length === 0) return ''

  bits.push(
    '# Apariencia del USUARIO (persona real con quien hablas — NO eres tú)',
    'Hechos sobre el cuerpo/rostro/estilo del usuario. Reconócele; no inventes otro físico. ' +
      'No digas que no puedes verle si hay descripción o fotos en su perfil.'
  )
  if (name) bits.push(`Nombre / cómo le llamas: ${name}`)
  if (notes) bits.push(`Descripción física (ficha del usuario):\n${notes.slice(0, 600)}`)

  if (selected.length === 1) {
    const g = selected[0]
    const edge = g.maxEdgePx || 0
    const both =
      roleOf(g) === 'full' || edge >= USER_VISUAL_SINGLE_MIN_EDGE || gal.length === 1
    bits.push(
      both
        ? `Referencia visual: **1 foto** (cara y cuerpo en el mismo encuadre` +
          (edge ? `, ~${edge}px` : '') +
          `). Etiqueta: ${g.label || g.role || 'principal'}.`
        : `Referencia visual principal: [${g.role || 'foto'}] ${g.label || 'ref'}.`
    )
  } else if (selected.length >= 2) {
    bits.push(
      'Referencias visuales del usuario (**2**): ' +
        selected
          .map((g, i) => {
            const r = roleOf(g)
            const kind =
              r === 'face' ? 'cara' : r === 'body' || r === 'full' ? 'cuerpo/plano' : r
            return `${i + 1}) ${kind}: ${g.label || 'foto'}`
          })
          .join(' · ')
    )
    bits.push(
      'Usa la de **cara** para identidad facial y la de **cuerpo** para complexión/estilo. ' +
        'Si solo una tiene buena calidad, priorízala sin inventar la otra.'
    )
  }

  if (gal.length > selected.length) {
    bits.push(
      `(Hay ${gal.length} fotos en su perfil; para visión se priorizan las ${selected.length} de arriba.)`
    )
  }

  bits.push(
    'Opinión: si el usuario pregunta por su físico, cómo se ve, o si tú mencionas su apariencia, ' +
      'puedes dar una opinión sincera, cariñosa y concreta (rostro, complexión, estilo) basada en la ficha y, si hay foto en este turno, en lo que ves. ' +
      'No digas que no tienes ojos ni que no puedes opinar.'
  )
  if (notes && selected.length) {
    bits.push(
      'Contraste ficha↔foto (cuando haya imagen del usuario en el mensaje): ' +
        'compara en silencio descripción vs foto. Si coinciden en lo esencial (pelo, rasgos, complexión), ' +
        'incluye en tu respuesta una línea corta `[IDENTIDAD_VISUAL: True]`. ' +
        'Si discrepan de forma clara, incluye `[IDENTIDAD_VISUAL: False]` y una alerta breve de qué no cuadra ' +
        '(sin humillar). No uses True/False si no hay foto en este turno.'
    )
  }

  return bits.join('\n').slice(0, max)
}

export function countUserVisualRefs(mem: UserVisualMemorySlice | null | undefined): number {
  return selectUserVisualRefs(mem).length
}

/** Paths/dataUrls for a vision turn — max 2. */
export function userVisualMediaForVision(
  mem: UserVisualMemorySlice | null | undefined
): Array<{ url: string; role: string; label: string; filePath?: string }> {
  return selectUserVisualRefs(mem).map((g) => ({
    url: g.dataUrl && g.dataUrl.startsWith('data:image/') ? g.dataUrl : '',
    role: roleOf(g),
    label: g.label || roleOf(g),
    filePath: g.filePath
  }))
}


/** User is asking about their own looks / body / photo of themselves. */
export function wantsUserAppearanceVision(userText: string): boolean {
  const q = String(userText || '').toLowerCase()
  if (!q.trim()) return false
  if (
    /\b(c[oó]mo\s+me\s+veo|c[oó]mo\s+me\s+ves|c[oó]mo\s+ves\s+mis\s+fotos|qu[eé]\s+tal\s+me\s+veo|me\s+ves\s+bien|me\s+encuentro\s+guap|estoy\s+guap|mi\s+f[ií]sico|mi\s+cuerpo|mi\s+cara|mi\s+rostro|mi\s+apariencia|mis\s+fotos|mi\s+foto|esta\s+foto\s+m[ií]a|te\s+gusta\s+c[oó]mo\s+me\s+veo|opin[ií]on\s+sobre\s+mi\s+(?:cuerpo|cara|look|estilo|f[ií]sico))\b/i.test(
      q
    )
  ) {
    return true
  }
  if (
    /\b(describe|describes|mira)\b.{0,20}\b(me|mi\s+foto|c[oó]mo\s+soy)\b/i.test(q)
  ) {
    return true
  }
  // Assistant-driven mention of user looks in a short follow-up is handled by host; this is user-side only
  return false
}

/**
 * Synthetic image attachments from user memory gallery (max 2).
 * Host must hydrate filePath → dataUrl before vision encode.
 */
export function userVisualAsAttachments(
  mem: UserVisualMemorySlice | null | undefined
): Array<{
  id: string
  name: string
  mimeType: string
  dataUrl?: string
  filePath?: string
  kind: 'image'
}> {
  const refs = selectUserVisualRefs(mem)
  const out: Array<{
    id: string
    name: string
    mimeType: string
    dataUrl?: string
    filePath?: string
    kind: 'image'
  }> = []
  for (let i = 0; i < refs.length; i++) {
    const g = refs[i]
    const dataUrl =
      g.dataUrl && g.dataUrl.startsWith('data:image/') ? g.dataUrl : undefined
    const filePath = g.filePath || undefined
    if (!dataUrl && !filePath) continue
    out.push({
      id: g.id || `user-visual-${i}`,
      name: g.label || `user-${roleOf(g)}.jpg`,
      mimeType: 'image/jpeg',
      dataUrl,
      filePath,
      kind: 'image'
    })
  }
  return out
}

/** Extra system lines when this turn attaches user photos for appearance. */
export function buildUserAppearanceVisionTurnHint(hasNotes: boolean): string {
  return (
    '[VISIÓN · apariencia del USUARIO]\n' +
    'En este mensaje hay hasta 2 fotos del usuario (cara y/o cuerpo; no son tuyas). Míralas todas.\n' +
    'Describe con detalle concreto: rostro (ojos, barba, expresión), cabello, complexión, estilo de ropa si se ve. ' +
    'Opina con cariño y honestidad; no te quedes en frases genéricas.\n' +
    (hasNotes
      ? 'Compara con la ficha de apariencia. Cierra con [IDENTIDAD_VISUAL: True] o [IDENTIDAD_VISUAL: False] según concordancia esencial.\n'
      : 'La ficha escrita puede estar vacía o corrupta: opina por lo que VES en las fotos. No copies monólogo erótico como descripción física.\n')
  )
}
