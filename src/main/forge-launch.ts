/**
 * E-FORGE-RT: locate Forge root, compatible Python, launch.py, and bat helpers.
 * Extracted from forge-runtime so start/stop stays in the runtime module.
 */
import { join } from 'path'
import { existsSync } from 'fs'
import { writeFile } from 'fs/promises'
import { spawnSync } from 'child_process'
import { detectForgePresent, type MachineProfile } from './machine-profile'

export async function resolveForgeRoot(profile: MachineProfile): Promise<string | null> {
  const base = profile.forgeInstallPath
  if (!(await detectForgePresent(base))) {
    // nested folder after extract
    try {
      const { readdir, stat } = await import('fs/promises')
      if (!existsSync(base)) return null
      const names = await readdir(base)
      for (const n of names) {
        const sub = join(base, n)
        try {
          if (!(await stat(sub)).isDirectory()) continue
          if (await detectForgePresent(sub)) return sub
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
    return null
  }
  // Prefer directory that has run.bat
  if (existsSync(join(base, 'run.bat')) || existsSync(join(base, 'webui-user.bat'))) {
    return base
  }
  return base
}


/** Run `python -c` and parse major.minor; null if fails. */
export function probePythonVersion(pythonExe: string, cwd?: string): { major: number; minor: number; raw: string } | null {
  try {
    const r = spawnSync(pythonExe, ['-c', 'import sys; print("%d.%d"%sys.version_info[:2])'], {
      cwd,
      encoding: 'utf-8',
      timeout: 8000,
      windowsHide: true
    })
    const raw = (r.stdout || '').trim()
    const m = /^(\d+)\.(\d+)/.exec(raw)
    if (!m) return null
    return { major: Number(m[1]), minor: Number(m[2]), raw }
  } catch {
    return null
  }
}

/**
 * Forge pins old torch (e.g. 2.3.1) → needs CPython 3.10 or 3.11 (max 3.12 in some builds).
 * System Python 3.13/3.14 will always fail pip install torch==2.3.1.
 */
export function isForgeCompatiblePython(v: { major: number; minor: number } | null): boolean {
  if (!v) return false
  if (v.major !== 3) return false
  return v.minor >= 10 && v.minor <= 12
}

/** Find launch.py and a usable Windows Python under forge root (nested installs). */
export async function resolveForgePythonAndLaunch(
  forgeRoot: string
): Promise<{ python: string; launchPy: string; cwd: string; version?: string } | null> {
  const { readdir, stat } = await import('fs/promises')
  const candidates: string[] = [forgeRoot]
  try {
    const names = await readdir(forgeRoot)
    for (const n of names) {
      const sub = join(forgeRoot, n)
      try {
        if ((await stat(sub)).isDirectory()) candidates.push(sub)
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }

  const pyRel = [
    ['venv', 'Scripts', 'python.exe'],
    ['system', 'python', 'python.exe'],
    ['python', 'python.exe'],
    ['py', 'python.exe'],
    ['Python310', 'python.exe'],
    ['Python311', 'python.exe'],
    ['portable', 'python', 'python.exe']
  ]

  type Hit = { python: string; launchPy: string; cwd: string; version: string; score: number }
  const hits: Hit[] = []

  for (const cwd of candidates) {
    const launchPy = join(cwd, 'launch.py')
    if (!existsSync(launchPy)) continue
    for (const parts of pyRel) {
      const python = join(cwd, ...parts)
      if (!existsSync(python)) continue
      const ver = probePythonVersion(python, cwd)
      const score = isForgeCompatiblePython(ver) ? 100 : ver ? 10 : 0
      // Prefer venv over embedded
      const bonus = parts[0] === 'venv' ? 20 : parts[0] === 'system' ? 15 : 0
      hits.push({
        python,
        launchPy,
        cwd,
        version: ver?.raw || '?',
        score: score + bonus
      })
    }
  }

  hits.sort((a, b) => b.score - a.score)
  const best = hits.find((h) => h.score >= 100)
  if (best) return best

  // Prefer app-managed portable Python if already provisioned (any data root guess)
  // Caller also runs ensurePortablePython when resolve returns null.

  // Do NOT fall back to PATH python 3.14 — that caused torch==2.3.1 install failure
  // Try py -3.11 / py -3.10 launcher on Windows
  const pyLaunchers = [
    ['py', '-3.11'],
    ['py', '-3.10'],
    ['py', '-3.12']
  ]
  for (const cwd of candidates) {
    const launchPy = join(cwd, 'launch.py')
    if (!existsSync(launchPy)) continue
    for (const [cmd, flag] of pyLaunchers) {
      try {
        const r = spawnSync(cmd, [flag, '-c', 'import sys; print("%d.%d"%sys.version_info[:2])'], {
          encoding: 'utf-8',
          timeout: 8000,
          windowsHide: true
        })
        const raw = (r.stdout || '').trim()
        const m = /^(\d+)\.(\d+)/.exec(raw)
        if (!m) continue
        const ver = { major: Number(m[1]), minor: Number(m[2]), raw }
        if (!isForgeCompatiblePython(ver)) continue
        // Use `py -3.11` as executable via cmd wrapper path: store as special
        return {
          python: cmd,
          launchPy,
          cwd,
          version: ver.raw + ' (py launcher ' + flag + ')'
        }
      } catch {
        /* ignore */
      }
    }
  }

  return null
}

/** Human message when no compatible Python is found. */

/**
 * Force webui-user.bat to keep --api (stock file often sets COMMANDLINE_ARGS= empty).
 * Backup once as webui-user.bat.kawaii-bak
 */
export async function ensureKawaiiWebuiUser(forgeRoot: string, port: number): Promise<void> {
  const userBat = join(forgeRoot, 'webui-user.bat')
  const bak = join(forgeRoot, 'webui-user.bat.kawaii-bak')
  try {
    if (existsSync(userBat) && !existsSync(bak)) {
      const { copyFile } = await import('fs/promises')
      await copyFile(userBat, bak)
    }
  } catch {
    /* ignore */
  }
  const content = `@echo off
REM === Managed by KawaiiGPT Robust — do not clear COMMANDLINE_ARGS ===
REM Original backed up as webui-user.bat.kawaii-bak (if present)
set PYTHONUNBUFFERED=1
set COMMANDLINE_ARGS=--api --nowebui --listen --port ${port} --server-name 127.0.0.1 --skip-version-check --skip-python-version-check
`
  try {
    await writeFile(userBat, content, 'utf-8')
  } catch {
    /* ignore — non-fatal if root is nested */
  }
  // Also write into nested dirs that have launch.py
  try {
    const { readdir, stat } = await import('fs/promises')
    const names = await readdir(forgeRoot)
    for (const n of names) {
      const sub = join(forgeRoot, n)
      try {
        if (!(await stat(sub)).isDirectory()) continue
        if (!existsSync(join(sub, 'launch.py')) && !existsSync(join(sub, 'webui.bat'))) continue
        const subUser = join(sub, 'webui-user.bat')
        const subBak = join(sub, 'webui-user.bat.kawaii-bak')
        if (existsSync(subUser) && !existsSync(subBak)) {
          const { copyFile } = await import('fs/promises')
          await copyFile(subUser, subBak)
        }
        await writeFile(subUser, content, 'utf-8')
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

/**
 * Hardened .bat: logs to disk, prefers venv+launch.py, never silent success without python.
 * Used only as fallback when direct Node spawn is unavailable.
 */
export async function writePortLauncher(forgeRoot: string, port: number): Promise<string> {
  await ensureKawaiiWebuiUser(forgeRoot, port)
  const bat = `@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
set PYTHONUNBUFFERED=1
set HF_HUB_DISABLE_TELEMETRY=1
set "LOG=%~dp0kawaii-forge-launch.log"
echo ==== KawaiiGPT Forge launch %DATE% %TIME% ====>> "%LOG%"
echo [KawaiiGPT] cwd=%CD%>> "%LOG%"
echo [KawaiiGPT] Starting Forge API on port ${port}...
echo [KawaiiGPT] Starting Forge API on port ${port}...>> "%LOG%"

set "KAWAII_ARGS=--api --nowebui --listen --port ${port} --server-name 127.0.0.1 --skip-version-check --skip-python-version-check"
set COMMANDLINE_ARGS=%KAWAII_ARGS%

REM --- Locate launch.py (this folder or one level deep) ---
set "LAUNCH="
if exist "%CD%\\launch.py" set "LAUNCH=%CD%\\launch.py"
if not defined LAUNCH if exist "%CD%\\webui\\launch.py" set "LAUNCH=%CD%\\webui\\launch.py"
for /d %%D in ("%CD%\\*") do (
  if not defined LAUNCH if exist "%%~fD\\launch.py" set "LAUNCH=%%~fD\\launch.py"
)

REM --- Locate python ---
set "PY="
if exist "%CD%\\venv\\Scripts\\python.exe" set "PY=%CD%\\venv\\Scripts\\python.exe"
if not defined PY if exist "%CD%\\system\\python\\python.exe" set "PY=%CD%\\system\\python\\python.exe"
if not defined PY if exist "%CD%\\python\\python.exe" set "PY=%CD%\\python\\python.exe"
if not defined PY (
  for /d %%D in ("%CD%\\*") do (
    if not defined PY if exist "%%~fD\\venv\\Scripts\\python.exe" set "PY=%%~fD\\venv\\Scripts\\python.exe"
  )
)

if defined LAUNCH if defined PY (
  echo [KawaiiGPT] PY=%PY%>> "%LOG%"
  echo [KawaiiGPT] LAUNCH=%LAUNCH%>> "%LOG%"
  echo [KawaiiGPT] Using direct: "%PY%" "%LAUNCH%" %KAWAII_ARGS%
  echo [KawaiiGPT] Using direct python+launch.py>> "%LOG%"
  "%PY%" "%LAUNCH%" %KAWAII_ARGS%
  echo [KawaiiGPT] python exit=%ERRORLEVEL%>> "%LOG%"
  exit /b %ERRORLEVEL%
)

if defined LAUNCH (
  where python >nul 2>&1
  if %ERRORLEVEL%==0 (
    echo [KawaiiGPT] Using PATH python + launch.py>> "%LOG%"
    python "%LAUNCH%" %KAWAII_ARGS%
    echo [KawaiiGPT] python exit=%ERRORLEVEL%>> "%LOG%"
    exit /b %ERRORLEVEL%
  )
)

REM --- Fallback webui.bat (webui-user.bat already forced by ensureKawaiiWebuiUser) ---
echo [KawaiiGPT] WARNING: fallback webui.bat / run.bat>> "%LOG%"
if exist "%CD%\\webui.bat" (
  call "%CD%\\webui.bat"
  echo [KawaiiGPT] webui.bat exit=%ERRORLEVEL%>> "%LOG%"
  exit /b %ERRORLEVEL%
)
if exist "%CD%\\run.bat" (
  call "%CD%\\run.bat"
  echo [KawaiiGPT] run.bat exit=%ERRORLEVEL%>> "%LOG%"
  exit /b %ERRORLEVEL%
)

echo [KawaiiGPT] ERROR: no launch.py / python / webui.bat found in %CD%
echo [KawaiiGPT] ERROR: no launch.py / python / webui.bat>> "%LOG%"
exit /b 1
`
  const path = join(forgeRoot, 'run-kawaii-api.bat')
  await writeFile(path, bat, 'utf-8')
  // Also nested roots
  try {
    const resolved = await resolveForgePythonAndLaunch(forgeRoot)
    if (resolved && resolved.cwd !== forgeRoot) {
      await writeFile(join(resolved.cwd, 'run-kawaii-api.bat'), bat, 'utf-8')
      await ensureKawaiiWebuiUser(resolved.cwd, port)
    }
  } catch {
    /* ignore */
  }
  return path
}

