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
  visualGallery: z
    .array(
      z.object({
        id: z.string(),
        dataUrl: z.string(),
        label: z.string().optional(),
        scene: z.string().optional()
      })
    )
    .max(12)
    .optional(),
  visualDescription: z.string().optional(),
  visualFromAvatar: z.boolean().optional(),
  relationshipRole: z.string().optional(),
  /** female | male | neutral — pronouns for the character */
  gender: z.enum(['female', 'male', 'neutral']).optional(),
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
  /** Harness: switch local model by task (code/vision/chat) when better match exists */
  autoModelRouting: z.boolean().default(true),

  localBaseUrl: z.string().min(1).default('http://localhost:11434'),
  localModel: z.string().default(''),
  /**
   * When true, user chose a model explicitly («Usar»).
   * Auto-routing will not override until they press Auto / unpin.
   */
  localModelPinned: z.boolean().default(false),
  /** auto = detect Ollama or LM Studio / llama.cpp; transparent to user */
  localRuntimePreference: z.enum(['auto', 'ollama', 'openai-compatible']).default('auto'),
  /** Optional explicit OpenAI-compatible base (e.g. http://127.0.0.1:1234/v1) */
  localOpenAIBaseUrl: z.string().default(''),
  /** Last resolved runtime label (informational) */
  localRuntimeLabel: z.string().default(''),

  localMaxTokens: z.number().int().min(64).max(32768).default(2048),
  localTimeoutMs: z.number().int().min(5000).max(600000).default(120000),

  /** Legacy primary cloud (kept for compatibility; also mirrored in cloudSlots) */
  cloudBaseUrl: z.string().default('https://openrouter.ai/api/v1'),
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
  /** Optional SearXNG base URL e.g. http://127.0.0.1:8080 */
  searxngBaseUrl: z.string().optional().default(''),

  systemPrompt: z.string().default(''),
  temperature: z.number().min(0).max(2).default(0.7),
  streaming: z.boolean().default(true),

  theme: z.enum(['kawaii', 'dark']).default('kawaii'),
  fontScale: z.number().min(0.85).max(1.3).default(1),

  hasCompletedSetup: z.boolean().default(false),

  character: CharacterProfileSchema.default(DEFAULT_CHARACTER),

  /** Compact facts about the user (injected as short system text, not full history) */
  /** How the assistant should address the user (optional) */
  userGender: z.enum(['female', 'male', 'neutral']).optional(),
  userMemory: z
    .object({
      facts: z.array(z.string()).default([]),
      factEntries: z
        .array(
          z.object({
            text: z.string(),
            importance: z.number().optional(),
            pinned: z.boolean().optional(),
            at: z.number().optional(),
            category: z
              .enum(['general', 'preference', 'appearance', 'goal', 'person', 'emotion', 'work'])
              .optional()
          })
        )
        .max(40)
        .optional(),
      preferredName: z.string().optional(),
      nicknames: z.array(z.string()).max(12).default([]),
      pendingNickname: z.string().optional(),
      appearanceNotes: z.string().optional(),
      avatarScenes: z.array(z.string()).max(24).default([]),
      goals: z.array(z.string()).max(12).default([]),
      currentFocus: z.string().optional(),
      people: z
        .array(
          z.object({
            name: z.string(),
            relation: z.string().optional(),
            note: z.string().optional()
          })
        )
        .max(12)
        .optional(),
      likes: z.array(z.string()).max(16).default([]),
      dislikes: z.array(z.string()).max(12).default([]),
      emotionalNotes: z.array(z.string()).max(8).optional(),
      relationshipSummary: z.string().optional(),
      lastRecalledAt: z.number().optional(),
      updatedAt: z.number().optional()
    })
    .default({ facts: [], avatarScenes: [], goals: [], likes: [], dislikes: [], nicknames: [] }),

  /** M0 — character individuality (separate from userMemory) */
  assistantMemory: z
    .object({
      likes: z.array(z.string()).max(12).default([]),
      dislikes: z.array(z.string()).max(10).default([]),
      habits: z.array(z.string()).max(10).default([]),
      boundaries: z.array(z.string()).max(8).default([]),
      voiceNotes: z.array(z.string()).max(8).default([]),
      relational: z.array(z.string()).max(12).optional(),
      updatedAt: z.number().optional(),
      version: z.number().optional()
    })
    .default({ likes: [], dislikes: [], habits: [], boundaries: [], voiceNotes: [] }),


  /** B2b — user mood with timestamps (sensitive UI) */
  userMood: z
    .array(
      z.object({
        text: z.string(),
        polarity: z.enum(['up', 'down', 'mixed', 'neutral']).optional(),
        at: z.number(),
        expiresAt: z.number().optional(),
        source: z.enum(['user', 'assistant']).default('user'),
        sensitivity: z.enum(['normal', 'sensitive']).optional()
      })
    )
    .max(8)
    .default([]),

  /** B2b — assistant transient mood */
  assistantMood: z
    .array(
      z.object({
        text: z.string(),
        polarity: z.enum(['up', 'down', 'mixed', 'neutral']).optional(),
        at: z.number(),
        expiresAt: z.number().optional(),
        source: z.enum(['user', 'assistant']).default('assistant'),
        sensitivity: z.enum(['normal', 'sensitive']).optional()
      })
    )
    .max(6)
    .default([]),

  /** A0 — agenda items (talk / reminder) */
  agendaItems: z
    .array(
      z.object({
        id: z.string(),
        type: z.enum(['talk', 'reminder', 'event']),
        title: z.string(),
        topic: z.string().optional(),
        sensitivity: z.enum(['normal', 'sensitive']).default('normal'),
        when: z.object({
          kind: z.enum(['exact', 'window', 'relative']),
          at: z.number().optional(),
          windowStart: z.number().optional(),
          windowEnd: z.number().optional(),
          relativeMs: z.number().optional(),
          tz: z.string().optional(),
          label: z.string().optional()
        }),
        status: z.enum(['pending', 'due', 'done', 'snoozed', 'cancelled']),
        notify: z.object({
          leadMinutes: z.number().optional(),
          insist: z.enum(['off', 'once', 'gentle', 'learned']).default('once'),
          maxNudges: z.number().optional(),
          nudgesSent: z.number().optional(),
          nextNudgeAt: z.number().optional()
        }),
        createdAt: z.number(),
        updatedAt: z.number(),
        sourceTurnId: z.string().optional()
      })
    )
    .max(40)
    .default([]),

  agendaPrefs: z
    .object({
      defaultLeadMinutes: z.number().default(15),
      insistStyle: z.enum(['off', 'once', 'gentle', 'learned']).default('once'),
      quietHours: z
        .object({ startH: z.number(), endH: z.number() })
        .optional(),
      learned: z
        .object({
          snoozeRate: z.number().optional(),
          preferLead: z.number().optional(),
          snoozeCount: z.number().optional(),
          doneCount: z.number().optional()
        })
        .optional()
    })
    .default({ defaultLeadMinutes: 15, insistStyle: 'once', quietHours: { startH: 8, endH: 20 } }),

  /** M1 — UI flag: offer restore vs start fresh after clear */
  memoryGatePending: z.boolean().default(false),

  /** M2 — soft get-to-know flow when user memory is sparse */
  memoryOnboarding: z
    .object({
      active: z.boolean().optional(),
      step: z.enum(['name', 'nickname', 'like', 'dislike', 'done']).optional(),
      dismissed: z.boolean().optional(),
      updatedAt: z.number().optional()
    })
    .optional(),

  /** M4 shell — relationship confidence (optional) */
  relationshipState: z
    .object({
      stage: z.string().optional(),
      acceptedNicknames: z.array(z.string()).max(12).optional(),
      rejectedNicknames: z.array(z.string()).max(12).optional(),
      lastProposalAt: z.number().optional(),
      turnsTogether: z.number().optional(),
      updatedAt: z.number().optional()
    })
    .optional(),

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
  /** Checkpoint preferred for self-portraits (FaceID identity) */
  preferredIdentityCheckpoint: z.string().default(''),
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
  /** If true, assistant may send a short message after idle time while app is open */
  conversationInitiativeEnabled: z.boolean().default(true),
  /** personality = cadence from character; fixed = conversationInitiativeMinutes */
  conversationInitiativeMode: z.enum(['personality', 'fixed']).default('personality'),
  /** Minutes of idle before initiative when mode is fixed (min 2) */
  conversationInitiativeMinutes: z.number().min(1).max(120).default(4),
  /** Epoch ms — do not send initiative until this time (chat: "dame 5 minutos") */
  conversationInitiativeSnoozeUntil: z.number().optional(),
  musicProviderMode: z.enum(['off', 'local', 'smart']).default('off'),
  videoGenEnabled: z.boolean().default(false),
  videoProviderMode: z.enum(['off', 'local', 'smart']).default('off'),

  /** TTS: leer respuestas del chat (Edge neural es-MX por defecto) */
  voiceTtsEnabled: z.boolean().default(true),
  /** Edge voice id, e.g. es-MX-DaliaNeural */
  voiceTtsVoiceId: z.string().default('es-MX-DaliaNeural'),
  /** Auto-play assistant replies */
  voiceTtsAutoPlay: z.boolean().default(false),
  /**
   * If true: voice only during mini-games (aventura/ajedrez).
   * Main chat stays silent unless the user presses the speaker button.
   */
  voiceTtsActivitiesOnly: z.boolean().default(false)
})

export type Settings = z.infer<typeof SettingsSchema>
export type CharacterProfile = z.infer<typeof CharacterProfileSchema>
export type CloudSlot = z.infer<typeof CloudSlotSchema>

export const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({})
