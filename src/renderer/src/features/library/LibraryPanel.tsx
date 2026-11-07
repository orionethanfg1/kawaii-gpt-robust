/**
 * Dedicated library panel — search, filters, preview, open folder, jump to chat.
 * Keeps Sidebar lean (no nested max-h lists of 80+ files).
 */
import { useState } from 'react'
import { FolderOpen, RefreshCw, Search, X, FileText, Image as ImageIcon, Sparkles } from 'lucide-react'
import { useChatStore } from '@shared/lib/stores/chatStore'
import { useUiChromeStore } from '@shared/lib/stores/uiChromeStore'
import { Button } from '@shared/ui/Button'
import { useLibraryData } from './useLibraryData'
import type { LibraryFilter, LibraryItem } from './libraryTypes'

type Preview = {
  name: string
  dataUrl?: string
  filePath?: string
  kind?: string
}

const FILTERS: { id: LibraryFilter; label: string }[] = [
  { id: 'all', label: 'Todo' },
  { id: 'images', label: 'Imágenes' },
  { id: 'docs', label: 'Documentos' },
  { id: 'generated', label: 'Generados' },
  { id: 'disk', label: 'En disco' }
]

function kindIcon(kind: string, isImage?: boolean) {
  if (kind === 'gen') return '🎨'
  if (kind === 'img' || isImage) return '🖼️'
  if (kind === 'doc') return '📄'
  return '📎'
}

