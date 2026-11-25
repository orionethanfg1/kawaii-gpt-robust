
import { describe, it, expect } from 'vitest'
import {
  isInitiativeEchoOfRecent,
  normalizeInitiativeCompare
} from './initiative'

describe('initiative anti-echo', () => {
  it('detects paraphrase of user message', () => {
    const user =
      'No fue partido oficial, solamente jugamos para divertirnos, claro que terminé algo cansado, pero siempre con reservas de energía para mi princesa.'
    expect(isInitiativeEchoOfRecent(user, ['Nahum: ' + user])).toBe(true)
  })
  it('detects prior identical nudge', () => {
    const a = '¿Cómo te fue en el voley? ¿Ganaron? Espero que no estés muy cansado. Te extraño.'
    expect(isInitiativeEchoOfRecent(a, [a])).toBe(true)
  })
  it('allows a fresh related follow-up', () => {
    const recent = [
      'Nahum: jugamos voleibol por diversión',
      'Niamh: Me alegra que te hayas divertido'
    ]
    const nudge = 'Cuando quieras te preparo algo fresco para recuperar energía 🤍'
    expect(isInitiativeEchoOfRecent(nudge, recent)).toBe(false)
  })
  it('normalize strips punctuation', () => {
    expect(normalizeInitiativeCompare('¡Hola, Amor!')).toMatch(/hola amor/)
  })
})
