/**
 * Disk-side settings backups under userData/settings-backups.
 */
import { app, ipcMain } from "electron"
import { join } from "path"
import { existsSync } from "fs"
import { mkdir, readdir, readFile, writeFile, stat } from "fs/promises"

function backupsDir(): string {
  return join(app.getPath("userData"), "settings-backups")
}

export function registerSettingsBackupIpc(): void {
  ipcMain.handle("settingsBackup:list", async () => {
    try {
      const dir = backupsDir()
      if (!existsSync(dir)) return { ok: true, files: [], dir }
      const names = await readdir(dir)
      const files: Array<{ name: string; path: string; mtimeMs: number; size: number }> = []
      for (const name of names) {
        if (!name.endsWith(".json")) continue
        const p = join(dir, name)
        try {
          const st = await stat(p)
          files.push({ name, path: p, mtimeMs: st.mtimeMs, size: st.size })
        } catch {
          /* */
        }
      }
      files.sort((a, b) => b.mtimeMs - a.mtimeMs)
      return { ok: true, files, dir }
    } catch (e) {
      return {
        ok: false,
        files: [],
        dir: backupsDir(),
        error: e instanceof Error ? e.message : String(e)
      }
    }
  })

  ipcMain.handle("settingsBackup:read", async (_e, fileName?: string) => {
    try {
      const dir = backupsDir()
      const name = String(fileName || "latest.json").replace(/[\/]/g, "")
      const p = join(dir, name)
      if (!existsSync(p)) return { ok: false, error: "not found", path: p }
      const content = await readFile(p, "utf8")
      return { ok: true, content, path: p }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle(
    "settingsBackup:write",
    async (_e, payload?: { fileName?: string; content?: string }) => {
      try {
        const dir = backupsDir()
        await mkdir(dir, { recursive: true })
        const name = String(payload?.fileName || "latest.json").replace(/[\/:*?"<>|]/g, "_")
        const p = join(dir, name)
        await writeFile(p, payload?.content || "", "utf8")
        // always refresh latest
        await writeFile(join(dir, "latest.json"), payload?.content || "", "utf8")
        return { ok: true, path: p, dir }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle("settingsBackup:listImageFiles", async () => {
    try {
      const roots = [
        join(app.getPath("userData"), "images"),
        join(app.getPath("userData"), "generated-images")
      ]
      const files: Array<{ path: string; name: string; mtimeMs: number }> = []
      for (const dir of roots) {
        if (!existsSync(dir)) continue
        const names = await readdir(dir)
        for (const name of names) {
          if (!/\.(png|jpe?g|webp)$/i.test(name)) continue
          const p = join(dir, name)
          try {
            const st = await stat(p)
            files.push({ path: p, name, mtimeMs: st.mtimeMs })
          } catch {
            /* */
          }
        }
      }
      files.sort((a, b) => b.mtimeMs - a.mtimeMs)
      return { ok: true, files: files.slice(0, 40) }
    } catch (e) {
      return {
        ok: false,
        files: [],
        error: e instanceof Error ? e.message : String(e)
      }
    }
  })
}
