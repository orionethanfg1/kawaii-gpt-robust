import { useEffect, useRef, useState } from 'react'
import { APP_VERSION, APP_REVISION } from '@shared/version'
import { Plus, Trash2, MessageSquare, Download, Upload, FileJson, FileText } from 'lucide-react'
import { KawaiiIcon } from '@shared/ui/KawaiiIcon'
import { useChatStore } from '@shared/lib/stores/chatStore'
import { persistMissingChatAttachments } from '../services/persistChatAttachments'
import { Button } from '@shared/ui/Button'
import {
  conversationsToJson,
  conversationsToMarkdownBundle,
  conversationToMarkdown,
  downloadTextFile,
  parseImportAny,
  stampFilename
} from '../lib/exportImport'

export function Sidebar() {
  const [ver, setVer] = useState(
    typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : APP_VERSION
  )
  useEffect(() => {
    const baked =
      typeof __APP_VERSION__ !== 'undefined' && __APP_VERSION__
        ? __APP_VERSION__
        : APP_VERSION
    setVer(baked)
    void window.kawaii?.getVersion?.().then((v) => {
      const electronV = String(v || '').replace(/^v/, '').trim()
      // Always show package.json version from main when available (source of truth)
      if (electronV) setVer(electronV)
      else setVer(baked)
    }).catch(() => setVer(baked))
  }, [])

  const {
    conversations,
    activeId,
    create,
    remove,
    setActive,
    importConversations,
    getActive
  } = useChatStore()
  const fileRef = useRef<HTMLInputElement>(null)
  const [importMsg, setImportMsg] = useState<string | null>(null)
  const [showLibrary, setShowLibrary] = useState(false)
  useEffect(() => {
    void persistMissingChatAttachments().catch(() => null)
  }, [])
  const [preview, setPreview] = useState<{
    name: string
    dataUrl?: string
    filePath?: string
    kind: string
  } | null>(null)
  const attachmentLibrary = (() => {
    type LibItem = {
      id: string
      name: string
      convId: string
      convTitle: string
      kind: 'img' | 'doc' | 'file' | 'gen'
      source: 'user' | 'assistant' | 'generated'
      filePath?: string
      dataUrl?: string
      role: string
    }
    const items: LibItem[] = []
    const seen = new Set<string>()
    const push = (it: LibItem) => {
      const key = `${it.filePath || ''}|${it.name}|${it.convId}|${it.kind}`
      if (seen.has(key)) return
      seen.add(key)
      items.push(it)
    }
    for (const c of conversations) {
      for (const m of c.messages || []) {
        const role = m.role || 'user'
        for (const a of m.attachments || []) {
          if (!a) continue
          const isImg = Boolean(
            a.mimeType?.startsWith('image/') ||
              a.dataUrl?.startsWith('data:image') ||
              /\.(png|jpe?g|webp|gif)$/i.test(a.name || '')
          )
          const kind: LibItem['kind'] = isImg
            ? role === 'assistant'
              ? 'gen'
              : 'img'
            : a.textContent
              ? 'doc'
              : 'file'
          push({
            id: a.id || a.name || `${c.id}-${items.length}`,
            name: a.name || (isImg ? 'imagen' : 'archivo'),
            convId: c.id,
            convTitle: c.title || 'Chat',
            kind,
            source:
              role === 'assistant' || kind === 'gen'
                ? 'generated'
                : role === 'user'
                  ? 'user'
                  : 'assistant',
            filePath: a.filePath,
            dataUrl: a.dataUrl,
            role
          })
        }
        // Generated image stored only in meta
        const metaPath = (m.meta as { imageFilePath?: string } | undefined)?.imageFilePath
        if (metaPath && typeof metaPath === 'string') {
          const base = metaPath.split(/[/\\]/).pop() || 'imagen-generada'
          push({
            id: `meta-${c.id}-${metaPath}`,
            name: base,
            convId: c.id,
            convTitle: c.title || 'Chat',
            kind: 'gen',
            source: 'generated',
            filePath: metaPath,
            role: m.role || 'assistant'
          })
        }
        const musicPath = (m.meta as { musicPath?: string } | undefined)?.musicPath
        if (musicPath && typeof musicPath === 'string') {
          const base = musicPath.split(/[/\\]/).pop() || 'audio'
          push({
            id: `music-${c.id}-${musicPath}`,
            name: base,
            convId: c.id,
            convTitle: c.title || 'Chat',
            kind: 'file',
            source: 'generated',
            filePath: musicPath,
            role: m.role || 'assistant'
          })
        }
      }
    }
    // Newest first-ish by conversation order reverse
    return items.slice(0, 80)
  })()

  const exportJson = (onlyActive: boolean) => {
    const list = onlyActive
      ? ([getActive()].filter(Boolean) as NonNullable<ReturnType<typeof getActive>>[])
      : conversations
    if (list.length === 0) {
      setImportMsg('No hay chats para exportar')
      return
    }
    downloadTextFile(
      stampFilename(onlyActive ? 'kawaii-chat' : 'kawaii-chats', 'json'),
      conversationsToJson(list),
      'application/json'
    )
    setImportMsg(null)
  }

  const exportMd = (onlyActive: boolean) => {
    const active = getActive()
    if (onlyActive && active) {
      downloadTextFile(
        stampFilename('kawaii-chat', 'md'),
        conversationToMarkdown(active),
        'text/markdown'
      )
      return
    }
    if (conversations.length === 0) {
      setImportMsg('No hay chats para exportar')
      return
    }
    downloadTextFile(
      stampFilename('kawaii-chats', 'md'),
      conversationsToMarkdownBundle(conversations),
      'text/markdown'
    )
  }

  const onImportFile = async (file: File | null) => {
    if (!file) return
    try {
      const text = await file.text()
      const result = parseImportAny(text, file.name)
      if (!result.ok) {
        setImportMsg(result.error || 'Importación fallida')
        return
      }
      const n = importConversations(result.conversations, 'merge')
      setImportMsg(`Importadas ${n} conversación(es)`)
    } catch (err) {
      setImportMsg(err instanceof Error ? err.message : 'Error al importar')
    }
  }

  return (
    <aside className="w-64 flex flex-col border-r border-kawaii-border bg-kawaii-surface-alt/80">
      <div className="p-3 border-b border-kawaii-border space-y-2">
        <Button className="w-full" onClick={() => create()}>
          <Plus className="w-4 h-4" />
          Nueva chat
        </Button>
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            className="text-[10px] px-2 py-1 rounded-lg border border-kawaii-border hover:bg-white flex items-center gap-1"
            title="Exportar todos los chats (JSON)"
            onClick={() => exportJson(false)}
          >
            <Download className="w-3 h-3" /> Exportar JSON
          </button>
          <button
            type="button"
            className="text-[10px] px-2 py-1 rounded-lg border border-kawaii-border hover:bg-white flex items-center gap-1"
            title="Exportar todos (Markdown)"
            onClick={() => exportMd(false)}
          >
            <Download className="w-3 h-3" /> Exportar MD
          </button>
          <button
            type="button"
            className="text-[10px] px-2 py-1 rounded-lg border border-kawaii-border hover:bg-white flex items-center gap-1"
            title="Exportar solo el chat activo"
            onClick={() => exportJson(true)}
          >
            <Download className="w-3 h-3" /> Exportar activo
          </button>
          <button
            type="button"
            className="text-[10px] px-2 py-1 rounded-lg border border-kawaii-border hover:bg-white flex items-center gap-1"
            title="Importar desde archivo JSON o Markdown"
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="w-3 h-3" /> Importar archivo
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json,.md,.markdown,text/markdown,text/plain"
            className="hidden"
            onChange={(e) => {
              void onImportFile(e.target.files?.[0] ?? null)
              e.target.value = ''
            }}
          />
        </div>
        {importMsg && (
          <p className="text-[10px] text-kawaii-text-muted leading-snug">{importMsg}</p>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto p-2 space-y-1">
        {conversations.length === 0 && (
          <p className="text-xs text-kawaii-text-muted text-center py-6">
            Sin conversaciones aún
          </p>
        )}
        {conversations.map((c) => (
          <div
            key={c.id}
            className={`group flex items-center gap-2 rounded-kawaii px-3 py-2 cursor-pointer transition ${
              c.id === activeId
                ? 'bg-kawaii-pink-soft text-kawaii-text'
                : 'hover:bg-white/70 text-kawaii-text-muted'
            }`}
            onClick={() => setActive(c.id)}
          >
            <KawaiiIcon name="chat" size={18} className="opacity-90" />
            <span className="flex-1 truncate text-sm font-medium">{c.title}</span>
            <button
              className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-100 text-red-500"
              onClick={(e) => {
                e.stopPropagation()
                remove(c.id)
              }}
              title="Eliminar"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </nav>

      <div className="border-t border-kawaii-border/60 px-3 py-2 shrink-0">
        <button
          type="button"
          className="text-[11px] w-full text-left text-kawaii-text-muted hover:text-kawaii-text"
          onClick={() => {
            setShowLibrary((v) => {
              const next = !v
              if (next) void persistMissingChatAttachments().catch(() => null)
              return next
            })
          }}
        >
          {showLibrary ? '▾' : '▸'} Biblioteca de adjuntos ({attachmentLibrary.length})
        </button>
        {showLibrary ? (
          <div className="mt-1 space-y-1">
            <div className="flex gap-1 flex-wrap">
              <button
                type="button"
                className="text-[10px] px-1.5 py-0.5 rounded border border-kawaii-border/60 hover:bg-pink-50"
                title="Abrir carpeta de modelos LM Studio"
                onClick={() => {
                  void window.kawaii?.modelsOpenLayerFolder?.('lmstudio')
                }}
              >
                📂 LM Studio
              </button>
              <button
                type="button"
                className="text-[10px] px-1.5 py-0.5 rounded border border-kawaii-border/60 hover:bg-pink-50"
                title="Abrir carpeta de modelos Ollama"
                onClick={() => {
                  void window.kawaii?.modelsOpenLayerFolder?.('ollama')
                }}
              >
                📂 Ollama
              </button>
              <button
                type="button"
                className="text-[10px] px-1.5 py-0.5 rounded border border-kawaii-border/60 hover:bg-pink-50"
                title="Archivos que TÚ subiste (originales)"
                onClick={() => {
                  void (async () => {
                    try {
                      const openDir =
                        window.kawaii?.filesOpenUserUploadsDir ||
                        window.kawaii?.filesOpenChatAttachmentsDir
                      if (typeof openDir === 'function') {
                        const r = await openDir()
                        if (r?.ok) return
                      }
                      const dirs = await window.kawaii?.filesListKnownDirs?.()
                      const att = dirs?.dirs?.find((d) =>
                        /user-uploads|subidas/i.test(String(d.id) + String(d.label))
                      )
                      if (att?.path) await window.kawaii?.filesOpenPath?.(att.path)
                    } catch (e) {
                      console.warn('[sidebar] open user-uploads failed', e)
                    }
                  })()
                }}
              >
                📂 Mis archivos
              </button>
              <button
                type="button"
                className="text-[10px] px-1.5 py-0.5 rounded border border-kawaii-border/60 hover:bg-pink-50"
                title="Extractos y material que la app usa para contexto / memoria"
                onClick={() => {
                  void (async () => {
                    try {
                      const openDir = window.kawaii?.filesOpenAppContextDir
                      if (typeof openDir === 'function') {
                        const r = await openDir()
                        if (r?.ok) return
                      }
                      const dirs = await window.kawaii?.filesListKnownDirs?.()
                      const att = dirs?.dirs?.find((d) =>
                        /app-context|contexto/i.test(String(d.id) + String(d.label))
                      )
                      if (att?.path) await window.kawaii?.filesOpenPath?.(att.path)
                    } catch (e) {
                      console.warn('[sidebar] open app-context failed', e)
                    }
                  })()
                }}
              >
                📂 Contexto app
              </button>
              <button
                type="button"
                className="text-[10px] px-1.5 py-0.5 rounded border border-kawaii-border/60 hover:bg-pink-50"
                title="Abrir carpeta de imágenes generadas"
                onClick={() => {
                  void (async () => {
                    try {
                      const folder = await window.kawaii?.imageGetFolder?.()
                      const p =
                        typeof folder === 'string'
                          ? folder
                          : (folder as { path?: string } | null)?.path
                      if (p) await window.kawaii?.filesOpenPath?.(p)
                      else {
                        const dirs = await window.kawaii?.filesListKnownDirs?.()
                        const gen = dirs?.dirs?.find((d) =>
                          /generated|imagen/i.test(d.id + d.label)
                        )
                        if (gen?.path) await window.kawaii?.filesOpenPath?.(gen.path)
                      }
                    } catch {
                      /* ignore */
                    }
                  })()
                }}
              >
                📂 Imágenes gen.
              </button>
            </div>
            <ul className="max-h-44 overflow-y-auto space-y-1">
              {attachmentLibrary.length === 0 ? (
                <li className="text-[10px] text-kawaii-text-muted">
                  Sin adjuntos ni generados en chats. Sube un archivo o genera una imagen.
                </li>
              ) : (
                attachmentLibrary.map((a) => (
                  <li
                    key={a.id + a.convId + (a.filePath || '')}
                    className="flex items-center gap-0.5 group"
                  >
                    <button
                      type="button"
                      className="text-[10px] flex-1 text-left truncate hover:bg-pink-50 rounded px-1 py-0.5"
                      title={`${a.convTitle} · ${a.name}${a.filePath ? '\n' + a.filePath : ''}`}
                      onClick={() => {
                        if (a.kind === 'img' || a.kind === 'gen') {
                          setPreview({
                            name: a.name,
                            dataUrl: a.dataUrl,
                            filePath: a.filePath,
                            kind: a.kind
                          })
                        } else {
                          setActive(a.convId)
                        }
                      }}
                    >
                      {a.kind === 'gen' ? '🎨' : a.kind === 'img' ? '🖼️' : a.kind === 'doc' ? '📄' : '📎'}{' '}
                      <span className="text-kawaii-text-muted">
                        {a.source === 'user' ? '↑' : a.source === 'generated' ? '✦' : '·'}
                      </span>{' '}
                      {a.name}
                    </button>
                    {a.filePath ? (
                      <button
                        type="button"
                        className="text-[9px] px-1 opacity-70 hover:opacity-100 shrink-0"
                        title="Abrir carpeta contenedora"
                        onClick={(e) => {
                          e.stopPropagation()
                          void window.kawaii?.filesShowInFolder?.(a.filePath!)
                        }}
                      >
                        📂
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="text-[9px] px-1 opacity-70 hover:opacity-100 shrink-0"
                      title="Ir al chat"
                      onClick={(e) => {
                        e.stopPropagation()
                        setActive(a.convId)
                      }}
                    >
                      💬
                    </button>
                  </li>
                ))
              )}
            </ul>
            {preview ? (
              <div
                className="fixed inset-0 z-[80] bg-black/50 flex items-center justify-center p-4"
                onClick={() => setPreview(null)}
                role="presentation"
              >
                <div
                  className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[85vh] overflow-auto p-3"
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
                        onClick={() => {
                          void window.kawaii?.filesOpenPath?.(preview.filePath!)
                        }}
                      >
                        Abrir archivo
                      </button>
                      <button
                        type="button"
                        className="text-xs px-2 py-1 rounded border ml-1"
                        onClick={() => {
                          void window.kawaii?.filesShowInFolder?.(preview.filePath!)
                        }}
                      >
                        Ver en carpeta
                      </button>
                    </div>
                  ) : (
                    <p className="text-[11px] text-kawaii-text-muted">
                      Sin vista previa (solo en el chat).
                    </p>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="p-3 text-[11px] text-kawaii-text-muted border-t border-kawaii-border">
        {APP_REVISION ? ("KawaiiGPT Robust · v" + ver + " rev." + APP_REVISION) : ("KawaiiGPT Robust · v" + ver)}
      </div>
    </aside>
  )
}
