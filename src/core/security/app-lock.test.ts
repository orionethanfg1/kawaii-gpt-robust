import { describe, it, expect, beforeEach } from 'vitest'
import {
  isValidPinFormat,
  hashPin,
  verifyPin,
  lockSession,
  markSessionUnlocked,
  isSessionUnlocked,
  needsLockGate,
  shouldRelockForInactivity,
  touchActivity
} from './app-lock'

describe('B app-lock (own PIN, no OS)', () => {
  beforeEach(() => {
    lockSession()
  })

  it('rejects short PIN', () => {
    expect(isValidPinFormat('12')).toBe(false)
    expect(isValidPinFormat('1234')).toBe(true)
    expect(isValidPinFormat('abcd')).toBe(false)
  })

  it('hash + verify roundtrip', async () => {
    const { saltB64, pinHashB64 } = await hashPin('4829')
    expect(await verifyPin('4829', saltB64, pinHashB64)).toBe(true)
    expect(await verifyPin('0000', saltB64, pinHashB64)).toBe(false)
  })

  it('session lock / unlock', () => {
    expect(isSessionUnlocked()).toBe(false)
    markSessionUnlocked()
    expect(isSessionUnlocked()).toBe(true)
    lockSession()
    expect(isSessionUnlocked()).toBe(false)
  })

  it('needsLockGate when enabled and locked', () => {
    expect(
      needsLockGate({
        enabled: true,
        saltB64: 'x',
        pinHashB64: 'y',
        timeoutMinutes: 30
      })
    ).toBe(true)
    markSessionUnlocked()
    expect(
      needsLockGate({
        enabled: true,
        saltB64: 'x',
        pinHashB64: 'y',
        timeoutMinutes: 30
      })
    ).toBe(false)
  })

  it('inactivity helper', () => {
    markSessionUnlocked()
    touchActivity()
    expect(shouldRelockForInactivity(60)).toBe(false)
  })
})
