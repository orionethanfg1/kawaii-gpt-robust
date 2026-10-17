/**
 * Third-party plugin manifest validation & normalize (safe, pure).
 */
import type { PluginManifest, PluginToolDef, PluginListItem } from './types'

export type PluginValidationIssue = {
  level: 'error' | 'warn'
  path: string
  message: string
}

export type PluginValidationResult = {
  ok: boolean
  issues: PluginValidationIssue[]
  normalized?: PluginManifest
}

const ID_RE = /^[a-z][a-z0-9_-]{1,63}$/i

function asTools(raw: unknown): PluginToolDef[] {
  if (!Array.isArray(raw)) return []
  const out: PluginToolDef[] = []
  for (const t of raw) {
    if (typeof t === 'string' && t.trim()) {
      out.push({ name: t.trim() })
    } else if (t && typeof t === 'object' && typeof (t as { name?: string }).name === 'string') {
      const o = t as PluginToolDef
      out.push({
        name: String(o.name).trim(),
        description: o.description ? String(o.description).slice(0, 400) : undefined,
        parameters: o.parameters && typeof o.parameters === 'object' ? o.parameters : undefined
      })
    }
  }
  return out.filter((t) => t.name.length > 0)
}

/** Normalize loose JSON into a PluginManifest (best-effort). */
export function normalizePluginManifest(
  raw: Record<string, unknown>,
  fallbackId?: string
): PluginManifest {
  const id = String(raw.id || fallbackId || 'plugin')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .slice(0, 64)
  const tools = asTools(raw.tools)
  const phrases = Array.isArray(raw.phrases)
    ? raw.phrases.map((p) => String(p).trim()).filter(Boolean).slice(0, 12)
    : []
  const permissions = Array.isArray(raw.permissions)
    ? raw.permissions.map((p) => String(p).trim()).filter(Boolean).slice(0, 16)
    : []
  const runtimeRaw = String(raw.runtime || 'builtin').toLowerCase()
  const runtime =
    runtimeRaw === 'python' || runtimeRaw === 'node' || runtimeRaw === 'builtin'
      ? (runtimeRaw as PluginManifest['runtime'])
      : 'builtin'

  return {
    id: id || 'plugin',
    name: String(raw.name || id || 'Plugin').slice(0, 80),
    version: raw.version != null ? String(raw.version).slice(0, 32) : undefined,
    runtime,
    entry: raw.entry != null ? String(raw.entry) : null,
    tools,
    permissions,
    phrases,
    category: raw.category != null ? String(raw.category).slice(0, 32) : 'sistema',
    summary: raw.summary != null ? String(raw.summary).slice(0, 240) : undefined,
    author: raw.author != null ? String(raw.author).slice(0, 80) : undefined,
    homepage: raw.homepage != null ? String(raw.homepage).slice(0, 200) : undefined,
    kawaiiMinVersion:
      raw.kawaiiMinVersion != null ? String(raw.kawaiiMinVersion).slice(0, 24) : undefined,
    enabled: raw.enabled === false ? false : true,
    source: (raw.source as PluginManifest['source']) || 'disk'
  }
}

/** Validate manifest; returns issues. ok=false only on hard errors. */
export function validatePluginManifest(
  raw: unknown,
  fallbackId?: string
): PluginValidationResult {
  const issues: PluginValidationIssue[] = []
  if (!raw || typeof raw !== 'object') {
    return {
      ok: false,
      issues: [{ level: 'error', path: '', message: 'manifest debe ser un objeto JSON' }]
    }
  }
  const obj = raw as Record<string, unknown>
  const normalized = normalizePluginManifest(obj, fallbackId)

  if (!ID_RE.test(normalized.id)) {
    issues.push({
      level: 'error',
      path: 'id',
      message: 'id inválido (usa letras, números, _ o -; 2–64 chars)'
    })
  }
  if (!normalized.name.trim()) {
    issues.push({ level: 'error', path: 'name', message: 'name es obligatorio' })
  }
  if (!normalized.tools.length) {
    issues.push({
      level: 'warn',
      path: 'tools',
      message: 'sin tools: el panel no podrá ejecutar nada'
    })
  }
  for (const t of normalized.tools) {
    if (!/^[a-z][a-z0-9_]{1,63}$/i.test(t.name)) {
      issues.push({
        level: 'error',
        path: `tools.${t.name}`,
        message: 'nombre de tool inválido'
      })
    }
  }
  if (normalized.runtime === 'python' && !normalized.entry) {
    issues.push({
      level: 'warn',
      path: 'entry',
      message: 'runtime python sin entry (script)'
    })
  }
  if (normalized.runtime === 'node') {
    issues.push({
      level: 'warn',
      path: 'runtime',
      message: 'runtime node aún experimental en esta versión'
    })
  }

  const hard = issues.some((i) => i.level === 'error')
  return { ok: !hard, issues, normalized }
}

export function validatePluginListItem(item: PluginListItem): PluginValidationResult {
  return validatePluginManifest(item as unknown as Record<string, unknown>, item.id)
}
