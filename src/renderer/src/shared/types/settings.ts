import { z } from 'zod'
import { DEFAULT_CHARACTER } from '@core/character/profile'
import { defaultCloudSlots } from '@core/models/cloud-rotation'

export const ProviderModeSchema = z.enum(['local', 'cloud', 'smart'])
export type ProviderMode = z.infer<typeof ProviderModeSchema>

export const CharacterProfileSchema = z.object({
  name: z.string().min(1),
  tagline: z.string(),
  personality: z.string(),
  style: z.string(),
  visualEmoji: z.string(),
  visualImageUrl: z.string().optional(),
  visualDescription: z.string().optional(),
  visualFromAvatar: z.boolean().optional(),
  relationshipRole: z.string().optional(),
  relationshipReaction: z.string().optional(),
  relationshipHistory: z
    .array(
      z.object({
        at: z.number(),
        fromRole: z.string(),
        toRole: z.string(),
        trigger: z.string(),
        reaction: z.string()
      })
    )
    .optional(),
  traits: z.array(z.string())
})

export const CloudSlotSchema = z.object({
  id: z.string(),
  name: z.string(),
  baseUrl: z.string(),
  model: z.string(),
  enabled: z.boolean(),
  priority: z.number().int()
})

export const SettingsSchema = z.object({
  providerMode: ProviderModeSchema.default('smart'),

  localBaseUrl: z.string().url().default('http://localhost:11434'),
  localModel: z.string().default(''),
  /** auto = detect Ollama or LM Studio / llama.cpp; transparent to user */
  localRuntimePreference: z.enum(['auto', 'ollama', 'openai-compatible']).default('auto'),
  /** Optional explicit OpenAI-compatible base (e.g. http://127.0.0.1:1234/v1) */
  localOpenAIBaseUrl: z.string().default(''),
  /** Last resolved runtime label (informational) */
  localRuntimeLabel: z.string().default(''),

  localMaxTokens: z.number().int().min(64).max(32768).default(2048),
  localTimeoutMs: z.number().int().min(5000).max(600000).default(120000),

  /** Legacy primary cloud (kept for compatibility; also mirrored in cloudSlots) */
  cloudBaseUrl: z.string().url().default('https://openrouter.ai/api/v1'),
  cloudModel: z.string().default('openrouter/free'),
  cloudMaxTokens: z.number().int().min(64).max(32768).default(4096),
  cloudTimeoutMs: z.number().int().min(5000).max(300000).default(90000),

  /** Multi-provider cloud rotation list */
  cloudSlots: z.array(CloudSlotSchema).default(defaultCloudSlots()),
  /** Prefer free-tier models when rotating */
  preferFreeTiers: z.boolean().default(true),
  /** Auto-rotate to next cloud on rate limit / quota */
  cloudAutoRotate: z.boolean().default(true),

  longPromptThreshold: z.number().int().min(100).max(20000).default(1500),
  webSearchEnabled: z.boolean().default(true),
  webSearchMaxResults: z.number().int().min(1).max(10).default(5),

  systemPrompt: z.string().default(''),
  temperature: z.number().min(0).max(2).default(0.7),
  streaming: z.boolean().default(true),

  theme: z.enum(['kawaii', 'dark']).default('kawaii'),
  fontScale: z.number().min(0.85).max(1.3).default(1),

  hasCompletedSetup: z.boolean().default(false),

  character: CharacterProfileSchema.default(DEFAULT_CHARACTER),

  /** Compact facts about the user (injected as short system text, not full history) */
  userMemory: z
    .object({
      facts: z.array(z.string()).default([]),
      preferredName: z.string().optional(),
      updatedAt: z.number().optional()
    })
    .default({ facts: [] }),


  showRouteInfo: z.boolean().default(true),
  autoDiagnoseOnError: z.boolean().default(true),

  /** Hide post-setup checklist when all items done */
  dismissSetupChecklist: z.boolean().default(false),

  /** Pre-summarize long chats while idle (local model preferred) */
  backgroundSummaryEnabled: z.boolean().default(true),
  /**
   * Allow background summary via cloud if local is unavailable.
   * Opt-in: may consume paid/free-tier quota.
   */
  backgroundSummaryAllowCloud: z.boolean().default(false),

  /** Master switch for image generation (Phase 0–1 default off) */
  imageGenEnabled: z.boolean().default(true),
  /** smart = fewer options; advanced = full controls */
  uiComplexity: z.enum(['smart', 'advanced']).default('smart'),
  /** Soft tips from assistant while using the app */
  assistantTipsEnabled: z.boolean().default(true),

  imageProviderMode: z.enum(['off', 'cloud', 'local', 'smart']).default('smart'),
  imageWidth: z.number().int().min(256).max(1536).default(1024),
  imageHeight: z.number().int().min(256).max(1536).default(1024),
  imageTimeoutMs: z.number().int().min(15000).max(300000).default(90000),
  /** Automatic1111 / Forge API base */
  a1111BaseUrl: z.string().default('http://127.0.0.1:7860'),
  a1111Steps: z.number().int().min(5).max(50).default(20),
  a1111CfgScale: z.number().min(1).max(20).default(7),
  /** Selected checkpoint title/name from A1111 */
  a1111Checkpoint: z.string().default(''),
  /** Cloudflare Workers AI (FLUX) — account id is not secret; token in secure store */
  cloudflareAccountId: z.string().default(''),
  imagePreferCloudflare: z.boolean().default(true),
  /** Append character style to image prompts */
  imageUseCharacterStyle: z.boolean().default(true),

  /** Multi-layer generative: music / video (engines optional; off by default) */
  musicGenEnabled: z.boolean().default(false),
  /** auto = pick ACE if eligible else skip YuE if low VRAM */
  musicPreferredBackend: z.enum(['auto', 'ace-step', 'yue', 'off']).default('auto'),
  musicProviderMode: z.enum(['off', 'local', 'smart']).default('off'),
  videoGenEnabled: z.boolean().default(false),
  videoProviderMode: z.enum(['off', 'local', 'smart']).default('off')
})

export type Settings = z.infer<typeof SettingsSchema>
export type CharacterProfile = z.infer<typeof CharacterProfileSchema>
export type CloudSlot = z.infer<typeof CloudSlotSchema>

export const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({})
