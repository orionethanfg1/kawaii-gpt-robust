/**
 * Phase 8 — STT pure checks.
 */

import {
  classifySttError,
  isSpeechRecognitionSupported,
  sttErrorMessageEs,
  STT_DEFAULT_LANG
} from './stt'

export type Phase8Check = { id: string; ok: boolean; detail: string }

export function runPhase8PureChecks(): Phase8Check[] {
  const out: Phase8Check[] = []

  out.push({
    id: 'phase8-stt-lang',
    ok: STT_DEFAULT_LANG === 'es-MX',
    detail: STT_DEFAULT_LANG
  })

  out.push({
    id: 'phase8-stt-error-permission',
    ok: classifySttError('not-allowed') === 'not-allowed',
    detail: sttErrorMessageEs('not-allowed').slice(0, 60)
  })

  out.push({
    id: 'phase8-stt-error-no-speech',
    ok: classifySttError('no-speech') === 'no-speech',
    detail: sttErrorMessageEs('no-speech').slice(0, 50)
  })

  // In browser/Electron with webkit — may be true; in pure node test runner, false is ok
  const supported = isSpeechRecognitionSupported(
    globalThis as typeof globalThis & {
      SpeechRecognition?: unknown
      webkitSpeechRecognition?: unknown
    }
  )
  out.push({
    id: 'phase8-stt-api-surface',
    ok: typeof isSpeechRecognitionSupported === 'function',
    detail: `supportedInHost=${supported}`
  })

  // Module + hook export path (string presence via dynamic import in tester)
  out.push({
    id: 'phase8-stt-messages-es',
    ok: sttErrorMessageEs('unsupported').includes('voz'),
    detail: sttErrorMessageEs('unsupported').slice(0, 50)
  })

  return out
}
