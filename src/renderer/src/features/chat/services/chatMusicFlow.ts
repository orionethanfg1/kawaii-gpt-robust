/**
 * ACE-Step music generation handoff from chat (extracted from useChat).
 */
import { useSettingsStore } from '@shared/lib/stores/settingsStore'
import type { Attachment } from '@core/conversation'

export type ChatMusicFlowDeps = {
  trimmed: string
  hasAtt: boolean
  attachments?: Attachment[]
  activeId: string | null
  create: () => string
  addMessage: (
    convId: string,
    msg: {
      role: 'user' | 'assistant'
      content: string
      isStreaming?: boolean
      attachments?: Attachment[]
      meta?: Record<string, unknown>
    }
  ) => string
  updateMessage: (
    convId: string,
    msgId: string,
    patch: {
      content?: string
      isStreaming?: boolean
      attachments?: Attachment[]
      meta?: Record<string, unknown>
    }
  ) => void
  armLoading: () => void
  clearLoading: () => void
  setError: (e: string | null) => void
  setPhase: (phase: 'generating' | string, route: null) => void
  musicGenEnabled?: boolean
  req: {
    prompt?: string
    stylePrompt?: string
    lyrics?: string
  }
}

export async function runChatMusicFlow(deps: ChatMusicFlowDeps): Promise<void> {
  const {
    trimmed,
    hasAtt,
    attachments,
    create,
    addMessage,
    updateMessage,
    armLoading,
    clearLoading,
    setError,
    setPhase,
    req
  } = deps

  let convId = deps.activeId
  if (!convId) convId = create()
  addMessage(convId, {
    role: 'user',
    content: trimmed || '📷',
    attachments: hasAtt ? attachments : undefined
  })
  const assistantId = addMessage(convId, {
    role: 'assistant',
    content: 'Preparando motor de música (ACE-Step)…',
    isStreaming: true
  })
  armLoading()
  setError(null)
  setPhase('generating', null)

  const prompt = String(req.stylePrompt || req.prompt || trimmed).trim()
  const lyrics = String(req.lyrics || '').trim()

  try {
    if (!deps.musicGenEnabled) {
      try {
        useSettingsStore.getState().update({ musicGenEnabled: true })
      } catch {
        /* ignore */
      }
    }
    const gen = await window.kawaii.musicGenerate?.({
      prompt,
      lyrics: lyrics || undefined,
      durationSec: 60,
      vocalLanguage: 'es'
    })
    if (!gen?.ok) {
      throw new Error(gen?.error || 'No se pudo generar la pista')
    }
    const pathLabel = String(
      (gen as { path?: string; audioPath?: string }).path ||
        (gen as { audioPath?: string }).audioPath ||
        ''
    ).trim()
    let dataUrl: string | undefined
    if (pathLabel && window.kawaii?.filesToDataUrl) {
      try {
        const emb = await window.kawaii.filesToDataUrl(pathLabel)
        if (emb?.ok && emb.dataUrl) dataUrl = emb.dataUrl
      } catch {
        /* ignore */
      }
    }
    const att = pathLabel
      ? [
          {
            id: `music_${Date.now()}`,
            name: pathLabel.split(/[/\\]/).pop() || 'track.mp3',
            mimeType: pathLabel.toLowerCase().endsWith('.wav')
              ? 'audio/wav'
              : 'audio/mpeg',
            sizeBytes: 0,
            filePath: pathLabel,
            dataUrl
          }
        ]
      : undefined
    updateMessage(convId, assistantId, {
      content:
        'Listo — pista generada con ACE-Step. Repródúcela abajo o abre la carpeta.' +
        (pathLabel ? `\n\n📁 \`${pathLabel}\`` : ''),
      isStreaming: false,
      attachments: att,
      meta: {
        musicPath: pathLabel || undefined,
        musicTaskId: gen.taskId,
        modality: 'music'
      }
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    updateMessage(convId, assistantId, {
      content: `Error al generar música: ${msg}`,
      isStreaming: false,
      meta: { isError: true }
    })
    setError(msg)
  } finally {
    clearLoading()
  }
}
