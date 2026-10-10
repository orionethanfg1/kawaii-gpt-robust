/** C1 — discover plugins/<id>/plugin.json on disk */
import { app, ipcMain } from 'electron'
import { join } from 'node:path'
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { validatePluginManifest, normalizePluginManifest } from '../../core/plugins/validate'

function pluginsRoots(): string[] {
  const roots: string[] = []
  try {
    // Dev: project root /plugins
    const appPath = app.getAppPath()
    roots.push(join(appPath, 'plugins'))
    // Packaged: resources/plugins
    roots.push(join(process.resourcesPath || appPath, 'plugins'))
    // CWD fallback
    roots.push(join(process.cwd(), 'plugins'))
  } catch {
    roots.push(join(process.cwd(), 'plugins'))
  }
  return roots
}

function loadManifests(): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = []
  const seen = new Set<string>()
  for (const root of pluginsRoots()) {
    if (!existsSync(root)) continue
    let dirs: string[] = []
    try {
      dirs = readdirSync(root)
    } catch {
      continue
    }
    for (const name of dirs) {
      const dir = join(root, name)
      try {
        if (!statSync(dir).isDirectory()) continue
      } catch {
        continue
      }
      const mf = join(dir, 'plugin.json')
      if (!existsSync(mf)) continue
      try {
        const raw = JSON.parse(readFileSync(mf, 'utf-8')) as Record<string, unknown>
        const v = validatePluginManifest(raw, name)
        if (!v.ok || !v.normalized) {
          console.warn('[plugins] invalid manifest', mf, v.issues)
          continue
        }
        if (v.normalized.enabled === false) {
          continue
        }
        const id = v.normalized.id
        if (seen.has(id)) continue
        seen.add(id)
        out.push({
          ...v.normalized,
          source: 'disk',
          dir,
          validationWarnings: v.issues.filter((i) => i.level === 'warn')
        })
      } catch (e) {
        console.warn('[plugins] bad manifest', mf, e)
      }
    }
  }
  return out
}

export function registerPluginsIpc(): void {
  ipcMain.handle('plugins:list', async () => {
    try {
      return { ok: true, plugins: loadManifests() }
    } catch (e) {
      return {
        ok: false,
        plugins: [],
        error: e instanceof Error ? e.message : String(e)
      }
    }
  })

  ipcMain.handle('plugins:validate', async (_e, payload: { manifest?: unknown; id?: string }) => {
    try {
      const v = validatePluginManifest(payload?.manifest ?? {}, payload?.id)
      return { ok: v.ok, issues: v.issues, normalized: v.normalized }
    } catch (e) {
      return {
        ok: false,
        issues: [{ level: 'error', path: '', message: e instanceof Error ? e.message : String(e) }]
      }
    }
  })

  ipcMain.handle('plugins:catalog', async () => {
    try {
      const plugins = loadManifests()
      const tools: Array<{ name: string; pluginId: string; description?: string }> = []
      for (const p of plugins) {
        const id = String(p.id || '')
        const tlist = p.tools
        if (Array.isArray(tlist)) {
          for (const t of tlist) {
            if (typeof t === 'string') {
              tools.push({ name: t, pluginId: id })
            } else if (t && typeof t === 'object') {
              const o = t as { name?: string; description?: string }
              if (o.name) tools.push({ name: o.name, pluginId: id, description: o.description })
            }
          }
        }
      }
      return { ok: true, plugins, tools }
    } catch (e) {
      return {
        ok: false,
        plugins: [],
        tools: [],
        error: e instanceof Error ? e.message : String(e)
      }
    }
  })
}
