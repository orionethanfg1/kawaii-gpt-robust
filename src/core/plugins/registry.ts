/**
 * C1 — merge static capability plugins with disk manifests (plugins/).
 */
import type { CapabilityPlugin } from '../agent/capabilities-registry'
import { CAPABILITY_PLUGINS } from '../agent/capabilities-registry'
import type { PluginListItem, PluginManifest } from './types'

/** Map disk/builtin manifest → panel capability shape */
export function manifestToCapability(m: PluginManifest): CapabilityPlugin {
  const tools = (m.tools || []).map((t) => (typeof t === 'string' ? t : t.name))
  return {
    id: m.id,
    title: m.name || m.id,
    category: (m.category as CapabilityPlugin['category']) || 'sistema',
    summary: m.summary || (m.tools?.[0] as { description?: string })?.description || m.name,
    tools,
    phrases: m.phrases,
    host: m.runtime === 'builtin' || m.runtime === 'python' || true
  }
}

export function mergeCapabilityPlugins(
  disk: PluginListItem[] | undefined | null
): CapabilityPlugin[] {
  const byId = new Map<string, CapabilityPlugin>()
  for (const p of CAPABILITY_PLUGINS) {
    byId.set(p.id, p)
  }
  for (const m of disk || []) {
    if (!m?.id) continue
    const cap = manifestToCapability({ ...m, source: m.source || 'disk' })
    // Disk overrides title/summary/tools if same id; else adds
    const prev = byId.get(m.id)
    if (prev) {
      byId.set(m.id, {
        ...prev,
        title: cap.title || prev.title,
        summary: cap.summary || prev.summary,
        tools: [...new Set([...(prev.tools || []), ...(cap.tools || [])])],
        phrases: [...new Set([...(prev.phrases || []), ...(cap.phrases || [])])]
      })
    } else {
      byId.set(m.id, cap)
    }
  }
  return [...byId.values()]
}

export function formatMergedCapabilitiesForChat(
  disk: PluginListItem[] | undefined | null
): string {
  const plugs = mergeCapabilityPlugins(disk)
  const lines = [
    '**Capacidades de la app (plugins / herramientas)**',
    '',
    'Host = datos reales de tu máquina. Disk = manifiestos en carpeta plugins/.',
    ''
  ]
  for (const p of plugs) {
    const host = p.host ? ' · host' : ''
    lines.push(`- **${p.title}**${host}: ${p.summary}`)
    if (p.tools?.length) lines.push(`  - tools: ${p.tools.join(', ')}`)
  }
  return lines.join('\n')
}
