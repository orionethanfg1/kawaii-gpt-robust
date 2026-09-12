export type IpAdapterKind = 'faceid' | 'ip-adapter'

export type IpAdapterModel = {
  name: string
  kind: IpAdapterKind
}

export type IpAdapterConfig = {
  model: string
  module: string
  weight: number
  image: string
}

/** Pick a locally installed ControlNet IP-Adapter model, preferring FaceID. */
export function pickIpAdapterModel(models: string[]): IpAdapterModel | null {
  const candidates = models
    .map((name) => String(name || '').trim())
    .filter(Boolean)
    .filter((name) => /ip[-_ ]?adapter|faceid/i.test(name))
  const face = candidates.find((name) => /faceid/i.test(name))
  if (face) return { name: face, kind: 'faceid' }
  const adapter = candidates[0]
  return adapter ? { name: adapter, kind: 'ip-adapter' } : null
}

/** Build the ControlNet always-on payload accepted by A1111/Forge extensions. */
export function buildIpAdapterConfig(
  model: IpAdapterModel,
  image: string,
  weight = 0.8
): IpAdapterConfig {
  const normalized = model.name.toLowerCase()
  const module = /faceid/i.test(normalized)
    ? /sdxl/i.test(normalized)
      ? 'ip-adapter-faceid-plusv2_sdxl'
      : 'ip-adapter-faceid-plusv2_sd15'
    : /sdxl/i.test(normalized)
      ? 'ip-adapter_clip_sdxl'
      : 'ip-adapter_clip_sd15'
  return {
    model: model.name,
    module,
    weight: Math.min(1.2, Math.max(0.45, weight)),
    image
  }
}