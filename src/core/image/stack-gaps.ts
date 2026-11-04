
/**
 * Detect missing pieces of the local image stack and suggest installs.
 */

export type StackGapId =
  | 'forge_offline'
  | 'no_checkpoint'
  | 'no_faceid'
  | 'no_controlnet_struct'
  | 'no_avatar'

export type StackGap = {
  id: StackGapId
  severity: 'critical' | 'important' | 'optional'
  title: string
  detail: string
  /** Chat phrase the user can send, or host tool */
  suggestSay?: string
  tool?: string
}

export type StackGapInput = {
  forgeOk?: boolean
  forgeState?: string
  checkpointCount?: number
  controlNetModels?: string[]
  hasFaceIdDisk?: boolean
  hasFaceIdApi?: boolean
  hasAvatar?: boolean
  forSelfPortrait?: boolean
}

export function assessImageStackGaps(input: StackGapInput): StackGap[] {
  const gaps: StackGap[] = []
  const cn = input.controlNetModels || []
  const hasFaceApi =
    input.hasFaceIdApi === true ||
    cn.some((m) => /faceid/i.test(m))
  const hasFaceDisk = input.hasFaceIdDisk === true || hasFaceApi
  const hasStruct = cn.some((m) => /openpose|canny|depth|lineart/i.test(m))

  if (input.forgeOk === false || /stop|error|offline/i.test(String(input.forgeState || ''))) {
    gaps.push({
      id: 'forge_offline',
      severity: 'critical',
      title: 'Forge no está listo',
      detail: 'La capa de imagen local necesita Forge en marcha.',
      suggestSay: 'arranca Forge',
      tool: 'start_forge'
    })
  }

  if (input.checkpointCount != null && input.checkpointCount <= 0) {
    gaps.push({
      id: 'no_checkpoint',
      severity: 'critical',
      title: 'Sin checkpoint SD',
      detail: 'No hay modelo de imagen (.safetensors) usable en Forge.',
      suggestSay: 'revisa Forge',
      tool: 'probe_forge'
    })
  }

  if (!hasFaceDisk || (input.forSelfPortrait && !hasFaceApi)) {
    gaps.push({
      id: 'no_faceid',
      severity: input.forSelfPortrait ? 'important' : 'optional',
      title: 'FaceID no disponible',
      detail: hasFaceDisk
        ? 'FaceID está en disco pero Forge no lo lista — reinicia Forge.'
        : 'Sin FaceID los autorretratos no conservan la cara del personaje. La app puede descargarlo.',
      suggestSay: 'instala FaceID',
      tool: 'ensure_faceid'
    })
  }

  if (!hasStruct && cn.length === 0) {
    gaps.push({
      id: 'no_controlnet_struct',
      severity: 'optional',
      title: 'Sin modelos ControlNet básicos',
      detail: 'Openpose/canny ayudan a pose y estructura.',
      suggestSay: 'instala ControlNet',
      tool: 'ensure_controlnet'
    })
  }

  if (input.forSelfPortrait && input.hasAvatar === false) {
    gaps.push({
      id: 'no_avatar',
      severity: 'important',
      title: 'Sin avatar del personaje',
      detail: 'Sube un retrato frontal en Ajustes → Personaje para bloquear identidad.',
      suggestSay: undefined
    })
  }

  return gaps
}

export function formatStackGapsForChat(gaps: StackGap[]): string {
  if (!gaps.length) return '_Stack de imagen: OK (nada crítico pendiente)._'
  const lines = ['**Lo que falta o conviene instalar:**', '']
  for (const g of gaps) {
    const badge =
      g.severity === 'critical' ? '🔴' : g.severity === 'important' ? '🟡' : '⚪'
    lines.push(`${badge} **${g.title}** — ${g.detail}`)
    if (g.suggestSay) {
      lines.push(`   → Puedes decirme: *«${g.suggestSay}»*`)
    }
  }
  return lines.join('\n')
}
