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

  if (fullOnly) {
    const edge = fullOnly.maxEdgePx || 0
    // Dedicated face + weak full → keep both; strong full alone is enough
    if (face && body && face !== body && edge < USER_VISUAL_SINGLE_MIN_EDGE) {
      return [face, body]
    }
    if (edge >= USER_VISUAL_SINGLE_MIN_EDGE || !face) return [fullOnly]
    if (face && fullOnly !== face) return [face, fullOnly]
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
