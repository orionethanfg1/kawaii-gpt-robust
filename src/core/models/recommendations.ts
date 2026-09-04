/**
 * Hardware-aware local model recommendations + expanded catalog.
 * Sources: Ollama library + community (abliterated) with explicit risk flags.
 * Pull names verified against public Ollama library / common HF→Ollama paths.
 */

export interface HardwareProfile {
  totalMemoryGB: number
  cpuCores: number
  architecture: string
}

export type ModelSource = 'ollama-official' | 'ollama-community' | 'hf-gguf'
export type ModelRisk = 'none' | 'uncensored'

export interface ModelRecommendation {
  id: string
  /** ollama pull name (or hf.co/... for GGUF import) */
  pullName: string
  label: string
  sizeHint: string
  minRamGB: number
  reason: string
  tier: 'tiny' | 'small' | 'medium' | 'large'
  source: ModelSource
  risk: ModelRisk
  /** Shown when risk !== none */
  riskWarning?: string
  tags?: string[]
  /** Optional mirror / docs link for the user */
  infoUrl?: string
}

const ABLIT_WARN =
  'Modelo abliterado/uncensored: puede reducir filtros de seguridad. Úsalo bajo tu responsabilidad; no para menores ni entornos corporativos sin política clara.'

/** Practical catalog — official first, then community (incl. abliterated). */
export const LOCAL_MODEL_CATALOG: ModelRecommendation[] = [
  // —— Official / safe defaults ——
  {
    id: 'qwen25-05b',
    pullName: 'qwen2.5:0.5b',
    label: 'Qwen2.5 0.5B',
    sizeHint: '~400 MB',
    minRamGB: 2,
    reason: 'Muy ligero; ideal para PCs con poca RAM',
    tier: 'tiny',
    source: 'ollama-official',
    risk: 'none',
    tags: ['rápido', 'español']
  },
  {
    id: 'llama32-1b',
    pullName: 'llama3.2:1b',
    label: 'Llama 3.2 1B',
    sizeHint: '~1.3 GB',
    minRamGB: 3,
    reason: 'Rápido y usable en portátiles modestos',
    tier: 'tiny',
    source: 'ollama-official',
    risk: 'none',
    tags: ['rápido']
  },
  {
    id: 'qwen25-15b',
    pullName: 'qwen2.5:1.5b',
    label: 'Qwen2.5 1.5B',
    sizeHint: '~1 GB',
    minRamGB: 4,
    reason: 'Buen equilibrio calidad/velocidad en 8 GB RAM',
    tier: 'small',
    source: 'ollama-official',
    risk: 'none',
    tags: ['español', 'recomendado']
  },
  {
    id: 'llama32-3b',
    pullName: 'llama3.2:3b',
    label: 'Llama 3.2 3B',
    sizeHint: '~2 GB',
    minRamGB: 6,
    reason: 'Recomendado por defecto en la mayoría de PCs',
    tier: 'small',
    source: 'ollama-official',
    risk: 'none',
    tags: ['recomendado', 'chat']
  },
  {
    id: 'phi3-mini',
    pullName: 'phi3:mini',
    label: 'Phi-3 Mini',
    sizeHint: '~2.3 GB',
    minRamGB: 6,
    reason: 'Fuerte en razonamiento para su tamaño',
    tier: 'small',
    source: 'ollama-official',
    risk: 'none',
    tags: ['razonamiento']
  },
  {
    id: 'qwen25-3b',
    pullName: 'qwen2.5:3b',
    label: 'Qwen2.5 3B',
    sizeHint: '~1.9 GB',
    minRamGB: 6,
    reason: 'Excelente en español e instrucciones',
    tier: 'small',
    source: 'ollama-official',
    risk: 'none',
    tags: ['español', 'instrucciones']
  },
  {
    id: 'gemma2-2b',
    pullName: 'gemma2:2b',
    label: 'Gemma 2 2B',
    sizeHint: '~1.6 GB',
    minRamGB: 5,
    reason: 'Ligero y coherente (Google)',
    tier: 'small',
    source: 'ollama-official',
    risk: 'none',
    tags: ['chat']
  },
  {
    id: 'mistral-7b',
    pullName: 'mistral:7b',
    label: 'Mistral 7B',
    sizeHint: '~4.1 GB',
    minRamGB: 10,
    reason: 'Clásico versátil en chat y código',
    tier: 'medium',
    source: 'ollama-official',
    risk: 'none',
    tags: ['código', 'chat']
  },
  {
    id: 'llama31-8b',
    pullName: 'llama3.1:8b',
    label: 'Llama 3.1 8B',
    sizeHint: '~4.7 GB',
    minRamGB: 12,
    reason: 'Alta calidad de conversación',
    tier: 'medium',
    source: 'ollama-official',
    risk: 'none',
    tags: ['calidad', 'recomendado']
  },
  {
    id: 'qwen25-7b',
    pullName: 'qwen2.5:7b',
    label: 'Qwen2.5 7B',
    sizeHint: '~4.7 GB',
    minRamGB: 12,
    reason: 'Muy bueno en español y tareas largas',
    tier: 'medium',
    source: 'ollama-official',
    risk: 'none',
    tags: ['español', 'calidad']
  },
  {
    id: 'qwen25-14b',
    pullName: 'qwen2.5:14b',
    label: 'Qwen2.5 14B',
    sizeHint: '~9 GB',
    minRamGB: 18,
    reason: 'Más inteligencia si tienes RAM de sobra',
    tier: 'large',
    source: 'ollama-official',
    risk: 'none',
    tags: ['calidad']
  },
  {
    id: 'llama31-70b',
    pullName: 'llama3.1:70b',
    label: 'Llama 3.1 70B',
    sizeHint: '~40 GB',
    minRamGB: 48,
    reason: 'Solo con mucha RAM / GPU dedicada',
    tier: 'large',
    source: 'ollama-official',
    risk: 'none',
    tags: ['máxima calidad']
  },
  // —— Community abliterated (Ollama library names in active use) ——
  {
    id: 'huihui-qwen3-4b-ablit',
    pullName: 'huihui_ai/qwen3-abliterated:4b',
    label: 'Qwen3 4B Abliterated',
    sizeHint: '~2.5 GB',
    minRamGB: 8,
    reason: 'Menos filtros de rechazo; creativo / roleplay',
    tier: 'small',
    source: 'ollama-community',
    risk: 'uncensored',
    riskWarning: ABLIT_WARN,
    tags: ['uncensored', 'roleplay'],
    infoUrl: 'https://ollama.com/huihui_ai/qwen3-abliterated'
  },
  {
    id: 'mannix-llama31-8b-ablit',
    pullName: 'mannix/llama3.1-8b-abliterated',
    label: 'Llama 3.1 8B Abliterated',
    sizeHint: '~5 GB',
    minRamGB: 12,
    reason: 'Variante sin censura muy usada en Ollama',
    tier: 'medium',
    source: 'ollama-community',
    risk: 'uncensored',
    riskWarning: ABLIT_WARN,
    tags: ['uncensored'],
    infoUrl: 'https://ollama.com/mannix/llama3.1-8b-abliterated'
  },
  {
    id: 'huihui-qwen25-coder-ablit',
    pullName: 'huihui_ai/qwen2.5-coder-abliterate:7b',
    label: 'Qwen2.5 Coder 7B Abliterated',
    sizeHint: '~4.7 GB',
    minRamGB: 12,
    reason: 'Código con menos bloqueos (riesgo de uso indebido)',
    tier: 'medium',
    source: 'ollama-community',
    risk: 'uncensored',
    riskWarning: ABLIT_WARN,
    tags: ['uncensored', 'código'],
    infoUrl: 'https://ollama.com/search?q=qwen2.5-coder-abliterate'
  },
  // —— HF GGUF via Ollama (hf.co/ prefix) ——
  {
    id: 'hf-llama32-3b',
    pullName: 'hf.co/bartowski/Llama-3.2-3B-Instruct-GGUF',
    label: 'Llama 3.2 3B (HF GGUF)',
    sizeHint: '~2 GB',
    minRamGB: 6,
    reason: 'Desde Hugging Face vía Ollama; útil si el registry oficial falla',
    tier: 'small',
    source: 'hf-gguf',
    risk: 'none',
    tags: ['huggingface', 'mirror'],
    infoUrl: 'https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF'
  },
  {
    id: 'hf-qwen25-7b',
    pullName: 'hf.co/bartowski/Qwen2.5-7B-Instruct-GGUF',
    label: 'Qwen2.5 7B (HF GGUF)',
    sizeHint: '~4.7 GB',
    minRamGB: 12,
    reason: 'Mirror GGUF popular en Hugging Face',
    tier: 'medium',
    source: 'hf-gguf',
    risk: 'none',
    tags: ['huggingface', 'mirror'],
    infoUrl: 'https://huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF'
  }
]

