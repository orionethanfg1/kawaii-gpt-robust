/**
 * Auto-provision Windows embeddable Python 3.11 + Forge venv + torch.
 * Persistent job state + retries so network drops can resume.
 */

import { join } from 'path'
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync
} from 'fs'
import { createWriteStream } from 'fs'
import { spawnSync } from 'child_process'
import { pipeline } from 'stream/promises'

export const EMBED_PYTHON_VERSION = '3.11.9'
export const EMBED_PYTHON_URL =
  'https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip'
export const GET_PIP_URL = 'https://bootstrap.pypa.io/get-pip.py'

export const TORCH_SPEC = 'torch==2.3.1 torchvision==0.18.1'
export const TORCH_INDEX = 'https://download.pytorch.org/whl/cu121'

export type PythonEnsureProgress = {
  phase: 'check' | 'download' | 'extract' | 'pip' | 'venv' | 'torch' | 'ready' | 'error'
  message: string
  percent?: number
}

type EnvJobState = {
  version: 1
  dataRoot: string
  webuiDir: string
  step: 'python' | 'venv' | 'torch' | 'libs' | 'done'
  updatedAt: number
  lastError?: string
  torchAttempts: number
  libsAttempts: number
}

/** setuptools>=82 breaks CLIP setup.py (pkg_resources / build_meta) */
const SETUPTOOLS_PIN = 'setuptools==69.5.1'
/** Official pins from A1111/Forge launch_utils (commit ends in …fc8e1) */
const CLIP_CANDIDATES = [
  'https://github.com/openai/CLIP/archive/d50d76daa670286dd6cacf3bcd80b5e4823fc8e1.zip',
  'git+https://github.com/openai/CLIP.git@d50d76daa670286dd6cacf3bcd80b5e4823fc8e1',
  'git+https://github.com/openai/CLIP.git'
]
const OPEN_CLIP_CANDIDATES = [
  'https://github.com/mlfoundations/open_clip/archive/bb6e834e9c70d9c27d0dc3ecedeebeaeb1ffad6b.zip',
  'git+https://github.com/mlfoundations/open_clip.git@bb6e834e9c70d9c27d0dc3ecedeebeaeb1ffad6b',
  'git+https://github.com/mlfoundations/open_clip.git'
]

function jobPath(dataRoot: string): string {
  return join(dataRoot, 'runtime', 'forge-env-job.json')
}

function loadJob(dataRoot: string): EnvJobState | null {
  try {
    const p = jobPath(dataRoot)
    if (!existsSync(p)) return null
    return JSON.parse(readFileSync(p, 'utf-8')) as EnvJobState
  } catch {
    return null
  }
}

function saveJob(job: EnvJobState): void {
  try {
    mkdirSync(join(job.dataRoot, 'runtime'), { recursive: true })
    writeFileSync(jobPath(job.dataRoot), JSON.stringify(job, null, 2), 'utf-8')
  } catch {
    /* ignore */
  }
}

export function portablePythonDir(dataRoot: string): string {
  return join(dataRoot, 'runtime', `python-${EMBED_PYTHON_VERSION}`)
}

export function portablePythonExe(dataRoot: string): string {
  return join(portablePythonDir(dataRoot), 'python.exe')
}

function runPy(
  python: string,
  args: string[],
  opts?: { cwd?: string; timeout?: number }
): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(python, args, {
    cwd: opts?.cwd,
    encoding: 'utf-8',
    timeout: opts?.timeout ?? 60_000,
    windowsHide: true,
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      PYTHONNOUSERSITE: '1',
      PIP_DISABLE_PIP_VERSION_CHECK: '1',
      PIP_DEFAULT_TIMEOUT: '100'
    }
  })
  return {
    status: r.status,
    stdout: (r.stdout || '').toString(),
    stderr: (r.stderr || '').toString()
  }
}

