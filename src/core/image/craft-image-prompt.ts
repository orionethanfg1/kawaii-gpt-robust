/**
 * I1 — LLM crafts a detailed Stable Diffusion prompt.
 * Host keeps identity authority: DNA tags + negatives are forced when isSelf.
 * Fail-soft: caller falls back to rule-based compose on timeout/parse failure.
 */

import {
  appearanceToIdentityTags,
  identityNegativeBits,
  identityProfileToPromptBits,
  stripConflictingIdentityFromPrompt,
  rivalIdentityNegatives,
  type IdentityProfile
} from './identity-profile'

export type CraftFraming = 'close' | 'half' | 'full' | 'wide'

export type CraftedImagePrompt = {
  positive: string
  negative: string
  framing?: CraftFraming
  style?: string
  /** Model opinion only — host isSelf wins */
  isSelfHint?: boolean
  source: 'llm' | 'heuristic'
  rawModelText?: string
}

export type CraftImagePromptInput = {
  userText: string
  /** Host-resolved self portrait */
  isSelf: boolean
  characterName?: string
  /** Appearance summary already stripped of outfit */
  appearanceSummary?: string
  identity?: IdentityProfile | null
  /** Optional baseline prompt from rule compose (hints for the LLM) */
  baselinePositive?: string
  baselineNegative?: string
  hasFaceIdRef?: boolean
}

const QUALITY =
  '(masterpiece:1.2), (best quality:1.2), highly detailed, sharp focus'

const BASE_NEG =
  'two heads, two faces, multiple faces, double head, extra limbs, extra fingers, ' +
  'fused fingers, deformed hands, mutated hands, bad anatomy, bad proportions, disfigured, ' +
  'blurry, low quality, jpeg artifacts, watermark, text, logo, signature, multiple people, ' +
  'crowd, clone, identity mismatch, different person'

const FRAMING_SET = new Set<CraftFraming>(['close', 'half', 'full', 'wide'])

/** System instruction: model returns JSON only for SD tags. */
export function buildImageCraftSystemPrompt(input: {
  isSelf: boolean
  characterName?: string
  appearanceSummary?: string
  hasFaceIdRef?: boolean
}): string {
  const name = (input.characterName || 'the character').trim()
  const look = (input.appearanceSummary || '').trim().slice(0, 280)
  const selfBlock = input.isSelf
    ? [
        `This is a SELF-PORTRAIT of "${name}".`,
        look ? `Locked appearance (do NOT change hair/eyes/skin): ${look}` : '',
        input.hasFaceIdRef
          ? 'FaceID reference image will be applied — emphasize face clarity, natural expression, same person. Do NOT invent hair color/style or eye color; leave those to the locked appearance / FaceID.'
          : 'No FaceID ref available — put stronger identity tags on hair, eyes, face shape (only if given in locked appearance).',
        'Do not invent a different person or change core identity traits.',
        'Never output conflicting traits (e.g. blonde AND brown hair, curly AND straight).'
      ]
        .filter(Boolean)
        .join(' ')
    : 'This is NOT the companion avatar. Do not force the companion identity. Follow the user subject only.'

  return (
    'You are a Stable Diffusion prompt engineer for a local Forge/A1111 pipeline.\n' +
    'Reply with ONE JSON object only (no markdown, no commentary) with keys:\n' +
    '  positive (string): English comma-separated SD tags, concrete pose/outfit/scene/lighting/camera.\n' +
    '  negative (string): English tags to avoid.\n' +
    '  framing (string): one of close|half|full|wide.\n' +
    '  style (string): one of casual_photo|portrait_studio|cinematic|anime|soft_portrait.\n' +
    'Rules:\n' +
    '- positive must be English tags, not Spanish prose.\n' +
    '- Include quality cues only lightly (masterpiece is added by host).\n' +
    '- Be specific: pose, expression, clothing materials, environment, time of day, lens.\n' +
    '- Keep positive under ~120 words.\n' +
    selfBlock
  )
}

export function buildImageCraftUserPrompt(input: CraftImagePromptInput): string {
  const parts = [
    `User request:\n${String(input.userText || '').trim().slice(0, 600)}`
  ]
  if (input.baselinePositive) {
    parts.push(`Baseline tags (optional refine):\n${input.baselinePositive.slice(0, 500)}`)
  }
  return parts.join('\n\n')
}

/**
 * Extract JSON object from model text (tolerate fences / leading prose).
 */
export function parseCraftedImagePromptJson(raw: string): {
  positive?: string
  negative?: string
  framing?: CraftFraming
  style?: string
  isSelf?: boolean
} | null {
  const text = String(raw || '').trim()
  if (!text) return null
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const obj = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
    const positive = typeof obj.positive === 'string' ? obj.positive.trim() : ''
    const negative = typeof obj.negative === 'string' ? obj.negative.trim() : ''
    if (!positive || positive.length < 12) return null
    const framingRaw = String(obj.framing || '').toLowerCase().trim()
    const framing = FRAMING_SET.has(framingRaw as CraftFraming)
      ? (framingRaw as CraftFraming)
      : undefined
    const style =
      typeof obj.style === 'string' && obj.style.trim() ? obj.style.trim() : undefined
    const isSelf =
      typeof obj.isSelf === 'boolean'
        ? obj.isSelf
        : typeof obj.is_self === 'boolean'
          ? obj.is_self
          : undefined
    return { positive, negative, framing, style, isSelf }
  } catch {
    return null
  }
}

