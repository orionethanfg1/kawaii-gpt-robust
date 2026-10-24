/**
 * STT (speech-to-text) — contract + pure helpers.
 * Runtime: Web Speech API in the renderer (Chromium). No cloud key required.
 * Future: optional local Whisper without changing this surface.
 */

export type SttStatus = 'unsupported' | 'idle' | 'listening' | 'error'

export type SttResult = {
  transcript: string
  isFinal: boolean
}

export type SttErrorKind =
  | 'unsupported'
  | 'not-allowed'
  | 'no-speech'
  | 'network'
  | 'aborted'
  | 'unknown'

export function classifySttError(error: string | undefined): SttErrorKind {
  const e = String(error || '').toLowerCase()
  if (/not-allowed|permission|denied/i.test(e)) return 'not-allowed'
  if (/no-speech/i.test(e)) return 'no-speech'
  if (/network/i.test(e)) return 'network'
  if (/aborted/i.test(e)) return 'aborted'
  if (/not.supported|unsupported/i.test(e)) return 'unsupported'
  return 'unknown'
}

export function sttErrorMessageEs(kind: SttErrorKind): string {
  switch (kind) {
    case 'unsupported':
      return 'Este entorno no soporta dictado por voz (Web Speech).'
    case 'not-allowed':
      return 'Permiso de micrófono denegado. Actívalo en el sistema o en el diálogo del navegador.'
    case 'no-speech':
      return 'No se detectó voz. Intenta de nuevo cerca del micrófono.'
    case 'network':
      return 'El reconocimiento de voz necesita red en este motor. Comprueba la conexión.'
    case 'aborted':
      return 'Dictado cancelado.'
    default:
      return 'No se pudo completar el dictado.'
  }
}

/** Preferred locale for LATAM companion app */
export const STT_DEFAULT_LANG = 'es-MX'

export function isSpeechRecognitionSupported(
  g: typeof globalThis & {
    SpeechRecognition?: unknown
    webkitSpeechRecognition?: unknown
  } = globalThis as never
): boolean {
  return Boolean(g.SpeechRecognition || g.webkitSpeechRecognition)
}
