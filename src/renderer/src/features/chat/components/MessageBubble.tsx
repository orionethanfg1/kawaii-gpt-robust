import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Message } from '@core/conversation'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'

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

export function MessageBubble({ message, onResend, onDelete }: Props) {
  const showRoute = useSettingsStore((s) => s.settings.showRouteInfo)
  const character = useSettingsStore((s) => s.settings.character)
  const isUser = message.role === 'user'
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
              className="w-full h-full object-cover"
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
        {images.length > 0 && (
          <div className="space-y-2 mb-2">
            {images.map((img) => (
              <img
                key={img.id}
                src={img.dataUrl}
                alt={img.name || 'imagen'}
                className="max-h-72 rounded-xl border border-kawaii-border/50 object-contain bg-black/5"
              />
            ))}
          </div>
        )}
        {isUser || message.isStreaming ? (
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed">
            {message.content || (message.isStreaming ? '…' : '')}
            {message.isStreaming && (
              <span className="inline-block w-1.5 h-4 ml-0.5 bg-current animate-pulse align-middle" />
            )}
          </p>
        ) : (
          message.content && (
            <div className="prose prose-sm max-w-none prose-p:my-1 prose-pre:bg-kawaii-purple-soft prose-pre:rounded-xl">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
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
      </div>
    </div>
      {!message.isStreaming && (onResend || onDelete) && (
        <div
          className={`flex gap-2 mt-0.5 px-1 ${isUser ? 'justify-end' : 'justify-start ml-11'}`}
        >
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
            <button
              type="button"
              className="text-[10px] text-kawaii-text-muted hover:underline"
              onClick={() => onDelete(message.id)}
              title="Eliminar mensaje"
            >
              Eliminar
            </button>
          )}
        </div>
      )}
    </div>
  )
}
