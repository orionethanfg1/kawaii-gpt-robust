/**
 * Local + cloud vision options ranked by quality / hardware fit (2026 research).
 * Prefer Ollama tags that are widely available and recoverable via pull jobs.
 */

export type VisionTier = 'tiny' | 'balanced' | 'quality'

export type LocalVisionCandidate = {
  /** Ollama pull tag */
  tag: string
  tier: VisionTier
  /** Approx VRAM GB needed (Q4) */
  vramGB: number
  /** Approx download GB */
  downloadGB: number
  label: string
  notes: string
}

export type CloudVisionCandidate = {
  model: string
  provider: 'openrouter' | 'gemini'
  label: string
  free: boolean
}

/** Prefer smaller first within tier for reliability of first install */
export const LOCAL_VISION_CANDIDATES: LocalVisionCandidate[] = [
  {
    tag: 'moondream',
    tier: 'tiny',
    vramGB: 2,
    downloadGB: 1.7,
    label: 'Moondream 2',
    notes: 'Rápido, bajo VRAM; captions básicos'
  },
  {
    tag: 'llava:7b',
    tier: 'balanced',
    vramGB: 6,
    downloadGB: 4.7,
    label: 'LLaVA 1.6 7B',
    notes: 'Fallback seguro, amplia compatibilidad'
  },
  {
    tag: 'qwen2.5vl:7b',
    tier: 'quality',
    vramGB: 6,
    downloadGB: 5.5,
    label: 'Qwen2.5-VL 7B',
    notes: 'Mejor OCR y detalle; recomendado ≥8 GB VRAM'
  },
  {
    tag: 'minicpm-v',
    tier: 'balanced',
    vramGB: 6,
    downloadGB: 5.5,
    label: 'MiniCPM-V',
    notes: 'Fuerte en documentos / OCR'
  },
  {
    tag: 'qwen3-vl:4b',
    tier: 'quality',
    vramGB: 5,
    downloadGB: 3.3,
    label: 'Qwen3-VL 4B',
    notes: 'Familia moderna, buen equilibrio (si el tag existe en tu Ollama)'
  },
  {
    tag: 'llava:13b',
    tier: 'quality',
    vramGB: 10,
    downloadGB: 8,
    label: 'LLaVA 13B',
    notes: 'Más calidad; necesita ~10+ GB VRAM'
  }
]

export const CLOUD_VISION_CANDIDATES: CloudVisionCandidate[] = [
  {
    model: 'google/gemini-2.0-flash-exp:free',
    provider: 'openrouter',
    label: 'Gemini Flash (OpenRouter free)',
    free: true
  },
  {
    model: 'qwen/qwen-vl-plus:free',
    provider: 'openrouter',
    label: 'Qwen VL Plus (OpenRouter free)',
    free: true
  },
  {
    model: 'qwen/qwen2.5-vl-32b-instruct:free',
    provider: 'openrouter',
    label: 'Qwen2.5-VL 32B free',
    free: true
  },
  {
    model: 'google/gemini-flash-1.5:free',
    provider: 'openrouter',
    label: 'Gemini Flash 1.5 free',
    free: true
  }
]

export function pickLocalVisionTags(vramGB: number | null | undefined): LocalVisionCandidate[] {
  const v = typeof vramGB === 'number' && vramGB > 0 ? vramGB : 8
  // Order: fit VRAM, prefer quality then balanced then tiny as install cascade
  const fit = LOCAL_VISION_CANDIDATES.filter((c) => c.vramGB <= v + 0.5)
  const list = fit.length ? fit : LOCAL_VISION_CANDIDATES.filter((c) => c.tier === 'tiny')
  // Install order: tiny first (fast recovery), then balanced, then quality
  return [...list].sort((a, b) => {
    const order = { tiny: 0, balanced: 1, quality: 2 }
    if (order[a.tier] !== order[b.tier]) return order[a.tier] - order[b.tier]
    return a.vramGB - b.vramGB
  })
}

export function isVisionModelName(name: string): boolean {
  const n = name.toLowerCase()
  return (
    n.includes('llava') ||
    n.includes('moondream') ||
    n.includes('minicpm') ||
    n.includes('vision') ||
    n.includes('qwen2.5vl') ||
    n.includes('qwen2-vl') ||
    n.includes('qwen3-vl') ||
    n.includes('bakllava') ||
    n.includes('gemma3') ||
    n.includes('gemma4')
  )
}
