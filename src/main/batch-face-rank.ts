/**
 * Rank PNG buffers against a reference data URL using tools/face_similarity.py
 */
import { writeFileSync, unlinkSync, mkdtempSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { spawn } from 'child_process'
import { app } from 'electron'
import { pickBestIndex } from '../core/image/batch-rank'

function dataUrlToBuf(dataUrl: string): Buffer | null {
  const m = /^data:image\/\w+;base64,(.+)$/i.exec(dataUrl)
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
    join(__dirname, '../../tools', name)
  ]
  return candidates.find((p) => existsSync(p)) || null
}

function runScore(script: string, refPath: string, imgPath: string, timeoutMs = 25_000): Promise<number | null> {
  return new Promise((resolve) => {
    const py = process.platform === 'win32' ? 'python' : 'python3'
    const child = spawn(py, [script, '--ref', refPath, '--image', imgPath, '--json'], {
      windowsHide: true
    })
    let stdout = ''
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        /* */
      }
      resolve(null)
    }, timeoutMs)
    child.stdout?.on('data', (d) => {
      stdout += String(d)
    })
    child.on('close', () => {
      clearTimeout(timer)
      const line = stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .pop()
      if (!line) {
        resolve(null)
        return
      }
      try {
        const j = JSON.parse(line) as { ok?: boolean; score?: number; reason?: string }
        if (j.reason === 'deps_missing') {
          resolve(null)
          return
        }
        if (typeof j.score === 'number') resolve(j.score)
        else resolve(null)
      } catch {
        resolve(null)
      }
    })
    child.on('error', () => {
      clearTimeout(timer)
      resolve(null)
    })
  })
}

export async function rankBuffersByFaceRef(
  referenceDataUrl: string | undefined,
  buffers: Buffer[]
): Promise<{ bestIndex: number; scores: Array<number | null>; ranked: boolean }> {
  if (!referenceDataUrl || buffers.length <= 1) {
    return { bestIndex: 0, scores: buffers.map(() => null), ranked: false }
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
      const p = join(dir, `c${i}.png`)
      writeFileSync(p, buffers[i])
      paths.push(p)
      scores.push(await runScore(script, refPath, p))
    }
    const bestIndex = pickBestIndex(scores)
    const ranked = scores.some((s) => s != null)
    return { bestIndex, scores, ranked }
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
