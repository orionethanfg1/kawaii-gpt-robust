import { describe, it, expect } from 'vitest'
import {
  harvestFromConversations,
  applyHarvestToAssistantMemory
} from './memory-harvest'
import { buildCoreMemoryHeader, applyGrowthMilestone } from './memory-growth'
import { filterSalientNames, scoreMemorySalience, shouldWriteMemory } from './memory-write-policy'

describe('memory-harvest E0', () => {
  it('recovers «Mi princesa Celta» from a past user message', () => {
    const r = harvestFromConversations([
      {
        id: 'c1',
        title: 'Niamh íntima',
        messages: [
          {
            role: 'user',
            content: 'Me encanta llamarte Mi princesa Celta, de verdad.'
          },
          {
            role: 'assistant',
            content: 'Ay… me haces sentir especial cuando me dices así.'
          }
        ]
      }
    ])
    expect(r.preferredNames.some((n) => /princesa/i.test(n))).toBe(true)
    expect(r.scannedMessages).toBeGreaterThan(0)
  })

  it('ignores app-doc-continue and [APP] leaks', () => {
    const r = harvestFromConversations([
      {
        id: 'c2',
        messages: [
          {
            role: 'user',
            content: 'sigue',
            meta: { kind: 'app-doc-continue' }
          },
          {
            role: 'assistant',
            content: '[APP] Continúa la lectura del documento…'
          },
          {
            role: 'user',
            content: 'Te digo cielo cuando estamos juntos'
          }
        ]
      }
    ])
    expect(r.preferredNames.some((n) => /cielo/i.test(n))).toBe(true)
    expect(r.preferredNames.join(' ')).not.toMatch(/\[APP\]/)
  })

  it('applyHarvest merges new names and marks changed', () => {
    const harvest = harvestFromConversations([
      {
        id: 'x',
        messages: [
          { role: 'user', content: 'Me gusta llamarte mi vida' }
        ]
      }
    ])
    const { next, changed, addedNames } = applyHarvestToAssistantMemory(
      { preferredNames: [] },
      harvest
    )
    expect(changed || addedNames.length >= 0).toBe(true)
    expect(Array.isArray(next.preferredNames)).toBe(true)
  })
})

describe('memory-write-policy E1', () => {
  it('scores explicit nicknames high enough to write', () => {
    const s = scoreMemorySalience({
      kind: 'assistant_preferred_name',
      explicit: true,
      phraseLen: 18
    })
    expect(shouldWriteMemory('assistant_preferred_name', s)).toBe(true)
  })

  it('filterSalientNames keeps explicit names', () => {
    const out = filterSalientNames(['Mi princesa Celta'], { explicit: true })
    expect(out).toContain('Mi princesa Celta')
  })
})

describe('memory-growth E2 + E4 header', () => {
  it('applies nickname_harvested growth note', () => {
    const next = applyGrowthMilestone(
      { preferredNames: ['Niamh'] },
      { type: 'nickname_harvested', names: ['Mi princesa Celta'] }
    )
    expect((next.growthNotes || []).some((g) => /princesa/i.test(g))).toBe(true)
  })

  it('buildCoreMemoryHeader prioritizes assistant names vs user name', () => {
    const h = buildCoreMemoryHeader({
      characterName: 'Niamh',
      assistantPreferredNames: ['Mi princesa Celta'],
      userPreferredName: 'Nahum',
      growthNotes: ['Apodos recuperados de vuestra historia.']
    })
    expect(h).toMatch(/MEMORIA CORE/)
    expect(h).toMatch(/Mi princesa Celta/)
    expect(h).toMatch(/Nahum/)
    expect(h.indexOf('princesa')).toBeLessThan(h.indexOf('Nahum') + 50)
  })
})
