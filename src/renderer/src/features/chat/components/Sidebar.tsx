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
import { useUiChromeStore } from '@shared/lib/stores/uiChromeStore'

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
  useEffect(() => {
    void persistMissingChatAttachments().catch(() => null)
  }, [])

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

      <div className="border-t border-kawaii-border/60 px-3 py-2 shrink-0 space-y-1">
        <button
          type="button"
          className="text-[11px] w-full text-left px-2 py-1.5 rounded-lg border border-kawaii-border/70 hover:bg-pink-50 text-kawaii-text"
          onClick={() => useUiChromeStore.getState().setLibraryOpen(true)}
          title="Abrir biblioteca de adjuntos y archivos"
        >
          📚 Biblioteca de archivos
        </button>
        <p className="text-[9px] text-kawaii-text-muted px-1">
          Buscar, filtrar y previsualizar sin amontonar el panel de chats
        </p>
      </div>

      <div className="p-3 text-[11px] text-kawaii-text-muted border-t border-kawaii-border">
        {APP_REVISION ? ("KawaiiGPT Robust · v" + ver + " rev." + APP_REVISION) : ("KawaiiGPT Robust · v" + ver)}
      </div>
    </aside>
  )
}
