import { describe, it, expect } from 'vitest'
import { proposeRecoveryAfterFailure, recoveryTipFromResults, formatRecoveryProposal } from './auto-correct'

describe('AC1 auto-correct', () => {
  it('proposes start_forge after health_forge down', () => {
    const p = proposeRecoveryAfterFailure('health_forge', 'Forge API error / stopped')
    expect(p).not.toBeNull()
    expect(p!.nextTools).toContain('start_forge')
    expect(p!.humanMessage.toLowerCase()).toMatch(/forge/)
    expect(p!.safeAuto).toBe(true)
  })

  it('proposes ensure_faceid when missing', () => {
    const p = proposeRecoveryAfterFailure('check_faceid', 'Sin FaceID/IP-Adapter')
    expect(p).not.toBeNull()
    expect(p!.nextTools[0]).toBe('ensure_faceid')
  })

  it('formats proposal for prompt', () => {
    const p = proposeRecoveryAfterFailure('health_forge', 'detenido')
    expect(p).not.toBeNull()
    const s = formatRecoveryProposal(p!)
    expect(s).toMatch(/AUTOCORRECCIÓN/)
  })

  it('recoveryTipFromResults picks last failure', () => {
    const tip = recoveryTipFromResults([
      { tool: 'probe_forge', ok: true, summary: 'ok' },
      { tool: 'health_forge', ok: false, summary: 'error stopped' }
    ])
    expect(tip?.nextTools[0]).toBe('start_forge')
  })
})
