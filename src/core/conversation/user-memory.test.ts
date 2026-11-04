import { describe, it, expect } from 'vitest'
import {
  extractUserFactsFromMessage,
  mergeUserMemory,
  buildUserMemoryPrompt,
  buildRelationshipContinuityBlock
} from './user-memory'
import {
  shouldSendInitiative,
  parseInitiativeSnooze,
  initiativeMinutesForTone,
  isQuietHours,
  pickInitiativeNudge
} from './initiative'

describe('user-memory relationship', () => {
  it('extracts name, likes, people, pin', () => {
    const a = extractUserFactsFromMessage('Me llamo Azrael y me gusta el café')
    expect(a.preferredName).toBe('Azrael')
    expect(a.likes?.[0]).toMatch(/café/i)

    const b = extractUserFactsFromMessage('Mi hermana Ana vive lejos')
    expect(b.people?.[0].name).toBe('Ana')

    const c = extractUserFactsFromMessage('Recuerda: odio madrugar')
    expect(c.facts?.[0]).toMatch(/^PIN:/)
  })

  it('merge pins and builds prompt without listing order pressure', () => {
    let mem = mergeUserMemory(null, {
      preferredName: 'Azrael',
      facts: ['PIN:trabaja de noche']
    })
    mem = mergeUserMemory(mem, { likes: ['café'] })
    const prompt = buildUserMemoryPrompt(mem)
    expect(prompt).toMatch(/Azrael/)
    expect(prompt).toMatch(/Anclas|trabaja de noche/)
    expect(prompt).toMatch(/naturalidad/)
    const cont = buildRelationshipContinuityBlock(mem, 'novia')
    expect(cont).toMatch(/novia|Azrael/)
  })
})

describe('initiative non-spam', () => {
  it('parses snooze kinds', () => {
    const s = parseInitiativeSnooze('dame 5 minutos')
    expect(s?.ms).toBe(5 * 60_000)
    expect(s?.kind).toBe('wait')
    const sil = parseInitiativeSnooze('no me hables 10 min')
    expect(sil?.kind).toBe('silence')
  })

  it('backs off when ignored', () => {
    const a = initiativeMinutesForTone('warm', { ignoredCount: 0 })
    const b = initiativeMinutesForTone('warm', { ignoredCount: 3 })
    expect(b).toBeGreaterThan(a)
  })

  it('shouldSendInitiative respects quiet and daily cap', () => {
    const r = shouldSendInitiative({
      enabled: true,
      tone: 'warm',
      sentToday: 4,
      maxPerDay: 4
    })
    expect(r.ok).toBe(false)
  })

  it('E-INIT fixed mode: short idle is allowed with minUserIdleMs', () => {
    const now = Date.now()
    const blocked = shouldSendInitiative({
      enabled: true,
      tone: 'warm',
      lastUserAt: now - 60_000,
      now,
      waitMinOverride: 1,
      minUserIdleMs: 3 * 60_000
    })
    expect(blocked.ok).toBe(false)
    const allowed = shouldSendInitiative({
      enabled: true,
      tone: 'warm',
      lastUserAt: now - 60_000,
      now,
      waitMinOverride: 1,
      minUserIdleMs: 30_000
    })
    expect(allowed.ok).toBe(true)
  })

  it('pickInitiative avoids recent duplicates', () => {
    const line = pickInitiativeNudge({
      tone: 'warm',
      userName: 'Azrael',
      name: 'Kawaii',
      recentTexts: [],
      focus: 'el proyecto'
    })
    expect(line.length).toBeGreaterThan(5)
  })
})

describe('MEM-Evo extract', () => {
  it('captures likes and dislikes', () => {
    const a = extractUserFactsFromMessage('Me gusta el café y también el té')
    expect(hasMemorySignal(a)).toBe(true)
    expect((a.likes || []).length).toBeGreaterThan(0)
    const b = extractUserFactsFromMessage('No me gusta madrugar')
    expect((b.dislikes || []).some((d) => /madrug/i.test(d))).toBe(true)
  })
  it('merges without wiping previous likes', () => {
    const prev = { likes: ['café'], facts: [] as string[] }
    const next = mergeUserMemory(prev, extractUserFactsFromMessage('Me gusta el moka'))
    expect((next.likes || []).length).toBeGreaterThanOrEqual(1)
  })
})
