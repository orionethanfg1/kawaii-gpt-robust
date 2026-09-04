/**
 * Capability registry: which generative layers are wired and healthy.
 * Does not load heavy models — only status flags from settings + probes.
 */

import type { GenerativeCapability, GenerativeModality } from './types'

export interface RegistryInput {
  imageGenEnabled?: boolean
  imageProviderMode?: 'off' | 'cloud' | 'local' | 'smart'
  /** Future flags */
  musicEnabled?: boolean
  videoEnabled?: boolean
  /** Probe results */
  imageCloudOk?: boolean
  imageLocalOk?: boolean
  musicLocalOk?: boolean
  videoLocalOk?: boolean
}

export function buildCapabilityRegistry(input: RegistryInput): GenerativeCapability[] {
  const caps: GenerativeCapability[] = [
    {
      id: 'text-hub',
      modality: 'text',
      displayName: 'Chat (texto)',
      priority: 0,
      status: 'available',
      kind: 'hybrid'
    }
  ]

  if (input.imageGenEnabled && input.imageProviderMode !== 'off') {
    const mode = input.imageProviderMode || 'cloud'
    let status: GenerativeCapability['status'] = 'available'
    let reason: string | undefined
    if (mode === 'cloud' && input.imageCloudOk === false) {
      status = 'degraded'
      reason = 'Cloud de imágenes no responde'
    } else if (mode === 'local' && input.imageLocalOk === false) {
      status = 'unavailable'
      reason = 'WebUI local no disponible'
    } else if (mode === 'smart') {
      if (input.imageLocalOk) status = 'available'
      else if (input.imageCloudOk !== false) status = 'available'
      else {
        status = 'unavailable'
        reason = 'Ni local ni cloud de imágenes'
      }
    }
    caps.push({
      id: 'image-stack',
      modality: 'image',
      displayName: 'Imágenes',
      priority: 1,
      status,
      reason,
      kind: mode === 'local' ? 'local' : mode === 'cloud' ? 'cloud' : 'hybrid'
    })
  } else {
    caps.push({
      id: 'image-stack',
      modality: 'image',
      displayName: 'Imágenes',
      priority: 1,
      status: 'not_configured',
      reason: 'Activa generación de imágenes en Ajustes',
      kind: 'hybrid'
    })
  }

  // Music / video: declared but not configured until later phases
  caps.push({
    id: 'music-stack',
    modality: 'music',
    displayName: 'Música',
    priority: 2,
    status: input.musicEnabled && input.musicLocalOk ? 'available' : 'not_configured',
    reason: input.musicEnabled
      ? input.musicLocalOk
        ? undefined
        : 'Motor de música no listo'
      : 'Próximamente (ACE-Step / similar)',
    kind: 'local'
  })

  caps.push({
    id: 'video-stack',
    modality: 'video',
    displayName: 'Video',
    priority: 3,
    status: input.videoEnabled && input.videoLocalOk ? 'available' : 'not_configured',
    reason: input.videoEnabled
      ? input.videoLocalOk
        ? undefined
        : 'Motor de video no listo'
      : 'Próximamente (capa opcional)',
    kind: 'local'
  })

  return caps
}

export function modalityAvailable(
  caps: GenerativeCapability[],
  modality: GenerativeModality
): boolean {
  const c = caps.find((x) => x.modality === modality)
  return c?.status === 'available' || c?.status === 'degraded'
}
