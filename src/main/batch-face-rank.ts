/**
 * I2 — Rank PNG buffers against a reference data URL using tools/face_similarity.py
 */
import { writeFileSync, rmSync, mkdtempSync, existsSync } from 'fs'
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

const FACE_SCORE_METHOD = 'insightface_arcface_cosine'

type BatchScoreResult = {
  scores: Array<number | null>
  method?: string
  diag?: string
}

function runScores(
  script: string,
  refPath: string,
  imagePaths: string[],
  timeoutMs = 90_000
): Promise<BatchScoreResult> {
  return new Promise((resolve) => {
    const bins = pythonCandidates()
    let idx = 0
    const emptyScores = () => imagePaths.map(() => null)
    const tryNext = () => {
      if (idx >= bins.length) {
        resolve({ scores: emptyScores(), diag: 'python-or-face-scorer-unavailable' })
        return
      }
      const py = bins[idx++]
      const prefix = py === 'py' ? ['-3'] : []
      const args = [
        ...prefix,
        script,
        '--ref',
        refPath,
        ...imagePaths.flatMap((imagePath) => ['--image', imagePath]),
        '--json'
      ]
      let child: ReturnType<typeof spawn>
      try {
        child = spawn(py, args, { windowsHide: true })
      } catch {
        tryNext()
        return
      }
      let stdout = ''
      let stderr = ''
      let settled = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const finish = (result: BatchScoreResult) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        resolve(result)
      }
      timer = setTimeout(() => {
        try {
          child.kill()
        } catch {
          /* */
        }
        finish({ scores: emptyScores(), diag: 'face-scorer-timeout' })
      }, timeoutMs)
      child.stdout?.on('data', (d) => {
        stdout += String(d)
      })
      child.stderr?.on('data', (d) => {
        stderr += String(d)
      })
      child.on('close', () => {
        const line = stdout
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean)
          .pop()
        if (!line) {
          if (/not found|no such file|No module/i.test(stderr)) {
            settled = true
            if (timer) clearTimeout(timer)
            tryNext()
            return
          }
          finish({ scores: emptyScores(), diag: 'face-scorer-no-output' })
          return
        }
        try {
          const j = JSON.parse(line) as {
            ok?: boolean
            method?: string | null
            results?: Array<{ ok?: boolean; score?: number }>
            reason?: string
            summary?: string
          }
          if (!j.ok && ['deps_missing', 'model_missing'].includes(String(j.reason))) {
            settled = true
            if (timer) clearTimeout(timer)
            tryNext()
            return
          }
          if (j.method !== FACE_SCORE_METHOD || !Array.isArray(j.results)) {
            finish({
              scores: emptyScores(),
              diag: j.summary || `unsupported-face-score-method:${String(j.method || 'none')}`
            })
            return
          }
          const scores = imagePaths.map((_, imageIndex) => {
            const result = j.results?.[imageIndex]
            const score = result?.score
            return result?.ok &&
              typeof score === 'number' &&
              Number.isFinite(score) &&
              score >= -1 &&
              score <= 1
              ? score
              : null
          })
          finish({
            scores,
            method: FACE_SCORE_METHOD,
            diag: scores.some((score) => score != null)
              ? undefined
              : j.summary || 'no-face-embeddings-scored'
          })
        } catch {
          finish({ scores: emptyScores(), diag: 'face-scorer-invalid-json' })
        }
      })
      child.on('error', () => {
        settled = true
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
): Promise<{
  bestIndex: number
  scores: Array<number | null>
  ranked: boolean
  method?: string
  diag?: string
}> {
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
    for (let i = 0; i < buffers.length; i++) {
      const p = join(dir, `candidate-${i + 1}.png`)
      writeFileSync(p, buffers[i])
      paths.push(p)
    }
    const scored = await runScores(script, refPath, paths)
    const scores = scored.scores
    const bestIndex = pickBestIndex(scores)
    const ranked = scores.some((s) => s != null)
    return {
      bestIndex,
      scores,
      ranked,
      method: ranked ? scored.method : undefined,
      diag: ranked ? undefined : scored.diag
    }
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      console.warn('[face-rank] failed to clean temporary score directory')
    }
  }
}