export function isPortablePythonReady(dataRoot: string): boolean {
  const exe = portablePythonExe(dataRoot)
  if (!existsSync(exe)) return false
  const r = runPy(exe, ['-c', 'import sys; print("%d.%d"%sys.version_info[:2])'], {
    timeout: 10000
  })
  return (r.stdout || '').trim().startsWith('3.11')
}

async function downloadFile(
  url: string,
  dest: string,
  onProgress?: (pct: number) => void
): Promise<void> {
  // Resume if partial file exists
  let start = 0
  try {
    if (existsSync(dest)) {
      const { statSync } = await import('fs')
      start = statSync(dest).size
    }
  } catch {
    start = 0
  }

  const headers: Record<string, string> = {}
  if (start > 0) headers.Range = `bytes=${start}-`

  const res = await fetch(url, { redirect: 'follow', headers })
  if (res.status === 416) return // already complete
  if (!res.ok && res.status !== 206) {
    throw new Error(`Download failed ${res.status}: ${url}`)
  }
  const totalHdr = Number(res.headers.get('content-length') || 0)
  const total = res.status === 206 ? start + totalHdr : totalHdr || start
  const { Readable } = await import('stream')
  if (!res.body) throw new Error('Empty body')
  const nodeStream = Readable.fromWeb(res.body as never)
  let done = start
  const out = createWriteStream(dest, { flags: start > 0 && res.status === 206 ? 'a' : 'w' })
  nodeStream.on('data', (chunk: Buffer) => {
    done += chunk.length
    if (total > 0 && onProgress) onProgress(Math.min(99, Math.round((done / total) * 100)))
  })
  await pipeline(nodeStream, out)
}

