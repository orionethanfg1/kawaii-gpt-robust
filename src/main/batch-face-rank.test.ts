import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  mkdtempSync: vi.fn(),
  writeFileSync: vi.fn(),
  rmSync: vi.fn(),
  spawn: vi.fn(),
  scoreResponse: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getAppPath: () => 'C:\\kawaii-test-app' }
}))

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    existsSync: mocks.existsSync,
    mkdtempSync: mocks.mkdtempSync,
    writeFileSync: mocks.writeFileSync,
    rmSync: mocks.rmSync
  }
})

vi.mock('child_process', () => ({ spawn: mocks.spawn }))
vi.mock('os', () => ({ tmpdir: () => 'C:\\kawaii-test-temp' }))

import { rankBuffersByFaceRef } from './batch-face-rank'

describe('rankBuffersByFaceRef', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.existsSync.mockImplementation((path: unknown) =>
      String(path).endsWith('face_similarity.py')
    )
    mocks.mkdtempSync.mockReturnValue(
      join('C:\\kawaii-test-temp', 'kawaii-face-test')
    )
    mocks.scoreResponse.mockReturnValue(
      JSON.stringify({
        ok: true,
        method: 'insightface_arcface_cosine',
        results: [
          { ok: true, score: 0.8 },
          { ok: true, score: 0.7 }
        ]
      })
    )
    mocks.spawn.mockImplementation(() => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter
        stderr: EventEmitter
      }
      child.stdout = new EventEmitter()
      child.stderr = new EventEmitter()
      queueMicrotask(() => {
        child.stdout.emit('data', `${mocks.scoreResponse()}\n`)
        child.emit('close', 0)
      })
      return child
    })
  })

  it('writes each candidate to a distinct file and scores it', async () => {
    const result = await rankBuffersByFaceRef(
      'data:image/png;base64,cmVm',
      [Buffer.from('candidate one'), Buffer.from('candidate two')]
    )

    const writtenPaths = mocks.writeFileSync.mock.calls.map(([path]) =>
      String(path)
    )
    expect(writtenPaths).toEqual([
      join('C:\\kawaii-test-temp', 'kawaii-face-test', 'ref.png'),
      join('C:\\kawaii-test-temp', 'kawaii-face-test', 'candidate-1.png'),
      join('C:\\kawaii-test-temp', 'kawaii-face-test', 'candidate-2.png')
    ])
    expect(result).toMatchObject({
      bestIndex: 0,
      scores: [0.8, 0.7],
      ranked: true,
      method: 'insightface_arcface_cosine'
    })
    expect(mocks.spawn).toHaveBeenCalledTimes(1)
    expect(mocks.rmSync).toHaveBeenCalledWith(
      join('C:\\kawaii-test-temp', 'kawaii-face-test'),
      { recursive: true, force: true }
    )
  })

  it('does not trust unsupported similarity methods as identity scores', async () => {
    mocks.scoreResponse.mockReturnValue(
      JSON.stringify({
        ok: true,
        method: 'opencv_hist_proxy',
        results: [{ ok: true, score: 0.99 }, { ok: true, score: 0.1 }]
      })
    )

    const result = await rankBuffersByFaceRef(
      'data:image/png;base64,cmVm',
      [Buffer.from('candidate one'), Buffer.from('candidate two')]
    )

    expect(result).toMatchObject({
      bestIndex: 0,
      scores: [null, null],
      ranked: false
    })
    expect(result.method).toBeUndefined()
  })
})
