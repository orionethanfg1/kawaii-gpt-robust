/**
 * Voice TTS layer — Latin American Spanish first (es-MX).
 *
 * Phase A: Microsoft Edge neural voices via `edge-tts` (no API key, no GPU).
 * Default: es-MX-DaliaNeural (neutral LATAM / Mexican broadcast standard).
 * Offline Piper / Kokoro can be added later without changing this IPC contract.
 *
 * Isolated module: failures never crash chat, Forge, or music.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { app } from 'electron'
import { pathToFileURL } from 'node:url'

export type VoiceInfo = {
  id: string
  label: string
  locale: string
  gender: 'female' | 'male' | 'neutral'
  region: string
}

/** Curated LATAM-first catalog (Edge neural). es-ES only as optional fallback. */
export const VOICE_CATALOG: VoiceInfo[] = [
  {
    id: 'es-MX-DaliaNeural',
    label: 'Dalia (México · neutro LATAM)',
    locale: 'es-MX',
    gender: 'female',
    region: 'México'
  },
  {
    id: 'es-MX-JorgeNeural',
    label: 'Jorge (México)',
    locale: 'es-MX',
    gender: 'male',
    region: 'México'
  },
  {
    id: 'es-CO-SalomeNeural',
    label: 'Salomé (Colombia)',
    locale: 'es-CO',
    gender: 'female',
    region: 'Colombia'
  },
  {
    id: 'es-AR-ElenaNeural',
    label: 'Elena (Argentina)',
    locale: 'es-AR',
    gender: 'female',
    region: 'Argentina'
  },
  {
    id: 'es-PE-CamilaNeural',
    label: 'Camila (Perú)',
    locale: 'es-PE',
    gender: 'female',
    region: 'Perú'
  },
  {
    id: 'es-US-PalomaNeural',
    label: 'Paloma (EE.UU. · español)',
    locale: 'es-US',
    gender: 'female',
    region: 'EE.UU.'
  },
  {
    id: 'es-ES-ElviraNeural',
    label: 'Elvira (España · solo si la prefieres)',
    locale: 'es-ES',
    gender: 'female',
    region: 'España'
  }
]

export const DEFAULT_VOICE_ID = 'es-MX-DaliaNeural'

let currentAbort: AbortController | null = null
let edgeTtsReady: boolean | null = null
let voiceLogTail: string[] = []
const MAX_VOICE_LOG = 150

