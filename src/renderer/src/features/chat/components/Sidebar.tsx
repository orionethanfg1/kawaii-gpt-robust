import { useEffect, useRef, useState } from 'react'
import { APP_VERSION, APP_REVISION } from '@shared/version'
import { Plus, Trash2, MessageSquare, Download, Upload, FileJson, FileText, Pencil} from 'lucide-react'
import { KawaiiIcon } from '@shared/ui/KawaiiIcon'
import { useChatStore } from '@shared/lib/stores/chatStore'
import { suggestChatTitles } from '../services/suggestChatTitles'
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
import {
  exportFullBackup,
  importFullBackup,
  openBackupsFolder
} from '@features/backup/fullBackupService'
import { recoverChatsFromDisk, forceSpillAllChats } from '../services/chatRecovery'

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
    getActive,
    rename,
    setPrivate
  } = useChatStore()
  const fileRef = useRef<HTMLInputElement>(null)
  const [importMsg, setImportMsg] = useState<string | null>(null)
  const [renameId, setRenameId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [renameSuggestions, setRenameSuggestions] = useState<string[]>([])
  const [renameLoading, setRenameLoading] = useState(false)
  const [showLibrary, setShowLibrary] = useState(false)
  const [diskLibrary, setDiskLibrary] = useState<
    Array<{
      name: string
      path: string
      kind: string
      size: number
      isImage: boolean
    }>
  >([])
  useEffect(() => {
    void persistMissingChatAttachments().catch(() => null)
  }, [])
  useEffect(() => {
    if (!showLibrary) return
    void (async () => {
      try {
        const r = await window.kawaii?.filesListLibrary?.()
        if (r?.ok && r.items) setDiskLibrary(r.items)
      } catch {
        setDiskLibrary([])
      }
    })()
  }, [showLibrary])
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
    void (async () => {
      let list = onlyActive
        ? ([getActive()].filter(Boolean) as NonNullable<ReturnType<typeof getActive>>[])
        : [...conversations]
      if (list.length === 0) {
        setImportMsg('No hay chats para exportar')
        return
      }
      const priv = list.filter((c) => c.isPrivate)
      if (priv.length) {
        const st = useSettingsStore.getState().settings
        if (st.appLockEnabled && st.appLockPinHashB64) {
          const pin = window.prompt(
            'Hay chats privados. Introduce el PIN de la app para incluirlos, o Cancelar.'
          )
          if (pin == null) return
          const { verifyPin } = await import('@core/security/app-lock')
          const ok = await verifyPin(
            pin.trim(),
            st.appLockSaltB64 || '',
            st.appLockPinHashB64 || ''
          )
          if (!ok) {
            setImportMsg('PIN incorrecto — no se exportó')
            return
          }
        }
      }
      downloadTextFile(
        stampFilename(onlyActive ? 'kawaii-chat' : 'kawaii-chats', 'json'),
        conversationsToJson(list),
        'application/json'
      )
      setImportMsg(null)
    })()
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
          <button
            type="button"
            className="text-[10px] flex items-center gap-1 px-1.5 py-0.5 rounded border border-amber-300/80 bg-amber-50 hover:bg-amber-100 text-amber-950"
            title="Fusionar chats desde userData/chats (recuperar historial perdido)"
            onClick={() => {
              void (async () => {
                try {
                  setImportMsg('Recuperando desde disco…')
                  const r = await recoverChatsFromDisk()
                  setImportMsg(
                    r.ok
                      ? `Recuperación: ${r.restored} restaurados, ${r.merged} fusionados · disco ${r.diskFiles} · LS ${r.lsSnapshots || 0}` +
                        (r.details[0] ? ` · ${r.details[0].slice(0, 80)}` : '')
                      : `Falló: ${r.details[0] || 'error'}`
                  )
                } catch (e) {
                  setImportMsg(e instanceof Error ? e.message : String(e))
                }
              })()
            }}
          >
            ♻ Recuperar chats
          </button>
          <button
            type="button"
            className="text-[10px] flex items-center gap-1 px-1.5 py-0.5 rounded border border-kawaii-border/60 hover:bg-pink-50"
            title="Guardar ahora todos los chats en disco"
            onClick={() => {
              void (async () => {
                try {
                  const n = await forceSpillAllChats()
                  setImportMsg(n > 0 ? `Respaldo en disco: ${n} chat(s)` : 'Nada que respaldar')
                } catch (e) {
                  setImportMsg(e instanceof Error ? e.message : String(e))
                }
              })()
            }}
          >
            💾 Respaldar ahora
          </button>
          <button
            type="button"
            className="text-[10px] flex items-center gap-1 px-1.5 py-0.5 rounded border border-emerald-300/80 bg-emerald-50 hover:bg-emerald-100 text-emerald-950"
            title="Respaldo completo: chats, memorias, personalidad, guardarropa (carpeta portable)"
            onClick={() => {
              void (async () => {
                setImportMsg('Creando respaldo completo…')
                const r = await exportFullBackup()
                setImportMsg(r.message)
              })()
            }}
          >
            📦 Respaldo completo
          </button>
          <button
            type="button"
            className="text-[10px] flex items-center gap-1 px-1.5 py-0.5 rounded border border-sky-300/80 bg-sky-50 hover:bg-sky-100 text-sky-950"
            title="Importar carpeta kawaii-full-… (merge)"
            onClick={() => {
              void (async () => {
                setImportMsg('Importando respaldo…')
                const r = await importFullBackup('merge')
                setImportMsg(r.message)
              })()
            }}
          >
            📥 Importar completo
          </button>
          <button
            type="button"
            className="text-[10px] flex items-center gap-1 px-1.5 py-0.5 rounded border border-kawaii-border/60 hover:bg-white"
            title="Abrir carpeta de respaldos (userData/backups)"
            onClick={() => {
              void openBackupsFolder()
            }}
          >
            📂 Carpeta backups
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
          <div key={c.id} className="relative">
            <div
              className={`group flex items-center gap-1.5 rounded-kawaii px-3 py-2 cursor-pointer transition ${
                c.id === activeId
                  ? 'bg-kawaii-pink-soft text-kawaii-text'
                  : 'hover:bg-white/70 text-kawaii-text-muted'
              }`}
              onClick={() => {
                if (renameId !== c.id) setActive(c.id)
              }}
            >
              <KawaiiIcon name="chat" size={18} className="opacity-90 shrink-0" />
              <span className="flex-1 truncate text-sm font-medium">
                {c.isPrivate ? '🔒 Chat privado' : c.title}
              </span>
              <button
                type="button"
                className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-kawaii-pink-soft text-kawaii-text-muted"
                title={c.isPrivate ? 'Quitar privado' : 'Marcar privado'}
                onClick={(e) => {
                  e.stopPropagation()
                  setPrivate?.(c.id, !c.isPrivate)
                }}
              >
                <span className="text-[10px]">{c.isPrivate ? '🔓' : '🔒'}</span>
              </button>
              <button
                type="button"
                className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-kawaii-pink-soft text-kawaii-text-muted"
                title="Renombrar"
                onClick={(e) => {
                  e.stopPropagation()
                  setRenameId(c.id)
                  setRenameDraft(c.title || '')
                  setRenameSuggestions([])
                  void (async () => {
                    setRenameLoading(true)
                    try {
                      const sug = await suggestChatTitles({
                        messages: (c.messages || []).map((m) => ({
                          role: m.role,
                          content: m.content
                        })),
                        currentTitle: c.title,
                        useLlm: true
                      })
                      setRenameSuggestions(sug)
                    } catch {
                      /* */
                    } finally {
                      setRenameLoading(false)
                    }
                  })()
                }}
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
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
            {renameId === c.id ? (
              <div
                className="absolute left-1 right-1 top-full z-30 mt-1 rounded-kawaii border border-kawaii-border bg-white shadow-lg p-2 space-y-2"
                onClick={(e) => e.stopPropagation()}
              >
                <p className="text-[10px] font-semibold text-kawaii-text">Renombrar chat</p>
                <input
                  className="input-kawaii text-xs w-full"
                  value={renameDraft}
                  autoFocus
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const v = renameDraft.trim()
                      if (v) rename(c.id, v.slice(0, 60))
                      setRenameId(null)
                    }
                    if (e.key === 'Escape') setRenameId(null)
                  }}
                />
                <div className="flex flex-wrap gap-1">
                  {renameLoading ? (
                    <span className="text-[10px] text-kawaii-text-muted">Sugerencias…</span>
                  ) : null}
                  {renameSuggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className="text-[10px] px-1.5 py-0.5 rounded-full border border-kawaii-border hover:bg-kawaii-pink-soft/50"
                      onClick={() => {
                        setRenameDraft(s)
                        rename(c.id, s.slice(0, 60))
                        setRenameId(null)
                      }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2 justify-end">
                  <button
                    type="button"
                    className="text-[10px] text-kawaii-text-muted hover:underline"
                    onClick={() => setRenameId(null)}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    className="text-[10px] font-semibold text-kawaii-pink-deep hover:underline"
                    onClick={() => {
                      const v = renameDraft.trim()
                      if (v) rename(c.id, v.slice(0, 60))
                      setRenameId(null)
                    }}
                  >
                    Guardar
                  </button>
                </div>
              </div>
            ) : null}
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
            {diskLibrary.length > 0 ? (
              <div className="mb-1">
                <p className="text-[9px] font-semibold text-kawaii-text-muted px-1 mb-0.5">
                  En disco ({diskLibrary.length})
                </p>
                <ul className="max-h-28 overflow-y-auto space-y-0.5 mb-1">
                  {diskLibrary.slice(0, 40).map((d) => (
                    <li key={d.path} className="flex items-center gap-0.5">
                      <button
                        type="button"
                        className="text-[10px] flex-1 text-left truncate hover:bg-pink-50 rounded px-1 py-0.5"
                        title={d.path}
                        onClick={() => {
                          if (d.isImage) {
                            void (async () => {
                              try {
                                const r = await window.kawaii?.filesToDataUrl?.(d.path)
                                setPreview({
                                  name: d.name,
                                  dataUrl: r?.dataUrl,
                                  filePath: d.path,
                                  kind: 'img'
                                })
                              } catch {
                                setPreview({
                                  name: d.name,
                                  filePath: d.path,
                                  kind: 'file'
                                })
                              }
                            })()
                          } else {
                            setPreview({
                              name: d.name,
                              filePath: d.path,
                              kind: d.kind === 'context' ? 'doc' : 'file'
                            })
                          }
                        }}
                      >
                        {d.isImage ? '🖼️' : d.kind === 'context' ? '📄' : '📎'}{' '}
                        <span className="text-kawaii-text-muted text-[9px]">
                          {d.kind === 'user' ? 'tú' : d.kind === 'context' ? 'app' : d.kind}
                        </span>{' '}
                        {d.name}
                      </button>
                      <button
                        type="button"
                        className="text-[9px] px-1 shrink-0"
                        title="Carpeta"
                        onClick={() => void window.kawaii?.filesShowInFolder?.(d.path)}
                      >
                        📂
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <p className="text-[9px] font-semibold text-kawaii-text-muted px-1 mb-0.5">
              En chats ({attachmentLibrary.length})
            </p>
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
