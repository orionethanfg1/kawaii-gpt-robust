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
    .filter((name) => !/(?:^|[-_. ])lora(?:[-_. ]|$)/i.test(name))
  // Prefer FaceID Plus v2 > FaceID Plus > FaceID > generic IP-Adapter
  const rank = (n: string) => {
    const x = n.toLowerCase()
    if (/faceid.*plus.*v2|plusv2.*faceid|faceid-plusv2/i.test(x)) return 100
    if (/faceid.*plus|plus.*faceid/i.test(x)) return 80
    if (/faceid/i.test(x)) return 60
    if (/ip-adapter-plus/i.test(x)) return 40
    return 20
  }
  const sorted = [...candidates].sort((a, b) => rank(b) - rank(a))
  const best = sorted[0]
  if (!best) return null
  return {
    name: best,
    kind: /faceid/i.test(best) ? 'faceid' : 'ip-adapter'
  }
}

/**
 * Build the ControlNet always-on payload accepted by A1111/Forge.
 * FaceID defaults stronger (0.9) than generic IP-Adapter (0.75) for identity lock.
 */
export function buildIpAdapterConfig(
  model: IpAdapterModel,
  image: string,
  weight?: number
): IpAdapterConfig {
  const normalized = model.name.toLowerCase()
  const isFace = /faceid/i.test(normalized)
  const isSdxl = /sdxl/i.test(normalized)
  const isFacePlusV2 = /faceid.*plus.*v2|plusv2.*faceid/i.test(normalized)
  const isFacePlus = !isFacePlusV2 && /faceid.*plus|plus.*faceid/i.test(normalized)
  const isAdapterPlus = /ip[-_ ]?adapter[-_ ]?plus/i.test(normalized)
  const module = isFace
    ? `ip-adapter-faceid${isFacePlusV2 ? '-plusv2' : isFacePlus ? '-plus' : ''}_${isSdxl ? 'sdxl' : 'sd15'}`
    : `ip-adapter${isAdapterPlus ? '-plus' : '_clip'}_${isSdxl ? 'sdxl' : 'sd15'}`
  const defaultW = isFace ? 0.9 : 0.75
  const w = weight == null ? defaultW : weight
  // Strip data-URL header for APIs that want raw base64 in `image`
  const imagePayload = image.startsWith('data:image/')
    ? image
    : image
  return {
    model: model.name,
    module,
    weight: Math.min(1.2, Math.max(0.2, w)),
    image: imagePayload
  }
}

/** Forge sometimes lists models under /controlnet/model_list or /sdapi/v1/… */
export function parseControlNetModelList(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object') return []
  const o = raw as { model_list?: string[]; models?: string[] }
  const list = o.model_list || o.models || []
  return list.map((x) => String(x || '').trim()).filter(Boolean)
}