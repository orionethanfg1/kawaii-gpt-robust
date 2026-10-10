/**
 * LLM lines for mini-games. Keeps a single in-flight request + one audio pipeline
 * so voice always matches the text on screen (no overlapping "two adventures").
 */
import { sendChatMessage } from '@features/chat/services/chatOrchestrator'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'
import { useChatStore } from '@shared/lib/stores/chatStore'
import { companionName } from './companion'
import type { ChatMessage } from '@core/providers'

let genSeq = 0
let audioSeq = 0
let currentAudio: HTMLAudioElement | null = null

function stopAudio() {
  try {
    currentAudio?.pause()
    currentAudio = null
  } catch {
    /* ignore */
  }
  try {
    void window.kawaii?.voiceStop?.()
  } catch {
    /* ignore */
  }
}

/** Strip TITULO/LUGAR labels so TTS never reads the scaffold. */
export function textForSpeech(raw: string): string {
  let t = (raw || '').trim()
  t = t.replace(/^TITULO:\s*.+$/gim, '')
  t = t.replace(/^LUGAR:\s*.+$/gim, '')
  t = t.replace(/^INTRO:\s*/gim, '')
  t = t.replace(/^MOVE:\s*.+$/gim, '')
  t = t.replace(/^DICE:\s*/gim, '')
  t = t.replace(/\n{2,}/g, '\n').trim()
  // Drop numbered choice lines from speech (user already sees checkboxes)
  t = t
    .split('\n')
    .filter((line) => !/^\s*\d+[\).:-]\s+/.test(line))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  return t.slice(0, 480)
}

async function playVoice(text: string, voiceId: string): Promise<void> {
  const my = ++audioSeq
  stopAudio()
  const speakText = textForSpeech(text)
  if (!speakText || speakText.length < 3) return

  let r = await window.kawaii?.voiceSpeak?.({ text: speakText, voiceId })
  if (my !== audioSeq) return
  if (!r?.ok && /edge-tts|Python|motor de voz|pip install/i.test(String(r?.error || ''))) {
    const ens = await window.kawaii?.voiceEnsure?.()
    if (my !== audioSeq) return
    if (ens?.ok) {
      r = await window.kawaii?.voiceSpeak?.({ text: speakText, voiceId })
    }
  }
  if (my !== audioSeq || !r?.ok) return

  const mediaUrl = (r as { mediaUrl?: string }).mediaUrl
  const dataUrl =
    (r as { audioDataUrl?: string }).audioDataUrl ||
    (typeof (r as { audioUrl?: string }).audioUrl === 'string' &&
    (r as { audioUrl: string }).audioUrl.startsWith('data:')
      ? (r as { audioUrl: string }).audioUrl
      : '')
  const src = mediaUrl || dataUrl || ''
  if (!src) return

  const audio = new Audio(src)
  currentAudio = audio
  try {
    await audio.play()
    await new Promise<void>((resolve) => {
      audio.onended = () => resolve()
      audio.onerror = () => resolve()
    })
  } catch {
    if (dataUrl?.startsWith('data:') && my === audioSeq) {
      try {
        const res = await fetch(dataUrl)
        const blob = await res.blob()
        const obj = URL.createObjectURL(blob)
        const a2 = new Audio(obj)
        currentAudio = a2
        try {
          await a2.play()
          await new Promise<void>((resolve) => {
            a2.onended = () => resolve()
            a2.onerror = () => resolve()
          })
        } finally {
          URL.revokeObjectURL(obj)
        }
      } catch {
        /* ignore */
      }
    }
  } finally {
    if (currentAudio === audio) currentAudio = null
  }
}

export type CompanionLineOpts = {
  speak?: boolean
  /** Explicit text to TTS (defaults to cleaned model reply) */
  speakText?: string
  asUserVisible?: boolean
  /** Prior scene turns so the model continues THE SAME adventure */
  sceneHistory?: ChatMessage[]
  /** Hard timeout ms (default 28s for snappier games) */
  timeoutMs?: number
  /** Abort signal from UI */
  signal?: AbortSignal
}

/**
 * Generate one companion line. Cancels logical "generation id" for stale replies
 * (caller should still ignore late results if busy flag flipped).
 */