function voiceLog(line: string): void {
  const t = String(line || '').trimEnd()
  if (!t) return
  const stamp = new Date().toISOString().slice(11, 19)
  const row = `[${stamp}] ${t}`
  voiceLogTail.push(row)
  if (voiceLogTail.length > MAX_VOICE_LOG) voiceLogTail.shift()
  try {
    const { BrowserWindow } = require('electron') as typeof import('electron')
    for (const win of BrowserWindow.getAllWindows()) {
      try {
        win.webContents.send('voice:log-line', { line: row, tail: voiceLogTail.slice(-80) })
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

export function getVoiceLogTail(): string[] {
  return [...voiceLogTail]
}


export function voiceOutDir(): string {
  try {
    return path.join(app.getPath('userData'), 'voice-out')
  } catch {
    return path.join(os.tmpdir(), 'kawaii-voice-out')
  }
}

/** Strip markdown / noise so TTS does not read code fences or image paths. */
export function sanitizeTextForTts(raw: string): string {
  let t = (raw || '').trim()
  if (!t) return ''
  // Remove fenced code
  t = t.replace(/```[\s\S]*?```/g, ' ')
  // Inline code
  t = t.replace(/`[^`]+`/g, ' ')
  // Markdown images / links → keep label text only
  t = t.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
  t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  // Bold/italic markers
  t = t.replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1')
  // Headings
  t = t.replace(/^#{1,6}\s+/gm, '')
  // HTML tags
  t = t.replace(/<[^>]+>/g, ' ')
  // Collapse whitespace
  t = t.replace(/\s+/g, ' ').trim()
  // Cap length to avoid huge Edge requests
  if (t.length > 4000) t = t.slice(0, 4000) + '…'
  return t
}

let resolvedPython: string | null = null
let installInFlight: Promise<{ ok: boolean; python?: string; error?: string }> | null = null

async function resolveDataRoot(): Promise<string> {
  try {
    const { loadMachineProfile } = await import('./machine-profile')
    const profile = await loadMachineProfile()
    if (profile?.dataRoot) return profile.dataRoot
  } catch {
    /* ignore */
  }
  try {
    return path.join(app.getPath('userData'), 'voice-runtime')
  } catch {
    return path.join(os.tmpdir(), 'kawaii-voice-runtime')
  }
}

function voiceVenvPython(dataRoot: string): string {
  if (process.platform === 'win32') {
    return path.join(dataRoot, 'runtime', 'voice-venv', 'Scripts', 'python.exe')
  }
  return path.join(dataRoot, 'runtime', 'voice-venv', 'bin', 'python')
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

async function findSystemPython(): Promise<string | null> {
  const candidates =
    process.platform === 'win32'
      ? ['py', 'python', 'python3']
      : ['python3', 'python']
  for (const py of candidates) {
    const check = await runCmd(py, ['-c', 'import sys; print(sys.executable)'], 15_000)
    if (check.code === 0 && check.stdout.trim()) {
      // Prefer absolute executable path so spawn never needs shell (spaces in user dir)
      const exe = check.stdout.trim().split(/\r?\n/).filter(Boolean).pop()
      if (exe && (await fileExists(exe))) return exe
      return py
    }
  }
  return null
}

async function pythonHasEdgeTts(py: string): Promise<boolean> {
  const check = await runCmd(py, ['-c', 'import edge_tts; print("ok")'], 20_000)
  return check.code === 0 && /ok/i.test(check.stdout)
}

/**
 * Ensure edge-tts is available: prefer dedicated voice venv under dataRoot,
 * create it and pip install if missing. Transparent to the user.
 */
export async function ensureEdgeTts(opts?: {
  onProgress?: (msg: string) => void
}): Promise<{ ok: boolean; python?: string; error?: string; installed?: boolean }> {
  const progress = (m: string) => {
    voiceLog(m)
    try {
      opts?.onProgress?.(m)
    } catch {
      /* ignore */
    }
  }

  if (resolvedPython && edgeTtsReady) {
    return { ok: true, python: resolvedPython }
  }
  if (installInFlight) return installInFlight

  installInFlight = (async () => {
    try {
      progress('Buscando motor de voz…')
      const dataRoot = await resolveDataRoot()
      const venvPy = voiceVenvPython(dataRoot)

      // 1) Existing voice venv with edge-tts
      if (await fileExists(venvPy) && (await pythonHasEdgeTts(venvPy))) {
        edgeTtsReady = true
        resolvedPython = venvPy
        progress('Motor de voz listo')
        return { ok: true, python: venvPy }
      }

      // 2) System python already has edge-tts
      const sysPy = await findSystemPython()
      if (sysPy && (await pythonHasEdgeTts(sysPy))) {
        edgeTtsReady = true
        resolvedPython = sysPy
        progress('Motor de voz listo (sistema)')
        return { ok: true, python: sysPy }
      }

      // 3) Base python to create venv: portable Forge python if present, else system
      let basePy: string | null = null
      try {
        const { isPortablePythonReady, portablePythonExe, ensurePortablePython } =
          await import('./python-runtime')
        if (isPortablePythonReady(dataRoot)) {
          basePy = portablePythonExe(dataRoot)
        } else if (sysPy) {
          basePy = sysPy
        } else {
          progress('Preparando Python portable…')
          const ens = await ensurePortablePython(dataRoot)
          if (ens.ok) basePy = ens.python
        }
      } catch {
        basePy = sysPy
      }

      if (!basePy) {
        edgeTtsReady = false
        return {
          ok: false,
          error:
            'No hay Python disponible. La app intentará usar el Python portable en el próximo arranque de Forge; o instala Python 3 desde python.org.'
        }
      }

      // 4) Create venv if needed
      const venvDir = path.join(dataRoot, 'runtime', 'voice-venv')
      if (!(await fileExists(venvPy))) {
        progress('Creando entorno de voz…')
        await fs.mkdir(path.dirname(venvDir), { recursive: true })
        // embeddable python may lack venv — try venv then virtualenv fallback via pip
        let created = await runCmd(basePy, ['-m', 'venv', venvDir], 120_000)
        if (created.code !== 0 || !(await fileExists(venvPy))) {
          progress('Instalando pip/virtualenv…')
          await runCmd(basePy, ['-m', 'pip', 'install', '--user', 'virtualenv'], 180_000)
          created = await runCmd(basePy, ['-m', 'virtualenv', venvDir], 120_000)
        }
        if (!(await fileExists(venvPy))) {
          // Last resort: install edge-tts on base python --user
          progress('Instalando edge-tts…')
          const inst = await runCmd(
            basePy,
            ['-m', 'pip', 'install', '--user', 'edge-tts'],
            180_000
          )
          if (inst.code === 0 && (await pythonHasEdgeTts(basePy))) {
            edgeTtsReady = true
            resolvedPython = basePy
            progress('Motor de voz instalado')
            return { ok: true, python: basePy, installed: true }
          }
          edgeTtsReady = false
          return {
            ok: false,
            error:
              'No se pudo crear el entorno de voz. ' +
              (created.stderr || created.stdout || '').slice(0, 200)
          }
        }
      }

      // 5) pip install edge-tts into venv
      progress('Instalando edge-tts (solo la primera vez)…')
      const pip = await runCmd(
        venvPy,
        ['-m', 'pip', 'install', '--upgrade', 'pip', 'edge-tts'],
        180_000
      )
      if (pip.code !== 0) {
        // try ensurepip then retry
        await runCmd(venvPy, ['-m', 'ensurepip', '--upgrade'], 60_000)
        const pip2 = await runCmd(venvPy, ['-m', 'pip', 'install', 'edge-tts'], 180_000)
        if (pip2.code !== 0 || !(await pythonHasEdgeTts(venvPy))) {
          edgeTtsReady = false
          return {
            ok: false,
            error:
              'Falló la instalación de edge-tts: ' +
              (pip2.stderr || pip.stderr || pip.stdout || '').slice(0, 300)
          }
        }
      } else if (!(await pythonHasEdgeTts(venvPy))) {
        edgeTtsReady = false
        return { ok: false, error: 'edge-tts instalado pero no se importa. Reintentá en unos segundos.' }
      }

      edgeTtsReady = true
      resolvedPython = venvPy
      progress('Motor de voz listo')
      return { ok: true, python: venvPy, installed: true }
    } finally {
      installInFlight = null
    }
  })()

  return installInFlight
}

function runCmd(
  cmd: string,
  args: string[],
  timeoutMs: number
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    // Never shell=true with absolute paths: "C:\Users\Orion Ethan\..." splits at space
    const isPath = /[\\/]/.test(cmd) || /\s/.test(cmd)
    const child = spawn(cmd, args, {
      windowsHide: true,
      shell: process.platform === 'win32' && !isPath,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        /* ignore */
      }
      resolve({ code: 1, stdout, stderr: stderr || 'timeout' })
    }, timeoutMs)
    child.stdout?.on('data', (d) => {
      stdout += String(d)
    })
    child.stderr?.on('data', (d) => {
      stderr += String(d)
    })
    child.on('error', (e) => {
      clearTimeout(timer)
      resolve({ code: 1, stdout, stderr: String(e.message || e) })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? 1, stdout, stderr })
    })
  })
}

export type SpeakResult = {
  ok: boolean
  audioPath?: string
  /** Prefer audioDataUrl — file:// is blocked in Electron renderer */
  audioUrl?: string
  /** data:audio/mpeg;base64,... for reliable playback */
  audioDataUrl?: string
  mediaUrl?: string
  voiceId?: string
  error?: string
  chars?: number
}

/**
 * Synthesize speech to a local media file (mp3).
 * Does not play audio — renderer uses HTMLAudioElement (keeps main process light).
 */
export async function speakText(opts: {
  text: string
  voiceId?: string
  rate?: string
}): Promise<SpeakResult> {
  const text = sanitizeTextForTts(opts.text)
  if (!text) return { ok: false, error: 'Texto vacío tras limpiar markdown' }

  const voiceId =
    opts.voiceId && VOICE_CATALOG.some((v) => v.id === opts.voiceId)
      ? opts.voiceId
      : DEFAULT_VOICE_ID

  // Cancel previous synthesis if any
  stopSpeak()
  currentAbort = new AbortController()
  const signal = currentAbort.signal

  voiceLog(`speak start voice=${voiceId} chars=${text.length}`)
  const ready = await ensureEdgeTts()
  if (!ready.ok || !ready.python) {
    voiceLog(`ensure fail: ${ready.error || 'no python'}`)
    return {
      ok: false,
      error:
        ready.error ||
        'Motor de voz no disponible. Abrí Ajustes → Voz y pulsá «Instalar motor de voz».'
    }
  }
  if (signal.aborted) return { ok: false, error: 'Cancelado' }

  const dir = voiceOutDir()
  await fs.mkdir(dir, { recursive: true })
  const outPath = path.join(dir, `tts-${Date.now()}.mp3`)

  // edge-tts CLI: edge-tts --voice X --text "..." --write-media out.mp3
  // Also available as python -m edge_tts
  const rate = opts.rate || '+0%'
  const args = [
    '-m',
    'edge_tts',
    '--voice',
    voiceId,
    '--rate',
    rate,
    '--text',
    text,
    '--write-media',
    outPath
  ]

  const r = await runCmd(ready.python, args, 120_000)
  if (signal.aborted) {
    try {
      await fs.unlink(outPath)
    } catch {
      /* ignore */
    }
    return { ok: false, error: 'Cancelado' }
  }

  if (r.code !== 0) {
    const err = (r.stderr || r.stdout || 'edge-tts falló').slice(0, 400)
    voiceLog(`edge-tts fail code=${r.code}: ${err}`)
    return {
      ok: false,
      error: err,
      voiceId
    }
  }

  try {
    const st = await fs.stat(outPath)
    if (st.size < 64) {
      voiceLog(`audio vacío size=${st.size}`)
      return { ok: false, error: 'Archivo de audio vacío', voiceId }
    }
    const buf = await fs.readFile(outPath)
    const audioDataUrl = `data:audio/mpeg;base64,${buf.toString('base64')}`
    const base = path.basename(outPath)
    const mediaUrl = `kawaii-media://voice/${encodeURIComponent(base)}`
    voiceLog(`ok voice=${voiceId} bytes=${st.size} chars=${text.length} media=${mediaUrl}`)
    return {
      ok: true,
      audioPath: outPath,
      audioUrl: mediaUrl,
      audioDataUrl,
      mediaUrl,
      voiceId,
      chars: text.length
    }
  } catch (e) {
    voiceLog(`read fail ${e instanceof Error ? e.message : String(e)}`)
    return { ok: false, error: 'No se generó el archivo de audio', voiceId }
  }
}

export function stopSpeak(): void {
  try {
    currentAbort?.abort()
  } catch {
    /* ignore */
  }
  currentAbort = null
}

export function listVoices(): VoiceInfo[] {
  return VOICE_CATALOG.slice()
}

export async function voiceStatus(): Promise<{
  ok: boolean
  engine: string
  defaultVoice: string
  edgeTtsReady: boolean | null
  message: string
}> {
  const ready = await ensureEdgeTts()
  return {
    ok: ready.ok,
    engine: 'edge-tts (Microsoft neural · es-MX prioritario)',
    defaultVoice: DEFAULT_VOICE_ID,
    edgeTtsReady: ready.ok,
    message: ready.ok
      ? 'Listo · voz por defecto Dalia (México / neutro LATAM)'
      : ready.error || 'No listo'
  }
}
