/**
 * Hardware-aware local model recommendations + expanded catalog.
 * Sources: Ollama library + community (abliterated) with explicit risk flags.
 * Pull names verified against public Ollama library / common HF→Ollama paths.
 */

export interface HardwareProfile {
  totalMemoryGB: number
  cpuCores: number
  architecture: string
  gpuName?: string | null
  vramGB?: number | null
  hasDiscreteGpu?: boolean | null
}

export type ModelSource = 'ollama-official' | 'ollama-community' | 'hf-gguf'
export type ModelRisk = 'none' | 'uncensored'

export type ModelRole =
  | 'general'
  | 'companion'
  | 'code'
  | 'reason'
  | 'vision'
  | 'optional-rp'

export interface ModelRecommendation {
  id: string
  /** ollama pull name (or hf.co/... for GGUF import) */
  pullName: string
  label: string
  sizeHint: string
  minRamGB: number
  /** Soft ceiling: smoother than minRamGB (C1) */
  comfortRamGB?: number
  reason: string
  tier: 'tiny' | 'small' | 'medium' | 'large'
  source: ModelSource
  risk: ModelRisk
  /** Shown when risk !== none */
  riskWarning?: string
  tags?: string[]
  /** Catalog roles for routing / UI (C2) */
  roles?: ModelRole[]
  /** Lower = preferred within same role (ablit before RP) */
  recommendRank?: number
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
    tags: ['uncensored', 'companion', 'abliterated'],
    roles: ['companion', 'general'],
    recommendRank: 25,
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
    tags: ['uncensored', 'companion', 'abliterated'],
    roles: ['companion'],
    recommendRank: 28,
    infoUrl: 'https://ollama.com/mannix/llama3.1-8b-abliterated'
  },

  // —— Preferred companion: abliterated (general capability, fewer refusals) ——
  {
    id: 'qwen3-14b-ablit-huihui',
    pullName: 'huihui_ai/qwen3-abliterated:14b-v2',
    label: 'Qwen3 14B Abliterated (huihui v2)',
    sizeHint: '~9 GB',
    minRamGB: 14,
    comfortRamGB: 18,
    reason: 'Prioritario companion: menos negativas, sigue siendo Qwen3 general (no solo RP)',
    tier: 'medium',
    source: 'ollama-community',
    risk: 'uncensored',
    riskWarning: ABLIT_WARN,
    tags: ['uncensored', 'companion', 'abliterated', 'qwen3', 'recomendado'],
    roles: ['companion', 'general'],
    recommendRank: 10,
    infoUrl: 'https://ollama.com/huihui_ai/qwen3-abliterated'
  },
  {
    id: 'qwen3-14b-ablit-richard',
    pullName: 'richardyoung/qwen3-14b-abliterated',
    label: 'Qwen3 14B Abliterated (richardyoung)',
    sizeHint: '~9 GB',
    minRamGB: 14,
    comfortRamGB: 18,
    reason: 'Abliterated Q4; buen equilibrio calidad/tamaño para cercanía adulta',
    tier: 'medium',
    source: 'ollama-community',
    risk: 'uncensored',
    riskWarning: ABLIT_WARN,
    tags: ['uncensored', 'companion', 'abliterated', 'qwen3'],
    roles: ['companion', 'general'],
    recommendRank: 12,
    infoUrl: 'https://ollama.com/richardyoung/qwen3-14b-abliterated'
  },
  {
    id: 'qwen3-8b-ablit',
    pullName: 'huihui_ai/qwen3-abliterated:8b',
    label: 'Qwen3 8B Abliterated',
    sizeHint: '~5 GB',
    minRamGB: 10,
    comfortRamGB: 12,
    reason: 'Abliterated más ligero si 14B va justo de RAM',
    tier: 'medium',
    source: 'ollama-community',
    risk: 'uncensored',
    riskWarning: ABLIT_WARN,
    tags: ['uncensored', 'companion', 'abliterated', 'qwen3'],
    roles: ['companion', 'general'],
    recommendRank: 20,
    infoUrl: 'https://ollama.com/huihui_ai/qwen3-abliterated'
  },
  {
    id: 'optional-rp-tifa-14b',
    pullName: 'hf.co/ValueFX9507/Tifa-Deepsex-14b-CoT-GGUF-Q4',
    label: 'Tifa-Deepsex 14B CoT (RP opcional)',
    sizeHint: '~9 GB',
    minRamGB: 14,
    comfortRamGB: 18,
    reason: 'Opcional: afinado novela/RP. Preferir abliterated Qwen para chat íntimo general',
    tier: 'medium',
    source: 'hf-gguf',
    risk: 'uncensored',
    riskWarning: ABLIT_WARN + ' Modelo orientado a roleplay/ficción, no como único chat cotidiano.',
    tags: ['uncensored', 'optional-rp', 'roleplay'],
    roles: ['optional-rp'],
    recommendRank: 90,
    infoUrl: 'https://huggingface.co/ValueFX9507/Tifa-Deepsex-14b-CoT-GGUF-Q4'
  },
  {
    id: 'companion-dolphin-llama3',
    pullName: 'dolphin-llama3',
    label: 'Dolphin Llama3 (companion)',
    sizeHint: '~4.7 GB',
    minRamGB: 10,
    reason: 'Menos negativas automáticas; sigue bien el system prompt de cercanía adulta',
    tier: 'medium',
    source: 'ollama-official',
    risk: 'uncensored',
    riskWarning: ABLIT_WARN,
    tags: ['uncensored', 'companion', 'abliterated'],
    roles: ['companion'],
    recommendRank: 30,
    infoUrl: 'https://ollama.com/library/dolphin-llama3'
  },
  {
    id: 'companion-dolphin-mistral',
    pullName: 'dolphin-mistral',
    label: 'Dolphin Mistral (companion)',
    sizeHint: '~4.1 GB',
    minRamGB: 8,
    reason: 'Opción ligera refusal-reduced para chat companion',
    tier: 'small',
    source: 'ollama-official',
    risk: 'uncensored',
    riskWarning: ABLIT_WARN,
    tags: ['uncensored', 'companion'],
    roles: ['companion'],
    recommendRank: 35,
    infoUrl: 'https://ollama.com/library/dolphin-mistral'
  },
  {
    id: 'companion-hermes3-8b',
    pullName: 'adrienbrault/nous-hermes3-llama3.1-8b',
    label: 'Hermes 3 8B (steerable)',
    sizeHint: '~5 GB',
    minRamGB: 12,
    reason: 'Muy gobernable por system prompt; menos moralina, no es “modo porno”',
    tier: 'medium',
    source: 'ollama-community',
    risk: 'uncensored',
    riskWarning: ABLIT_WARN,
    tags: ['uncensored', 'companion', 'steerable'],
    roles: ['companion'],
    recommendRank: 40,
    infoUrl: 'https://ollama.com/adrienbrault/nous-hermes3-llama3.1-8b'
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
  const ram = Math.max(1, profile.totalMemoryGB * 0.6)
  const vram = typeof profile.vramGB === 'number' && profile.vramGB > 0 ? profile.vramGB : 0
  // GPU offload: effective headroom is max(RAM share, VRAM + modest system)
  if (vram >= 6) return Math.max(ram, vram + Math.min(8, profile.totalMemoryGB * 0.25))
  return ram
}

