/**
 * CSS object-position for circular chat avatar so the face stays visible.
 */

export type AvatarFocusInput = {
  avatarFocusMode?: 'auto' | 'manual' | string
  avatarFocusX?: number
  avatarFocusY?: number
  /** Wardrobe role of the current primary, if known */
  primaryRole?: string
  primaryTags?: string[]
}

/**
 * Auto bias: full-body / outfit → higher (show head); face/portrait → near center.
 */
export function resolveAvatarObjectPosition(input?: AvatarFocusInput | null): string {
  if (!input) return '50% 22%'
  const mode = input.avatarFocusMode === 'manual' ? 'manual' : 'auto'
  if (mode === 'manual') {
    const x = clamp(input.avatarFocusX ?? 50, 0, 100)
    const y = clamp(input.avatarFocusY ?? 22, 0, 100)
    return `${x}% ${y}%`
  }
  const role = String(input.primaryRole || '').toLowerCase()
  const tags = (input.primaryTags || []).map((t) => String(t).toLowerCase()).join(' ')
  const faceish =
    /face|rostro|portrait|selfie|primer/.test(role) ||
    /face|rostro|portrait|selfie|cara/.test(tags)
  const fullish =
    /full|body|cuerpo|outfit|scene|escena/.test(role) ||
    /full.?body|cuerpo.?completo|outfit|scene/.test(tags)
  if (faceish && !fullish) return '50% 35%'
  if (fullish) return '50% 18%'
  // Default companion full-length in circle: keep head in frame
  return '50% 22%'
}

function clamp(n: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, Number.isFinite(n) ? n : a))
}
