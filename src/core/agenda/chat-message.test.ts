import { describe, it, expect } from 'vitest'
import { buildAgendaDueChatMessage } from './chat-message'
import type { AgendaItem } from './types'

const base: AgendaItem = {
  id: '1',
  type: 'reminder',
  title: 'pagar la luz',
  sensitivity: 'normal',
  when: { kind: 'exact', at: Date.now() },
  status: 'due',
  notify: { insist: 'once' },
  createdAt: 0,
  updatedAt: 0
}

describe('agenda chat message', () => {
  it('reminder soft line', () => {
    const t = buildAgendaDueChatMessage(base)
    expect(t).toMatch(/luz/i)
    expect(t.length).toBeGreaterThan(10)
  })
  it('talk sensitive', () => {
    const t = buildAgendaDueChatMessage({
      ...base,
      type: 'talk',
      title: 'lo de ayer',
      sensitivity: 'sensitive'
    }, { userName: 'Nahum' })
    expect(t).toMatch(/Nahum/)
    expect(t).toMatch(/prisa|listo/i)
  })
})
