import { useEffect } from 'react'
import { useRef, useState, KeyboardEvent } from 'react'
import { Send, Square, Smile, ImagePlus, Paperclip, X, FileText } from 'lucide-react'
import { Button } from '@shared/ui/Button'
import type { Attachment } from '@core/conversation'
import { isTextDocumentFile, isUnsupportedOfficeFile, MAX_FILE_BYTES } from '@core/chat/document-attach'
// office check via document-attach

const EMOJI_SET = [
  '😀', '😂', '🥹', '😊', '😍', '🥰', '😘', '😏', '🥺', '😢',
  '😭', '😡', '🤔', '😎', '🙄', '😴', '❤️', '💕', '🔥', '✨',
  '👍', '👎', '🙏', '🤝', '💔', '😳', '🫣', '🎉', '🌹', '☕'
]

interface Props {
  disabled?: boolean
  isLoading?: boolean
  onSend: (text: string, attachments?: Attachment[]) => void
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
  const [value, setValue] = useState('')
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
  const imageRef = useRef<HTMLInputElement>(null)
  const docRef = useRef<HTMLInputElement>(null)

  const submit = () => {
    const t = value.trim()
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
    for (const f of Array.from(files).slice(0, 4)) {
      if (!f.type.startsWith('image/')) continue
      if (f.size > 12 * 1024 * 1024) continue
      try {
        const dataUrl = await readFileAsDataUrl(f)
        next.push({
          id: `att_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
          name: f.name,
          mimeType: f.type,
          sizeBytes: f.size,
          dataUrl
        })
      } catch {
        /* skip */
      }
    }
    if (next.length) setPending((p) => [...p, ...next].slice(0, 8))
  }

  const onPickDocs = async (files: FileList | null) => {
    if (!files?.length) return
    const next: Attachment[] = []
    const skippedOffice: string[] = []
    for (const f of Array.from(files).slice(0, 4)) {
      if (isUnsupportedOfficeFile(f.name, f.type)) {
        skippedOffice.push(f.name)
        continue
      }
      if (!isTextDocumentFile(f.name, f.type)) continue
      if (f.size > MAX_FILE_BYTES) continue
      try {
        const text = await readFileAsText(f)
        if (!text.trim()) continue
        next.push({
          id: `doc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
          name: f.name,
          mimeType: f.type || 'text/plain',
          sizeBytes: f.size,
          textContent: text
        })
      } catch {
        /* skip */
      }
    }
    if (next.length) setPending((p) => [...p, ...next].slice(0, 8))
    if (skippedOffice.length) {
      try {
        window.alert(
          'Aún no puedo leer .docx/.pdf dentro del chat.\n' +
            'Convierte a .txt o .md, o pega el texto.\n\n' +
            'Omitidos: ' +
            skippedOffice.join(', ')
        )
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
          accept=".txt,.md,.markdown,.json,.csv,.tsv,.log,.ts,.tsx,.js,.jsx,.py,.rs,.go,.java,.c,.cpp,.h,.css,.html,.xml,.yaml,.yml,.toml,.ini,.sql,text/plain,application/json"
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
        <textarea
          className="input-kawaii min-h-[48px] max-h-40 resize-y flex-1"
          placeholder={
            isLoading
              ? 'Generando… Detener para cancelar'
              : 'Escribe… (fotos, .txt/.md/.json…; .docx aún no, Enter envía)'
          }
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={false}
          rows={1}
        />
        {isLoading ? (
          <Button variant="ghost" onClick={() => onStop?.()} title="Detener">
            <Square className="w-4 h-4" />
          </Button>
        ) : (
          <Button onClick={submit} disabled={disabled || (!value.trim() && pending.length === 0)} title="Enviar">
            <Send className="w-4 h-4" />
          </Button>
        )}
      </div>
    </div>
  )
}
