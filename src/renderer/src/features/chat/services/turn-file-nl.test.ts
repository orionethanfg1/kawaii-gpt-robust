import { describe, expect, it } from 'vitest'
import { buildDecisionPacket } from '@core/agent/decision-packet'
import { buildFileNlSystemBlock, packetWantsFileNl } from './turn-file-nl'
import { turnNeedsHostTools } from './turn-agent-tools'

describe('turn-file-nl X6', () => {
  it('packet wants file nl on biblioteca ask', () => {
    const p = buildDecisionPacket({ userText: 'lista lo que hay en la biblioteca' })
    expect(p.task).toBe('files')
    expect(packetWantsFileNl(p)).toBe(true)
    expect(turnNeedsHostTools(p, 'lista lo que hay en la biblioteca')).toBe(true)
  })

  it('buildFileNlSystemBlock mentions allowlisted tools', () => {
    const b = buildFileNlSystemBlock({ characterName: 'Niamh' })
    expect(b).toMatch(/list_library/)
    expect(b).toMatch(/delete_file/)
    expect(b).toMatch(/APP_ACTION/)
  })

  it('pure chat does not want file nl', () => {
    const p = buildDecisionPacket({ userText: 'te quiero mucho' })
    expect(packetWantsFileNl(p)).toBe(false)
  })
})