/** C1 — soft size ceilings from live hardware */
export type HardwareModelBudget = {
  usableGB: number
  /** Smooth default Auto (prefer ≤ this params B) */
  comfortParamsB: number
  /** Slow but OK (user ran up to ~27B) */
  okParamsB: number
  /** Do not recommend unless only option */
  skipParamsB: number
  summary: string
}

export function hardwareModelBudget(profile: HardwareProfile): HardwareModelBudget {
  const usable = usableRamGB(profile)
  let comfort = 7
  let ok = 14
  let skip = 32
  if (usable >= 40) {
    comfort = 14
    ok = 32
    skip = 70
  } else if (usable >= 24) {
    comfort = 14
    ok = 27
    skip = 40
  } else if (usable >= 16) {
    comfort = 9
    ok = 14
    skip = 32
  } else if (usable >= 10) {
    comfort = 7
    ok = 9
    skip = 14
  } else {
    comfort = 3
    ok = 7
    skip = 9
  }
  const vram = profile.vramGB
  const vNote =
    typeof vram === 'number' && vram > 0 ? ` · VRAM ~${Math.round(vram)} GB` : ''
  return {
    usableGB: usable,
    comfortParamsB: comfort,
    okParamsB: ok,
    skipParamsB: skip,
    summary: `Tu PC: ~${Math.round(profile.totalMemoryGB)} GB RAM${vNote} · recomendado hasta ~${comfort}B · hasta ~${ok}B posible (más lento)`
  }
}

export function estimateParamsBFromId(id: string): number | null {
  const x = id.toLowerCase()
  const m =
    x.match(/(\d+(?:\.\d+)?)\s*b/) ||
    x.match(/[-_/:](\d{1,3})b([-_/:]|$)/) ||
    x.match(/(\d{1,3})b-/)
  if (!m) return null
  return parseFloat(m[1])
}

export function catalogSpeedFit(
  m: ModelRecommendation,
  budget: HardwareModelBudget
): 'comfort' | 'ok-slow' | 'skip' {
  const pb = estimateParamsBFromId(m.pullName) ?? estimateParamsBFromId(m.label)
  const need = m.comfortRamGB ?? m.minRamGB
  if (need > budget.usableGB + 4) return 'skip'
  if (pb != null) {
    if (pb > budget.skipParamsB) return 'skip'
    if (pb > budget.okParamsB) return 'skip'
    if (pb > budget.comfortParamsB) return 'ok-slow'
  }
  if (m.minRamGB > budget.usableGB + 0.5) return 'ok-slow'
  return 'comfort'
}