/**
 * Merge LLM craft with host identity authority.
 * When isSelf, DNA tags go first; identity negatives always appended.
 */
export function mergeCraftedWithIdentity(
  crafted: {
    positive: string
    negative?: string
    framing?: CraftFraming
    style?: string
  },
  opts: {
    isSelf: boolean
    identity?: IdentityProfile | null
    appearanceSummary?: string
    baselineNegative?: string
  }
): CraftedImagePrompt {
  const faceIdActive =
    Boolean(opts.identity?.primaryPhoto) ||
    (opts.identity?.secondaryRefs || []).length > 0

  const posParts: string[] = [QUALITY]
  if (opts.isSelf && opts.identity) {
    posParts.push(...identityProfileToPromptBits(opts.identity, { faceIdActive }))
  } else if (opts.isSelf && opts.appearanceSummary) {
    let tags = appearanceToIdentityTags(opts.appearanceSummary)
    if (faceIdActive) {
      tags = tags.filter(
        (t) =>
          !/^(?:long\s+)?(?:blonde|brown|black|red)\s+hair$/i.test(t) &&
          !/^(?:curly|straight|wavy)\s+hair$/i.test(t)
      )
    }
    for (const tag of tags) {
      posParts.push(`(${tag}:1.4)`)
    }
    posParts.push('solo, single person, (one face:1.4), (one head:1.4)')
  }

  // Strip quality / identity noise the model may have duplicated
  let llmPos = crafted.positive
    .replace(/\(masterpiece[^)]*\)/gi, '')
    .replace(/best quality/gi, '')
    .replace(/highly detailed/gi, '')
    .replace(/\s+,/g, ',')
    .replace(/,+/g, ', ')
    .trim()

  // Host DNA wins: remove LLM-invented rival hair/eyes (blonde vs brown, curly vs straight…)
  if (opts.isSelf) {
    const lockedTags = opts.identity
      ? appearanceToIdentityTags(
          [
            opts.identity.appearanceSummary || '',
            opts.identity.hairNotes || '',
            opts.identity.eyesNotes || ''
          ].join(', ')
        )
      : appearanceToIdentityTags(opts.appearanceSummary || '')
    if (lockedTags.length && llmPos) {
      const { cleaned } = stripConflictingIdentityFromPrompt(llmPos, lockedTags)
      llmPos = cleaned
    }
    // If no locked hair tags, only strip clearly-wrong invents (blonde) when FaceID is on
    if (faceIdActive && llmPos && !lockedTags.some((t) => /hair$/i.test(t))) {
      llmPos = llmPos
        .replace(/\(\s*(?:blonde|blond|platinum)\s+hair\s*:[^)]+\)/gi, ' ')
        .replace(/\b(?:blonde|blond|platinum)\s+hair\b/gi, ' ')
        .replace(/\s*,\s*,+/g, ', ')
        .replace(/\s{2,}/g, ' ')
        .trim()
    }
  }
  if (llmPos) posParts.push(llmPos)

  const negParts: string[] = [BASE_NEG]
  if (crafted.negative) negParts.push(crafted.negative)
  if (opts.baselineNegative) negParts.push(opts.baselineNegative)
  if (opts.isSelf && opts.identity) {
    negParts.push(...identityNegativeBits(opts.identity))
    const lockedTags = appearanceToIdentityTags(
      [
        opts.identity.appearanceSummary || '',
        opts.identity.hairNotes || '',
        opts.identity.eyesNotes || ''
      ].join(', ')
    )
    negParts.push(...rivalIdentityNegatives(lockedTags))
  }

  const dedupe = (s: string) => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const part of s.split(',').map((x) => x.trim()).filter(Boolean)) {
      const k = part.toLowerCase()
      if (seen.has(k)) continue
      seen.add(k)
      out.push(part)
    }
    return out.join(', ')
  }

  return {
    positive: dedupe(posParts.join(', ')),
    negative: dedupe(negParts.join(', ')),
    framing: crafted.framing,
    style: crafted.style,
    source: 'llm'
  }
}

/**
 * Run LLM craft with timeout. llmFn returns raw model text.
 * On any failure returns null (caller uses heuristic).
 */
export async function craftImagePromptWithLlm(
  input: CraftImagePromptInput,
  llmFn: (system: string, user: string) => Promise<string>,
  timeoutMs = 5500
): Promise<CraftedImagePrompt | null> {
  const userText = String(input.userText || '').trim()
  if (!userText) return null
  try {
    const system = buildImageCraftSystemPrompt({
      isSelf: input.isSelf,
      characterName: input.characterName,
      appearanceSummary: input.appearanceSummary || input.identity?.appearanceSummary,
      hasFaceIdRef: input.hasFaceIdRef
    })
    const user = buildImageCraftUserPrompt(input)
    const text = await Promise.race([
      llmFn(system, user),
      new Promise<string>((_, rej) =>
        setTimeout(() => rej(new Error('image-craft-timeout')), timeoutMs)
      )
    ])
    const parsed = parseCraftedImagePromptJson(text)
    if (!parsed?.positive) return null
    const merged = mergeCraftedWithIdentity(parsed, {
      isSelf: input.isSelf,
      identity: input.identity,
      appearanceSummary: input.appearanceSummary || input.identity?.appearanceSummary,
      baselineNegative: input.baselineNegative
    })
    merged.rawModelText = String(text || '').slice(0, 800)
    merged.isSelfHint = parsed.isSelf
    return merged
  } catch {
    return null
  }
}