function patchPth(dir: string): void {
  const names = readdirSync(dir)
  const pth = names.find((n) => n.endsWith('._pth') && n.startsWith('python'))
  if (!pth) return
  const path = join(dir, pth)
  let content = readFileSync(path, 'utf-8')
  if (!/^\s*import site\s*$/m.test(content)) {
    content = content.replace(/#\s*import site/, 'import site')
    if (!/import site/.test(content)) content += '\nimport site\n'
  }
  if (!/Lib\\site-packages/.test(content) && !/Lib\/site-packages/.test(content)) {
    content += 'Lib\\site-packages\n'
  }
  if (!/^Lib\s*$/m.test(content)) content += 'Lib\n'
  content = content.replace(/^\s*#\s*import site/m, 'import site')
  writeFileSync(path, content, 'utf-8')
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function isTransientNetworkError(text: string): boolean {
  return /NameResolutionError|getaddrinfo|Connection interrupted|Connection reset|timed out|Failed to establish|Could not find a version|Remote end closed|SSL|Max retries|Temporary failure|Network is unreachable|Connection refused/i.test(
    text
  )
}

export async function ensurePortablePython(
  dataRoot: string,
  onProgress?: (p: PythonEnsureProgress) => void
): Promise<{ ok: true; python: string } | { ok: false; error: string }> {
  const emit = (p: PythonEnsureProgress) => {
    try {
      onProgress?.(p)
    } catch {
      /* ignore */
    }
  }

  try {
    if (isPortablePythonReady(dataRoot)) {
      emit({ phase: 'ready', message: 'Python 3.11 portable listo', percent: 100 })
      return { ok: true, python: portablePythonExe(dataRoot) }
    }

    const dir = portablePythonDir(dataRoot)
    mkdirSync(dir, { recursive: true })
    const zipPath = join(dataRoot, 'runtime', `python-${EMBED_PYTHON_VERSION}-embed-amd64.zip`)
    mkdirSync(join(dataRoot, 'runtime'), { recursive: true })

    emit({ phase: 'download', message: 'Descargando Python 3.11.9 portable (~25 MB)…', percent: 5 })
    if (!existsSync(join(dir, 'python.exe'))) {
      let lastErr = ''
      for (let attempt = 1; attempt <= 5; attempt++) {
        try {
          await downloadFile(EMBED_PYTHON_URL, zipPath, (pct) =>
            emit({
              phase: 'download',
              message: `Descargando Python 3.11.9… ${pct}% (intento ${attempt}/5)`,
              percent: Math.round(pct * 0.45)
            })
          )
          lastErr = ''
          break
        } catch (e) {
          lastErr = e instanceof Error ? e.message : String(e)
          emit({
            phase: 'download',
            message: `Red interrumpida, reintentando… (${attempt}/5)`,
            percent: 10
          })
          await sleep(2000 * attempt)
        }
      }
      if (lastErr) throw new Error(lastErr)

      emit({ phase: 'extract', message: 'Extrayendo Python 3.11…', percent: 50 })
      const exp = spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          `Expand-Archive -Path '${zipPath.replace(/'/g, "''")}' -DestinationPath '${dir.replace(/'/g, "''")}' -Force`
        ],
        { encoding: 'utf-8', timeout: 120_000, windowsHide: true }
      )
      if (exp.status !== 0) {
        throw new Error(exp.stderr || exp.stdout || 'Expand-Archive failed')
      }
    }

    if (!existsSync(join(dir, 'python.exe'))) {
      throw new Error('python.exe no apareció tras extraer el embeddable')
    }

    patchPth(dir)
    emit({ phase: 'pip', message: 'Instalando pip + virtualenv…', percent: 65 })

    const getPip = join(dir, 'get-pip.py')
    const hasPip =
      existsSync(join(dir, 'Scripts', 'pip.exe')) ||
      existsSync(join(dir, 'Lib', 'site-packages', 'pip'))
    if (!hasPip) {
      await downloadFile(GET_PIP_URL, getPip)
      const pip = runPy(join(dir, 'python.exe'), [getPip, '--no-warn-script-location'], {
        cwd: dir,
        timeout: 300_000
      })
      if (pip.status !== 0) {
        throw new Error(`get-pip falló: ${(pip.stderr || pip.stdout).slice(0, 400)}`)
      }
    }

    const ve = runPy(
      join(dir, 'python.exe'),
      [
        '-m',
        'pip',
        'install',
        '--upgrade',
        'pip',
        'setuptools==69.5.1',
        'wheel',
        'virtualenv',
        'packaging'
      ],
      { cwd: dir, timeout: 300_000 }
    )
    if (ve.status !== 0) {
      throw new Error(`pip virtualenv falló: ${(ve.stderr || ve.stdout).slice(0, 400)}`)
    }

    if (!isPortablePythonReady(dataRoot)) {
      throw new Error('Python portable instalado pero no responde como 3.11')
    }

    emit({ phase: 'ready', message: 'Python 3.11 portable listo', percent: 100 })
    return { ok: true, python: portablePythonExe(dataRoot) }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    emit({ phase: 'error', message: error })
    return { ok: false, error }
  }
}

export function forgeVenvPython(forgeWebuiDir: string): string {
  return join(forgeWebuiDir, 'venv', 'Scripts', 'python.exe')
}

export function isForgeVenvReady(forgeWebuiDir: string): boolean {
  const py = forgeVenvPython(forgeWebuiDir)
  if (!existsSync(py)) return false
  const r = runPy(py, ['-c', 'import sys; print("%d.%d"%sys.version_info[:2])'], {
    timeout: 10000
  })
  const v = (r.stdout || '').trim()
  return v.startsWith('3.10') || v.startsWith('3.11') || v.startsWith('3.12')
}

export function forgeVenvHasTorch(forgeWebuiDir: string): boolean {
  const py = forgeVenvPython(forgeWebuiDir)
  if (!existsSync(py)) return false
  const r = runPy(py, ['-c', 'import torch; print(torch.__version__)'], { timeout: 30000 })
  return r.status === 0 && (r.stdout || '').trim().length > 0
}

/**
 * Create forge/venv with portable 3.11 and install torch with retries + job persistence.
 */
export async function ensureForgeVenvWithTorch(
  dataRoot: string,
  forgeWebuiDir: string,
  onProgress?: (p: PythonEnsureProgress) => void
): Promise<{ ok: true; python: string } | { ok: false; error: string; resumable?: boolean }> {
  const emit = (p: PythonEnsureProgress) => {
    try {
      onProgress?.(p)
    } catch {
      /* ignore */
    }
  }

  const job: EnvJobState = loadJob(dataRoot) || {
    version: 1,
    dataRoot,
    webuiDir: forgeWebuiDir,
    step: 'python',
    updatedAt: Date.now(),
    torchAttempts: 0,
    libsAttempts: 0
  }
  if (job.libsAttempts == null) job.libsAttempts = 0
  job.webuiDir = forgeWebuiDir
  job.dataRoot = dataRoot

  try {
    // --- Python ---
    if (job.step === 'python' || !isPortablePythonReady(dataRoot)) {
      job.step = 'python'
      saveJob(job)
      const base = await ensurePortablePython(dataRoot, onProgress)
      if (!base.ok) {
        job.lastError = base.error
        saveJob(job)
        return { ...base, resumable: true }
      }
      job.step = 'venv'
      job.lastError = undefined
      saveJob(job)
    }

    const basePy = portablePythonExe(dataRoot)
    const venvPy = forgeVenvPython(forgeWebuiDir)

    // --- Venv ---
    if (job.step === 'venv' || !isForgeVenvReady(forgeWebuiDir)) {
      job.step = 'venv'
      saveJob(job)
      emit({ phase: 'venv', message: 'Creando venv de Forge con Python 3.11…', percent: 40 })
      mkdirSync(forgeWebuiDir, { recursive: true })
      if (!isForgeVenvReady(forgeWebuiDir)) {
        const ve = runPy(basePy, ['-m', 'virtualenv', '--copies', join(forgeWebuiDir, 'venv')], {
          cwd: forgeWebuiDir,
          timeout: 180_000
        })
        if (ve.status !== 0 || !existsSync(venvPy)) {
          const err = `No se pudo crear venv: ${(ve.stderr || ve.stdout || '').slice(0, 500)}`
          job.lastError = err
          saveJob(job)
          return { ok: false, error: err, resumable: true }
        }
      }
      job.step = 'torch'
      job.lastError = undefined
      saveJob(job)
    }

    // --- Torch with retries (pip resumes wheel downloads when possible) ---
    if (!forgeVenvHasTorch(forgeWebuiDir)) {
      job.step = 'torch'
      saveJob(job)
      const maxAttempts = 8
      let lastErr = ''
      for (let attempt = job.torchAttempts + 1; attempt <= maxAttempts; attempt++) {
        job.torchAttempts = attempt
        saveJob(job)
        emit({
          phase: 'torch',
          message: `Instalando torch 2.3.1 (intento ${attempt}/${maxAttempts}, reanudable si se corta la red)…`,
          percent: 50 + Math.min(40, attempt * 4)
        })
        const torch = runPy(
          venvPy,
          [
            '-m',
            'pip',
            'install',
            '--retries',
            '10',
            '--timeout',
            '120',
            ...TORCH_SPEC.split(' '),
            '--extra-index-url',
            TORCH_INDEX
          ],
          { cwd: forgeWebuiDir, timeout: 1_800_000 }
        )
        const out = `${torch.stderr || ''}\n${torch.stdout || ''}`
        if (torch.status === 0 && forgeVenvHasTorch(forgeWebuiDir)) {
          lastErr = ''
          break
        }
        lastErr = out.slice(0, 700) || `pip exit ${torch.status}`
        if (!isTransientNetworkError(lastErr) && attempt >= 3) {
          // Non-network failure after a few tries — still allow resume but report clearly
          job.lastError = lastErr
          saveJob(job)
          return {
            ok: false,
            error: `pip torch falló: ${lastErr.slice(0, 400)}`,
            resumable: true
          }
        }
        emit({
          phase: 'torch',
          message: `Red interrumpida en torch (${attempt}/${maxAttempts}). Reintentando en ${attempt * 3}s…`,
          percent: 55
        })
        await sleep(3000 * attempt)
      }
      if (lastErr || !forgeVenvHasTorch(forgeWebuiDir)) {
        job.lastError = lastErr || 'torch no importable'
        saveJob(job)
        return {
          ok: false,
          error:
            `pip torch incompleto tras varios intentos (red). Pulsa de nuevo «Arrancar Forge API» para continuar. ` +
            lastErr.slice(0, 280),
          resumable: true
        }
      }
    }

    // --- Critical libs: setuptools pin + CLIP (avoids build_meta / pkg_resources crash) ---
    const needsLibs = (() => {
      const r = runPy(
        venvPy,
        [
          '-c',
          'import importlib.util as u,sys; ok=u.find_spec("clip") and u.find_spec("open_clip"); import setuptools; from packaging.version import parse; v=setuptools.__version__; sys.exit(0 if ok and parse(v)<parse("82") else 1)'
        ],
        { timeout: 30000 }
      )
      return r.status !== 0
    })()

    if (needsLibs || job.step === 'libs') {
      job.step = 'libs'
      saveJob(job)
      const maxLibs = 6
      let lastErr = ''
      for (let attempt = job.libsAttempts + 1; attempt <= maxLibs; attempt++) {
        job.libsAttempts = attempt
        saveJob(job)
        emit({
          phase: 'pip',
          message: `Preparando librerías Forge (setuptools+CLIP) intento ${attempt}/${maxLibs}…`,
          percent: 88
        })

        // 1) Pin setuptools (must be <82 for CLIP setup.py)
        // setuptools + pydantic/fastapi pins (avoids FieldInfo.in_ crash with Gradio)
        const st = runPy(
          venvPy,
          [
            '-m',
            'pip',
            'install',
            '--retries',
            '8',
            '--timeout',
            '120',
            SETUPTOOLS_PIN,
            'wheel',
            'packaging',
            'pydantic>=2.5,<2.12',
            'fastapi>=0.104,<0.116'
          ],
          { cwd: forgeWebuiDir, timeout: 600_000 }
        )
        if (st.status !== 0) {
          lastErr = (st.stderr || st.stdout || '').slice(0, 500)
          if (isTransientNetworkError(lastErr)) {
            await sleep(2500 * attempt)
            continue
          }
          job.lastError = lastErr
          saveJob(job)
          return {
            ok: false,
            error: `Pin setuptools falló: ${lastErr.slice(0, 300)}`,
            resumable: true
          }
        }

        // 2) CLIP + open_clip — try official A1111 URLs then git fallbacks
        const pipNoIso = (spec: string) =>
          runPy(
            venvPy,
            [
              '-m',
              'pip',
              'install',
              '--retries',
              '8',
              '--timeout',
              '120',
              '--no-build-isolation',
              '--prefer-binary',
              spec
            ],
            { cwd: forgeWebuiDir, timeout: 900_000 }
          )

        let clipOk = false
        let clipErr = ''
        for (const spec of CLIP_CANDIDATES) {
          emit({
            phase: 'pip',
            message: `Instalando CLIP (${spec.includes('git+') ? 'git' : 'zip'})…`,
            percent: 90
          })
          const clip = pipNoIso(spec)
          if (clip.status === 0) {
            clipOk = true
            break
          }
          clipErr = (clip.stderr || clip.stdout || '').slice(0, 500)
          if (/404|Not Found/i.test(clipErr)) continue
          if (isTransientNetworkError(clipErr) || /build_meta|pkg_resources|setuptools/i.test(clipErr)) {
            runPy(venvPy, ['-m', 'pip', 'install', SETUPTOOLS_PIN, 'wheel'], {
              cwd: forgeWebuiDir,
              timeout: 300_000
            })
          }
        }
        if (!clipOk) {
          lastErr = clipErr || 'CLIP install failed'
          if (isTransientNetworkError(lastErr) || /404|Not Found/i.test(lastErr)) {
            await sleep(2000 * attempt)
            continue
          }
          job.lastError = lastErr
          saveJob(job)
          return {
            ok: false,
            error: `CLIP falló: ${lastErr.slice(0, 300)}`,
            resumable: true
          }
        }

        let ocOk = false
        for (const spec of OPEN_CLIP_CANDIDATES) {
          const oc = pipNoIso(spec)
          if (oc.status === 0) {
            ocOk = true
            break
          }
        }
        if (!ocOk) {
          emit({
            phase: 'pip',
            message: 'open_clip parcial; Forge puede completar al arrancar…',
            percent: 92
          })
        }

        lastErr = ''
        break
      }
      if (lastErr) {
        job.lastError = lastErr
        saveJob(job)
        return {
          ok: false,
          error:
            `Librerías Forge incompletas. Pulsa otra vez Arrancar Forge API para reanudar. ${lastErr.slice(0, 250)}`,
          resumable: true
        }
      }
    }

    job.step = 'done'
    job.lastError = undefined
    job.torchAttempts = 0
    job.libsAttempts = 0
    saveJob(job)

    emit({ phase: 'ready', message: 'Venv Forge + torch + CLIP listos', percent: 100 })
    return { ok: true, python: venvPy }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    job.lastError = error
    saveJob(job)
    emit({ phase: 'error', message: error })
    return { ok: false, error, resumable: true }
  }
}


/**
 * Force-compatible Gradio/FastAPI/Pydantic stack.
 * Forge create_api() still builds Gradio UI even with --nowebui;
 * pydantic>=2.12 breaks older fastapi (FieldInfo.in_).
 */
export async function ensureForgeWebStack(
  forgeWebuiDir: string,
  onProgress?: (p: PythonEnsureProgress) => void
): Promise<{ ok: true } | { ok: false; error: string }> {
  const emit = (p: PythonEnsureProgress) => {
    try {
      onProgress?.(p)
    } catch {
      /* ignore */
    }
  }
  const venvPy = forgeVenvPython(forgeWebuiDir)
  if (!existsSync(venvPy)) {
    return { ok: false, error: 'venv no encontrado; prepara el entorno primero' }
  }

  // Detect broken combo
  const check = runPy(
    venvPy,
    [
      '-c',
      'import pydantic,fastapi,sys; from packaging.version import parse; pv=pydantic.__version__; fv=fastapi.__version__; bad=parse(pv)>=parse("2.12"); print(pv,fv,bad); sys.exit(1 if bad else 0)'
    ],
    { timeout: 30000 }
  )
  const alreadyOk = check.status === 0

  emit({
    phase: 'pip',
    message: alreadyOk
      ? 'Stack web Forge OK (pydantic/fastapi)'
      : 'Reparando pydantic/fastapi (evita FieldInfo.in_)…',
    percent: 93
  })

  // Always pin known-good range for this Forge generation
  const pin = runPy(
    venvPy,
    [
      '-m',
      'pip',
      'install',
      '--retries',
      '8',
      '--timeout',
      '120',
      'pydantic==2.10.6',
      'pydantic-core==2.27.2',
      'fastapi==0.115.6',
      'starlette==0.41.3',
      SETUPTOOLS_PIN,
      'wheel'
    ],
    { cwd: forgeWebuiDir, timeout: 600_000 }
  )
  if (pin.status !== 0) {
    return {
      ok: false,
      error: `No se pudo fijar pydantic/fastapi: ${(pin.stderr || pin.stdout || '').slice(0, 400)}`
    }
  }

  // Sanity: FieldInfo should work with fastapi params if import works
  const verify = runPy(
    venvPy,
    [
      '-c',
      'import pydantic,fastapi; from packaging.version import parse; assert parse(pydantic.__version__)<parse("2.12"); print("ok", pydantic.__version__, fastapi.__version__)'
    ],
    { timeout: 20000 }
  )
  if (verify.status !== 0) {
    return {
      ok: false,
      error: `Verificación pydantic falló: ${(verify.stderr || verify.stdout || '').slice(0, 300)}`
    }
  }
  emit({ phase: 'ready', message: 'Stack Gradio/API compatible', percent: 96 })
  return { ok: true }
}
