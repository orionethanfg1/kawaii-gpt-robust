/** Disk / builtin plugin manifest (C1) */

export type PluginToolDef = {
  name: string
  description?: string
  parameters?: Record<string, unknown>
}

export type PluginManifest = {
  id: string
  name: string
  version?: string
  runtime?: 'builtin' | 'python' | 'node'
  entry?: string | null
  tools?: PluginToolDef[]
  permissions?: string[]
  phrases?: string[]
  category?: string
  summary?: string
  /** Where it was loaded from */
  source?: 'builtin' | 'disk'
}

export type PluginListItem = PluginManifest & {
  dir?: string
}
