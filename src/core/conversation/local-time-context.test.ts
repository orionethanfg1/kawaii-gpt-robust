import { describe, it, expect } from 'vitest'
import { buildLocalTimeContextBlock, buildLocalTimeOneLiner } from './local-time-context'

describe('local-time-context S6', () => {
  it('builds non-empty temporal block', () => {
    const b = buildLocalTimeContextBlock({
      now: new Date('2026-10-25T15:30:00'),
      locale: 'es-MX'
    })
    expect(b).toContain('CONTEXTO_TEMPORAL')
    expect(b.length).toBeGreaterThan(40)
  })

  it('one-liner for initiative', () => {
    const s = buildLocalTimeOneLiner(new Date('2026-10-25T15:30:00'))
    expect(s.toLowerCase()).toMatch(/hora/)
  })
})