export async function generateCompanionLine(
  instruction: string,
  opts?: CompanionLineOpts
): Promise<string> {
  const myGen = ++genSeq
  const settings = useSettingsStore.getState().settings
  const name = companionName()
  let text = ''
  const controller = new AbortController()
  const timeoutMs = opts?.timeoutMs ?? 28_000
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
  const onAbort = () => controller.abort()
  opts?.signal?.addEventListener('abort', onAbort)

  // Lean system: identity + stay in the SAME scene (no random new plots)
  const extraSystem = [
    `# Rol`,
    `Eres ${name}. Hablas en español, en personaje, 2–5 frases.`,
    `IMPORTANTE: Continúa la escena ya abierta. NO inventes un título nuevo ni reinicies la historia.`,
    `Si hay historial de escena, respeta lugar, objetivo y hechos previos.`,
    `Al final, si ofreces acciones, numéralas exactamente:`,
    `1. …`,
    `2. …`,
    `3. …`,
    `Sin markdown de código ni meta-comentarios.`
  ].join('\n')

  try {
    await sendChatMessage({
      settings: {
        ...settings,
        // Faster path for games
        webSearchEnabled: false,
        streaming: true,
        temperature: Math.min(settings.temperature ?? 0.7, 0.75),
        localMaxTokens: Math.min(settings.localMaxTokens || 2048, 512),
        cloudMaxTokens: Math.min(settings.cloudMaxTokens || 4096, 512)
      },
      userContent: instruction,
      history: opts?.sceneHistory || [],
      signal: controller.signal,
      extraSystem,
      callbacks: {
        onToken: (t) => {
          if (myGen !== genSeq) return
          if (t.startsWith(text)) text = t
          else text += t
        },
        onRoute: () => {},
        onDone: () => {},
        onError: () => {}
      }
    })
  } catch {
    if (myGen === genSeq) {
      text = text || `…(${name} se queda pensativa un segundo)`
    }
  } finally {
    window.clearTimeout(timeout)
    opts?.signal?.removeEventListener('abort', onAbort)
  }

  if (myGen !== genSeq) {
    return text.trim() || ''
  }

  text = text.trim() || `Estoy contigo.`

  if (opts?.asUserVisible === true) {
    const chat = useChatStore.getState()
    let id = chat.activeId
    if (!id) id = chat.create('Juegos')
    chat.addMessage(id, { role: 'assistant', content: text })
  }

  const activitiesOnly = Boolean(settings.voiceTtsActivitiesOnly)
  const allowSpeak =
    opts?.speak !== false &&
    (activitiesOnly || settings.voiceTtsEnabled !== false)

  if (allowSpeak && myGen === genSeq) {
    const voiceId = settings.voiceTtsVoiceId || 'es-MX-DaliaNeural'
    const toSpeak = opts?.speakText ?? text
    void playVoice(toSpeak, voiceId)
  }

  return text
}

/** Ask model for a UCI move; comment must refer to THIS board state. */
export async function askModelChessMove(
  fen: string,
  legalUci: string[],
  lastUserUci: string
): Promise<{ uci: string | null; comment: string }> {
  const settings = useSettingsStore.getState().settings
  const name = companionName()
  const sample = legalUci.slice(0, 40).join(', ')
  let text = ''
  try {
    await sendChatMessage({
      settings: {
        ...settings,
        webSearchEnabled: false,
        streaming: true,
        localMaxTokens: Math.min(settings.localMaxTokens || 2048, 256),
        cloudMaxTokens: Math.min(settings.cloudMaxTokens || 4096, 256)
      },
      userContent:
        `Partida de ajedrez en curso (NO inventes otra). FEN: ${fen}\n` +
        `El usuario jugó: ${lastUserUci || '(apertura)'}\n` +
        `Jugadas legales (UCI): ${sample}\n` +
        `Responde en 2 líneas exactamente:\n` +
        `MOVE: <uci de la lista>\n` +
        `DICE: <una frase de ${name} sobre ESTA jugada en el tablero>`,
      history: [],
      extraSystem: `Eres ${name} jugando negras en esta partida. MOVE debe ser una UCI de la lista. No inventes partidas distintas.`,
      callbacks: {
        onToken: (t) => {
          if (t.startsWith(text)) text = t
          else text += t
        },
        onRoute: () => {},
        onDone: () => {},
        onError: () => {}
      }
    })
  } catch {
    return { uci: null, comment: '' }
  }
  const moveM = text.match(/MOVE:\s*([a-h][1-8][a-h][1-8][qrbn]?)/i)
  const diceM = text.match(/DICE:\s*(.+)/i)
  let uci = moveM ? moveM[1].toLowerCase() : null
  if (uci && !legalUci.includes(uci)) {
    const hit = legalUci.find((u) => u.startsWith(uci!.slice(0, 4)))
    uci = hit || null
  }
  const comment = (diceM?.[1] || '').trim().slice(0, 280)
  return { uci, comment }
}

export function cancelCompanionSpeech() {
  audioSeq += 1
  stopAudio()
}


/** Speak arbitrary on-screen text (no new LLM call). Cancels prior audio. */
export async function speakCompanionText(text: string): Promise<void> {
  const settings = useSettingsStore.getState().settings
  const activitiesOnly = Boolean(settings.voiceTtsActivitiesOnly)
  const allow = activitiesOnly || settings.voiceTtsEnabled !== false
  if (!allow) return
  const voiceId = settings.voiceTtsVoiceId || 'es-MX-DaliaNeural'
  await playVoice(text, voiceId)
}
