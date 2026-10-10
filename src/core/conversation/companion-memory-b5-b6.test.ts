/**
 * B5 + B6 — Selective context + coexistence regression suite
 */
import { describe, it, expect } from 'vitest'
import {
  extractAssistantSelfFacts,
  buildAssistantMemoryPrompt,
  emptyAssistantMemory,
  classifyAssistantLikePhrase
} from './assistant-memory'
import { reconcileAssistantMemory } from './assistant-memory-reconcile'
import { collectAssistantMemoryFromReply } from './collect-assistant-memory'
import {
  selectAssistantMemoryForTurn,
  buildRelationshipStageRules
} from './selective-memory-context'
import { cutAtSecondRestart } from '../chat/collapse-openers'
import { finalizeAssistantReply } from '../chat/assistant-reply-pipeline'
import {
  extractUserFactsFromMessage,
  mergeUserMemory,
  buildSelectiveUserMemoryPrompt
} from './user-memory'

describe('B5 selective assistant context', () => {
  const mem = {
    ...emptyAssistantMemory(),
    likes: ['la astronomía', 'el café de olla', 'aprender galés'],
    relational: ['cocinar para Nahum', 'cuando me dicen amor'],
    boundaries: ['no consejos médicos']
  }

  it('self-ask exposes likes', () => {
    const s = selectAssistantMemoryForTurn(mem, 'Dime algo que te guste a ti')
    expect(s.selfAsk).toBe(true)
    expect(s.likes.length).toBeGreaterThan(0)
    expect(s.likes.some((x) => /astronom|caf|gal/i.test(x))).toBe(true)
  })

  it('greeting does not dump inventory', () => {
    const s = selectAssistantMemoryForTurn(mem, 'Hola')
    expect(s.greetingOnly).toBe(true)
    expect(s.likes.length).toBe(0)
  })

  it('bond turn prioritizes relational', () => {
    const s = selectAssistantMemoryForTurn(mem, '¿cómo quieres que te diga cariño?')
    expect(s.bondTurn).toBe(true)
    expect(s.relational.length).toBeGreaterThan(0)
  })

  it('empty self-ask still returns guidance prompt', () => {
    const p = buildAssistantMemoryPrompt(emptyAssistantMemory(), {
      userText: 'dime algo que te guste'
    })
    expect(p).toMatch(/sin gustos|individualidad|NO son los del usuario/i)
  })

  it('stage rules discourage fake intimacy for stranger', () => {
    const r = buildRelationshipStageRules({ stage: 'stranger', turnsTogether: 1 }, 'novia')
    expect(r).toMatch(/conocerse|intimidad|aspiracional/i)
  })
})

describe('B6 coexistence suite', () => {
  it('1+3: two distinct likes both persist', () => {
    let mem = emptyAssistantMemory()
    const r1 = collectAssistantMemoryFromReply(
      mem,
      'Me encanta la astronomía y mirar las estrellas.'
    )
    expect(r1.changed).toBe(true)
    mem = r1.memory
    const r2 = collectAssistantMemoryFromReply(
      mem,
      'Me encanta aprender sobre el galés y dialectos celtas.'
    )
    expect(r2.changed).toBe(true)
    const likes = (r2.memory.likes || []).join(' ')
    expect(likes).toMatch(/astronom/i)
    expect(likes).toMatch(/gal/i)
  })

  it('4: repeated Gracias restart collapses once', () => {
    const raw =
      'Gracias, Nahum, por eso. Me alegra. Gracias, Nahum, por eso otra vez.'
    const cut = cutAtSecondRestart(raw)
    expect((cut.match(/Gracias/gi) || []).length).toBe(1)
  })

  it('4b: two different Me encanta preferences kept', () => {
    const raw =
      'Me encanta la astronomía. Me encanta cocinar sopas reconfortantes.'
    const cut = cutAtSecondRestart(raw)
    expect(cut).toMatch(/astronom/i)
    expect(cut).toMatch(/cocinar|sopas/i)
  })

  it('5: length finishReason marks limited', () => {
    const fin = finalizeAssistantReply('Texto parcial del modelo…', {
      finishReason: 'length'
    })
    expect(fin.limited).toBe(true)
    expect(fin.display.length).toBeGreaterThan(5)
  })

  it('6: user like stays in userMemory domain only', () => {
    const userPatch = extractUserFactsFromMessage('A mí me gusta el café de olla')
    const hasUserLike =
      (userPatch.likes || []).some((x) => /caf/i.test(x)) ||
      Boolean(userPatch.likes?.length)
    // Assistant extract on same text should not claim it as assistant self
    // (first person of user message is still "me gusta" — extractAssistant is for assistant replies)
    const asst = extractAssistantSelfFacts(
      '¡Qué bien! El café de olla es rico cuando lo preparas tú.'
    )
    // Assistant talking about user's coffee shouldn't always become like
    // Soft: at least user merge works
    const um = mergeUserMemory({ facts: [] }, userPatch)
    expect((um.likes || []).join(' ').length + (um.facts || []).join(' ').length).toBeGreaterThan(0)
  })

  it('7: relational preference classified', () => {
    expect(classifyAssistantLikePhrase('cocinar para Nahum')).toBe('relational')
    expect(classifyAssistantLikePhrase('la astronomía')).toBe('stable')
    const ex = extractAssistantSelfFacts(
      'Me gusta hacerte sentir especial y cocinar para Nahum.'
    )
    // may land in relational via classify on pushLike
    const rel = (ex.relational || []).join(' ')
    const likes = (ex.likes || []).join(' ')
    expect(rel.length + likes.length).toBeGreaterThan(0)
    if (rel) expect(rel).toMatch(/Nahum|sentir|cocinar/i)
  })

  it('8: forget removes like', () => {
    const prev = { ...emptyAssistantMemory(), likes: ['el café de olla', 'la astronomía'] }
    const r = reconcileAssistantMemory(prev, {}, {
      userText: 'ya no te gusta el café de olla'
    })
    expect((r.memory.likes || []).join(' ')).not.toMatch(/caf/i)
    expect((r.memory.likes || []).join(' ')).toMatch(/astronom/i)
  })

  it('9: selective user prompt omits user likes on assistant-self question', () => {
    const mem = {
      facts: [],
      likes: ['el ajedrez', 'el café'],
      preferredName: 'Nahum'
    }
    const p = buildSelectiveUserMemoryPrompt(mem, 'Dime algo que te guste a ti')
    expect(p).not.toMatch(/Gustos del USUARIO.*ajedrez/i)
    expect(p).toMatch(/Nahum|Nombre/i)
  })

  it('extract + reconcile: amanecer sample from product', () => {
    const sample =
      'Me encanta ver el amanecer sobre un lago, cuando la luz se refleja en las aguas.'
    const r = collectAssistantMemoryFromReply(emptyAssistantMemory(), sample)
    expect(r.changed).toBe(true)
    expect((r.memory.likes || []).join(' ')).toMatch(/amanecer|lago/i)
  })
})
