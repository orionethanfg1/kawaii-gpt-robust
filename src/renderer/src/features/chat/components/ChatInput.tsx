import { useEffect } from 'react'
import { useRef, useState, KeyboardEvent } from 'react'
import { Send, Square, Smile, ImagePlus, Paperclip, X, FileText, Brain, Mic, MicOff, Bold, Italic, List } from 'lucide-react'
import { Button } from '@shared/ui/Button'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'
import { useChatStore } from '@shared/lib/stores/chatStore'
import { getDocReadingStatesForConv } from '../services/documentReadingStore'
import type { Attachment } from '@core/conversation'
import { isTextDocumentFile, isUnsupportedOfficeFile, isOfficeExtractable, MAX_FILE_BYTES, MAX_OFFICE_BYTES } from '@core/chat/document-attach'
import { useSpeechToText } from '../hooks/useSpeechToText'
import { wrapMarkdownSelection } from '@core/chat/normalize-markdown'
import {
  applySpanishAutocorrectLight,
  applySuggestion,
  suggestSpanishAutocorrect,
  type AutocorrectSuggestion
} from '@core/text/es-autocorrect'
// office check via document-attach

const EMOJI_SET = [
  '😀', '😂', '🥹', '😊', '😍', '🥰', '😘', '😏', '🥺', '😢',
  '😭', '😡', '🤔', '😎', '🙄', '😴', '❤️', '💕', '🔥', '✨',
  '👍', '👎', '🙏', '🤝', '💔', '😳', '🫣', '🎉', '🌹', '☕'
]

interface Props {
  disabled?: boolean
  isLoading?: boolean
  onSend: (
    text: string,
    attachments?: Attachment[],
    opts?: { meta?: Record<string, unknown> }
  ) => void
  onStop?: () => void
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result || ''))
    r.onerror = () => reject(new Error('read failed'))
    r.readAsDataURL(file)
  })
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result || ''))
    r.onerror = () => reject(new Error('read failed'))
    r.readAsText(file, 'UTF-8')
  })
}

