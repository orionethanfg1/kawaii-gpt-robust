/** M4 — deferred boot: Ollama best-effort, layers cold, purge downloads */
import { getForgeRuntimeStatus, refreshForgeHealth } from './forge-runtime'
import { isOllamaReachable, resolveOllamaBinary } from './ipc/ollama-ipc'

export function scheduleBootBackground(delayMs = 3500): void {
  setTimeout(() => {
    void (async () => {
      try {
        if (!(await isOllamaReachable('http://127.0.0.1:11434'))) {
          try {
            const bin = resolveOllamaBinary()
            if (!bin) return
            const { spawn } = await import('child_process')
            const c = spawn(bin, ['serve'], {
              detached: true,
              stdio: 'ignore',
              windowsHide: true,
              shell: process.platform === 'win32'
            })
            if (typeof c?.unref === 'function') c.unref()
          } catch {
            /* ignore */
          }
        }
      } catch {
        /* ignore */
      }
      try {
        const { scheduleBootLayers } = await import('./layer-scheduler')
        await scheduleBootLayers({ autoImage: false })
        try {
          const st = getForgeRuntimeStatus()
          if (st.state === 'running') void refreshForgeHealth().catch(() => null)
        } catch {
          /* ignore */
        }
      } catch {
        /* ignore */
      }
      try {
        const { purgeStaleJobs } = await import('./resumable-download')
        const { loadMachineProfile } = await import('./machine-profile')
        const { join } = await import('path')
        const p = await loadMachineProfile().catch(() => null)
        const root =
          (p as { sdWorkRoot?: string; forgeInstallPath?: string } | null)?.sdWorkRoot ||
          (p as { forgeInstallPath?: string } | null)?.forgeInstallPath
        if (root) {
          await purgeStaleJobs(join(String(root), 'downloads')).catch(() => 0)
        }
      } catch {
        /* ignore */
      }
    })()
  }, delayMs)
}
