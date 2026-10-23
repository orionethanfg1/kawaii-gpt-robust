/** M4 — system:hardwareProfile IPC */
import { ipcMain } from 'electron'
import { arch, cpus, totalmem } from 'os'

export type SystemHardwareProfile = {
  totalMemoryGB: number
  cpuCores: number
  architecture: string
  gpuName?: string | null
  vramGB?: number | null
  hasDiscreteGpu?: boolean | null
}

export function registerSystemHardwareIpc(): void {
  ipcMain.handle('system:hardwareProfile', async (): Promise<SystemHardwareProfile> => {
    const base: SystemHardwareProfile = {
      totalMemoryGB: Number((totalmem() / 1024 ** 3).toFixed(1)),
      cpuCores: cpus().length,
      architecture: arch(),
      gpuName: null,
      vramGB: null,
      hasDiscreteGpu: null
    }
    try {
      if (process.platform === 'win32') {
        const { execFile } = await import('child_process')
        const { promisify } = await import('util')
        const execFileAsync = promisify(execFile)
        // Prefer nvidia-smi (accurate); WMI AdapterRAM is often wrong on >4GB GPUs
        try {
          const { stdout: smi } = await execFileAsync(
            'nvidia-smi',
            ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'],
            { timeout: 5000, windowsHide: true }
          )
          const line = (smi || '').trim().split(/\r?\n/)[0] || ''
          const parts = line.split(',').map((s: string) => s.trim())
          if (parts[0]) {
            base.gpuName = parts[0]
            const mib = Number(parts[1])
            if (Number.isFinite(mib) && mib > 0) {
              base.vramGB = Number((mib / 1024).toFixed(1))
            }
            base.hasDiscreteGpu = true
          }
        } catch {
          /* no nvidia-smi in PATH */
        }

        if (!base.gpuName) {
          const { stdout } = await execFileAsync(
            'powershell.exe',
            [
              '-NoProfile',
              '-Command',
              'Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM | ConvertTo-Json -Compress'
            ],
            { timeout: 8000, windowsHide: true }
          )
          const parsed = JSON.parse(stdout || 'null')
          const list = Array.isArray(parsed) ? parsed : parsed ? [parsed] : []
          type Cand = { name: string; gb: number; score: number }
          const cands: Cand[] = []
          for (const g of list) {
            const name = String(g?.Name || '')
            if (!name || /microsoft|basic display|basic render|remote desktop/i.test(name)) continue
            const ram = Number(g?.AdapterRAM) || 0
            let gb = ram > 0 ? ram / 1024 ** 3 : 0
            if (gb > 32) gb = 0
            let score = 0
            if (/nvidia|geforce|rtx|gtx|quadro/i.test(name)) score = 100 + gb
            else if (/amd|radeon|rx /i.test(name) && !/radeon\(tm\) graphics|vega graphics/i.test(name))
              score = 80 + gb
            else if (/intel arc/i.test(name)) score = 70 + gb
            else if (/radeon|amd/i.test(name)) score = 20 + gb
            else score = 10
            cands.push({ name, gb, score })
          }
          cands.sort((a, b) => b.score - a.score)
          const best = cands[0]
          if (best) {
            base.gpuName = best.name
            base.vramGB = best.gb > 0 ? Number(best.gb.toFixed(1)) : null
            base.hasDiscreteGpu = best.score >= 70
          }
        }

        if (base.gpuName && /nvidia|geforce|rtx|gtx/i.test(base.gpuName)) {
          base.hasDiscreteGpu = true
          if (base.vramGB == null || base.vramGB < 1) {
            if (/3060/.test(base.gpuName)) base.vramGB = 12
            else if (/3070/.test(base.gpuName)) base.vramGB = 8
            else if (/3080/.test(base.gpuName)) base.vramGB = 10
            else if (/4060/.test(base.gpuName)) base.vramGB = 8
            else if (/4070|4080|4090/.test(base.gpuName)) base.vramGB = 12
          }
        }

        ;(global as unknown as { __kawaiiHw: SystemHardwareProfile }).__kawaiiHw = { ...base }
      }
    } catch {
      // keep nulls — never fail the profile
    }
    ;(global as unknown as { __kawaiiHw: SystemHardwareProfile }).__kawaiiHw = { ...base }
    return base
  })
}