export function ChatInput({ disabled, isLoading, onSend, onStop }: Props) {
  const thinkMode = useSettingsStore((s) => (s.settings as { thinkMode?: string }).thinkMode || 'off')
  const updateSettings = useSettingsStore((s) => s.update)
  const cycleThink = () => {
    const next = thinkMode === 'off' ? 'on' : thinkMode === 'on' ? 'auto' : 'off'
    updateSettings({ thinkMode: next } as never)
  }
  const [value, setValue] = useState('')
  const [acSuggestions, setAcSuggestions] = useState<AutocorrectSuggestion[]>([])
  const stt = useSpeechToText({
    lang: 'es-MX',
    onTranscript: (text, isFinal) => {
      if (!text || !isFinal) return
      setValue((prev) => {
        const base = prev.replace(/\s*…[^…]*$/u, '').trim()
        return base ? `${base} ${text}` : text
      })
    }
  })
  useEffect(() => {
    const h = (ev: Event) => {
      const text = (ev as CustomEvent<{ text?: string }>).detail?.text
      if (text) setValue(text)
    }
    window.addEventListener('kawaii:prefill-chat', h)
    return () => window.removeEventListener('kawaii:prefill-chat', h)
  }, [])

  const [showEmoji, setShowEmoji] = useState(false)
  const [pending, setPending] = useState<Attachment[]>([])
  const activeId = useChatStore((st) => st.activeId)
  const [canContinueReading, setCanContinueReading] = useState(false)
  const [docAutoPaused, setDocAutoPaused] = useState(false)

  useEffect(() => {
    if (!activeId) {
      setDocAutoPaused(false)
      return
    }
    const sync = () => {
      try {
        setDocAutoPaused(sessionStorage.getItem('kawaii-doc-auto-paused:' + activeId) === '1')
      } catch {
        setDocAutoPaused(false)
      }
    }
    sync()
    const onP = () => sync()
    window.addEventListener('kawaii:doc-auto-paused', onP)
    const t = window.setInterval(sync, 2000)
    return () => {
      window.removeEventListener('kawaii:doc-auto-paused', onP)
      clearInterval(t)
    }
  }, [activeId, isLoading])

  useEffect(() => {
    if (!activeId) {
      setCanContinueReading(false)
      return
    }
    try {
      const states = getDocReadingStatesForConv(activeId)
      const open = states.some((x) => {
        const rem = x as {
          mode?: string
          ingestComplete?: boolean
          streamOffset?: number
          totalChars?: number
        }
        if (rem.mode === 'read_and_remember' || rem.ingestComplete) return false
        const off = Number(rem.streamOffset || 0)
        const total = Number(rem.totalChars || x.totalChars || 0)
        if (total > 2000 && off > 0 && off < total * 0.98) return true
        return (
          x.chapterCount >= 1 &&
          x.chapterIndex < x.chapterCount &&
          (x.totalChars > 800 || x.chapterCount > 1)
        )
      })
      setCanContinueReading(open)
    } catch {
      setCanContinueReading(false)
    }
  }, [activeId, value, isLoading])
  const imageRef = useRef<HTMLInputElement>(null)
  const docRef = useRef<HTMLInputElement>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)

  const applyFormat = (marker: '*' | '**') => {
    const el = textRef.current
    const start = el?.selectionStart ?? value.length
    const end = el?.selectionEnd ?? value.length
    const r = wrapMarkdownSelection(value, start, end, marker)
    setValue(r.text)
    requestAnimationFrame(() => {
      const t = textRef.current
      if (!t) return
      t.focus()
      t.setSelectionRange(r.selStart, r.selEnd)
    })
  }

  const applyList = () => {
    const el = textRef.current
    const start = el?.selectionStart ?? 0
    const end = el?.selectionEnd ?? 0
    const selected = value.slice(start, end) || ''
    if (selected.includes('\n')) {
      const listed = selected
        .split('\n')
        .map((line) => {
          const t = line.trim()
          if (!t) return line
          if (/^[-*]\s/.test(t)) return line
          return `- ${t}`
        })
        .join('\n')
      setValue(value.slice(0, start) + listed + value.slice(end))
    } else {
      const lineStart = value.lastIndexOf('\n', start - 1) + 1
      const prefix = value.slice(lineStart, start)
      if (/^\s*[-*]\s/.test(prefix + value.slice(start, end))) return
      setValue(value.slice(0, lineStart) + '- ' + value.slice(lineStart))
    }
    requestAnimationFrame(() => textRef.current?.focus())
  }

  const submit = () => {
    const corrected = applySpanishAutocorrectLight(value).trim()
    const t = corrected
    if ((!t && pending.length === 0) || disabled || isLoading) return
    const placeholder =
      pending.some((p) => p.mimeType?.startsWith('image/')) &&
      !pending.some((p) => p.textContent)
        ? '📷'
        : pending.some((p) => p.textContent)
          ? '📎 Archivo adjunto'
          : ''
    onSend(t || placeholder, pending.length ? pending : undefined)
    setValue('')
    setAcSuggestions([])
    setPending([])
    setShowEmoji(false)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  const addEmoji = (em: string) => setValue((v) => v + em)

  const onPickImages = async (files: FileList | null) => {
    if (!files?.length) return
    const next: Attachment[] = []
    const skipped: string[] = []
    for (const f of Array.from(files).slice(0, 4)) {
      const isImg =
        f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(f.name)
      if (!isImg) {
        skipped.push(`${f.name} (no es imagen)`)
        continue
      }
      if (f.size > 12 * 1024 * 1024) {
        skipped.push(`${f.name} (>12 MB)`)
        continue
      }
      try {
        let dataUrl = await readFileAsDataUrl(f)
        try {
          const { compressDataUrlForVision } = await import('@core/chat/vision-attach')
          dataUrl = await compressDataUrlForVision(dataUrl)
        } catch {
          /* keep original */
        }
        next.push({
          id: `att_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
          name: f.name,
          mimeType: f.type || 'image/jpeg',
          sizeBytes: f.size,
          dataUrl
        })
      } catch {
        skipped.push(`${f.name} (no se pudo leer)`)
      }
    }
    if (next.length) setPending((p) => [...p, ...next].slice(0, 8))
    if (skipped.length) {
      try {
        const { notifyUser } = await import('@shared/lib/notify')
        void notifyUser(
          'Algunas imágenes no se añadieron',
          skipped.slice(0, 4).join('\n'),
          { kind: 'warn', sticky: false, os: false }
        )
      } catch {
        /* */
      }
    }
  }

  const onPickDocs = async (files: FileList | null) => {
    if (!files?.length) return
    const next: Attachment[] = []
    const skippedOffice: string[] = []
    const failedExtract: string[] = []
    for (const f of Array.from(files).slice(0, 4)) {
      if (isUnsupportedOfficeFile(f.name, f.type)) {
        skippedOffice.push(f.name)
        continue
      }
      if (isOfficeExtractable(f.name, f.type)) {
        if (f.size > MAX_OFFICE_BYTES) {
          failedExtract.push(f.name + ' (demasiado grande)')
          continue
        }
        try {
          const buf = await f.arrayBuffer()
          const bytes = new Uint8Array(buf)
          let binary = ''
          const chunk = 0x8000
          for (let i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
          }
          const base64 = btoa(binary)
          const api = window.kawaii as
            | {
                filesExtractText?: (p: {
                  name: string
                  base64: string
                  mime?: string
                }) => Promise<{
                  ok: boolean
                  text?: string
                  error?: string
                  totalChars?: number
                  extractPath?: string
                  complete?: boolean
                }>
              }
            | undefined
          if (!api?.filesExtractText) {
            failedExtract.push(f.name + ' (IPC no disponible)')
            continue
          }
          const r = await api.filesExtractText({ name: f.name, base64, mime: f.type })
          if (!r.ok || !r.text?.trim()) {
            failedExtract.push(
              f.name + (r.error ? ' — ' + String(r.error).slice(0, 80) : '')
            )
            continue
          }
          let sourcePath: string | undefined
          let extractPath: string | undefined = r.extractPath
          try {
            // ALWAYS keep original .docx/.pdf in user-uploads for full re-extract
            const saved = await window.kawaii?.filesSaveChatAttachment?.({
              fileName: f.name,
              base64,
              kind: 'user'
            })
            if (saved?.ok && saved.filePath) sourcePath = saved.filePath
            if (!extractPath) {
              try {
                const txtName = f.name.replace(/\.[^.]+$/, '') + '.extract.txt'
                const extracted = await window.kawaii?.filesSaveChatAttachment?.({
                  fileName: txtName,
                  text: r.text,
                  kind: 'context'
                })
                if (extracted?.ok && extracted.filePath) extractPath = extracted.filePath
              } catch {
                /* */
              }
            }
          } catch {
            /* optional disk copy */
          }
          let body = r.text
          if (extractPath && window.kawaii?.filesReadTextPath) {
            try {
              const full = await window.kawaii.filesReadTextPath(extractPath)
              if (full?.ok && full.text && full.text.length > body.length) body = full.text
            } catch {
              /* */
            }
          }
          // If extract still short, force ensure from source immediately
          if (
            sourcePath &&
            body.length < 400_000 &&
            window.kawaii?.filesEnsureDocExtract
          ) {
            try {
              const er = await window.kawaii.filesEnsureDocExtract({
                sourcePath,
                extractPath,
                name: f.name
              })
              if (er?.ok && er.text && er.text.length > body.length) {
                body = er.text
                if (er.extractPath) extractPath = er.extractPath
              }
              if (er?.ok && er.extractPath && window.kawaii.filesReadTextPath) {
                const full = await window.kawaii.filesReadTextPath(er.extractPath)
                if (full?.ok && full.text && full.text.length > body.length) body = full.text
              }
            } catch {
              /* */
            }
          }
          next.push({
            id: 'doc_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
            name: f.name,
            mimeType:
              f.type ||
              (f.name.toLowerCase().endsWith('.pdf')
                ? 'application/pdf'
                : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
            sizeBytes: f.size,
            textContent: body,
            filePath: extractPath || sourcePath,
            sourceFilePath: sourcePath
          })
        } catch {
          failedExtract.push(f.name)
        }
        continue
      }
      if (!isTextDocumentFile(f.name, f.type)) {
        failedExtract.push(f.name + ' (tipo no soportado; usa txt/md/pdf/docx o imagen)')
        continue
      }
      if (f.size > MAX_FILE_BYTES) {
        failedExtract.push(f.name + ' (demasiado grande)')
        continue
      }
      try {
        const text = await readFileAsText(f)
        if (!text.trim()) {
          failedExtract.push(f.name + ' (vacío)')
          continue
        }
        let savedPath: string | undefined
        try {
          const saved = await window.kawaii?.filesSaveChatAttachment?.({
            fileName: f.name,
            text,
            kind: 'user'
          })
          if (saved?.ok && saved.filePath) savedPath = saved.filePath
        } catch {
          /* optional */
        }
        next.push({
          id: 'doc_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
          name: f.name,
          mimeType: f.type || 'text/plain',
          sizeBytes: f.size,
          textContent: text,
          filePath: savedPath
        })
      } catch {
        /* skip */
      }
    }
    if (next.length) setPending((p) => [...p, ...next].slice(0, 8))
    if (skippedOffice.length || failedExtract.length) {
      try {
        const bits: string[] = []
        if (failedExtract.length)
          bits.push('No se pudo extraer:\n' + failedExtract.join('\n'))
        if (skippedOffice.length)
          bits.push(
            'Formato no soportado (usa .docx/.pdf/.txt/.md):\n' + skippedOffice.join(', ')
          )
        window.alert(bits.join('\n\n'))
      } catch {
        /* */
      }
    }
  }

  return (

    <div className="border-t border-kawaii-border bg-white/80 backdrop-blur px-4 py-3 shrink-0 relative">
      {pending.length > 0 ? (
        <div className="flex flex-wrap gap-2 max-w-4xl mx-auto mb-2">
          {pending.map((a) => (
            <div
              key={a.id}
              className="relative w-16 h-16 rounded-lg overflow-hidden border border-kawaii-border bg-kawaii-bg/50 flex items-center justify-center"
              title={a.name}
            >
              {a.dataUrl && a.mimeType?.startsWith('image/') ? (
                <img src={a.dataUrl} alt={a.name} className="w-full h-full object-cover" />
              ) : (
                <div className="flex flex-col items-center gap-0.5 px-1 text-center">
                  <FileText className="w-5 h-5 text-kawaii-pink" />
                  <span className="text-[9px] text-kawaii-text-muted truncate max-w-[56px]">
                    {a.name || 'doc'}
                  </span>
                </div>
              )}
              <button
                type="button"
                className="absolute top-0.5 right-0.5 bg-black/60 text-white rounded-full p-0.5"
                onClick={() => setPending((p) => p.filter((x) => x.id !== a.id))}
                title="Quitar"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {canContinueReading && !isLoading ? (
        <div className="max-w-4xl mx-auto mb-2">
          <button
            type="button"
            className="text-[11px] px-2.5 py-1 rounded-full border border-kawaii-border bg-white hover:bg-pink-50 text-kawaii-text"
            title="Seguir el siguiente tramo del documento"
            onClick={() => {
              try {
                if (activeId) {
                  sessionStorage.setItem('kawaii-doc-auto-paused:' + activeId, '1')
                  sessionStorage.setItem('kawaii-doc-auto-chain:' + activeId, '0')
                }
              } catch {
                /* */
              }
              void onSend(
                '[APP] Continuar lectura del documento: siguiente tramo/capítulo; resume y opina en personaje. ' +
                  'No es mensaje del usuario ni escena íntima.',
                undefined,
                {
                  meta: {
                    kind: 'app-doc-continue',
                    uiLabel: 'Continuando la lectura del documento…'
                  }
                }
              )
            }}
          >
            Continuar lectura
          </button>
          {docAutoPaused ? (
            <span className="text-[10px] text-kawaii-text-muted ml-2">
              Auto pausado tras 3 tramos · sigue a mano cuando quieras
            </span>
          ) : (
            <span className="text-[10px] text-kawaii-text-muted ml-2">
              Auto: hasta 3 tramos · la app avanza hasta el final del archivo (por partes)
            </span>
          )}
        </div>
      ) : null}

      {showEmoji ? (
        <div className="max-w-4xl mx-auto mb-2 p-2 rounded-kawaii border border-kawaii-border bg-white shadow-sm flex flex-wrap gap-1">
          {EMOJI_SET.map((em) => (
            <button
              key={em}
              type="button"
              className="text-lg hover:bg-kawaii-pink/20 rounded px-1"
              onClick={() => addEmoji(em)}
            >
              {em}
            </button>
          ))}
        </div>
      ) : null}

      {/* Rich-text helpers (markdown under the hood — LLM already understands it) */}
      <div className="max-w-4xl mx-auto mb-1 flex items-center gap-0.5 px-0.5">
        <button
          type="button"
          className="p-1 rounded hover:bg-pink-50 text-kawaii-text-muted hover:text-kawaii-text"
          title="Negrita (selecciona texto)"
          onClick={() => applyFormat('**')}
        >
          <Bold className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          className="p-1 rounded hover:bg-pink-50 text-kawaii-text-muted hover:text-kawaii-text"
          title="Cursiva (selecciona texto)"
          onClick={() => applyFormat('*')}
        >
          <Italic className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          className="p-1 rounded hover:bg-pink-50 text-kawaii-text-muted hover:text-kawaii-text"
          title="Lista"
          onClick={() => applyList()}
        >
          <List className="w-3.5 h-3.5" />
        </button>
        <span className="text-[9px] text-kawaii-text-muted ml-1 hidden sm:inline">
          Formato · el modelo lo ve como texto enriquecido
        </span>
      </div>

      <div className="flex items-end gap-1.5 max-w-4xl mx-auto">
        <input
          ref={imageRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            void onPickImages(e.target.files)
            e.target.value = ''
          }}
        />
        <input
          ref={docRef}
          type="file"
          accept=".txt,.md,.markdown,.json,.csv,.tsv,.log,.ts,.tsx,.js,.jsx,.py,.rs,.go,.java,.c,.cpp,.h,.css,.html,.xml,.yaml,.yml,.toml,.ini,.sql,.docx,.pdf,text/plain,application/json,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          multiple
          className="hidden"
          onChange={(e) => {
            void onPickDocs(e.target.files)
            e.target.value = ''
          }}
        />
        <Button variant="ghost" className="shrink-0" title="Emojis" onClick={() => setShowEmoji((s) => !s)}>
          <Smile className="w-4 h-4" />
        </Button>
        <Button variant="ghost" className="shrink-0" title="Adjuntar imagen" onClick={() => imageRef.current?.click()}>
          <ImagePlus className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          className="shrink-0"
          title="Adjuntar archivo de texto / código"
          onClick={() => docRef.current?.click()}
        >
          <Paperclip className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          className={"shrink-0 " + (thinkMode !== 'off' ? 'text-violet-600 bg-violet-50' : '')}
          title={
            thinkMode === 'off'
              ? 'Think: apagado (clic → on)'
              : thinkMode === 'on'
                ? 'Think: encendido (clic → auto)'
                : 'Think: auto (clic → off)'
          }
          onClick={cycleThink}
        >
          <Brain className="w-4 h-4" />
          {thinkMode !== 'off' ? (
            <span className="text-[10px] ml-0.5 font-medium">{thinkMode === 'auto' ? 'Auto' : 'On'}</span>
          ) : null}
        </Button>

        <div className="flex-1 flex flex-col gap-1 min-w-0">
          {acSuggestions.length > 0 ? (
            <div className="flex flex-wrap gap-1 px-0.5">
              {acSuggestions.slice(0, 5).map((s) => (
                <button
                  key={`${s.index}-${s.from}-${s.to}`}
                  type="button"
                  className="text-[10px] px-1.5 py-0.5 rounded-full bg-kawaii-pink/15 text-kawaii-pink-deep hover:bg-kawaii-pink/25"
                  title="Aplicar corrección"
                  onClick={() => {
                    setValue((v) => applySuggestion(v, s))
                    setAcSuggestions((prev) => prev.filter((x) => x.index !== s.index))
                  }}
                >
                  {s.from} → {s.to}
                </button>
              ))}
              <button
                type="button"
                className="text-[10px] px-1.5 py-0.5 rounded-full text-kawaii-text-muted hover:underline"
                onClick={() => {
                  setValue((v) => applySpanishAutocorrectLight(v))
                  setAcSuggestions([])
                }}
              >
                Corregir todo
              </button>
            </div>
          ) : null}
          <textarea
            ref={textRef}
            className="input-kawaii min-h-[48px] max-h-40 resize-y w-full"
            placeholder={
              isLoading
                ? 'Generando… Detener para cancelar'
                : stt.status === 'listening'
                  ? 'Escuchando… habla ahora (clic en el mic para parar)'
                  : 'Escribe… (fotos, .txt/.md/.docx/.pdf…; Enter envía)'
            }
            value={value}
            onChange={(e) => {
              const v = e.target.value
              setValue(v)
              try {
                setAcSuggestions(suggestSpanishAutocorrect(v).slice(0, 6))
              } catch {
                setAcSuggestions([])
              }
            }}
            onKeyDown={onKeyDown}
            disabled={false}
            rows={1}
            spellCheck={true}
            lang="es-MX"
            autoCorrect="on"
            autoCapitalize="sentences"
            title="Corrector del sistema: subrayado rojo en errores. Clic derecho para sugerencias. Chips = diccionario de la app."
          />
        </div>
        {stt.supported ? (
          <Button
            variant="ghost"
            title={
              stt.status === 'listening'
                ? 'Detener dictado'
                : stt.error
                  ? stt.error
                  : 'Dictar por voz (es-MX)'
            }
            onClick={() => stt.toggle()}
            disabled={Boolean(isLoading)}
            className={
              stt.status === 'listening'
                ? 'text-rose-600 animate-pulse'
                : stt.status === 'error'
                  ? 'text-amber-700'
                  : undefined
            }
          >
            {stt.status === 'listening' ? (
              <MicOff className="w-4 h-4" />
            ) : (
              <Mic className="w-4 h-4" />
            )}
          </Button>
        ) : null}
        {isLoading ? (
          <Button variant="ghost" onClick={() => onStop?.()} title="Detener">
            <Square className="w-4 h-4" />
          </Button>
        ) : (
          <Button onClick={submit}
            data-primary-send="1" disabled={disabled || (!value.trim() && pending.length === 0)} title="Enviar">
            <Send className="w-4 h-4" />
          </Button>
        )}
      </div>
    </div>
  )
}
