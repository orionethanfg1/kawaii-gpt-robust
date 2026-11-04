/**
 * G1 / P0 — Canonical path boundary for host file tools.
 * Main process is the authority: prefix-safe, optional realpath, no soft allow.
 */

import { normalize, resolve, sep, isAbsolute } from 'path'
import { existsSync, realpathSync, lstatSync } from 'fs'

export type PathBoundaryResult =
  | { ok: true; path: string; root: string }
  | { ok: false; error: string }

/** Normalize for comparison (Windows-aware lowercasing). */
export function normalizeForCompare(p: string): string {
  let n = normalize(resolve(String(p || '').trim()))
  // Strip trailing separators except root
  while (n.length > 1 && (n.endsWith('/') || n.endsWith('\\'))) {
    n = n.slice(0, -1)
  }
  return process.platform === 'win32' ? n.toLowerCase() : n
}

/**
 * True if `target` is the same as `root` or a path strictly inside root.
 * Rejects sibling prefix tricks: root "userData" vs "userData-extra".
 */
export function isPathInsideRoot(target: string, root: string): boolean {
  const t = normalizeForCompare(target)
  const r = normalizeForCompare(root)
  if (!t || !r) return false
  if (t === r) return true
  const prefix = r.endsWith(sep) ? r : r + sep
  // On Windows sep is `\`; also accept `/` after normalize (Node normalize uses `\`)
  const prefixAlt = prefix.replace(/\\/g, '/')
  const tAlt = t.replace(/\\/g, '/')
  return t.startsWith(prefix) || tAlt.startsWith(prefixAlt)
}

/**
 * Resolve real path when the path exists (follows symlinks/junctions).
 * If it does not exist yet (dest of copy), resolve parent realpath + basename.
 */
export function resolveCanonical(filePath: string): string {
  const raw = String(filePath || '').trim()
  if (!raw) throw new Error('Ruta vacía')
  const resolved = resolve(raw)
  try {
    if (existsSync(resolved)) {
      return realpathSync(resolved)
    }
    // Destination may not exist: canonicalize parent
    const parent = resolve(resolved, '..')
    if (existsSync(parent)) {
      const realParent = realpathSync(parent)
      const base = resolved.slice(parent.length).replace(/^[/\\]+/, '')
      return resolve(realParent, base)
    }
  } catch {
    /* fall through to resolved */
  }
  return resolved
}

/**
 * Allow only if canonical path is under one of the roots.
 * @param extraRoots optional trusted dirs (must already be user-approved settings)
 */
export function assertPathAllowed(
  filePath: string,
  primaryRoot: string,
  extraRoots?: string[]
): PathBoundaryResult {
  try {
    const raw = String(filePath || '').trim()
    if (!raw) return { ok: false, error: 'Ruta vacía' }
    if (raw.includes('\0')) return { ok: false, error: 'Ruta inválida' }

    // Reject obvious system escapes early
    const lower = raw.toLowerCase().replace(/\\/g, '/')
    if (
      /^(c:)?\/windows\b/i.test(lower) ||
      /\/system32\b/i.test(lower) ||
      lower.startsWith('//') ||
      /^[a-z]:\/\/+/i.test(raw)
    ) {
      return { ok: false, error: 'Ruta de sistema no permitida' }
    }

    const canonical = resolveCanonical(raw)
    const roots = [
      primaryRoot,
      ...(extraRoots || []).map((r) => String(r || '').trim()).filter(Boolean)
    ]
      .map((r) => {
        try {
          return existsSync(r) ? realpathSync(resolve(r)) : resolve(r)
        } catch {
          return resolve(r)
        }
      })
      .filter(Boolean)

    for (const root of roots) {
      if (isPathInsideRoot(canonical, root)) {
        return { ok: true, path: canonical, root }
      }
    }
    return {
      ok: false,
      error: 'Ruta fuera de userData y de carpetas de confianza (trustedFileRoots)'
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Soft check: path looks like a symlink/junction (for audit). */
export function isSymlinkOrJunction(filePath: string): boolean {
  try {
    const st = lstatSync(filePath)
    return st.isSymbolicLink()
  } catch {
    return false
  }
}
