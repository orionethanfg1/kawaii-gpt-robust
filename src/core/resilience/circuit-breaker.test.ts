import { describe, it, expect, beforeEach } from 'vitest'
import { CircuitBreaker } from './circuit-breaker'

describe('CircuitBreaker', () => {
  let cb: CircuitBreaker

  beforeEach(() => {
    cb = new CircuitBreaker({
      failureThreshold: 2,
      baseCooldownMs: 1000,
      successThreshold: 1
    })
  })

  it('starts closed and allows requests', () => {
    expect(cb.getState('p1')).toBe('closed')
    expect(cb.canRequest('p1')).toBe(true)
  })

  it('opens after threshold failures', () => {
    cb.recordFailure('p1', 'err1')
    expect(cb.getState('p1')).toBe('closed')
    cb.recordFailure('p1', 'err2')
    expect(cb.getState('p1')).toBe('open')
    expect(cb.canRequest('p1')).toBe(false)
  })

  it('transitions to half-open after cooldown', () => {
    cb.recordFailure('p1')
    cb.recordFailure('p1')
    expect(cb.getState('p1')).toBe('open')

    const future = Date.now() + 5000
    expect(cb.canRequest('p1', future)).toBe(true)
    expect(cb.getState('p1')).toBe('half-open')
  })

  it('closes after successful probe in half-open', () => {
    cb.recordFailure('p1')
    cb.recordFailure('p1')
    cb.canRequest('p1', Date.now() + 5000)
    cb.recordSuccess('p1')
    expect(cb.getState('p1')).toBe('closed')
  })

  it('re-opens if half-open probe fails', () => {
    cb.recordFailure('p1')
    cb.recordFailure('p1')
    cb.canRequest('p1', Date.now() + 5000)
    cb.recordFailure('p1', 'probe failed')
    expect(cb.getState('p1')).toBe('open')
  })
})
