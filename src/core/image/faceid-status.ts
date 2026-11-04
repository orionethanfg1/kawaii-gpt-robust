
/**
 * Detect whether FaceID / IP-Adapter models are present in a Forge model list.
 */
export type FaceIdStatus = {
  available: boolean
  kind: 'faceid' | 'ipadapter' | 'none'
  modelName?: string
  message: string
}

export function assessFaceIdFromModelNames(modelNames: string[]): FaceIdStatus {
  const names = (modelNames || []).map((n) => n.toLowerCase())
  const face = names.find(
    (n) =>
      n.includes('faceid') ||
      n.includes('face-id') ||
      n.includes('ip-adapter-faceid') ||
      n.includes('ip_adapter_faceid')
  )
  if (face) {
    return {
      available: true,
      kind: 'faceid',
      modelName: face,
      message: 'FaceID disponible para autorretratos'
    }
  }

  const ip = names.find(
    (n) => n.includes('ip-adapter') || n.includes('ip_adapter') || n.includes('ipadapter')
  )
  if (ip) {
    return {
      available: false,
      kind: 'ipadapter',
      modelName: ip,
      message: 'Solo hay IP-Adapter genérico; un autorretrato requiere un modelo FaceID.'
    }
  }

  return {
    available: false,
    kind: 'none',
    message:
      'Sin FaceID en Forge. Los autorretratos con identidad están bloqueados hasta instalar ip-adapter-faceid-plusv2 en ControlNet.'
  }
}

export function canApplyRequiredFaceId(
  modelName?: string,
  moduleName?: string,
  faceIdLoraReady = false
): boolean {
  const identityAdapter = `${modelName || ''} ${moduleName || ''}`
  if (!/faceid/i.test(identityAdapter)) return false
  if (/faceid.*plus.*v2|plusv2.*faceid/i.test(identityAdapter)) {
    return faceIdLoraReady
  }
  return true
}