export function usableRamGB(profile: HardwareProfile): number {
  return Math.max(1, profile.totalMemoryGB * 0.6)
}

export function filterCatalog(opts: {
  profile?: HardwareProfile
  query?: string
  includeUncensored?: boolean
  source?: ModelSource | 'all'
  onlyCompatible?: boolean
}): ModelRecommendation[] {
  const q = (opts.query || '').trim().toLowerCase()
  const usable = opts.profile ? usableRamGB(opts.profile) : 999
  return LOCAL_MODEL_CATALOG.filter((m) => {
    if (!opts.includeUncensored && m.risk === 'uncensored') return false
    if (opts.source && opts.source !== 'all' && m.source !== opts.source) return false
    if (opts.onlyCompatible !== false && opts.profile && m.minRamGB > usable + 0.5) return false
    if (!q) return true
    const hay = `${m.label} ${m.pullName} ${m.reason} ${(m.tags || []).join(' ')}`.toLowerCase()
    return hay.includes(q)
  })
}

export function recommendLocalModels(
  profile: HardwareProfile,
  installed: string[] = []
): {
  primary: ModelRecommendation
  alternatives: ModelRecommendation[]
  allCompatible: ModelRecommendation[]
  installedMatches: string[]
  profileSummary: string
} {
  const usable = usableRamGB(profile)
  const compatible = LOCAL_MODEL_CATALOG.filter(
    (m) => m.risk === 'none' && m.minRamGB <= usable + 0.5
  )
  const list =
    compatible.length > 0
      ? compatible
      : LOCAL_MODEL_CATALOG.filter((m) => m.tier === 'tiny' && m.risk === 'none')

  const ranked = [...list].sort((a, b) => {
    const score = (m: ModelRecommendation) => {
      let s = m.minRamGB
      if (m.tier === 'small') s += 2
      if (m.tier === 'medium') s += 4
      if (installed.some((i) => i === m.pullName || i.startsWith(m.pullName))) s += 10
      if (m.tags?.includes('recomendado')) s += 3
      return s
    }
    return score(b) - score(a)
  })

  const primary = ranked[0] ?? LOCAL_MODEL_CATALOG[0]
  const alternatives = ranked.filter((m) => m.id !== primary.id).slice(0, 8)

  const installedMatches = installed.filter((name) =>
    LOCAL_MODEL_CATALOG.some(
      (c) => name === c.pullName || name.startsWith(c.pullName.split(':')[0])
    )
  )

  return {
    primary,
    alternatives,
    allCompatible: ranked,
    installedMatches,
    profileSummary: `${profile.totalMemoryGB} GB RAM · ${profile.cpuCores} núcleos · ${profile.architecture}`
  }
}

export function pickInstalledOrRecommended(
  installed: string[],
  profile: HardwareProfile
): string {
  const { primary, installedMatches } = recommendLocalModels(profile, installed)
  if (installedMatches.length > 0) {
    for (const c of LOCAL_MODEL_CATALOG) {
      if (c.risk !== 'none') continue
      const hit = installed.find((i) => i === c.pullName || i.startsWith(c.pullName))
      if (hit && c.minRamGB <= usableRamGB(profile) + 0.5) return hit
    }
    return installedMatches[0]
  }
  return primary.pullName
}
