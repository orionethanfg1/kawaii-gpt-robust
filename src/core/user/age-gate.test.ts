import { describe, it, expect } from 'vitest'
import {
  parseBirthDate,
  ageYearsAt,
  evaluateAgeGate,
  effectiveAdultIntimacyOptIn,
  isBirthdayToday,
  nextBirthdayDate
} from './age-gate'

describe('C age-gate', () => {
  it('parses ISO and DMY', () => {
    expect(parseBirthDate('1990-05-15')?.getFullYear()).toBe(1990)
    expect(parseBirthDate('15/05/1990')?.getDate()).toBe(15)
    expect(parseBirthDate('not-a-date')).toBeNull()
    expect(parseBirthDate('2099-01-01')).toBeNull()
  })

  it('computes age', () => {
    const birth = parseBirthDate('2000-06-15')!
    expect(ageYearsAt(birth, new Date(2026, 5, 14))).toBe(25) // day before birthday
    expect(ageYearsAt(birth, new Date(2026, 5, 15))).toBe(26)
  })

  it('blocks under 18', () => {
    const g = evaluateAgeGate('2015-01-01', { now: new Date(2026, 0, 1) })
    expect(g.isAdult).toBe(false)
    expect(g.allowAdultContent).toBe(false)
  })

  it('allows 18+', () => {
    const g = evaluateAgeGate('2000-01-01', { now: new Date(2026, 0, 1) })
    expect(g.isAdult).toBe(true)
    expect(g.allowAdultContent).toBe(true)
  })

  it('effectiveAdultIntimacyOptIn requires both flag and age', () => {
    expect(
      effectiveAdultIntimacyOptIn({
        adultIntimacyOptIn: true,
        userBirthDate: '2015-01-01',
        now: new Date(2026, 0, 1)
      })
    ).toBe(false)
    expect(
      effectiveAdultIntimacyOptIn({
        adultIntimacyOptIn: true,
        userBirthDate: '2000-01-01',
        now: new Date(2026, 0, 1)
      })
    ).toBe(true)
    expect(
      effectiveAdultIntimacyOptIn({
        adultIntimacyOptIn: false,
        userBirthDate: '2000-01-01'
      })
    ).toBe(false)
  })

  it('birthday today', () => {
    const now = new Date(2026, 9, 16)
    expect(isBirthdayToday('2000-10-16', now)).toBe(true)
    expect(isBirthdayToday('2000-10-15', now)).toBe(false)
    expect(nextBirthdayDate('2000-10-16', now)?.getDate()).toBe(16)
  })
})
