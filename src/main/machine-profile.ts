/**
 * Persistent machine profile for heavy local infra (SD/Forge paths, disk prefs).
 * Generic: detected per machine, never hardcodes a specific drive letter in the repo.
 */

import { app } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { mkdir, readFile, writeFile, rename, unlink, readdir, stat } from 'fs/promises'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { platform, totalmem } from 'os'

const execFileAsync = promisify(execFile)

export const MACHINE_PROFILE_VERSION = 1

export interface DriveInfo {
  letter: string
  freeGB: number
  totalGB: number
  isSystem: boolean
}

export interface MachinePreflight {
  ok: boolean
  at: string
  reasons: string[]
  warnings: string[]
}

export interface MachineProfile {
  version: number
  updatedAt: string
  /** Root for heavy SD data (forge, models, outputs) */
  preferredDataRoot: string
  forgeInstallPath: string
  sdModelsPath: string
  localImageEligible: boolean
  gpuName: string | null
  vramGB: number | null
  hasDiscreteGpu: boolean | null
  totalMemoryGB: number
  lastPreflight: MachinePreflight
  userOverrides: {
    neverInstallOnSystemDrive: boolean
    /** User locked the path — do not auto-change */
    lockDataRoot: boolean
  }
}

function profilePath(): string {
  return join(app.getPath('userData'), 'machine-profile.json')
}

function defaultUserDataSdRoot(): string {
  return join(app.getPath('userData'), 'sd-workspace')
}

/** Serialize profile writes — concurrent ensureMachineProfile was racing on the same .tmp */
let profileWriteChain: Promise<void> = Promise.resolve()

