/**
 * Declarative capability registry — add a layer once here (or via registerCapability)
 * and the system prompt + UI can discover it without hand-editing chatOrchestrator.
 */

export type CapabilityRuntimeStatus =
  | 'available'
  | 'degraded'
  | 'not_configured'
  | 'unavailable'

export type CapabilityDef = {
  /** Stable id: image, music, games, voice, … */
  id: string
  /** Shown to the model and UI */
  label: string
  /** Short instruction for the model when available */
  whenAvailable: string
  /** Short instruction when off */
  whenOff: string
  /** Optional modality for generative planning */
  modality?: 'text' | 'image' | 'music' | 'video' | 'voice' | 'games' | 'other'
  /** Order in the prompt (lower first) */
  order?: number
}

export type CapabilitySnapshot = CapabilityDef & {
  status: CapabilityRuntimeStatus
  reason?: string
}

/** Built-in layers. New features: append here or call registerCapability at module load. */
const CORE: CapabilityDef[] = [
  {
    id: 'text',
    label: 'Chat',
    modality: 'text',
    order: 0,
    whenAvailable: 'conversación siempre disponible',
    whenOff: 'n/a'
  },
  {
    id: 'image',
    label: 'Imágenes',
    modality: 'image',
    order: 10,
    whenAvailable:
      'SÍ puedes generar y describir imágenes (Forge local y/o cloud). Si piden foto/retrato/escena de ti, usa la ficha visual.',
    whenOff: 'capa imagen desactivada en Ajustes — no digas que generaste un archivo'
  },
  {
    id: 'music',
    label: 'Música',
    modality: 'music',
    order: 20,
    whenAvailable:
      'SÍ puedes generar audio (ACE). Letras/ayuda creativa = solo texto. Generar pista = solo si piden audio/canción generada.',
    whenOff: 'música no activa — puedes escribir letras pero no inventes archivos de audio'
  },
  {
    id: 'voice',
    label: 'Voz (TTS)',
    modality: 'voice',
    order: 30,
    whenAvailable: 'las respuestas pueden leerse en voz alta (TTS LATAM); no digas que no tienes voz',
    whenOff: 'TTS no configurado o desactivado'
  },
  {
    id: 'games',
    label: 'Juegos',
    modality: 'games',
    order: 40,
    whenAvailable:
      'puedes invitar a Ajedrez y Aventura (ventanas de la app). Enlaces: [Ajedrez](kawaii-activity://chess) [Aventura](kawaii-activity://adventure). Juegas CON el usuario en personaje.',
    whenOff: 'actividades no expuestas'
  },
  {
    id: 'vision',
    label: 'Visión',
    modality: 'other',
    order: 50,
    whenAvailable: 'puedes analizar imágenes que el usuario suba o las que se generen (visión local/cloud)',
    whenOff: 'análisis de imagen limitado'
  },
  {
    id: 'video',
    label: 'Video',
    modality: 'video',
    order: 60,
    whenAvailable: 'capa video experimental',
    whenOff: 'video no disponible'
  }
]

const extra: CapabilityDef[] = []

/** Call from a new feature module once so the chat learns the layer automatically. */
export function registerCapability(def: CapabilityDef): void {
  const i = extra.findIndex((c) => c.id === def.id)
  if (i >= 0) extra[i] = def
  else extra.push(def)
  const j = CORE.findIndex((c) => c.id === def.id)
  if (j >= 0) CORE[j] = { ...CORE[j], ...def }
}

export type CapabilityFlags = {
  imageGenEnabled?: boolean
  imageProviderMode?: string
  musicGenEnabled?: boolean
  videoGenEnabled?: boolean
  voiceTtsEnabled?: boolean
  gamesEnabled?: boolean
  visionEnabled?: boolean
}

function statusFor(id: string, f: CapabilityFlags): { status: CapabilityRuntimeStatus; reason?: string } {
  switch (id) {
    case 'text':
      return { status: 'available' }
    case 'image': {
      const on = f.imageGenEnabled !== false && f.imageProviderMode !== 'off'
      return on
        ? { status: 'available', reason: `modo ${f.imageProviderMode || 'smart'}` }
        : { status: 'not_configured', reason: 'desactivado' }
    }
    case 'music':
      return f.musicGenEnabled === true
        ? { status: 'available', reason: 'ACE bajo demanda' }
        : { status: 'not_configured', reason: 'desactivado' }
    case 'voice':
      return f.voiceTtsEnabled !== false
        ? { status: 'available' }
        : { status: 'not_configured' }
    case 'games':
      return f.gamesEnabled !== false
        ? { status: 'available' }
        : { status: 'not_configured' }
    case 'vision':
      return f.visionEnabled !== false
        ? { status: 'available' }
        : { status: 'degraded' }
    case 'video':
      return f.videoGenEnabled === true
        ? { status: 'degraded', reason: 'experimental' }
        : { status: 'not_configured' }
    default:
      return { status: 'available' }
  }
}

export function listCapabilityDefs(): CapabilityDef[] {
  const map = new Map<string, CapabilityDef>()
  for (const c of CORE) map.set(c.id, c)
  for (const c of extra) map.set(c.id, { ...map.get(c.id), ...c } as CapabilityDef)
  return [...map.values()].sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
}

export function snapshotCapabilities(flags: CapabilityFlags): CapabilitySnapshot[] {
  return listCapabilityDefs().map((def) => {
    const { status, reason } = statusFor(def.id, flags)
    return { ...def, status, reason }
  })
}

/** Compact block for system prompt — model must treat this as ground truth. */
export function formatCapabilitiesForPrompt(flags: CapabilityFlags): string {
  const snaps = snapshotCapabilities(flags)
  const lines = snaps.map((s) => {
    const on = s.status === 'available' || s.status === 'degraded'
    const body = on ? s.whenAvailable : s.whenOff
    const tag = on ? 'SÍ' : 'NO'
    return `- ${s.label} [${tag}${s.reason ? ` · ${s.reason}` : ''}]: ${body}`
  })
  return (
    `[CAPAS_APP] Estas son tus capacidades REALES en KawaiiGPT ahora (no inventes otras ni digas que no puedes lo marcado SÍ):\n` +
    lines.join('\n') +
    `\nSi el usuario pregunta qué puedes hacer, resume esta lista en tono de personaje. ` +
    `Si una capa está SÍ y piden usarla, ofrece hacerlo o guía el siguiente paso; no niegues la capacidad.`
  )
}

/** Map to legacy CapabilityInfo used by GenerativeLayersBadge */
export function toLegacyCapabilityInfo(flags: CapabilityFlags): Array<{
  id: string
  modality: 'text' | 'image' | 'music' | 'video'
  displayName: string
  status: CapabilityRuntimeStatus
  reason?: string
}> {
  const mod = (m?: string): 'text' | 'image' | 'music' | 'video' => {
    if (m === 'image' || m === 'music' || m === 'video' || m === 'text') return m
    return 'text'
  }
  return snapshotCapabilities(flags)
    .filter((s) => ['text', 'image', 'music', 'video'].includes(s.modality || 'text'))
    .map((s) => ({
      id: s.id,
      modality: mod(s.modality),
      displayName: s.label,
      status: s.status,
      reason: s.reason
    }))
}
