
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
      available: true,
      kind: 'ipadapter',
      modelName: ip,
      message: 'IP-Adapter genérico (mejor instalar FaceID Plus v2)'
    }
  }
  return {
    available: false,
    kind: 'none',
    message:
      'Sin FaceID/IP-Adapter en Forge. Los autorretratos usarán solo texto (identidad más débil). Instala ip-adapter-faceid-plusv2 en ControlNet.'
  }
}
