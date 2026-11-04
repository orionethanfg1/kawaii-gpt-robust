/**
 * Safe visual URLs for renderer: never put file:// or kawaii-file: in <img src>
 * (CSP img-src only allows 'self' data: blob:).
 */

export function isDataImageUrl(s?: string | null): boolean {
  return Boolean(s && String(s).startsWith('data:image/'))
}

/** Extract absolute filesystem path from path / file:// / kawaii-file: */
export function pathFromVisualRef(s?: string | null): string | undefined {
  const u = String(s || '').trim()
  if (!u || u.startsWith('data:')) return undefined
  if (u.startsWith('kawaii-file:')) {
    return u.slice('kawaii-file:'.length).replace(/^\/\//, '')
  }
  if (u.startsWith('file:')) {
    try {
      // file:///C:/... or file://localhost/C:/...
      let rest = u.replace(/^file:\/\//i, '')
      if (rest.startsWith('localhost/')) rest = rest.slice(10)
      if (rest.startsWith('/')) {
        // Unix or /C:/Windows
        if (/^\/[A-Za-z]:/.test(rest)) rest = rest.slice(1)
      }
      return decodeURIComponent(rest)
    } catch {
      return u.replace(/^file:\/\//i, '')
    }
  }
  // Windows path or POSIX under userData
  if (/^[A-Za-z]:[\\/]/.test(u) || u.startsWith('/')) return u
  return undefined
}

export function needsDiskHydrate(item: {
  dataUrl?: string
  filePath?: string
}): boolean {
  if (isDataImageUrl(item.dataUrl)) return false
  return Boolean(item.filePath || pathFromVisualRef(item.dataUrl))
}


/** CSP-safe URL for a wardrobe file on disk (basename only). */
export function wardrobeMediaUrl(filePathOrName?: string | null): string | undefined {
  const raw = String(filePathOrName || '').trim()
  if (!raw) return undefined
  let name = raw
  if (raw.includes('/') || raw.includes('\\')) {
    name = raw.split(/[/\\]/).pop() || ''
  }
  if (name.startsWith('kawaii-file:')) {
    name = name.slice('kawaii-file:'.length).split(/[/\\]/).pop() || ''
  }
  if (!name || name.includes('..')) return undefined
  if (!/\.(png|jpe?g|webp)$/i.test(name)) return undefined
  return 'kawaii-media://wardrobe/' + encodeURIComponent(name)
}
