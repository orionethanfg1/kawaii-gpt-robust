/**
 * Hito 3.4 — Infer ControlNet type from prompt and match installed models.
 * Structural units need a reference image (pose/canny/depth from photo).
 * FaceID / IP-Adapter is handled separately in identity-ref.
 */

export type ControlNetKind =
  | 'openpose'
  | 'canny'
  | 'depth'
  | 'softedge'
  | 'lineart'
  | 'none'

export type ControlNetUnit = {
  enabled: boolean
  module: string
  model: string
  weight: number
  image: string
  resize_mode: string
  guidance_start: number
  guidance_end: number
  control_mode: string
  pixel_perfect: boolean
  /** Host label for progress UI */
  kind: ControlNetKind | 'faceid' | 'ip-adapter'
}

const KIND_MODEL_RE: Record<Exclude<ControlNetKind, 'none'>, RegExp> = {
  openpose: /openpose|pose/i,
  canny: /canny/i,
  depth: /depth/i,
  softedge: /softedge|soft.?edge|hed/i,
  lineart: /lineart|line.?art|scribble/i
}

const KIND_MODULE: Record<Exclude<ControlNetKind, 'none'>, string> = {
  openpose: 'openpose_full',
  canny: 'canny',
  depth: 'depth_midas',
  softedge: 'softedge_hed',
  lineart: 'lineart_realistic'
}

/**
 * Infer structural ControlNet from natural-language / tag prompt.
 * Priority: openpose > canny > depth > softedge > lineart.
 */
export function inferControlNetKind(prompt: string): ControlNetKind {
  const t = prompt || ''
  // Pose / body language
  if (
    /\b(pose|postura|openpose|bailando|sentad[oa]|de pie|arrodillad|corriendo|yoga|gesto|manos en|arms? (up|crossed)|full body pose)\b/i.test(
      t
    ) ||
    /\b(cuerpo completo|full body|de cuerpo entero)\b/i.test(t)
  ) {
    return 'openpose'
  }
  // Edges / line structure
  if (
    /\b(canny|bordes|contorno|líneas duras|lineas duras|edge detection|wireframe)\b/i.test(t)
  ) {
    return 'canny'
  }
  if (/\b(lineart|line art|dibujo a línea|scribble|boceto)\b/i.test(t)) {
    return 'lineart'
  }
  if (/\b(softedge|bordes suaves|hed)\b/i.test(t)) {
    return 'softedge'
  }
  // Depth / 3D layout
  if (
    /\b(depth|profundidad|mapa de profundidad|3d scene|perspectiva fuerte|volum[eé]trico)\b/i.test(
      t
    )
  ) {
    return 'depth'
  }
  return 'none'
}

/** Pick best model filename for a kind from ControlNet model_list */
export function pickControlNetModel(
  models: string[],
  kind: ControlNetKind
): string | null {
  if (kind === 'none' || !models.length) return null
  const re = KIND_MODEL_RE[kind]
  const hits = models.filter((m) => re.test(m) && !/ip-adapter|faceid/i.test(m))
  // Prefer sd15 / v11 over sdxl if mixed
  const sd15 = hits.find((m) => /sd15|v11p_sd15|control_v11/i.test(m))
  return sd15 || hits[0] || null
}

export function controlNetModuleFor(kind: ControlNetKind): string {
  if (kind === 'none') return 'none'
  return KIND_MODULE[kind]
}

/** Default weights: structural slightly lower so FaceID wins on face */
export function controlNetWeightFor(kind: ControlNetKind): number {
  switch (kind) {
    case 'openpose':
      return 0.85
    case 'canny':
      return 0.7
    case 'depth':
      return 0.65
    case 'softedge':
      return 0.7
    case 'lineart':
      return 0.75
    default:
      return 0
  }
}

function toBase64Image(image: string): string {
  if (image.startsWith('data:image/')) {
    return image.slice(image.indexOf(',') + 1).replace(/\s/g, '')
  }
  return image
}

export function buildStructuralControlNetUnit(
  kind: ControlNetKind,
  modelName: string,
  referenceImage: string,
  weight?: number
): ControlNetUnit | null {
  if (kind === 'none' || !modelName || !referenceImage) return null
  return {
    enabled: true,
    module: controlNetModuleFor(kind),
    model: modelName,
    weight: weight ?? controlNetWeightFor(kind),
    image: toBase64Image(referenceImage),
    resize_mode: 'Crop and Resize',
    guidance_start: 0,
    guidance_end: 0.85,
    control_mode: 'Balanced',
    pixel_perfect: true,
    kind
  }
}

/**
 * Plan structural ControlNet: needs prompt kind + installed model + reference image.
 */
export function planStructuralControlNet(opts: {
  prompt: string
  models: string[]
  referenceImage?: string
  /** Force kind (UI override) */
  forceKind?: ControlNetKind
}): {
  kind: ControlNetKind
  unit: ControlNetUnit | null
  note: string
} {
  const kind = opts.forceKind && opts.forceKind !== 'none'
    ? opts.forceKind
    : inferControlNetKind(opts.prompt)
  if (kind === 'none') {
    return { kind, unit: null, note: 'Sin ControlNet estructural (prompt libre)' }
  }
  const model = pickControlNetModel(opts.models, kind)
  if (!model) {
    return {
      kind,
      unit: null,
      note: `Prompt pide ${kind}, pero no hay modelo ControlNet instalado`
    }
  }
  if (!opts.referenceImage?.startsWith('data:image/') && !opts.referenceImage) {
    return {
      kind,
      unit: null,
      note: `Sugerido ${kind} (${model}) — hace falta imagen de referencia para aplicarlo`
    }
  }
  const unit = buildStructuralControlNetUnit(kind, model, opts.referenceImage!)
  return {
    kind,
    unit,
    note: unit
      ? `ControlNet auto · ${kind} · ${model} · w=${unit.weight}`
      : `No se pudo armar unidad ${kind}`
  }
}

/** Convert host units → Forge alwayson_scripts.ControlNet.args (strip kind) */
export function controlNetUnitsToArgs(
  units: ControlNetUnit[]
): Array<Record<string, unknown>> {
  return units
    .filter((u) => u.enabled && u.model)
    .map(({ kind: _k, ...rest }) => ({ ...rest }))
}
