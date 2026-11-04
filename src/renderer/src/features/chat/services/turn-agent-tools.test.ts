import { describe, expect, it } from 'vitest'
import { turnNeedsHostTools } from './turn-agent-tools'
import { buildDecisionPacket } from '@core/agent/decision-packet'

describe('turn-agent-tools X5', () => {
  it('skips tools on pure chat', () => {
    const p = buildDecisionPacket({ userText: 'hola qué tal' })
    expect(turnNeedsHostTools(p, 'hola qué tal')).toBe(false)
  })

  it('needs tools for diagnóstico', () => {
    expect(turnNeedsHostTools(null, 'haz un diagnóstico de la app')).toBe(true)
  })

  it('needs tools when packet says so', () => {
    const p = buildDecisionPacket({ userText: 'lista mis archivos' })
    // files may or may not set needsTools — force via inject
    expect(turnNeedsHostTools({ ...p, needsTools: true }, 'x')).toBe(true)
  })
})