async function atomicWriteJson(file: string, data: unknown): Promise<void> {
  const dir = file.includes('/') || file.includes('\\')
    ? file.replace(/[/\\][^/\\]+$/, '')
    : '.'
  try {
    await mkdir(dir, { recursive: true })
  } catch {
    /* userData should exist */
  }

  const payload = JSON.stringify(data, null, 2)
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`

  await writeFile(tmp, payload, 'utf-8')

  // Windows: rename over existing can fail; remove dest first when present
  try {
    if (existsSync(file)) {
      try {
        await unlink(file)
      } catch {
        /* ignore — rename may still work */
      }
    }
    await rename(tmp, file)
  } catch (err) {
    // Fallback: write directly (still better than crashing the IPC)
    try {
      await writeFile(file, payload, 'utf-8')
    } catch (err2) {
      try {
        await unlink(tmp)
      } catch {
        /* ignore */
      }
      throw err2 instanceof Error ? err2 : err
    }
    try {
      await unlink(tmp)
    } catch {
      /* ignore leftover tmp */
    }
  }
}

async function withProfileWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = profileWriteChain
  let release!: () => void
  profileWriteChain = new Promise<void>((r) => {
    release = r
  })
  await prev.catch(() => undefined)
  try {
    return await fn()
  } finally {
    release()
  }
}

/** List fixed drives on Windows with free space. Empty on non-Windows. */
export async function listDrives(): Promise<DriveInfo[]> {
  if (platform() !== 'win32') {
    return [
      {
        letter: defaultUserDataSdRoot(),
        freeGB: 50,
        totalGB: 100,
        isSystem: true
      }
    ]
  }

  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        "Get-CimInstance Win32_LogicalDisk -Filter \"DriveType=3\" | Select-Object DeviceID,FreeSpace,Size | ConvertTo-Json -Compress"
      ],
      { timeout: 15_000, windowsHide: true }
    )
    const raw = stdout.trim()
    if (!raw) return []
    const parsed = JSON.parse(raw) as
      | { DeviceID: string; FreeSpace: number; Size: number }
      | Array<{ DeviceID: string; FreeSpace: number; Size: number }>
    const rows = Array.isArray(parsed) ? parsed : [parsed]
    const systemRoot = (process.env.SystemDrive || 'C:').toUpperCase()
    return rows
      .filter((r) => r?.DeviceID && typeof r.FreeSpace === 'number')
      .map((r) => {
        const letter = String(r.DeviceID).toUpperCase().replace(/\\$/, '')
        return {
          letter,
          freeGB: Number((r.FreeSpace / 1024 ** 3).toFixed(1)),
          totalGB: Number((r.Size / 1024 ** 3).toFixed(1)),
          isSystem: letter === systemRoot || letter.startsWith(systemRoot)
        }
      })
      .sort((a, b) => b.freeGB - a.freeGB)
  } catch {
    return []
  }
}

/**
 * Pick best data root: most free space, prefer non-system drive, path short.
 */
export function suggestDataRoot(drives: DriveInfo[], preferNonSystem = true): string {
  if (platform() !== 'win32') return defaultUserDataSdRoot()
  const candidates = preferNonSystem
    ? drives.filter((d) => !d.isSystem && d.freeGB >= 20)
    : drives.filter((d) => d.freeGB >= 20)
  const pool = candidates.length > 0 ? candidates : drives.filter((d) => d.freeGB >= 15)
  if (pool.length === 0) {
    // Fallback: first drive or userData
    const any = drives[0]
    return any ? `${any.letter}\\KawaiiSD` : defaultUserDataSdRoot()
  }
  const best = pool.sort((a, b) => b.freeGB - a.freeGB)[0]
  return `${best.letter}\\KawaiiSD`
}

export interface HardwareHints {
  gpuName?: string | null
  vramGB?: number | null
  hasDiscreteGpu?: boolean | null
  totalMemoryGB?: number
}

export function runPreflight(
  hw: HardwareHints,
  dataRoot: string,
  drives: DriveInfo[]
): MachinePreflight {
  const reasons: string[] = []
  const warnings: string[] = []
  const at = new Date().toISOString()

  const vram = hw.vramGB ?? 0
  const gpu = (hw.gpuName || '').toLowerCase()
  const nvidia = gpu.includes('nvidia') || gpu.includes('geforce') || gpu.includes('rtx') || gpu.includes('gtx')
  const discrete = hw.hasDiscreteGpu === true || nvidia

  if (!discrete || !nvidia) {
    reasons.push(
      'No se detectó GPU NVIDIA dedicada. Forge CUDA no es fiable aquí; usa generación cloud (Pollinations).'
    )
  } else if (vram > 0 && vram < 4) {
    reasons.push(`VRAM ~${vram} GB es baja (< 4 GB). SD local será muy lento o inestable.`)
  } else if (vram > 0 && vram < 8) {
    warnings.push(`VRAM ~${vram} GB: recomendado SD 1.5; SDXL puede ir justo.`)
  }

  const driveLetter = platform() === 'win32' ? dataRoot.slice(0, 2).toUpperCase() : ''
  const drive = drives.find((d) => d.letter === driveLetter || dataRoot.startsWith(d.letter))
  if (drive) {
    if (drive.freeGB < 15) {
      reasons.push(`Poco espacio libre en ${drive.letter} (~${drive.freeGB} GB). Se recomiendan ≥ 20 GB.`)
    } else if (drive.freeGB < 25) {
      warnings.push(`Espacio justo en ${drive.letter} (~${drive.freeGB} GB).`)
    }
    if (drive.isSystem) {
      warnings.push(
        `La ruta está en el disco del sistema (${drive.letter}). Mejor una unidad de datos si tienes.`
      )
    }
  }

  if ((hw.totalMemoryGB ?? totalmem() / 1024 ** 3) < 8) {
    warnings.push('Menos de 8 GB de RAM: el sistema puede ir justo con el WebUI.')
  }

  return {
    ok: reasons.length === 0,
    at,
    reasons,
    warnings
  }
}

function buildProfile(
  partial: Partial<MachineProfile> & {
    preferredDataRoot: string
    lastPreflight: MachinePreflight
  },
  hw: HardwareHints
): MachineProfile {
  const root = partial.preferredDataRoot
  return {
    version: MACHINE_PROFILE_VERSION,
    updatedAt: new Date().toISOString(),
    preferredDataRoot: root,
    forgeInstallPath: partial.forgeInstallPath || join(root, 'forge'),
    sdModelsPath: partial.sdModelsPath || join(root, 'models', 'Stable-diffusion'),
    localImageEligible: partial.lastPreflight.ok,
    gpuName: hw.gpuName ?? partial.gpuName ?? null,
    vramGB: hw.vramGB ?? partial.vramGB ?? null,
    hasDiscreteGpu: hw.hasDiscreteGpu ?? partial.hasDiscreteGpu ?? null,
    totalMemoryGB:
      hw.totalMemoryGB ?? partial.totalMemoryGB ?? Number((totalmem() / 1024 ** 3).toFixed(1)),
    lastPreflight: partial.lastPreflight,
    userOverrides: {
      neverInstallOnSystemDrive: partial.userOverrides?.neverInstallOnSystemDrive ?? true,
      lockDataRoot: partial.userOverrides?.lockDataRoot ?? false
    }
  }
}

export async function loadMachineProfile(): Promise<MachineProfile | null> {
  const file = profilePath()
  if (!existsSync(file)) return null
  try {
    const raw = await readFile(file, 'utf-8')
    const data = JSON.parse(raw) as MachineProfile
    if (!data || data.version !== MACHINE_PROFILE_VERSION) return null
    return data
  } catch {
    return null
  }
}

export async function saveMachineProfile(profile: MachineProfile): Promise<void> {
  await withProfileWriteLock(async () => {
    await mkdir(app.getPath('userData'), { recursive: true })
    await atomicWriteJson(profilePath(), profile)
  })
}

export async function clearMachineProfile(): Promise<void> {
  const file = profilePath()
  if (existsSync(file)) await unlink(file)
}

/**
 * Detect drives + hardware, create or refresh profile (respects lockDataRoot).
 */
export async function ensureMachineProfile(hw: HardwareHints = {}): Promise<{
  profile: MachineProfile
  drives: DriveInfo[]
  created: boolean
}> {
  const drives = await listDrives()
  const existing = await loadMachineProfile()
  const preferNonSystem = existing?.userOverrides?.neverInstallOnSystemDrive !== false

  let root: string
  if (existing?.userOverrides?.lockDataRoot && existing.preferredDataRoot) {
    root = existing.preferredDataRoot
  } else if (existing?.preferredDataRoot) {
    root = existing.preferredDataRoot
  } else {
    root = suggestDataRoot(drives, preferNonSystem)
  }

  const preflight = runPreflight(hw, root, drives)
  const profile = buildProfile(
    {
      preferredDataRoot: root,
      forgeInstallPath: existing?.forgeInstallPath,
      sdModelsPath: existing?.sdModelsPath,
      userOverrides: existing?.userOverrides,
      lastPreflight: preflight,
      gpuName: existing?.gpuName,
      vramGB: existing?.vramGB,
      hasDiscreteGpu: existing?.hasDiscreteGpu,
      totalMemoryGB: existing?.totalMemoryGB
    },
    hw
  )
  await saveMachineProfile(profile)
  return { profile, drives, created: !existing }
}

export async function setDataRoot(
  newRoot: string,
  hw: HardwareHints,
  lock = true
): Promise<MachineProfile> {
  const drives = await listDrives()
  const existing = await loadMachineProfile()
  const preflight = runPreflight(hw, newRoot, drives)
  const profile = buildProfile(
    {
      preferredDataRoot: newRoot,
      forgeInstallPath: join(newRoot, 'forge'),
      sdModelsPath: join(newRoot, 'models', 'Stable-diffusion'),
      userOverrides: {
        neverInstallOnSystemDrive: existing?.userOverrides?.neverInstallOnSystemDrive ?? true,
        lockDataRoot: lock
      },
      lastPreflight: preflight
    },
    hw
  )
  await saveMachineProfile(profile)
  return profile
}

/** Ensure folders under preferredDataRoot + LEEME + optional forge launcher stub */
export async function ensureDataRootWorkspace(profile: MachineProfile): Promise<{
  root: string
  modelsDir: string
  forgeDir: string
  created: boolean
}> {
  const root = profile.preferredDataRoot
  const modelsDir = profile.sdModelsPath
  const forgeDir = profile.forgeInstallPath
  const created = !existsSync(root)
  await mkdir(modelsDir, { recursive: true })
  await mkdir(join(root, 'outputs'), { recursive: true })
  await mkdir(forgeDir, { recursive: true })

  const readme = `KawaiiGPT — datos locales (machine-profile)
=========================================

Raíz: ${root}
Modelos: ${modelsDir}
Forge (instalar portable aquí): ${forgeDir}

1) GPU NVIDIA + suficiente VRAM → puedes usar Forge local.
2) Instala el pack portable de Forge DENTRO de la carpeta forge.
3) Usa run-kawaii-api.bat (se genera si detectamos run.bat) con --api.
4) En KawaiiGPT → URL: http://127.0.0.1:7860

