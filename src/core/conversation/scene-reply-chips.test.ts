import { describe, it, expect } from 'vitest'
import { sceneReplyChipsForPhase } from './scene-reply-chips'
import { buildTimeAwarenessBlock } from './time-awareness'

describe('S5 scene chips', () => {
  it('invited has accept/decline', () => {
    const c = sceneReplyChipsForPhase('invited')
    expect(c.map((x) => x.kind).sort().join(',')).toBe('accept,decline')
  })
  it('scene_active has exit options', () => {
    const c = sceneReplyChipsForPhase('scene_active')
    expect(c.some((x) => x.kind === 'soft_exit')).toBe(true)
  })
  it('idle empty', () => {
    expect(sceneReplyChipsForPhase('idle')).toHaveLength(0)
  })
})

describe('S6 time awareness', () => {
  it('includes clock and quiet line', () => {
    const b = buildTimeAwarenessBlock({
      now: new Date('2026-10-25T02:00:00'),
      quietStartH: 23,
      quietEndH: 8
    })
    expect(b).toMatch(/TIEMPO_LOCAL/)
    expect(b).toMatch(/02:00/)
    expect(b).toMatch(/descanso|suave/i)
  })
})
