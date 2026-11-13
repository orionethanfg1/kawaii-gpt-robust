/**
 * Stream / continue helpers (X3 deflate) — pure where possible.
 */
import {
  stripThinkingLeak,
  looksLikeStructuredReasoningDump
} from '@core/chat/strip-thinking'
import { stripWhileStreaming } from './chatPostProcess'

export type AppContinueKind = 'app-continue' | 'app-doc-continue' | 'app-agent' | 'other'

export function detectAppContinueKind(
  metaKind: string | undefined,
  text: string
): AppContinueKind | null {
  const mk = String(metaKind || '')
  const t = String(text || '').trim()
  if (mk === 'app-continue') return 'app-continue'
  if (mk === 'app-doc-continue') return 'app-doc-continue'
  if (mk === 'app-agent') return 'app-agent'
  if (/^\[APP\]/i.test(t)) {
    if (/lectura del documento/i.test(t)) return 'app-doc-continue'
    if (/continuar la respuesta|continúa el mismo hilo|Final visible previo/i.test(t))
      return 'app-continue'
    return 'app-agent'
  }
  return null
}

export type ContinueTurnTexts = {
  turnUserText: string
  turnExtraSystem: string
}

const DOC_APP_SYS =
  /lectura del documento|continuar la lectura|MAP-REDUCE LECTURA|es lectura de archivo|documento adjunto/i

/**
 * When continuing *writing* (not doc), collapse repeated APP doc-continue system
 * turns so the model does not re-enter progressive reading mid-chat.
 */
export function sanitizeMessagesForWriteContinue<
  T extends { role?: string; content?: string }
>(messages: T[]): T[] {
  if (!messages?.length) return messages
  let keptDocSys = 0
  const out: T[] = []
  for (const m of messages) {
    const role = String(m.role || '')
    const content = String(m.content || '')
    if (role === 'system' && DOC_APP_SYS.test(content)) {
      keptDocSys += 1
      // Keep at most one short marker so the model knows a book existed, not full chain
      if (keptDocSys > 1) continue
      out.push({
        ...m,
        content:
          '[INSTRUCCIÓN DE LA APP] Hubo lectura de archivo más arriba en el hilo. ' +
          'Este turno es CONTINUAR ESCRITURA de la última respuesta visible, no el siguiente capítulo. ' +
          'No avances la lectura salvo que el texto cortado fuera claramente un comentario de lectura incompleto.'
      } as T)
      continue
    }
    out.push(m)
  }
  return out
}

/** Build system + stand-in user text for APP continue / doc continue. */
export function buildAppContinueTurnTexts(
  kind: AppContinueKind,
  rawInstr: string
): ContinueTurnTexts {
  const instr = String(rawInstr || '').replace(/^\[APP\]\s*/i, '').trim()
  if (kind === 'app-continue') {
    return {
      turnExtraSystem:
        '[INSTRUCCIÓN DE LA APP — no es un mensaje del usuario]\n' +
        (instr ||
          'El usuario pidió continuar la respuesta porque se cortó.\n' +
            'Continúa el mismo hilo desde donde te quedaste.') +
        '\n\nReglas estrictas de continuidad (obligatorias):\n' +
        '- Tu salida debe leerse como UNA sola respuesta continua: si pegas lo nuevo al final del texto ya escrito, la unión tiene que ser gramatical y natural.\n' +
        '- PRIORIDAD 1: si la última frase quedó a medias (coma, puntos suspensivos, «…», sin punto final, palabra cortada), COMPLÉTACELA antes de abrir un párrafo nuevo.\n' +
        '- NO saltes palabras ni dejes uniones rotas del tipo «enredada,… tienen» (falta el sujeto o el verbo de enlace).\n' +
        '- NO repitas párrafos ni frases ya presentes en «FINAL YA ESCRITO».\n' +
        '- NO reinicies el tema, NO resumas lo anterior, NO digas que esperas o que te quedas en silencio.\n' +
        '- Misma voz y tono del último mensaje visible.\n' +
        '- PROHIBIDO retomar lectura de archivo, capítulos, extractos o «continuar la lectura» salvo que el texto cortado fuera claramente un comentario de lectura a medias.\n' +
        '- PROHIBIDO abrir o forzar narración física / formato de escena (rayas —…—) solo porque el historial tenga tramos de lectura o cariño.\n' +
        '- Si el hilo era conversación cercana, completa en diálogo natural, sin libro ni guion.',
      turnUserText:
        '(Continúa pegado al último carácter de tu respuesta anterior. Primero cierra cualquier frase incompleta; luego sigue el mismo hilo, sin reiniciar y sin cambiar a lectura de documento.)'
    }
  }
  if (kind === 'app-doc-continue') {
    return {
      turnExtraSystem:
        '[INSTRUCCIÓN DE LA APP — no es un mensaje del usuario]\n' +
        (instr || 'Continúa la lectura del documento adjunto.') +
        '\nNo inventes un mensaje del usuario; actúa como lectora del archivo. ' +
        'Esto NO es escena íntima: es lectura de archivo. No mezcles abrazos/besos con el siguiente tramo salvo que el usuario lo pida en el mismo mensaje.',
      turnUserText:
        '(La app solicita continuar la lectura del documento adjunto. Resume el siguiente tramo y opina; no reinicies una escena íntima.)'
    }
  }
  return {
    turnExtraSystem:
      '[INSTRUCCIÓN DE LA APP — no es un mensaje del usuario]\n' + (instr || 'Acción interna de la app.'),
    turnUserText: '(Instrucción de la aplicación en curso.)'
  }
}

export type VisibleThinkingSplit = {
  visible: string
  thinkingExtra: string
}

/** Split model output into user-visible text and thinking dump. */
export function splitVisibleAndThinking(raw: string): VisibleThinkingSplit {
  const best = String(raw || '')
  if (!best.trim()) return { visible: '', thinkingExtra: '' }
  let visible = stripWhileStreaming(best)
  let thinkingExtra = ''
  try {
    if (looksLikeStructuredReasoningDump(best) || looksLikeStructuredReasoningDump(visible)) {
      thinkingExtra = best
      visible = stripThinkingLeak(best).trim()
    } else {
      const cleaned = stripThinkingLeak(visible)
      if (cleaned.length < visible.length && visible.length > 40) {
        const approxRemoved = visible
          .split(/\n\n+/)
          .filter((para) => {
            const c = stripThinkingLeak(para)
            return c.length < para.length * 0.85
          })
          .join('\n\n')
          .trim()
        if (approxRemoved.length > 20) thinkingExtra = approxRemoved
        else if (cleaned.length < visible.length * 0.85) thinkingExtra = visible.slice(0, 8000)
        visible = cleaned || visible
      } else {
        visible = cleaned || visible
      }
    }
  } catch {
    /* keep */
  }
  try {
    // dynamic to avoid hard dep cycles in tests
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { preserveMdBreaks } = require('@core/chat/normalize-markdown') as {
      preserveMdBreaks: (s: string) => string
    }
    visible = preserveMdBreaks(visible)
  } catch {
    /* */
  }
  return { visible, thinkingExtra }
}
