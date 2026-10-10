/**
 * I2 — Rank PNG buffers against a reference data URL using tools/face_similarity.py
 */
import { writeFileSync, unlinkSync, mkdtempSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { spawn } from 'child_process'
import { app } from 'electron'
import { pickBestIndex } from '../core/image/batch-rank'

function dataUrlToBuf(dataUrl: string): Buffer | null {
  const m = /^data:image\/[\w+.-]+;base64,(.+)$/i.exec(dataUrl)
  if (!m) return null
  try {
    return Buffer.from(m[1], 'base64')
  } catch {
    return null
  }
}

function findScript(): string | null {
  const name = 'face_similarity.py'
  const candidates = [
    join(app.getAppPath(), 'tools', name),
    join(process.cwd(), 'tools', name),
    join(__dirname, '../../tools', name),
    join(__dirname, '../../../tools', name)
  ]
  return candidates.find((p) => existsSync(p)) || null
}

function pythonCandidates(): string[] {
  if (process.platform === 'win32') {
    return ['py', 'python', 'python3']
  }
  return ['python3', 'python']
}

function runScore(
  script: string,
  refPath: string,
  imgPath: string,
  timeoutMs = 90_000
): Promise<number | null> {
  return new Promise((resolve) => {
    const bins = pythonCandidates()
    let idx = 0
    const tryNext = () => {
      if (idx >= bins.length) {
        resolve(null)
        return
      }
      const py = bins[idx++]
      const args =
        py === 'py'
          ? ['-3', script, '--ref', refPath, '--image', imgPath, '--json']
          : [script, '--ref', refPath, '--image', imgPath, '--json']
      const child = spawn(py, args, { windowsHide: true })
      let stdout = ''
      let stderr = ''
      const timer = setTimeout(() => {
        try {
          child.kill()
        } catch {
          /* */
        }
        // first model download can be slow — try next interpreter only if no output
        if (!stdout.trim()) tryNext()
        else resolve(null)
      }, timeoutMs)
      child.stdout?.on('data', (d) => {
        stdout += String(d)
      })
      child.stderr?.on('data', (d) => {
        stderr += String(d)
      })
      child.on('close', () => {
        clearTimeout(timer)
        const line = stdout
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean)
          .pop()
        if (!line) {
          if (/not found|no such file|No module/i.test(stderr)) {
            tryNext()
            return
          }
          tryNext()
          return
        }
        try {
          const j = JSON.parse(line) as {
            ok?: boolean
            score?: number
            reason?: string
          }
          if (j.reason === 'deps_missing' && typeof j.score !== 'number') {
            tryNext()
            return
          }
          if (typeof j.score === 'number' && Number.isFinite(j.score)) {
            resolve(j.score)
            return
          }
          console.warn('[face-rank] no score in JSON', line.slice(0, 200))
          resolve(null)
        } catch {
          tryNext()
        }
      })
      child.on('error', () => {
        clearTimeout(timer)
        tryNext()
      })
    }
    tryNext()
  })
}

export async function rankBuffersByFaceRef(
  referenceDataUrl: string | undefined,
  buffers: Buffer[]
): Promise<{ bestIndex: number; scores: Array<number | null>; ranked: boolean; diag?: string }> {
  // I2 fix: score even a single buffer (was skipped when length <= 1)
  if (!referenceDataUrl || !buffers.length) {
    return { bestIndex: 0, scores: buffers.map(() => null), ranked: false, diag: "no-ref-or-empty" }
  }
  const refBuf = dataUrlToBuf(referenceDataUrl)
  const script = findScript()
  if (!refBuf || !script) {
    return { bestIndex: 0, scores: buffers.map(() => null), ranked: false }
  }
  let dir: string
  try {
    dir = mkdtempSync(join(tmpdir(), 'kawaii-face-'))
  } catch {
    return { bestIndex: 0, scores: buffers.map(() => null), ranked: false }
  }
  const refPath = join(dir, 'ref.png')
  const paths: string[] = []
  try {
    writeFileSync(refPath, refBuf)
    const scores: Array<number | null> = []
    for (let i = 0; i < buffers.length; i++) {
      const p = join(dir, )
      writeFileSync(p, buffers[i])
      paths.push(p)
      scores.push(await runScore(script, refPath, p))
    }
    const bestIndex = pickBestIndex(scores)
    const ranked = scores.some((s) => s != null)
    return {
      bestIndex,
      scores,
      ranked,
      diag: ranked ? undefined : "python-no-score (¿mismo intérprete con insightface? py -3 tools/face_similarity.py --ref a.png --image b.png --json)"
    }
  } finally {
    try {
      unlinkSync(refPath)
    } catch {
      /* */
    }
    for (const p of paths) {
      try {
        unlinkSync(p)
      } catch {
        /* */
      }
    }
  }
}
