import type { Attachment } from '@core/conversation'
import { buildTimeAwarenessBlock } from '@core/conversation/initiative'
import { buildDocumentsBlock } from '@core/chat/document-attach'
import { looksLikeIdentityReject } from '@core/generative/image-revision'
import { ensureVisualDescriptionFromAvatar } from '@features/settings/ensureVisualDescription'
import { useActivityStore } from '@shared/lib/stores/activityStore'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'
import { buildAppAgentSystemBlock } from './appAgent'
import { isHostToolIntent } from '@core/agent/host-tool-intent'

type ChatSettings = ReturnType<typeof useSettingsStore.getState>['settings']
type ConversationContext = {
  messages?: Array<{ createdAt?: number }>
  updatedAt?: number
} | null | undefined

function appendContext(current: string, block: string): string {
  return current ? `${current}\n\n${block}` : block
}

export async function buildChatSystemContext(options: {
  message: string
  hasMediaJob: boolean
  imageContextForText?: string
  attachments?: Attachment[]
  conversation: ConversationContext
  settings: ChatSettings
}): Promise<string> {
  const { message, hasMediaJob, imageContextForText, attachments, conversation, settings } = options
  let extraSystem = ''
  try {
    if (!hasMediaJob && isHostToolIntent(message)) {
      extraSystem = await buildAppAgentSystemBlock()
    } else if (!hasMediaJob) {
      extraSystem = ''
    } else {
      extraSystem =
        'El usuario pidió generar o revisar una imagen. Responde breve en lenguaje natural. ' +
        'NO uses bloques APP_ACTION ni herramientas de Forge/Ollama en este turno. ' +
        (looksLikeIdentityReject(message)
          ? 'El usuario rechazó la imagen anterior porque NO era tu apariencia. ' +
            'No digas "aquí tienes la imagen" hasta que el sistema adjunte una nueva. ' +
            'Disculpate en 1 frase y espera el adjunto real.'
          : '')
    }
    if (imageContextForText) extraSystem = appendContext(extraSystem, imageContextForText)
  } catch {
    /* preserve the existing fail-soft prompt assembly */
  }

  try {
    void ensureVisualDescriptionFromAvatar({ force: false })
  } catch {
    /* background refresh is best-effort */
  }

  if (attachments?.some((attachment) => attachment.mimeType?.startsWith('image/') && attachment.dataUrl)) {
    try {
      const { buildVisionSystemHint } = await import('@core/chat/vision-attach')
      const images = attachments.filter(
        (attachment) => attachment.dataUrl && attachment.mimeType?.startsWith('image/')
      )
      const character = useSettingsStore.getState().settings.character
      const gallery = (character?.visualGallery || []) as Array<{
        label?: string
        scene?: string
        dataUrl?: string
      }>
      const primaryUrl = (character as { visualImageUrl?: string })?.visualImageUrl
      const galleryRefs = [
        ...(primaryUrl
          ? [{ label: 'Principal (chat)', scene: 'avatar principal', primary: true as const }]
          : []),
        ...gallery.map((item) => ({
          label: item.label,
          scene: item.scene,
          primary: false as const
        }))
      ]
      extraSystem = appendContext(
        extraSystem,
        buildVisionSystemHint({
          trimmed: message,
          imageCount: images.length,
          characterName: character?.name,
          visualDescription: character?.visualDescription,
          hasAvatar: Boolean(primaryUrl || gallery.length),
          galleryRefs
        })
      )
    } catch {
      extraSystem = appendContext(
        extraSystem,
        '[VISION] Imagen adjuntada; descríbela con lo que puedas o pide más detalle si no tienes visión activa.'
      )
    }
  }

  try {
    const documentBlock = buildDocumentsBlock(attachments)
    if (documentBlock) extraSystem = appendContext(extraSystem, documentBlock)
  } catch {
    /* preserve chat even when an attachment cannot be parsed */
  }

  try {
    const userMemory = useSettingsStore.getState().settings.userMemory
    if (userMemory?.appearanceNotes) {
      extraSystem = appendContext(
        extraSystem,
        `[APARIENCIA_USUARIO] ${userMemory.appearanceNotes.slice(0, 400)}`
      )
    }
    if (userMemory?.avatarScenes?.length) {
      extraSystem = appendContext(
        extraSystem,
        `[ESCENAS_AVATAR] Escenas/vestuario ya usados: ${userMemory.avatarScenes.slice(-6).join(' · ')}`
      )
    }
  } catch {
    /* optional user-memory context */
  }

  try {
    const messages = conversation?.messages ?? []
    const last = messages.length ? messages[messages.length - 1] : null
    const lastAt =
      last && typeof last.createdAt === 'number'
        ? last.createdAt
        : typeof conversation?.updatedAt === 'number'
          ? conversation.updatedAt
          : 0
    const live = useSettingsStore.getState().settings
    const block = buildTimeAwarenessBlock({
      lastMessageAt: lastAt,
      personality: live.character?.personality,
      style: live.character?.style,
      relationshipRole: live.character?.relationshipRole,
      traits: live.character?.traits,
      tagline: live.character?.tagline,
      characterName: live.character?.name
    })
    if (block) extraSystem = appendContext(extraSystem, block)
  } catch {
    /* optional time-awareness context */
  }

  try {
    const activity = useActivityStore.getState()
    const characterName = settings.character?.name
    const block = activity.extraSystemBlock(characterName)
    if (block) {
      extraSystem = appendContext(extraSystem, block)
      if (activity.mode === 'adventure') activity.noteAdventureMove(message)
    } else if (/\b(aburr|jugamos|juego|ajedrez|aventura|dungeon|dnd)\b/i.test(message)) {
      extraSystem = appendContext(
        extraSystem,
        '# Actividades disponibles\n' +
          'Si encaja con tu personalidad, sugiere jugar y usa enlaces markdown:\n' +
          '- [Ajedrez visual](kawaii-activity://chess)\n' +
          '- [Aventura](kawaii-activity://adventure)\n' +
          'Tú acompañas al usuario (comentarios, voz si pide). Reglas flexibles.'
      )
    }
  } catch {
    /* optional activity context */
  }

  return extraSystem
}
