import { describe, it, expect } from 'vitest'
import { classifyChatTask, pickBestInstalledForTask, scoreModelForTask } from './task-route'

describe('task-route Sprint A', () => {
  it('classifies vision and code', () => {
    expect(classifyChatTask('describe esta foto', { hasImageAttachment: true })).toBe('vision')
    expect(classifyChatTask('arregla este bug de TypeScript')).toBe('code')
  })

  it('prefers vision model for vision task', () => {
    const r = pickBestInstalledForTask({
      installed: ['qwen2.5:14b', 'llava:7b', 'qwen2.5-coder:7b'],
      task: 'vision',
      current: 'qwen2.5:14b',
      ramGB: 32,
      minDelta: 0
    })
    expect(r.to.toLowerCase()).toMatch(/llava|vision|vl/)
  })

  it('prefers coder for code', () => {
    const r = pickBestInstalledForTask({
      installed: ['qwen2.5:7b', 'qwen2.5-coder:14b'],
      task: 'code',
      current: '',
      ramGB: 32,
      minDelta: 0
    })
    expect(r.to).toMatch(/coder/i)
  })

  it('scores reason models higher on balanced chat when they fit', () => {
    const a = scoreModelForTask('qwen3:8b', 'chat', 32)
    const b = scoreModelForTask('tinyllama:1b', 'chat', 32)
    expect(a).toBeGreaterThan(b)
  })
})

describe('R3 preferUncensoredCompanion', () => {
  it('boosts dolphin when opt-in bias on', () => {
    const a = scoreModelForTask('qwen2.5:14b', 'chat', 32, null, {
      preferUncensoredCompanion: true
    })
    const b = scoreModelForTask('dolphin-llama3', 'chat', 32, null, {
      preferUncensoredCompanion: true
    })
    expect(b).toBeGreaterThan(a - 5)
  })
})

describe("S1b vision-only", () => {
  it("scores moondream very low for chat", async () => {
    const { scoreModelForTask, isVisionOnlyAuxiliaryModel, pickBestInstalledForTask } = await import("./task-route")
    expect(isVisionOnlyAuxiliaryModel("moondream:latest")).toBe(true)
    expect(isVisionOnlyAuxiliaryModel("google/gemma-4-26b-a4b")).toBe(false)
    expect(scoreModelForTask("moondream:latest", "chat", 32, 16)).toBeLessThan(-20)
    const r = pickBestInstalledForTask({
      installed: ["moondream:latest", "google/gemma-4-26b-a4b"],
      task: "vision",
      current: "google/gemma-4-26b-a4b",
      ramGB: 32,
      vramGB: 16,
      minDelta: 3
    })
    expect(r.to).toMatch(/gemma/i)
    expect(r.applied).toBe(false)
  })
})
