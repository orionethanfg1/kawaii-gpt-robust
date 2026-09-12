import { useEffect, useRef, useState } from 'react'
import { APP_VERSION } from '@shared/version'
import { Plus, Trash2, MessageSquare, Download, Upload, FileJson, FileText } from 'lucide-react'
import { useChatStore } from '@shared/lib/stores/chatStore'
import { Button } from '@shared/ui/Button'
import {
  conversationsToJson,
  conversationsToMarkdownBundle,
  conversationToMarkdown,
  downloadTextFile,
  parseImportJson,
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
      const result = parseImportJson(text)
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
            title="Exportar todos (JSON)"
            onClick={() => exportJson(false)}
          >
            <FileJson className="w-3 h-3" /> JSON
          </button>
          <button
            type="button"
            className="text-[10px] px-2 py-1 rounded-lg border border-kawaii-border hover:bg-white flex items-center gap-1"
            title="Exportar todos (Markdown)"
            onClick={() => exportMd(false)}
          >
            <FileText className="w-3 h-3" /> MD
          </button>
          <button
            type="button"
            className="text-[10px] px-2 py-1 rounded-lg border border-kawaii-border hover:bg-white flex items-center gap-1"
            title="Exportar chat activo"
            onClick={() => exportJson(true)}
          >
            <Download className="w-3 h-3" /> Activo
          </button>
          <button
            type="button"
            className="text-[10px] px-2 py-1 rounded-lg border border-kawaii-border hover:bg-white flex items-center gap-1"
            title="Importar JSON"
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="w-3 h-3" /> Importar
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
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
            <MessageSquare className="w-4 h-4 shrink-0 opacity-60" />
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

      <div className="p-3 text-[11px] text-kawaii-text-muted border-t border-kawaii-border">
        {`KawaiiGPT Robust · v${ver}`}
      </div>
    </aside>
  )
}