export function LibraryPanel() {
  const open = useUiChromeStore((s) => s.libraryOpen)
  const setLibraryOpen = useUiChromeStore((s) => s.setLibraryOpen)
  const setActive = useChatStore((s) => s.setActive)
  const data = useLibraryData(open)
  const [preview, setPreview] = useState<Preview | null>(null)

  if (!open) return null

  const openFolderShortcuts = (
    <div className="flex flex-wrap gap-1.5">
      <button
        type="button"
        className="text-[10px] px-2 py-1 rounded-full border border-kawaii-border/70 hover:bg-pink-50"
        onClick={() => {
          void (async () => {
            const openDir =
              window.kawaii?.filesOpenUserUploadsDir || window.kawaii?.filesOpenChatAttachmentsDir
            if (typeof openDir === 'function') await openDir()
          })()
        }}
      >
        📂 Tus subidas
      </button>
      <button
        type="button"
        className="text-[10px] px-2 py-1 rounded-full border border-kawaii-border/70 hover:bg-pink-50"
        onClick={() => void window.kawaii?.filesOpenChatAttachmentsDir?.()}
      >
        📂 Adjuntos chat
      </button>
      <button
        type="button"
        className="text-[10px] px-2 py-1 rounded-full border border-kawaii-border/70 hover:bg-pink-50"
        onClick={() => void window.kawaii?.modelsOpenLayerFolder?.('lmstudio')}
      >
        📂 LM Studio
      </button>
      <button
        type="button"
        className="text-[10px] px-2 py-1 rounded-full border border-kawaii-border/70 hover:bg-pink-50"
        onClick={() => void window.kawaii?.modelsOpenLayerFolder?.('ollama')}
      >
        📂 Ollama
      </button>
    </div>
  )

  const onItemClick = async (a: LibraryItem) => {
    if (a.kind === 'img' || a.kind === 'gen') {
      let dataUrl = a.dataUrl
      if (!dataUrl && a.filePath) {
        try {
          const r = await window.kawaii?.filesToDataUrl?.(a.filePath)
          dataUrl = r?.dataUrl
        } catch {
          /* */
        }
      }
      setPreview({ name: a.name, dataUrl, filePath: a.filePath, kind: a.kind })
      return
    }
    if (a.convId) setActive(a.convId)
  }

  return (
    <div className="fixed inset-0 z-[80] flex justify-end bg-black/25" role="presentation">
      <button
        type="button"
        className="flex-1 cursor-default"
        aria-label="Cerrar biblioteca"
        onClick={() => setLibraryOpen(false)}
      />
      <aside
        className="w-full max-w-md h-full bg-white shadow-xl border-l border-kawaii-border flex flex-col"
        role="dialog"
        aria-label="Biblioteca de adjuntos"
      >
        <header className="px-4 py-3 border-b border-kawaii-border/70 flex items-start gap-2 shrink-0">
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-kawaii-text">Biblioteca</h2>
            <p className="text-[11px] text-kawaii-text-muted mt-0.5">
              Archivos de chats, generados y carpetas locales · {data.counts.all} ítems
            </p>
          </div>
          <Button
            variant="ghost"
            className="text-xs shrink-0"
            title="Actualizar disco"
            onClick={() => void data.refreshDisk()}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${data.loadingDisk ? 'animate-spin' : ''}`} />
          </Button>
          <button
            type="button"
            className="p-1.5 rounded-lg hover:bg-kawaii-surface text-kawaii-text-muted"
            onClick={() => setLibraryOpen(false)}
            title="Cerrar"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="px-4 py-2 space-y-2 border-b border-kawaii-border/50 shrink-0">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-kawaii-text-muted" />
            <input
              className="input-kawaii w-full text-xs pl-8 py-1.5"
              placeholder="Buscar por nombre, chat o ruta…"
              value={data.query}
              onChange={(e) => data.setQuery(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                className={`text-[10px] px-2 py-1 rounded-full border transition ${
                  data.filter === f.id
                    ? 'bg-kawaii-pink-soft border-kawaii-pink-deep text-kawaii-pink-deep font-medium'
                    : 'border-kawaii-border/70 text-kawaii-text-muted hover:bg-pink-50'
                }`}
                onClick={() => data.setFilter(f.id)}
              >
                {f.label}
                {f.id === 'all'
                  ? ` (${data.counts.all})`
                  : f.id === 'images'
                    ? ` (${data.counts.images})`
                    : f.id === 'docs'
                      ? ` (${data.counts.docs})`
                      : f.id === 'generated'
                        ? ` (${data.counts.generated})`
                        : ` (${data.counts.disk})`}
              </button>
            ))}
          </div>
          {openFolderShortcuts}
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
          {data.filter !== 'disk' ? (
            <section>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-kawaii-text-muted px-1 mb-1 flex items-center gap-1">
                <Sparkles className="w-3 h-3" /> En chats ({data.filteredChat.length})
              </p>
              {data.filteredChat.length === 0 ? (
                <p className="text-[11px] text-kawaii-text-muted px-1 py-2">
                  Nada en esta vista. Sube un archivo al chat o genera una imagen.
                </p>
              ) : (
                <ul className="space-y-0.5">
                  {data.filteredChat.map((a) => (
                    <li
                      key={a.id + (a.filePath || '') + (a.convId || '')}
                      className="flex items-center gap-0.5 rounded-lg hover:bg-pink-50/80 group"
                    >
                      <button
                        type="button"
                        className="flex-1 text-left text-[11px] px-2 py-1.5 truncate min-w-0"
                        title={`${a.convTitle || ''} · ${a.name}${a.filePath ? '\n' + a.filePath : ''}`}
                        onClick={() => void onItemClick(a)}
                      >
                        <span className="mr-1">{kindIcon(a.kind)}</span>
                        <span className="text-kawaii-text-muted text-[9px] mr-1">
                          {a.source === 'user' ? 'tú' : a.source === 'generated' ? 'gen' : 'app'}
                        </span>
                        <span className="font-medium text-kawaii-text">{a.name}</span>
                        {a.convTitle ? (
                          <span className="block text-[9px] text-kawaii-text-muted truncate">
                            {a.convTitle}
                          </span>
                        ) : null}
                      </button>
                      {a.convId ? (
                        <button
                          type="button"
                          className="text-[9px] px-1.5 py-1 opacity-70 hover:opacity-100 shrink-0"
                          title="Ir al chat"
                          onClick={() => {
                            setActive(a.convId!)
                            setLibraryOpen(false)
                          }}
                        >
                          💬
                        </button>
                      ) : null}
                      {a.filePath ? (
                        <button
                          type="button"
                          className="text-[9px] px-1.5 py-1 opacity-70 hover:opacity-100 shrink-0"
                          title="Ver en carpeta"
                          onClick={() => void window.kawaii?.filesShowInFolder?.(a.filePath!)}
                        >
                          <FolderOpen className="w-3.5 h-3.5" />
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}

          {data.filter === 'all' || data.filter === 'disk' || data.filter === 'images' || data.filter === 'docs' ? (
            <section>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-kawaii-text-muted px-1 mb-1 flex items-center gap-1">
                {data.filter === 'images' ? (
                  <ImageIcon className="w-3 h-3" />
                ) : (
                  <FileText className="w-3 h-3" />
                )}{' '}
                En disco ({data.filteredDisk.length})
              </p>
              {data.filteredDisk.length === 0 ? (
                <p className="text-[11px] text-kawaii-text-muted px-1 py-2">
                  {data.loadingDisk ? 'Cargando…' : 'Sin archivos en las carpetas de la app.'}
                </p>
              ) : (
                <ul className="space-y-0.5">
                  {data.filteredDisk.slice(0, 80).map((d) => (
                    <li key={d.path} className="flex items-center gap-0.5 rounded-lg hover:bg-pink-50/80">
                      <button
                        type="button"
                        className="flex-1 text-left text-[11px] px-2 py-1.5 truncate"
                        title={d.path}
                        onClick={() => {
                          void (async () => {
                            if (d.isImage) {
                              try {
                                const r = await window.kawaii?.filesToDataUrl?.(d.path)
                                setPreview({
                                  name: d.name,
                                  dataUrl: r?.dataUrl,
                                  filePath: d.path,
                                  kind: 'img'
                                })
                              } catch {
                                setPreview({ name: d.name, filePath: d.path, kind: 'file' })
                              }
                            } else {
                              setPreview({ name: d.name, filePath: d.path, kind: 'doc' })
                            }
                          })()
                        }}
                      >
                        <span className="mr-1">{kindIcon(d.isImage ? 'img' : 'doc', d.isImage)}</span>
                        {d.name}
                        <span className="block text-[9px] text-kawaii-text-muted truncate">
                          {d.kind} · {(d.size / 1024).toFixed(0)} KB
                        </span>
                      </button>
                      <button
                        type="button"
                        className="text-[9px] px-1.5 py-1 shrink-0"
                        title="Ver en carpeta"
                        onClick={() => void window.kawaii?.filesShowInFolder?.(d.path)}
                      >
                        <FolderOpen className="w-3.5 h-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}
        </div>

        {preview ? (
          <div
            className="absolute inset-0 z-10 bg-black/40 flex items-center justify-center p-4"
            onClick={() => setPreview(null)}
            role="presentation"
          >
            <div
              className="bg-white rounded-xl shadow-lg max-w-lg w-full max-h-[85vh] overflow-auto p-3"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-label="Vista previa"
            >
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs font-medium truncate pr-2">{preview.name}</span>
                <button
                  type="button"
                  className="text-xs text-kawaii-text-muted hover:text-kawaii-text"
                  onClick={() => setPreview(null)}
                >
                  Cerrar
                </button>
              </div>
              {preview.dataUrl ? (
                <img
                  src={preview.dataUrl}
                  alt={preview.name}
                  className="w-full rounded-lg object-contain max-h-[60vh]"
                />
              ) : preview.filePath ? (
                <div className="text-[11px] space-y-2">
                  <p className="text-kawaii-text-muted break-all">{preview.filePath}</p>
                  <button
                    type="button"
                    className="text-xs px-2 py-1 rounded bg-pink-100 hover:bg-pink-200"
                    onClick={() => void window.kawaii?.filesOpenPath?.(preview.filePath!)}
                  >
                    Abrir archivo
                  </button>
                  <button
                    type="button"
                    className="text-xs px-2 py-1 rounded border ml-1"
                    onClick={() => void window.kawaii?.filesShowInFolder?.(preview.filePath!)}
                  >
                    Ver en carpeta
                  </button>
                </div>
              ) : (
                <p className="text-[11px] text-kawaii-text-muted">Sin vista previa.</p>
              )}
            </div>
          </div>
        ) : null}
      </aside>
    </div>
  )
}
