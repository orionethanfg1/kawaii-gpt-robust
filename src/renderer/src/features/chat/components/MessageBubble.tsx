import React, { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { openActivity } from '@features/activities/companion'
import type { Message } from '@core/conversation'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'
import { ImageLightbox } from '@shared/ui/ImageLightbox'
import {
  buildFeedbackReport,
  recordFeedback,
  type FeedbackVote
} from '@core/feedback'
import { activityInfo } from '@shared/lib/stores/activityStore'

/** Preserve model line breaks when rendering Markdown (single \n → hard break). */
function preserveMdBreaks(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/([^\n])\n(?!\n)/g, '$1  \n')
}

interface Props {
  message: Message
  onResend?: (messageId: string) => void
  onDelete?: (messageId: string) => void
}

function formatTime(ts?: number): string {
  if (!ts) return ''
  try {
    return new Date(ts).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  } catch {
    return ''
  }
}



/** Advanced UI only: collapsible harness plan / action log under assistant messages. */
function HarnessPlanLog({
  planSummary,
  harnessLog
}: {
  planSummary?: string
  harnessLog?: string[]
}) {
  const [open, setOpen] = useState(false)
  const lines = Array.isArray(harnessLog)
    ? harnessLog.map((x) => String(x)).filter(Boolean)
    : []
  const summary = (planSummary || '').trim()
  if (!summary && lines.length === 0) return null

  return (
    <div className="mt-2 rounded-lg border border-kawaii-border/60 bg-kawaii-purple-soft/25 text-[11px] text-kawaii-text-muted">
      <button
        type="button"
        className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-left hover:bg-kawaii-purple-soft/40 rounded-lg"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="font-medium text-kawaii-text/80 truncate">
          ⚙️ Harness{summary ? `: ${summary.slice(0, 72)}${summary.length > 72 ? '…' : ''}` : ' · acciones'}
        </span>
        <span className="shrink-0 opacity-70">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-2.5 pb-2 pt-0 space-y-1 border-t border-kawaii-border/40">
          {summary ? (
            <p className="text-[10px] opacity-90 leading-snug pt-1.5">
              <span className="font-semibold">Plan:</span> {summary}
            </p>
          ) : null}
          {lines.length > 0 ? (
            <ul className="list-none space-y-0.5 font-mono text-[10px] leading-snug pt-1 max-h-40 overflow-y-auto">
              {lines.map((line, i) => (
                <li key={i} className="break-words opacity-90">
                  {line}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </div>
  )
}

export function MessageBubble({ message, onResend, onDelete }: Props) {
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)

  const showRoute = useSettingsStore((s) => s.settings.showRouteInfo)
  const uiComplexity = useSettingsStore((s) => s.settings.uiComplexity || 'smart')
  const character = useSettingsStore((s) => s.settings.character)
  const isUser = message.role === 'user'
  const [vote, setVote] = useState<FeedbackVote | null>(null)
  const [pendingVote, setPendingVote] = useState<FeedbackVote | null>(null)
  const [commentDraft, setCommentDraft] = useState('')
  const [speaking, setSpeaking] = useState(false)
  const voiceEnabled = useSettingsStore((s) => s.settings.voiceTtsEnabled !== false)
  const voiceAutoPlay = useSettingsStore((s) => s.settings.voiceTtsAutoPlay === true)
  const voiceActivitiesOnly = useSettingsStore((s) => s.settings.voiceTtsActivitiesOnly === true)
  const voiceId = useSettingsStore((s) => s.settings.voiceTtsVoiceId || 'es-MX-DaliaNeural')
  const autoSpokenRef = useRef<string | null>(null)

  const speakMessage = async () => {
    // Main chat: respect "solo en actividades"
    if (!voiceEnabled || isUser || speaking) return
    if (voiceActivitiesOnly) {
      activityInfo('Voz limitada a actividades (Ajustes → Voz). Desactiva “solo en actividades” para el chat.')
      return
    }
    const text = String(message.content || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/[*_#>`]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (!text) return
    setSpeaking(true)
    try {
      await window.kawaii?.voiceStop?.()
      let r = await window.kawaii?.voiceSpeak?.({ text: text.slice(0, 1200), voiceId })
      // Auto-install engine once if missing (transparent)
      if (!r?.ok && /edge-tts|Python|motor de voz|pip install/i.test(String(r?.error || ''))) {
        activityInfo('Preparando motor de voz (solo la primera vez)…')
        const ens = await window.kawaii?.voiceEnsure?.()
        if (ens?.ok) {
          r = await window.kawaii?.voiceSpeak?.({ text: text.slice(0, 1200), voiceId })
        } else {
          activityInfo(ens?.error || r?.error || 'No se pudo preparar la voz')
          setSpeaking(false)
          return
        }
      }
      if (!r?.ok) {
        activityInfo(r?.error || 'No se pudo sintetizar la voz')
        setSpeaking(false)
        return
      }
      const mediaUrl = (r as { mediaUrl?: string }).mediaUrl
      const dataUrl =
        (r as { audioDataUrl?: string }).audioDataUrl ||
        (typeof r.audioUrl === 'string' && r.audioUrl.startsWith('data:') ? r.audioUrl : '')
      const src = mediaUrl || dataUrl || ''
      if (!src) {
        activityInfo(
          'Audio generado pero no reproducible. Reintentá o revisá Ajustes → Voz → consola.'
        )
        setSpeaking(false)
        return
      }
      const playSrc = async (url: string) => {
        const audio = new Audio(url)
        await new Promise<void>((resolve, reject) => {
          audio.onended = () => resolve()
          audio.onerror = () => reject(new Error('audio element error'))
          void audio.play().catch(reject)
        })
      }
      try {
        await playSrc(src)
      } catch {
        if (dataUrl && dataUrl.startsWith('data:')) {
          try {
            const res = await fetch(dataUrl)
            const blob = await res.blob()
            const obj = URL.createObjectURL(blob)
            try {
              await playSrc(obj)
            } finally {
              URL.revokeObjectURL(obj)
            }
          } catch {
            activityInfo('Error al reproducir audio. Ver consola de Voz en Ajustes.')
          }
        } else {
          activityInfo('Error al reproducir audio. Ver consola de Voz en Ajustes.')
        }
      }
      setSpeaking(false)
    } catch (e) {
      setSpeaking(false)
      activityInfo(e instanceof Error ? e.message : String(e))
    }
  }

  const stopSpeaking = async () => {
    try {
      await window.kawaii?.voiceStop?.()
    } catch {
      /* ignore */
    }
    setSpeaking(false)
  }

  // Auto-play TTS when enabled (Ajustes → Voz → reproducir automáticamente)
  useEffect(() => {
    if (isUser || message.isStreaming) return
    if (!voiceEnabled || !voiceAutoPlay || voiceActivitiesOnly) return
    if (!message.content?.trim()) return
    if (autoSpokenRef.current === message.id) return
    autoSpokenRef.current = message.id
    const t = window.setTimeout(() => {
      void speakMessage()
    }, 350)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- speak once per finished message id
  }, [
    message.id,
    message.isStreaming,
    message.content,
    voiceAutoPlay,
    voiceEnabled,
    voiceActivitiesOnly,
    isUser
  ])

    const commitFeedback = (v: FeedbackVote, comment?: string) => {
    if (vote) return
    setVote(v)
    setPendingVote(null)
    setCommentDraft('')
    const isImage = Boolean(
      message.meta?.imagePrompt ||
        message.attachments?.some((a) => a.mimeType?.startsWith('image/'))
    )
    const report = buildFeedbackReport(
      v,
      {
        messageId: message.id,
        role: message.role,
        contentPreview: (message.content || '').slice(0, 120),
        isImage,
        imagePrompt: message.meta?.imagePrompt
          ? String(message.meta.imagePrompt)
          : undefined,
        model: message.meta?.model || message.meta?.imageModel,
        provider: message.meta?.provider || message.meta?.imageProvider,
        route: message.meta?.route,
        characterName: character?.name
      },
      comment
    )
    const saved = recordFeedback(report)
    if (saved) {
      activityInfo(
        v === 'up' ? 'Gracias por el 👍 (guardado)' : 'Gracias por el 👎 (guardado)',
        (comment?.trim() || report.report).slice(0, 160)
      )
    } else {
      activityInfo(
        'Feedback no guardado (duplicado o storage)',
        'Prueba otro mensaje o revisa localStorage kawaii-gpt-feedback-v1'
      )
    }
  }

  const openFeedback = (v: FeedbackVote) => {
    if (vote || pendingVote) return
    setPendingVote(v)
    setCommentDraft('')
  }
  const audios = (message.attachments ?? []).filter((a) =>
    a.mimeType?.startsWith('audio/') || a.filePath?.match(/\.(mp3|wav|ogg|flac)$/i)
  )
  const images = (message.attachments ?? []).filter((a) =>
    a.mimeType?.startsWith('image/') && a.dataUrl
  )
  const looksLikeError =
    message.meta?.isError === true ||
    (!isUser &&
      /Modelo no disponible|PROVIDER_|Ningún proveedor|No hay proveedores|Error al |rate limit|cuota/i.test(
        message.content || ''
      ))

  return (
    <>
    <div className="mb-3">
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} gap-2`}>
      {!isUser && (
        <div
          className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-kawaii-pink-soft border-2 border-kawaii-border flex items-center justify-center text-2xl shrink-0 mt-0.5 overflow-hidden shadow-sm"
          title={character?.name ?? 'Asistente'}
        >
          {character?.visualImageUrl ? (
            <img
              src={character.visualImageUrl}
              alt={character.name}
              title="Ver imagen ampliada"
              role="button"
              className="w-full h-full object-cover cursor-zoom-in"
              onClick={() =>
                character?.visualImageUrl && setLightboxSrc(character.visualImageUrl)
              }
            />
          ) : (
            <span>{character?.visualEmoji ?? '🌸'}</span>
          )}
        </div>
      )}
      <div
        className={`max-w-[85%] rounded-kawaii-lg px-4 py-3 shadow-kawaii ${
          isUser
            ? 'bg-kawaii-pink-deep text-white rounded-br-md'
            : 'bg-white border border-kawaii-border text-kawaii-text rounded-bl-md'
        }`}
      >
        {typeof message.meta?.imageTitle === 'string' && message.meta.imageTitle && (
          <p className="text-[12px] font-semibold text-kawaii-text mb-1 leading-snug">
            {String(message.meta.imageTitle)}
          </p>
        )}
        {images.length > 0 && (
          <div className="space-y-2 mb-2">
            {images.map((img) => (
              <img
                key={img.id}
                src={img.dataUrl}
                alt={img.name || 'imagen'}
                title="Clic para ampliar"
                className="max-h-72 rounded-xl border border-kawaii-border/50 object-contain bg-black/5 cursor-zoom-in"
                onClick={() => img.dataUrl && setLightboxSrc(img.dataUrl)}
              />
            ))}
          </div>
        )}
        {(audios.length > 0 || message.meta?.musicPath) && (
          <div className="space-y-2 mb-2">
            {(audios.length
              ? audios
              : [
                  {
                    id: 'meta-music',
                    name: 'pista',
                    mimeType: 'audio/mpeg',
                    sizeBytes: 0,
                    filePath: String(message.meta?.musicPath || ''),
                    dataUrl: undefined as string | undefined
                  }
                ]
            ).map((a) => (
              <div
                key={a.id}
                className="rounded-xl border border-kawaii-border/60 bg-black/5 p-2 space-y-1.5"
              >
                {a.dataUrl ? (
                  <audio controls className="w-full max-w-md" src={a.dataUrl} />
                ) : (
                  <p className="text-[11px] text-kawaii-text-muted">
                    Audio en disco (no incrustado). Ábrelo desde la carpeta.
                  </p>
                )}
                <div className="flex flex-wrap gap-2 text-[11px]">
                  {a.filePath ? (
                    <>
                      <button
                        type="button"
                        className="text-kawaii-pink-deep underline"
                        onClick={() => void window.kawaii?.filesShowInFolder?.(a.filePath!)}
                      >
                        Mostrar en carpeta
                      </button>
                      <button
                        type="button"
                        className="text-kawaii-pink-deep underline"
                        onClick={() => void window.kawaii?.filesOpenPath?.(a.filePath!)}
                      >
                        Abrir archivo
                      </button>
                    </>
                  ) : null}
                  {a.filePath ? (
                    <span className="text-kawaii-text-muted break-all font-mono text-[10px]">
                      {a.filePath}
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
        {Array.isArray(message.meta?.knownDirs) && message.meta.knownDirs.length > 0 ? (
          <div className="flex flex-col gap-1.5 mb-2 mt-1">
            {message.meta.knownDirs.map((d) => (
              <button
                key={d.id + d.path}
                type="button"
                className="text-left text-[12px] px-3 py-2 rounded-xl border border-kawaii-pink-deep/30 bg-kawaii-pink-soft/40 hover:bg-kawaii-pink-soft text-kawaii-pink-deep font-medium"
                onClick={() => void window.kawaii?.filesOpenPath?.(d.path)}
              >
                📂 Abrir: {d.label}
                <span className="block text-[10px] font-normal text-kawaii-text-muted truncate">
                  {d.path}
                </span>
              </button>
            ))}
          </div>
        ) : null}
        {isUser || message.isStreaming ? (
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed break-words">
            {message.content || (message.isStreaming ? '…' : '')}
            {message.isStreaming && (
              <span className="inline-block w-1.5 h-4 ml-0.5 bg-current animate-pulse align-middle" />
            )}
          </p>
        ) : (
          message.content && (
            <div
              className={
                'kawaii-md text-[15px] leading-relaxed break-words ' +
                '[&_p]:my-2 [&_p]:first:mt-0 [&_p]:last:mb-0 ' +
                '[&_strong]:font-semibold [&_b]:font-semibold ' +
                '[&_em]:italic [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 ' +
                '[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 ' +
                '[&_li]:my-0.5 [&_code]:text-[13px] [&_code]:bg-kawaii-purple-soft/60 ' +
                '[&_code]:px-1 [&_code]:rounded [&_pre]:my-2 [&_pre]:p-3 ' +
                '[&_pre]:rounded-xl [&_pre]:bg-kawaii-purple-soft/40 [&_pre]:overflow-x-auto ' +
                '[&_a]:text-kawaii-pink-deep [&_a]:underline [&_blockquote]:border-l-2 ' +
                '[&_blockquote]:border-kawaii-pink-deep/40 [&_blockquote]:pl-3 [&_blockquote]:opacity-90'
              }
            >
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  a: ({ href, children, ...props }) => {
                    const h = href || ''
                    if (h.startsWith('kawaii-activity://')) {
                      const kind = h.replace('kawaii-activity://', '').split(/[?#]/)[0]
                      return (
                        <button
                          type="button"
                          className="text-kawaii-pink-deep underline font-medium"
                          onClick={(e) => {
                            e.preventDefault()
                            if (kind === 'chess' || kind === 'adventure') {
                              openActivity(kind as 'chess' | 'adventure')
                            }
                          }}
                        >
                          {children}
                        </button>
                      )
                    }
                    return (
                      <a href={h} target="_blank" rel="noreferrer" {...props}>
                        {children}
                      </a>
                    )
                  },
                  p: ({ children }) => <p className="my-2 leading-relaxed">{children}</p>,
                  strong: ({ children }) => (
                    <strong className="font-semibold text-inherit">{children}</strong>
                  ),
                  li: ({ children }) => <li className="leading-relaxed">{children}</li>
                }}
              >
                {preserveMdBreaks(message.content)}
              </ReactMarkdown>
            </div>
          )
        )}
        {showRoute && !message.isStreaming && (message.meta?.model || message.meta?.imageProvider) && (
          <p className="mt-1.5 text-[10px] opacity-70 leading-snug">
            {message.meta.imageProvider ? (
              <>
                <span className="font-semibold">{message.meta.imageProvider}</span>
                {message.meta.imageModel ? ` · ${message.meta.imageModel}` : ''}
                {message.meta.imageWidth && message.meta.imageHeight
                  ? ` · ${message.meta.imageWidth}×${message.meta.imageHeight}`
                  : ''}
                {message.meta.latencyMs != null ? ` · ${message.meta.latencyMs}ms` : ''}
              </>
            ) : (
              <>
                <span className="font-semibold">{message.meta.model}</span>
                {message.meta.route ? ` · ${message.meta.route}` : ''}
                {message.meta.failover ? ' · failover' : ''}
                {message.meta.contextPacked ? ' · contexto ajustado' : ''}
                {message.meta.summarySource
                  ? ` · resumen:${message.meta.summarySource}`
                  : ''}
                {message.meta.latencyMs != null ? ` · ${message.meta.latencyMs}ms` : ''}
                {message.meta.switchedAt ? ` · ${formatTime(message.meta.switchedAt)}` : ''}
                {message.meta.reason ? (
                  <>
                    <br />
                    <span className="opacity-80">{message.meta.reason}</span>
                  </>
                ) : null}
              </>
            )}
          </p>
        )}
        {uiComplexity === 'advanced' &&
          !message.isStreaming &&
          !isUser &&
          (Boolean(message.meta?.planSummary) ||
            (Array.isArray(message.meta?.harnessLog) &&
              (message.meta.harnessLog as unknown[]).length > 0)) && (
            <HarnessPlanLog
              planSummary={
                typeof message.meta?.planSummary === 'string'
                  ? message.meta.planSummary
                  : undefined
              }
              harnessLog={
                Array.isArray(message.meta?.harnessLog)
                  ? (message.meta.harnessLog as string[])
                  : undefined
              }
            />
          )}
      </div>
    </div>
      {!message.isStreaming && (
        <div
          className={`flex gap-2 mt-0.5 px-1 items-center ${isUser ? 'justify-end' : 'justify-start ml-11'}`}
        >
          {!isUser && (
            <>
              {voiceEnabled && (
                <button
                  type="button"
                  className={`text-[12px] px-1.5 rounded ${speaking ? 'bg-kawaii-pink-soft' : 'opacity-70 hover:opacity-100'}`}
                  title={speaking ? 'Detener voz' : 'Leer en voz alta (es-MX / LATAM)'}
                  onClick={() => (speaking ? void stopSpeaking() : void speakMessage())}
                >
                  {speaking ? '⏹' : '🔊'}
                </button>
              )}
              <button
                type="button"
                className={`text-[12px] px-1.5 rounded ${vote === 'up' || pendingVote === 'up' ? 'bg-kawaii-pink-soft' : 'opacity-70 hover:opacity-100'}`}
                title="Me gusta (puedes añadir un comentario)"
                onClick={() => openFeedback('up')}
                disabled={vote !== null}
              >
                👍
              </button>
              <button
                type="button"
                className={`text-[12px] px-1.5 rounded ${vote === 'down' || pendingVote === 'down' ? 'bg-amber-100' : 'opacity-70 hover:opacity-100'}`}
                title="No me gusta (puedes describir el problema)"
                onClick={() => openFeedback('down')}
                disabled={vote !== null}
              >
                👎
              </button>
            </>
          )}
          {looksLikeError && onResend && (
            <button
              type="button"
              className="text-[10px] text-kawaii-pink-deep hover:underline"
              onClick={() => onResend(message.id)}
            >
              Reenviar
            </button>
          )}
          {onDelete && (
            <>
              <button
                type="button"
                className="text-[10px] text-kawaii-text-muted hover:underline"
                onClick={() => {
                  const text = String(message.content || '').trim()
                  const title = message.meta?.imageTitle ? String(message.meta.imageTitle) + '\n' : ''
                  void navigator.clipboard?.writeText(title + text).catch(() => {})
                }}
                title="Copiar mensaje"
              >
                Copiar
              </button>
              <button
                type="button"
                className="text-[10px] text-kawaii-text-muted hover:underline"
                onClick={() => onDelete(message.id)}
                title="Eliminar mensaje"
              >
                Eliminar
              </button>
            </>
          )}
        </div>
      )}

      {pendingVote && !vote ? (
        <div
          className={`mt-1 ml-11 mr-2 rounded-xl border border-kawaii-border bg-white/95 p-2 shadow-sm space-y-1.5 max-w-md ${
            isUser ? 'ml-auto' : ''
          }`}
        >
          <p className="text-[11px] text-kawaii-text-muted">
            {pendingVote === 'up'
              ? '¿Qué te gustó? (opcional)'
              : '¿Qué no te gustó o qué debería cambiar? (opcional)'}
          </p>
          <textarea
            className="w-full text-[12px] rounded-lg border border-kawaii-border px-2 py-1.5 min-h-[56px] resize-y bg-white focus:outline-none focus:ring-2 focus:ring-kawaii-pink-deep/25"
            placeholder={
              pendingVote === 'up'
                ? 'Ej. tono natural, buena imagen, respuesta útil…'
                : 'Ej. ojos mal, no parece Niamh, respuesta genérica…'
            }
            value={commentDraft}
            onChange={(e) => setCommentDraft(e.target.value)}
            maxLength={400}
            autoFocus
          />
          <div className="flex flex-wrap gap-2 justify-end">
            <button
              type="button"
              className="text-[11px] px-2 py-1 rounded-lg text-kawaii-text-muted hover:underline"
              onClick={() => {
                setPendingVote(null)
                setCommentDraft('')
              }}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="text-[11px] px-2 py-1 rounded-lg border border-kawaii-border hover:bg-kawaii-pink-soft/40"
              onClick={() => commitFeedback(pendingVote)}
            >
              Enviar sin comentario
            </button>
            <button
              type="button"
              className="text-[11px] px-2.5 py-1 rounded-lg bg-kawaii-pink-deep text-white"
              onClick={() => commitFeedback(pendingVote, commentDraft)}
            >
              Enviar
            </button>
          </div>
        </div>
      ) : null}

    </div>
    {lightboxSrc ? (
      <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
    ) : null}
    </>
  )
}
