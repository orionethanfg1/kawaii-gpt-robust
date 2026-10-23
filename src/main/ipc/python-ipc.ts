/**
 * Portable Python ensure IPC.
 */
import { ipcMain } from 'electron'

export function registerPythonIpc(): void {
  // tool scripts under project tools/ (face_similarity, forge_probe, ...)

  ipcMain.handle('python:ensure', async () => {
    try {
      const { ensureMachineProfile } = await import('../machine-profile')
      const {
        ensurePortablePython,
        isPortablePythonReady,
        portablePythonExe
      } = await import('../python-runtime')
      const { profile } = await ensureMachineProfile({} as never)
      if (isPortablePythonReady(profile.preferredDataRoot)) {
        return {
          ok: true,
          python: portablePythonExe(profile.preferredDataRoot),
          already: true
        }
      }
      return await ensurePortablePython(profile.preferredDataRoot)
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
ipcMain.handle(
    'python:runToolScript',
    async (
      _e,
      payload: { script?: string; args?: string[]; timeoutMs?: number }
    ) => {
      try {
        const { app } = await import('electron')
        const { join } = await import('path')
        const { existsSync } = await import('fs')
        const { spawn } = await import('child_process')
        const scriptName = String(payload?.script || '')
          .replace(/\\/g, '/')
          .split('/')
          .pop()
        if (!scriptName || !/^[\w.-]+\.py$/.test(scriptName)) {
          return { ok: false, error: 'script inválido' }
        }
        const candidates = [
          join(app.getAppPath(), 'tools', scriptName),
          join(process.cwd(), 'tools', scriptName),
          join(__dirname, '../../tools', scriptName)
        ]
        const scriptPath = candidates.find((p) => existsSync(p))
        if (!scriptPath) {
          return { ok: false, error: 'script no encontrado: ' + scriptName }
        }
        const args = Array.isArray(payload?.args) ? payload!.args!.map(String) : []
        const timeoutMs = Math.min(120_000, Math.max(3_000, payload?.timeoutMs ?? 30_000))
        const py = process.platform === 'win32' ? 'python' : 'python3'
        const result = await new Promise<{
          ok: boolean
          code: number | null
          stdout: string
          stderr: string
        }>((resolve) => {
          const child = spawn(py, [scriptPath, ...args], {
            windowsHide: true,
            env: { ...process.env }
          })
          let stdout = ''
          let stderr = ''
          const timer = setTimeout(() => {
            try {
              child.kill()
            } catch {
              /* */
            }
            resolve({ ok: false, code: -1, stdout, stderr: stderr + '\ntimeout' })
          }, timeoutMs)
          child.stdout?.on('data', (d) => {
            stdout += String(d)
          })
          child.stderr?.on('data', (d) => {
            stderr += String(d)
          })
          child.on('close', (code) => {
            clearTimeout(timer)
            resolve({ ok: code === 0, code, stdout, stderr })
          })
          child.on('error', (err) => {
            clearTimeout(timer)
            resolve({ ok: false, code: -1, stdout, stderr: String(err) })
          })
        })
        let parsed: unknown = null
        const line = result.stdout
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean)
          .pop()
        if (line) {
          try {
            parsed = JSON.parse(line)
          } catch {
            parsed = null
          }
        }
        return {
          ok: result.ok || Boolean(parsed),
          code: result.code,
          stdout: result.stdout.slice(0, 8000),
          stderr: result.stderr.slice(0, 2000),
          json: parsed
        }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )
}
