/** C1 — discover plugins/<id>/plugin.json on disk */
import { app, ipcMain } from 'electron'
import { join } from 'node:path'
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'

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
        const id = String(raw.id || name)
        if (seen.has(id)) continue
        seen.add(id)
        out.push({
          ...raw,
          id,
          source: 'disk',
          dir
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
}
