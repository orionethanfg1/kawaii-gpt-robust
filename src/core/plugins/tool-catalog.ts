/**
 * PLUG — unified tool catalog for UI + agent (disk plugins ∪ capability registry).
 */
import { CAPABILITY_PLUGINS } from '@core/agent/capabilities-registry'
import { mergeCapabilityPlugins } from './registry'
import type { PluginListItem } from './types'

export type CatalogTool = {
  name: string
  pluginId: string
  title: string
  description?: string
  runtime?: string
}

/** Flat list of invocable tool names with human context */
export function buildToolCatalog(disk?: PluginListItem[] | null): CatalogTool[] {
  const merged = mergeCapabilityPlugins(disk)
  const out: CatalogTool[] = []
  const seen = new Set<string>()
  for (const p of merged) {
    for (const t of p.tools || []) {
      const name = String(t).trim()
      if (!name || seen.has(name)) continue
      seen.add(name)
      out.push({
        name,
        pluginId: p.id,
        title: p.title,
        description: p.summary,
        runtime: p.host ? 'host' : undefined
      })
    }
  }
  return out
}

/**
 * Short natural-language brief for the LLM (not a dump).
 * Prefer when the user asks what the app can do / which tools exist.
 */
export function formatToolCatalogForLlm(disk?: PluginListItem[] | null, max = 24): string {
  const tools = buildToolCatalog(disk).slice(0, max)
  if (!tools.length) {
    return 'Herramientas host disponibles vía harness (diagnóstico, modelos, Forge, etc.).'
  }
  const byPlugin = new Map<string, string[]>()
  for (const t of tools) {
    const arr = byPlugin.get(t.title) || []
    arr.push(t.name)
    byPlugin.set(t.title, arr)
  }
  const lines: string[] = [
    'Puedes pedir en lenguaje natural que use herramientas reales de la máquina. Grupos:'
  ]
  for (const [title, names] of byPlugin) {
    lines.push(`- ${title}: ${names.slice(0, 6).join(', ')}${names.length > 6 ? '…' : ''}`)
  }
  lines.push(
    'No inventes resultados de tools: si hace falta dato real, el harness las ejecuta. Habla en personaje al explicar.'
  )
  return lines.join('\n')
}

export function formatToolCatalogSummary(disk?: PluginListItem[] | null): string {
  const tools = buildToolCatalog(disk)
  const plugs = mergeCapabilityPlugins(disk)
  return (
    `Plugins/capacidades: ${plugs.length} · tools: ${tools.length} · ` +
    plugs
      .slice(0, 8)
      .map((p) => p.title)
      .join(', ') +
    (plugs.length > 8 ? '…' : '')
  )
}

/** Builtin capability count (offline floor) */
export function builtinCapabilityCount(): number {
  return CAPABILITY_PLUGINS.length
}