Perfil de máquina: userData/machine-profile.json (se puede borrar para re-detectar).
`
  await writeFile(join(root, 'LEEME.txt'), readme, 'utf-8')

  // If user already extracted Forge with run.bat, write API launcher
  const runBat = join(forgeDir, 'run.bat')
  const webuiUser = join(forgeDir, 'webui-user.bat')
  if (existsSync(runBat) || existsSync(webuiUser)) {
    const apiBat = `@echo off
cd /d "%~dp0"
REM Launcher KawaiiGPT: API local
set COMMANDLINE_ARGS=--api --api-log --listen 127.0.0.1
if exist "webui-user.bat" (
  call webui-user.bat %*
) else if exist "run.bat" (
  call run.bat %*
) else (
  echo No se encontro run.bat ni webui-user.bat
  pause
)
`
    await writeFile(join(forgeDir, 'run-kawaii-api.bat'), apiBat, 'utf-8')
  }

  return { root, modelsDir, forgeDir, created }
}

export async function detectForgePresent(forgeDir: string): Promise<boolean> {
  if (!existsSync(forgeDir)) return false
  try {
    const names = await readdir(forgeDir)
    return names.some(
      (n) =>
        n.toLowerCase() === 'run.bat' ||
        n.toLowerCase() === 'webui-user.bat' ||
        n.toLowerCase() === 'webui.py'
    )
  } catch {
    return false
  }
}
