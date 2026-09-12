/**
 * Music backends: ACE-Step (primary) + YuE (high-end optional).
 * Eligibility is decided at runtime from VRAM/RAM — never hardcode a PC.
 */

export type MusicBackendId = 'ace-step' | 'yue' | 'stable-audio' | 'none'

export interface MusicBackendSpec {
  id: MusicBackendId
  name: string
  /** Practical minimum VRAM for usable quality (GB) */
  minVramGB: number
  /** Comfortable VRAM */
  recommendedVramGB: number
  minRamGB: number
  vocals: boolean
  fullSong: boolean
  qualityNote: string
  installWeightGB: number
  repoHint: string
}

export const MUSIC_BACKEND_SPECS: MusicBackendSpec[] = [
  {
    id: 'ace-step',
    name: 'ACE-Step 1.5',
    minVramGB: 6,
    recommendedVramGB: 12,
    minRamGB: 16,
    vocals: true,
    fullSong: true,
    qualityNote: 'Más cercano a Suno en open-source; canción completa + voces',
    installWeightGB: 12,
    repoHint: 'https://github.com/ACE-Step/ACE-Step-1.5'
  },
  {
    id: 'yue',
    name: 'YuE',
    minVramGB: 16,
    recommendedVramGB: 24,
    minRamGB: 32,
    vocals: true,
    fullSong: true,
    qualityNote: 'Muy fuerte en voces; exige GPU alta',
    installWeightGB: 25,
    repoHint: 'https://github.com/multimodal-art-projection/YuE'
  },
  {
    id: 'stable-audio',
    name: 'Stable Audio (instrumental)',
    minVramGB: 8,
    recommendedVramGB: 12,
    minRamGB: 16,
    vocals: false,
    fullSong: false,
    qualityNote: 'Instrumental / SFX — complemento, no reemplazo Suno',
    installWeightGB: 8,
    repoHint: 'Stability AI open weights'
  }
]

export interface MusicEligibility {
  vramGB: number | null
  ramGB: number
  ace: { eligible: boolean; reason: string; tier: 'off' | 'turbo' | 'sft' }
  yue: { eligible: boolean; reason: string }
  preferred: MusicBackendId
  disabled: MusicBackendId[]
  summary: string
}

export function analyzeMusicEligibility(opts: {
  vramGB?: number | null
  ramGB?: number
}): MusicEligibility {
  const vram = opts.vramGB == null || Number.isNaN(opts.vramGB) ? null : opts.vramGB
  const ram = opts.ramGB ?? 16

  const ace =
    vram == null
      ? { eligible: true, reason: 'VRAM desconocida — se probará ACE turbo con offload', tier: 'turbo' as const }
      : vram < 6
        ? {
            eligible: false,
            reason: `VRAM ${vram} GB < 6 GB mínimos para ACE-Step`,
            tier: 'off' as const
          }
        : vram < 10
          ? {
              eligible: true,
              reason: `VRAM ${vram} GB → ACE turbo (bajo consumo)`,
              tier: 'turbo' as const
            }
          : {
              eligible: true,
              reason: `VRAM ${vram} GB → ACE sft/turbo recomendado`,
              tier: 'sft' as const
            }

  const yue =
    vram == null
      ? {
          eligible: false,
          reason: 'VRAM desconocida — YuE deshabilitado hasta medir GPU (necesita ≥16 GB)'
        }
      : vram < 16 || ram < 24
        ? {
            eligible: false,
            reason: `YuE deshabilitado (VRAM ${vram ?? '?'} GB, RAM ${ram} GB; mínimo ~16 GB VRAM y 24+ GB RAM)`
          }
        : {
            eligible: true,
            reason: `YuE elegible (VRAM ${vram} GB, RAM ${ram} GB)`
          }

  const disabled: MusicBackendId[] = []
  if (!ace.eligible) disabled.push('ace-step')
  if (!yue.eligible) disabled.push('yue')

  let preferred: MusicBackendId = 'none'
  if (ace.eligible) preferred = 'ace-step'
  else if (yue.eligible) preferred = 'yue'
  else if (vram != null && vram >= 8) preferred = 'stable-audio'

  const summaryParts: string[] = []
  if (ace.eligible) {
    summaryParts.push(`ACE-Step: listo para usar (perfil ${ace.tier})`)
  } else {
    summaryParts.push(`ACE-Step: no disponible (${ace.reason})`)
  }
  if (yue.eligible) {
    summaryParts.push('YuE: disponible en este PC')
  } else {
    summaryParts.push(
      vram != null && vram < 16
        ? 'YuE: desactivado (hace falta ≥16 GB VRAM)'
        : ram < 24
          ? 'YuE: desactivado (hace falta más RAM)'
          : `YuE: desactivado`
    )
  }
  if (preferred === 'ace-step') summaryParts.push('Se usará ACE-Step')
  else if (preferred === 'yue') summaryParts.push('Se usará YuE')
  else if (preferred === 'none') summaryParts.push('Ningún motor local de música elegible')
  const summary = summaryParts.join(' · ')

  return { vramGB: vram, ramGB: ram, ace, yue, preferred, disabled, summary }
}
