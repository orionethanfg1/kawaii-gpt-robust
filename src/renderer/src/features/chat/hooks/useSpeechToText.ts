/**
 * Push-to-talk STT via Web Speech API (Chromium / Electron).
 * Best practices: user-gesture start, interim results, clean abort on unmount,
 * no auto-send (caller decides).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  STT_DEFAULT_LANG,
  classifySttError,
  isSpeechRecognitionSupported,
  sttErrorMessageEs,
  type SttStatus
} from '@core/voice/stt'

type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((ev: {
    resultIndex: number
    results: ArrayLike<{
      isFinal: boolean
      0: { transcript: string }
    }>
  }) => void) | null
  onerror: ((ev: { error?: string }) => void) | null
  onend: (() => void) | null
}

function createRecognition(lang: string): SpeechRecognitionLike | null {
  const g = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike
    webkitSpeechRecognition?: new () => SpeechRecognitionLike
  }
  const Ctor = g.SpeechRecognition || g.webkitSpeechRecognition
  if (!Ctor) return null
  const rec = new Ctor()
  rec.lang = lang || STT_DEFAULT_LANG
  rec.continuous = false
  rec.interimResults = true
  rec.maxAlternatives = 1
  return rec
}

export function useSpeechToText(opts?: {
  lang?: string
  /** Append or replace transcript into the text field */
  onTranscript?: (text: string, isFinal: boolean) => void
}) {
  const [status, setStatus] = useState<SttStatus>(() =>
    typeof window !== 'undefined' && isSpeechRecognitionSupported()
      ? 'idle'
      : 'unsupported'
  )
  const [error, setError] = useState<string | null>(null)
  const [interim, setInterim] = useState('')
  const recRef = useRef<SpeechRecognitionLike | null>(null)
  const onTranscriptRef = useRef(opts?.onTranscript)
  onTranscriptRef.current = opts?.onTranscript
  const lang = opts?.lang || STT_DEFAULT_LANG

  useEffect(() => {
    return () => {
      try {
        recRef.current?.abort()
      } catch {
        /* */
      }
      recRef.current = null
    }
  }, [])

  const stop = useCallback(() => {
    try {
      recRef.current?.stop()
    } catch {
      try {
        recRef.current?.abort()
      } catch {
        /* */
      }
    }
    setStatus((s) => (s === 'listening' ? 'idle' : s))
  }, [])

  const start = useCallback(() => {
    setError(null)
    setInterim('')
    if (!isSpeechRecognitionSupported()) {
      setStatus('unsupported')
      setError(sttErrorMessageEs('unsupported'))
      return
    }
    try {
      recRef.current?.abort()
    } catch {
      /* */
    }
    const rec = createRecognition(lang)
    if (!rec) {
      setStatus('unsupported')
      setError(sttErrorMessageEs('unsupported'))
      return
    }
    recRef.current = rec
    rec.onresult = (ev) => {
      let finalPiece = ''
      let interimPiece = ''
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const row = ev.results[i]
        const t = row?.[0]?.transcript || ''
        if (row.isFinal) finalPiece += t
        else interimPiece += t
      }
      if (interimPiece) setInterim(interimPiece)
      if (finalPiece) {
        setInterim('')
        onTranscriptRef.current?.(finalPiece.trim(), true)
      } else if (interimPiece) {
        onTranscriptRef.current?.(interimPiece.trim(), false)
      }
    }
    rec.onerror = (ev) => {
      const kind = classifySttError(ev.error)
      if (kind === 'aborted') {
        setStatus('idle')
        return
      }
      setError(sttErrorMessageEs(kind))
      setStatus('error')
    }
    rec.onend = () => {
      setStatus((s) => (s === 'listening' ? 'idle' : s))
      setInterim('')
    }
    try {
      rec.start()
      setStatus('listening')
    } catch (e) {
      setStatus('error')
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [lang])

  const toggle = useCallback(() => {
    if (status === 'listening') stop()
    else start()
  }, [status, start, stop])

  return {
    status,
    error,
    interim,
    supported: status !== 'unsupported',
    start,
    stop,
    toggle
  }
}
