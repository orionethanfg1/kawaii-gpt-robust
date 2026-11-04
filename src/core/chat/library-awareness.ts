/**
 * Tell the LLM what exists in the local library (user uploads, context extracts, images)
 * so it can offer to open, read, or talk about those files in conversation.
 */

export type LibraryItemLite = {
  name: string
  path?: string
  kind: 'user' | 'context' | 'images' | 'wardrobe' | 'backups' | 'other' | string
  size?: number
  isImage?: boolean
  /** From chat attachment index */
  fromChat?: boolean
}

const KIND_LABEL: Record<string, string> = {
  user: 'archivo del usuario',
  context: 'extracto / contexto app',
  images: 'imagen generada',
  wardrobe: 'guardarropa',
  backups: 'respaldo',
  other: 'otro'
}

export function buildLibraryAwarenessBlock(
  items: LibraryItemLite[],
  opts?: { maxItems?: number }
): string {
  if (!items?.length) return ''
  const max = opts?.maxItems ?? 24
  const sorted = [...items].slice(0, max)
  const lines = sorted.map((it, i) => {
    const kind = KIND_LABEL[it.kind] || it.kind
    const img = it.isImage ? ' · imagen' : ''
    const size =
      typeof it.size === 'number' && it.size > 0
        ? ` · ~${Math.max(1, Math.round(it.size / 1024))} KB`
        : ''
    return `${i + 1}. «${it.name}» (${kind}${img}${size})`
  })
  return (
    '[BIBLIOTECA_LOCAL] Archivos disponibles en esta app (el usuario puede pedir leerlos, abrirlos o comentarlos). ' +
    'Si pide uno por nombre, usa herramientas/lectura de documentos o indica la carpeta; no inventes contenido que no hayas leído.\n' +
    lines.join('\n') +
    (items.length > max ? `\n…y ${items.length - max} más en disco.` : '')
  )
}

/** Merge disk inventory + chat attachment names (dedupe by name). */
export function mergeLibraryCatalog(
  disk: LibraryItemLite[],
  fromChats: LibraryItemLite[]
): LibraryItemLite[] {
  const seen = new Set<string>()
  const out: LibraryItemLite[] = []
  for (const it of [...disk, ...fromChats]) {
    const key = (it.name || '').toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(it)
  }
  return out
}
