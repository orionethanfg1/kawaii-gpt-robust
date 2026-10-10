import { parseParamLabel } from '@core/models/capabilities'

export type ChatOutputProfile = 'lite' | 'mid' | 'heavy' | 'max'

export type ChatMachineCapacity = {
  ramGB?: number | null
  vramGB?: number | null
}

const PROFILE_RANK: Record<ChatOutputProfile, number> = {
  lite: 0,
  mid: 1,
  heavy: 2,
  max: 3
}

function profileAtMost(
  modelProfile: ChatOutputProfile,
  machineCapacity?: ChatMachineCapacity
): ChatOutputProfile {
  const ram = machineCapacity?.ramGB
  const vram = machineCapacity?.vramGB
  const hasCapacity = (typeof ram === 'number' && ram > 0) ||
    (typeof vram === 'number' && vram > 0)
  if (!hasCapacity) return modelProfile

  // Leave room for the OS/runtime; either memory pool can serve an offloaded model.
  const availableGB = Math.max(
    typeof ram === 'number' && ram > 0 ? ram * 0.72 : 0,
    typeof vram === 'number' && vram > 0 ? Math.max(0, vram - 1.5) : 0
  )
  const fitProfile: ChatOutputProfile =
    availableGB >= 45.5 ? 'max' :
      availableGB >= 22.1 ? 'heavy' :
        availableGB >= 10.4 ? 'mid' : 'lite'
  return PROFILE_RANK[modelProfile] <= PROFILE_RANK[fitProfile]
    ? modelProfile
    : fitProfile
}

export function outputProfileForModel(
  modelId: string,
  kind: 'local' | 'cloud',
  machineCapacity?: ChatMachineCapacity
): ChatOutputProfile {
  const model = (modelId || '').trim().toLowerCase()
  const { approxB, paramLabel } = parseParamLabel(model)
  if (paramLabel) {
    const profile =
      approxB <= 9 ? 'lite' :
        approxB <= 16 ? 'mid' :
          approxB < 70 ? 'heavy' : 'max'
    return kind === 'local' ? profileAtMost(profile, machineCapacity) : profile
  }

  if (kind === 'cloud') {
    if (/^(gpt-|openai\/gpt-|claude-|anthropic\/|o[134](?:-|$))/.test(model)) {
      return 'max'
    }
    if (/gemini|mistral-large|command-r-plus/.test(model)) return 'heavy'
  }
  return 'mid'
}

const PROFILE_LIMITS: Record<ChatOutputProfile, { normal: number; short: number; greeting: number }> = {
  lite: { normal: 384, short: 288, greeting: 128 },
  mid: { normal: 512, short: 384, greeting: 160 },
  heavy: { normal: 1024, short: 640, greeting: 192 },
  max: { normal: 1536, short: 768, greeting: 256 }
}

function isBriefGreetingOrAcknowledgement(text: string): boolean {
  const normalized = (text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return /^(?:hola|holi|hey|hi|hello|buenos dias|buenas tardes|buenas noches|que tal|buen dia)(?: (?:como estas|como vas|que haces))?$|^(?:ok|okay|vale|gracias|perfecto|listo|entendido|si|no)$/.test(
    normalized
  )
}

/** Limit completion size by the active model class and the current turn. */
export function chatOutputTokenBudget(options: {
  modelId: string
  kind: 'local' | 'cloud'
  userText: string
  configuredMaxTokens: number
  machineCapacity?: ChatMachineCapacity
}): number {
  const profile = outputProfileForModel(
    options.modelId,
    options.kind,
    options.machineCapacity
  )
  const limits = PROFILE_LIMITS[profile]
  const text = (options.userText || '').trim()
  const turnLimit = isBriefGreetingOrAcknowledgement(text)
    ? limits.greeting
    : text.length <= 80
      ? limits.short
      : limits.normal
  const configured = Number.isFinite(options.configuredMaxTokens)
    ? Math.floor(options.configuredMaxTokens)
    : limits.normal

  return Math.max(1, Math.min(configured, turnLimit))
}

export function recentTurnLimit(profile: ChatOutputProfile): number {
  return profile === 'lite' ? 6 : profile === 'mid' ? 8 : profile === 'heavy' ? 14 : 20
}

export function recentMessageLimit(profile: ChatOutputProfile): number {
  return recentTurnLimit(profile) * 2
}

export function repetitionPenalties(
  profile: ChatOutputProfile
): { frequencyPenalty: number; presencePenalty: number } {
  if (profile === 'lite') return { frequencyPenalty: 0.45, presencePenalty: 0.25 }
  if (profile === 'mid') return { frequencyPenalty: 0.3, presencePenalty: 0.15 }
  if (profile === 'heavy') return { frequencyPenalty: 0.1, presencePenalty: 0.05 }
  return { frequencyPenalty: 0, presencePenalty: 0 }
}
