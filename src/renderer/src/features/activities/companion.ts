import { useActivityStore } from '@shared/lib/stores/activityStore'
import { useChatStore } from '@shared/lib/stores/chatStore'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'
import { generateCompanionLine } from './companionLlm'

export function companionName(): string {
  return useSettingsStore.getState().settings.character?.name || 'Niamh'
}

export function companionAvatar(): string | undefined {
  const c = useSettingsStore.getState().settings.character
  return c?.visualImageUrl || c?.avatarUrl || undefined
}

async function playVoiceResult(r: {
  ok?: boolean
  mediaUrl?: string
  audioDataUrl?: string
  audioUrl?: string
}): Promise<void> {
  if (!r?.ok) return
  const dataUrl =
    r.audioDataUrl ||
    (typeof r.audioUrl === 'string' && r.audioUrl.startsWith('data:') ? r.audioUrl : '')
  const src = r.mediaUrl || dataUrl || ''
  if (!src) return
  try {
    await new Audio(src).play()
  } catch {
    if (dataUrl?.startsWith('data:')) {
      try {
        const res = await fetch(dataUrl)
        const blob = await res.blob()
        const obj = URL.createObjectURL(blob)
        try {
          await new Audio(obj).play()
        } finally {
          URL.revokeObjectURL(obj)
        }
      } catch {
        /* ignore */
      }
    }
  }
}

function speakText(text: string): void {
  const api = window.kawaii
  if (!api || typeof api.voiceSpeak !== 'function') return
  const voiceId =
    useSettingsStore.getState().settings.voiceTtsVoiceId || 'es-MX-DaliaNeural'
  void (async () => {
    try {
      let r = (await api.voiceSpeak({ text: text.slice(0, 500), voiceId })) as {
        ok?: boolean
        error?: string
        mediaUrl?: string
        audioDataUrl?: string
        audioUrl?: string
      }
      if (!r?.ok && /edge-tts|Python|motor|pip/i.test(String(r?.error || ''))) {
        await api.voiceEnsure?.()
        r = (await api.voiceSpeak({ text: text.slice(0, 500), voiceId })) as typeof r
      }
      await playVoiceResult(r || {})
    } catch {
      /* ignore */
    }
  })()
}

/** Fallback only when LLM fails */
export function companionSay(content: string, opts?: { speak?: boolean }) {
  const chat = useChatStore.getState()
  let id = chat.activeId
  if (!id) id = chat.create('Juegos')
  chat.addMessage(id, { role: 'assistant', content })
  if (opts?.speak !== false) {
    const s = useSettingsStore.getState().settings
    const tts = s.voiceTtsActivitiesOnly || s.voiceTtsEnabled !== false
    if (tts) speakText(content)
  }
}

export function openActivity(kind: 'adventure' | 'chess') {
  const store = useActivityStore.getState()
  if (kind === 'chess') store.startChess()
  else store.startAdventure()
  const open = window.kawaii?.activityOpenWindow
  if (typeof open === 'function') void open(kind)

  const name = companionName()
  const title =
    kind === 'chess'
      ? store.chess
        ? 'ajedrez'
        : 'ajedrez'
      : store.adventure?.title || 'aventura'

  void generateCompanionLine(
    kind === 'chess'
      ? `Acabas de abrir el tablero de ajedrez con el usuario. En 2 frases: confirma que JUEGAS tú (negras) de verdad, ` +
        `que puedes charlar y “romper” el ambiente, e invita a mover. Firma en tono de ${name}. ` +
        `Incluye el enlace [Abrir ajedrez](kawaii-activity://chess).`
      : `Acabas de empezar la aventura «${title}» CON el usuario (vas juntos, no solo narras). ` +
        `En 2–3 frases en personaje de ${name}: ánimo, dónde están, pregunta qué hacen. ` +
        `Pueden cambiar el título del relato si el usuario quiere. Incluye [Abrir panel](kawaii-activity://adventure).`,
    { speak: true, asUserVisible: true, timeoutMs: 18_000 }
  ).catch(() => {
    companionSay(
      kind === 'chess'
        ? `¿Jugamos? Yo muevo las negras. [Ajedrez](kawaii-activity://chess)`
        : `Vamos juntos a la aventura. [Aventura](kawaii-activity://adventure)`
    )
  })
}

export function endActivityWithComment(reason: 'stop' | 'window-closed' | 'user-closed' = 'stop') {
  const store = useActivityStore.getState()
  const mode = store.mode
  const adventureTitle = store.adventure?.title
  const chessActive = mode === 'chess'
  // Close activity BrowserWindows so "Cerrar/Salir" actually works
  try {
    void window.kawaii?.activityCloseAllWindows?.()
  } catch {
    /* ignore */
  }
  store.stop()
  if (mode === 'none') return
  const label = chessActive ? 'ajedrez' : adventureTitle || 'aventura'
  const name = companionName()
  void generateCompanionLine(
    reason === 'window-closed' || reason === 'user-closed'
      ? `El usuario acaba de cerrar la ventana de ${label}. Eres ${name}. ` +
        `En 2 frases: comenta algo concreto de lo que jugaron (no genérico), cómo te sentiste, ` +
        `y ofrece seguir charlando o volver. Enlaces opcionales [Ajedrez](kawaii-activity://chess) · [Aventura](kawaii-activity://adventure).`
      : `Acaban de terminar «${label}». Eres ${name}. Despedida corta y cálida ligada a esa partida, ` +
        `y ofrece otra actividad o charla. [Ajedrez](kawaii-activity://chess) · [Aventura](kawaii-activity://adventure).`,
    { speak: true, asUserVisible: true, timeoutMs: 20_000 }
  ).catch(() => {
    companionSay(`Cerramos ${label}. Cuando quieras retomar, aquí estoy.`, { speak: true })
  })
}

export function suggestActivityMarkdown(): string {
  const vibe = (useSettingsStore.getState().settings.character?.vibe || '').toLowerCase()
  const name = companionName()
  if (/juguet|divert|aventur|caos/.test(vibe)) {
    return `¿Exploramos? [aventura](kawaii-activity://adventure) o [ajedrez](kawaii-activity://chess) — yo, ${name}, voy contigo.`
  }
  return `Si te apetece: [ajedrez](kawaii-activity://chess) o [aventura](kawaii-activity://adventure).`
}

/** User renames adventure */
export function renameAdventure(title: string) {
  const store = useActivityStore.getState()
  if (!store.adventure) return
  useActivityStore.setState({
    adventure: { ...store.adventure, title: title.trim().slice(0, 80) || store.adventure.title }
  })
}