export function filterCatalog(opts: {
  profile?: HardwareProfile
  query?: string
  includeUncensored?: boolean
  includeOptionalRp?: boolean
  source?: ModelSource | 'all'
  onlyCompatible?: boolean
}): ModelRecommendation[] {
  const q = (opts.query || '').trim().toLowerCase()
  const usable = opts.profile ? usableRamGB(opts.profile) : 999
  const budget = opts.profile ? hardwareModelBudget(opts.profile) : null
  return LOCAL_MODEL_CATALOG.filter((m) => {
    if (!opts.includeUncensored && m.risk === 'uncensored') return false
    if (!opts.includeOptionalRp && (m.roles?.includes('optional-rp') || m.tags?.includes('optional-rp')))
      return false
    if (opts.source && opts.source !== 'all' && m.source !== opts.source) return false
    if (opts.onlyCompatible !== false && opts.profile) {
      const fit = budget ? catalogSpeedFit(m, budget) : 'comfort'
      if (fit === 'skip') return false
      if (m.minRamGB > usable + 4) return false
    }
    if (!q) return true
    const hay = `${m.label} ${m.pullName} ${m.reason} ${(m.tags || []).join(' ')} ${(m.roles || []).join(' ')}`.toLowerCase()
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
  budget: HardwareModelBudget
} {
  const budget = hardwareModelBudget(profile)
  const usable = budget.usableGB
  const compatible = LOCAL_MODEL_CATALOG.filter((m) => {
    if (m.risk !== 'none') return false
    if (catalogSpeedFit(m, budget) === 'skip') return false
    return m.minRamGB <= usable + 1
  })
  const list =
    compatible.length > 0
      ? compatible
      : LOCAL_MODEL_CATALOG.filter((m) => m.tier === 'tiny' && m.risk === 'none')

  const ranked = [...list].sort((a, b) => {
    const score = (m: ModelRecommendation) => {
      let s = 0
      const fit = catalogSpeedFit(m, budget)
      if (fit === 'comfort') s += 20
      else if (fit === 'ok-slow') s += 5
      const pb = estimateParamsBFromId(m.pullName)
      if (pb != null && pb <= budget.comfortParamsB && pb >= 7) s += 8
      if (m.tags?.includes('recomendado')) s += 5
      if (installed.some((i) => i === m.pullName || i.startsWith(m.pullName.split(':')[0]))) s += 12
      s += m.minRamGB * 0.3
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
    profileSummary: budget.summary,
    budget
  }
}

export function isUncensoredCompanionId(id: string): boolean {
  const x = id.toLowerCase()
  return /abliterat|uncensor|unfiltered|dolphin|hermes3|nous-hermes|venice|role.?play|deepsex|tifa-deep/i.test(
    x
  )
}

export function isOptionalRpId(id: string): boolean {
  const x = id.toLowerCase()
  return /deepsex|tifa-deep|nsfw[_-]?wan|optional-rp|roleplay-nsfw/i.test(x)
}

/** C2 — Prefer abliterated general models; RP only if includeOptionalRp */
export function recommendCompanionUncensored(
  profile: HardwareProfile,
  installed: string[] = [],
  opts?: { includeOptionalRp?: boolean }
): ModelRecommendation[] {
  const budget = hardwareModelBudget(profile)
  const usable = budget.usableGB
  const pool = LOCAL_MODEL_CATALOG.filter((m) => {
    if (m.risk !== 'uncensored') return false
    const isRp =
      m.roles?.includes('optional-rp') ||
      m.tags?.includes('optional-rp') ||
      isOptionalRpId(m.pullName)
    if (isRp && !opts?.includeOptionalRp) return false
    // Prefer companion/abliterated; exclude pure coder-ablit from companion list
    if (m.tags?.includes('código') && !m.tags?.includes('companion')) return false
    if (!(m.tags?.includes('companion') || m.tags?.includes('abliterated') || m.roles?.includes('companion') || isRp))
      return false
    if (catalogSpeedFit(m, budget) === 'skip') return false
    return m.minRamGB <= usable + 3
  })
  const ranked = [...pool].sort((a, b) => {
    const rank = (m: ModelRecommendation) => {
      let s = 100 - (m.recommendRank ?? 50)
      if (m.tags?.includes('abliterated')) s += 25
      if (m.roles?.includes('optional-rp') || m.tags?.includes('optional-rp')) s -= 40
      if (installed.some((i) => i === m.pullName || i.startsWith(m.pullName.split(':')[0]))) s += 30
      const fit = catalogSpeedFit(m, budget)
      if (fit === 'comfort') s += 10
      if (fit === 'ok-slow') s += 2
      return s
    }
    return rank(b) - rank(a)
  })
  return ranked.slice(0, 8)
}
