import { describe, it, expect } from 'vitest'
import {
  classifyChatTask,
  scoreModelForTask,
  resolveIntimateModelId
} from './task-route'

describe('C3 intimacy task', () => {
  it('classifies intimate request when adult opt-in', () => {
    const t = classifyChatTask('quiero más cercanía física contigo', {
      adultOptIn: true,
      relationshipStage: 'intimate_adult'
    })
    expect(t).toBe('intimacy')
  })

  it('does not force intimacy without opt-in', () => {
    const t = classifyChatTask('quiero más cercanía física contigo', {
      adultOptIn: false,
      relationshipStage: 'intimate'
    })
    expect(t).not.toBe('intimacy')
  })

  it('scores abliterated above tifa for intimacy', () => {
    const a = scoreModelForTask('huihui_ai/qwen3-abliterated:14b-v2', 'intimacy', 32)
    const b = scoreModelForTask('tifa-deepsex-14b', 'intimacy', 32)
    expect(a).toBeGreaterThan(b)
  })

  it('resolveIntimateModelId prefers pinned', () => {
    const id = resolveIntimateModelId({
      installed: ['qwen2.5:14b', 'richardyoung/qwen3-14b-abliterated'],
      localModelIntimate: 'richardyoung/qwen3-14b-abliterated',
      ramGB: 32
    })
    expect(id).toContain('abliterated')
  })
})
