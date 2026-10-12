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
        // Never auto-start Forge/ACE at boot — GPU free for chat / light LLMs
        await scheduleBootLayers({ autoImage: false })
        try {
          const { stopForgeRuntime } = await import('./forge-runtime')
          const st = getForgeRuntimeStatus()
          // Residual Forge from previous session: stop so RAM/VRAM stay free
          if (st.state === 'running' || st.state === 'starting') {
            console.log('[boot] deteniendo Forge residual (arranque en frío)')
            await stopForgeRuntime().catch(() => null)
          } else {
            void refreshForgeHealth().catch(() => null)
          }
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
