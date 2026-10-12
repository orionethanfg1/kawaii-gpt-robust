import { describe, it, expect } from 'vitest'
import {
  parseParamLabel,
  inferModelCapabilities,
  scoreModelFit,
  recommendBestInstalled
} from './capabilities'

describe('model capabilities', () => {
  it('parses E4B effective and A4B architecture tags', () => {
    const e = parseParamLabel('Gemma 4 E4B')
    expect(e.paramLabel).toBe('E4B')
    expect(e.architectureNote).toMatch(/efectivos/i)

    const a = parseParamLabel('Gemma 4 26B A4B')
    expect(a.paramLabel).toBe('A4B')
    expect(a.approxB).toBe(4)

    const plain = parseParamLabel('qwen3.5-9b')
    expect(plain.paramLabel).toMatch(/9/)
  })

  it('detects reason tools vision', () => {
    const q = inferModelCapabilities('Qwen3.5 9B')
    expect(q.caps).toContain('reason')
    expect(q.labels).toContain('Razonar')

    const v = inferModelCapabilities('llava:7b')
    expect(v.caps).toContain('vision')
  })

  it('scores fit for hardware', () => {
    const light = scoreModelFit('qwen2.5:7b', { ramGB: 16, prefer: 'chat' })
    const heavy = scoreModelFit('qwen/qwen3.8-27b', { ramGB: 16, prefer: 'chat' })
    expect(light.fitScore).toBeGreaterThan(heavy.fitScore)
  })

  it('recommends best installed', () => {
    const r = recommendBestInstalled(['qwen2.5:3b', 'qwen2.5:14b', 'moondream'], {
      ramGB: 32,
      prefer: 'chat'
    })
    expect(r?.id).toBeTruthy()
  })
})
