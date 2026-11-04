/**
 * Recommended identity stack downloads (Hugging Face / known good pins).
 * App self-heals by ensuring these when FaceID/autorretrato fails.
 */
export type IdentityStackItem = {
  id: string
  name: string
  role: 'faceid_model' | 'faceid_lora' | 'checkpoint' | 'controlnet'
  /** Relative under Forge models tree */
  relativeDir: string
  url: string
  /** Min size bytes to consider valid */
  minBytes: number
  note: string
  priority: number
}

/** SD1.5 FaceID Plus v2 — production default for Forge */
export const IDENTITY_STACK_SD15: IdentityStackItem[] = [
  {
    id: 'faceid-plusv2-bin',
    name: 'ip-adapter-faceid-plusv2_sd15.bin',
    role: 'faceid_model',
    relativeDir: 'ControlNet',
    url: 'https://huggingface.co/h94/IP-Adapter-FaceID/resolve/main/ip-adapter-faceid-plusv2_sd15.bin',
    minBytes: 1_000_000,
    note: 'IP-Adapter FaceID Plus v2 (ControlNet)',
    priority: 100
  },
  {
    id: 'faceid-plusv2-lora',
    name: 'ip-adapter-faceid-plusv2_sd15_lora.safetensors',
    role: 'faceid_lora',
    relativeDir: 'Lora',
    url: 'https://huggingface.co/h94/IP-Adapter-FaceID/resolve/main/ip-adapter-faceid-plusv2_sd15_lora.safetensors',
    minBytes: 500_000,
    note: 'LoRA pareja de FaceID Plus v2 (obligatoria para lock fuerte)',
    priority: 95
  }
]

/** Kept for callers that still refer to the former alternate directory. */
export const FACEID_LORA_ALT_DIR = 'Lora'

export function faceIdLoraPromptTag(weight = 0.75): string {
  return `<lora:ip-adapter-faceid-plusv2_sd15_lora:${weight.toFixed(2)}>`
}

export function summarizeIdentityStack(present: string[]): string {
  const need = IDENTITY_STACK_SD15.filter(
    (i) => !present.some((p) => p.toLowerCase().includes(i.name.toLowerCase().replace(/\.[^.]+$/, '')))
  )
  if (!need.length) return 'Stack identidad SD1.5 completo (FaceID + LoRA).'
  return (
    'Falta para identidad fuerte: ' +
    need.map((n) => n.name + ' (' + n.note + ')').join('; ')
  )
}
