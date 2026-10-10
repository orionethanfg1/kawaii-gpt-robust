/**
 * E-USECHAT-2: plan image/music media requests for a user turn (fail-soft).
 */
import { safePlanGenerativeTurn } from '@core/generative'
import { detectGenerativeIntent } from '@core/generative/intent'
import {
  looksLikeImageRevision,
  shouldForceImageRevision,
  isNonImageOperationalCommand,
  looksLikeIdentityReject
} from '@core/generative/image-revision'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'
import { useChatStore } from '@shared/lib/stores/chatStore'

export type MediaRequest = {
  modality: string
  prompt?: string
  negativePrompt?: string
  width?: number
  height?: number
  seed?: number
  stylePrompt?: string
  meta?: { source?: string }
}

export function planMediaRequestsForTurn(
  trimmed: string,
  settings: {
    imageGenEnabled?: boolean
    imageProviderMode?: string
    imageWidth?: number
    imageHeight?: number
    imageUseCharacterStyle?: boolean
    musicGenEnabled?: boolean
    videoGenEnabled?: boolean
    character?: { name?: string; appearance?: string; visualDescription?: string } | null
  },
  activeId: string | null
): {
  mediaRequests: MediaRequest[]
  imageOn: boolean
  imageMode: string
  imageContextForText: string
} {
  let mediaRequests: MediaRequest[] = []
  let imageContextForText = ''
let imageOn = settings.imageGenEnabled !== false
let imageMode = settings.imageProviderMode
try {
  // Auto-enable smart image layer on clear visual intent (fail-soft)
  if (
    (!imageOn || imageMode === 'off') &&
    /\b(imagen|foto|dibujo|ilustraci|picture|image)\b/i.test(trimmed)
  ) {
    imageOn = true
    imageMode = imageMode === 'off' ? 'smart' : imageMode
    try {
      useSettingsStore.getState().update({
        imageGenEnabled: true,
        imageProviderMode: imageMode
      })
    } catch {
      /* ignore */
    }
  }
  const live = useSettingsStore.getState().settings
  const photoAsk = /\b(foto|fotografía|fotografia|photo|realista|retrato)\b/i.test(trimmed)
  const selfPortrait =
    /\b(tuya|tuyo|foto tuya|imagen tuya|de ti(?:\s+misma)?|como t[uú]|tu avatar|autorretrato|selfie)\b/i.test(
      trimmed
    ) ||
    Boolean(
      live.character?.name &&
        new RegExp(
          `\\b${String(live.character.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
          'i'
        ).test(trimmed)
    )
  const safe = safePlanGenerativeTurn(trimmed, {
    imageGenEnabled: imageOn,
    imageProviderMode: imageMode,
    musicEnabled: live.musicGenEnabled === true,
    videoEnabled: live.videoGenEnabled === true,
    character: live.character,
    // Self-portrait → character look; generic photo → no avatar bleed
    useCharacterStyle: selfPortrait
      ? true
      : photoAsk
        ? false
        : live.imageUseCharacterStyle !== false,
    imageWidth: live.imageWidth || 1024,
    imageHeight: live.imageHeight || 1024
  })
  mediaRequests = safe.mediaRequests as typeof mediaRequests
  if (safe.mediaHint) console.debug('[kawaii:generative-bridge]', safe.mediaHint)
  if (safe.error) console.warn('[kawaii:generative-bridge]', safe.error)
} catch (e) {
  console.error('[kawaii:generative] isolated failure', e)
}

// Natural revision of last image even without «genera imagen»
// Detect prior image early (ChatGPT-style short edits: "hazla más joven")
const convPeekEarly = activeId
  ? useChatStore.getState().conversations.find((c) => c.id === activeId)
  : null
const hasPrevImg = Boolean(
  convPeekEarly?.messages.some(
    (m) =>
      m.meta?.imageFilePath ||
      m.meta?.imagePrompt ||
      m.attachments?.some((a) => a.mimeType?.startsWith('image/'))
  )
)

// Hard guarantee: explicit "haz una foto/imagen…" must generate, not only chat
try {
  const intent = detectGenerativeIntent(trimmed)
  if (intent.modality === 'image' && imageOn) {
    if (mediaRequests.length === 0) {
      mediaRequests = [
        {
          modality: 'image',
          prompt: intent.prompt || trimmed,
          width: settings.imageWidth || 1024,
          height: settings.imageHeight || 1024
        }
      ]
    }
  }
} catch {
  /* ignore */
}

// Force image revision path (must work even if planner returned text-only)
if (
  imageOn &&
  hasPrevImg &&
  mediaRequests.length === 0 &&
  (looksLikeImageRevision(trimmed, true) || shouldForceImageRevision(trimmed, true))
) {
  mediaRequests = [
    {
      modality: 'image',
      prompt: trimmed,
      width: settings.imageWidth || 1024,
      height: settings.imageHeight || 1024
    }
  ]
}

// Analyze / describe last image → text only with generation memory (ChatGPT-style)
imageContextForText = ''
if (
  /\b(analiz|describ|explic|cu[eé]ntame|qu[eé]\s+ves|c[oó]mo\s+se\s+ve|opina)\b/i.test(
    trimmed
  ) &&
  /\b(foto|imagen|dibujo)\b/i.test(trimmed)
) {
  const convPeek = activeId
    ? useChatStore.getState().conversations.find((c) => c.id === activeId)
    : null
  const lastImg = [...(convPeek?.messages || [])]
    .reverse()
    .find(
      (m) =>
        m.meta?.imagePrompt ||
        m.meta?.imageFilePath ||
        m.attachments?.some((a) => a.mimeType?.startsWith('image/'))
    )
  if (lastImg) {
    const att = lastImg.attachments?.find((a) => a.mimeType?.startsWith('image/'))
    imageContextForText = [
      '[Análisis de imagen en este chat — responde en texto, NO generes otra imagen]',
      lastImg.meta?.imagePrompt
        ? `Prompt usado: ${String(lastImg.meta.imagePrompt).slice(0, 500)}`
        : '',
      lastImg.meta?.imageProvider
        ? `Proveedor: ${lastImg.meta.imageProvider}`
        : '',
      lastImg.meta?.imageWidth
        ? `Tamaño: ${lastImg.meta.imageWidth}×${lastImg.meta.imageHeight}`
        : '',
      att?.name ? `Archivo adjunto: ${att.name}` : '',
      lastImg.meta?.imageFilePath
        ? `Ruta local: ${String(lastImg.meta.imageFilePath)}`
        : '',
      'Analiza con honestidad: composición, estilo, defectos (manos, ojos, texto), coherencia con el pedido y con el avatar del personaje si aplica. Si no ves la imagen real, basa el análisis en el prompt y sé transparente.'
    ]
      .filter(Boolean)
      .join('\n')
  }
}

// "esa no eres tú" after an image → must regenerate, not only apologize in text
if (
  mediaRequests.length === 0 &&
  looksLikeIdentityReject(trimmed) &&
  hasPrevImg
) {
  const char = settings.character
  const look = (char?.visualDescription || '').trim()
  mediaRequests = [
    {
      modality: 'image' as const,
      prompt: look
        ? `photorealistic portrait of ${char?.name || 'character'}, ${look}`
        : `photorealistic portrait of ${char?.name || 'the character'}, match avatar identity`,
      negativePrompt:
        'wrong person, different face, wrong hair color, two people, blurry',
      width: settings.imageWidth || 768,
      height: settings.imageHeight || 1024
    }
  ]
}



  if (isNonImageOperationalCommand(trimmed)) {
    mediaRequests = []
  }
  return { mediaRequests, imageOn, imageMode: String(imageMode || 'smart'), imageContextForText }
}
