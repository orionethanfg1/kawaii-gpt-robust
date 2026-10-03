/**
 * System hints when the user attaches images.
 * Multi-reference identity: compare upload(s) against character gallery + ficha.
 */
export type GalleryRef = {
  label?: string
  scene?: string
  /** true = primary chat avatar */
  primary?: boolean
}

export type VisionAttachOpts = {
  trimmed: string
  imageCount: number
  characterName?: string
  visualDescription?: string
  hasAvatar?: boolean
  /** Labels/scenes from Ajustes → galería (no need to resend all data URLs in system) */
  galleryRefs?: GalleryRef[]
}

export function buildVisionSystemHint(opts: VisionAttachOpts): string {
  const {
    trimmed,
    imageCount,
    characterName,
    visualDescription,
    hasAvatar,
    galleryRefs = []
  } = opts
  const name = (characterName || 'el personaje').trim()
  const bare = !trimmed || trimmed === '📷'
  const userSaysMe = /\b(yo|mi foto|así soy|asi soy|this is me|soy yo|soy la usuaria|soy el usuario)\b/i.test(
    trimmed
  )
  const aboutCharacter =
    /\b(t[uú]|ti|avatar|personaje|ella|eres tú|eres tu)\b/i.test(trimmed) ||
    (characterName
      ? new RegExp(characterName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(trimmed)
      : false)

  const lines: string[] = []
  lines.push(`[VISION_IDENTIDAD] Usuario adjuntó ${imageCount} imagen(es).`)
  if (bare) {
    lines.push(
      'Sin texto del usuario: describe cada imagen (personas, cara, pelo, ojos, ropa, escena).'
    )
  } else {
    lines.push(`Instrucción del usuario: ${trimmed}`)
  }

  if (visualDescription?.trim()) {
    lines.push('')
    lines.push(`Ficha visual canónica de **${name}**:`)
    lines.push(`"${visualDescription.trim().slice(0, 700)}"`)
  }

  if (galleryRefs.length) {
    lines.push('')
    lines.push(
      `Galería de referencia de **${name}** (${galleryRefs.length} escena(s); misma identidad, ropa/fondo distintos):`
    )
    galleryRefs.slice(0, 12).forEach((g, i) => {
      const tag = [g.primary ? '★principal' : null, g.label, g.scene]
        .filter(Boolean)
        .join(' · ')
      lines.push(`- Ref ${i + 1}${tag ? `: ${tag}` : ''}`)
    })
    lines.push(
      'Estas refs son LA MISMA persona en otras poses/ropa. Si la foto subida coincide en cara/estructura ' +
        `(ojos, nariz, mandíbula, pelo base) con **${name}**, dilo con claridad: "sí, soy yo / es ${name}" ` +
        'aunque el vestido o el fondo cambien. Si la cara no cuadra, dilo ("no parece la misma persona").'
    )
    lines.push(
      'Prioriza **identidad facial** sobre ropa o escenario. Sé precisa: sí / no / dudoso + 1-2 rasgos clave.'
    )
  } else if (hasAvatar || visualDescription?.trim()) {
    lines.push(
      `Compara con la identidad de **${name}**. Ropa distinta no invalida identidad si la cara coincide.`
    )
  }

  if (userSaysMe) {
    lines.push('El usuario dice que es SU foto: resume rasgos para memoria de apariencia del usuario.')
  } else if (aboutCharacter) {
    lines.push(`Prioriza decidir si la imagen es **${name}** (personaje del chat).`)
  } else if (bare) {
    lines.push(
      `Si hay una mujer/persona alineada con la ficha/galería de **${name}**, reconócela como ella; si no, no asumas.`
    )
  }

  lines.push(
    'Las imágenes van en el mensaje (data URL). Usa visión multimodal si está activa; si no, sé honesta.'
  )
  return lines.join('\n')
}
