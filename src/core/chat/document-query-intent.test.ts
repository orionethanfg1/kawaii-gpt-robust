import { describe, it, expect } from 'vitest'
import {
  wantsDocumentOrStoryQuery,
  wantsDocumentStoryEntityQuery,
  isPlausibleDocProperName
} from './document-query-intent'
import { mapSliceToFacts } from './document-reading-state'
import { buildDecisionPacket } from '../agent/decision-packet'

describe('D0 document query intent', () => {
  it('detects character questions without saying libro', () => {
    expect(wantsDocumentStoryEntityQuery('nombra los personajes')).toBe(true)
    expect(wantsDocumentOrStoryQuery('A ver nombra los personajes')).toBe(true)
    expect(wantsDocumentOrStoryQuery('¿quién es el protagonista?')).toBe(true)
    expect(wantsDocumentOrStoryQuery('hola mi amor')).toBe(false)
  })

  it('decision packet injects docs when reading state exists + character query', () => {
    const p = buildDecisionPacket({
      userText: 'nombra los personajes',
      hasOpenDocReading: false,
      hasDocReadingState: true
    })
    expect(p.task).toBe('docs')
    expect(p.inject.docs).toBe(true)
  })

  it('mapSliceToFacts drops Pues and keeps proper names', () => {
    const body =
      'Pues la noche cayó sobre el valle. Iris miró a Nahum con temor. «No temas», dijo Iris.'
    const mapped = mapSliceToFacts(body, ['Capítulo 3'])
    expect(mapped).toMatch(/Iris|Nahum/)
    expect(mapped.toLowerCase()).not.toMatch(/nombres:.*\bpues\b/)
  })

  it('isPlausibleDocProperName filters Spanish starters', () => {
    expect(isPlausibleDocProperName('Pues')).toBe(false)
    expect(isPlausibleDocProperName('Cuando')).toBe(false)
    expect(isPlausibleDocProperName('Iris')).toBe(true)
    expect(isPlausibleDocProperName('Nahum Vale')).toBe(true)
  })
})
