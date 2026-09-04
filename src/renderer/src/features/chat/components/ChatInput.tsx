import { useState, KeyboardEvent } from 'react'
import { Send, Square } from 'lucide-react'
import { Button } from '@shared/ui/Button'

interface Props {
  disabled?: boolean
  isLoading?: boolean
  onSend: (text: string) => void
  onStop?: () => void
}

export function ChatInput({ disabled, isLoading, onSend, onStop }: Props) {
  const [value, setValue] = useState('')

  const submit = () => {
    const t = value.trim()
    if (!t || disabled) return
    // Allow queueing a new message only when not loading; if loading, user must stop first
    if (isLoading) return
    onSend(t)
    setValue('')
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="border-t border-kawaii-border bg-white/80 backdrop-blur px-4 py-3 shrink-0">
      <div className="flex items-end gap-2 max-w-4xl mx-auto">
        <textarea
          className="input-kawaii min-h-[48px] max-h-40 resize-y flex-1"
          placeholder={
            isLoading
              ? 'Generando… puedes escribir; pulsa Detener para cancelar y enviar otro mensaje'
              : 'Escribe un mensaje… (Enter para enviar, Shift+Enter nueva línea)'
          }
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          // Never disable the textarea — only gate send while loading
          disabled={false}
          rows={1}
        />
        {isLoading ? (
          <Button variant="ghost" onClick={() => onStop?.()} title="Detener generación">
            <Square className="w-4 h-4" />
          </Button>
        ) : (
          <Button
            onClick={submit}
            disabled={!value.trim() || disabled}
            title="Enviar"
          >
            <Send className="w-4 h-4" />
          </Button>
        )}
      </div>
      {isLoading && (
        <p className="text-[10px] text-kawaii-text-muted max-w-4xl mx-auto mt-1">
          Respuesta en curso. Usa Detener si se quedó colgado.
        </p>
      )}
    </div>
  )
}
