import { describe, it, expect } from 'vitest'
import {
  extractIntimacyFirstNarrative,
  applyIntimacyExtraction,
  advanceIntimateScenePhase,
  protectIntimacyFactsOnTrim,
  buildIntimacyMemoryPromptRules,
  resolveLiveIntimatePhase
} from './intimacy-memory'

describe('intimacy-memory I1–I4', () => {
  it('extracts a wide first narrative from intimate messages', () => {
    const n = extractIntimacyFirstNarrative({
      userName: 'Nahum',
      characterName: 'Niamh',
      messages: [
        { role: 'user', content: 'Quiero estar contigo, es nuestra primera vez, despacio' },
        {
          role: 'assistant',
          content: 'Tengo nervios y cariño, mi cuerpo tiembla mientras te abrazo más fuerte'
        },
        { role: 'user', content: 'Más fuerte, te deseo' }
      ]
    })
    expect(n.length).toBeGreaterThan(40)
    expect(n).toMatch(/Primera cercanía|primera vez|Nahum|Niamh/i)
  })

  it('advances to scene_active on explicit signals', () => {
    const r = advanceIntimateScenePhase({
      phase: 'open',
      intimacyOpen: true,
      recentTexts: [
        'te deseo',
        'más fuerte, mi cuerpo contra el tuyo',
        'no pares'
      ]
    })
    expect(r.phase).toBe('scene_active')
  })

  it('writes INTIMACY_FIRST once and protects on trim', () => {
    const applied = applyIntimacyExtraction({
      facts: ['otro hecho'],
      relationship: { intimacyOpen: true, stage: 'intimate_adult' },
      forceFirst: true,
      messages: [
        { role: 'user', content: 'Es nuestra primera vez juntos, con cuidado' },
        { role: 'assistant', content: 'Me siento nerviosa y feliz, te abrazo más fuerte' },
        { role: 'user', content: 'Te deseo, no pares' },
        { role: 'assistant', content: 'Mi cuerpo responde a tu ritmo' },
        { role: 'user', content: 'Más cerca' },
        { role: 'assistant', content: 'Estoy contigo sin prisas' },
        { role: 'user', content: 'Así' },
        { role: 'assistant', content: 'Qué intenso y tierno a la vez' }
      ],
      userName: 'Nahum',
      characterName: 'Niamh'
    })
    expect(applied.wroteFirst).toBe(true)
    expect(applied.facts.some((f) => f.startsWith('INTIMACY_FIRST:'))).toBe(true)
    const trimmed = protectIntimacyFactsOnTrim(
      [...applied.facts, 'a', 'b', 'c', 'd', 'e'],
      3
    )
    expect(trimmed.some((f) => f.startsWith('INTIMACY_FIRST:'))).toBe(true)
  })

  it('prompt rules include first memory when present', () => {
    const block = buildIntimacyMemoryPromptRules({
      adultOptIn: true,
      relationship: { intimacyOpen: true, scenePhase: 'aftercare' },
      facts: ['INTIMACY_FIRST: Primera cercanía con cuidado y nervios mutuos.']
    })
    expect(block).toMatch(/MEMORIA PRIVILEGIADA|pausa afectiva/i)
  })
})


describe('S2/S3 scene exit', () => {
  it('detects soft rest as intimate close', async () => {
    const { looksLikeIntimateClose, detectIntimateSceneExit, resolveLiveIntimatePhase } =
      await import('./intimacy-memory')
    const line =
      'Estoy perfectamente, mi amor. Realmente estas escenas han sido increíbles. Pero, por ahora, quisiera descansar un poco.'
    expect(looksLikeIntimateClose(line)).toBe(true)
    const d = detectIntimateSceneExit({ userText: line })
    expect(d.exit).toBe(true)
    const phase = resolveLiveIntimatePhase({
      relationship: { intimacyOpen: true, scenePhase: 'scene_active', lastIntimateSceneAt: Date.now() },
      facts: ['INTIMACY_PHASE: scene_active'],
      recentTexts: [
        'te deseo más fuerte dentro de mí sin ropa',
        'mi cuerpo tu cuerpo gemidos',
        line
      ]
    })
    expect(phase).toBe('aftercare')
  })
})

describe('S1 invite + phase', () => {
  it('looksLikeIntimateInvite detects soft invite', async () => {
    const { looksLikeIntimateInvite, advanceIntimateScenePhase } = await import('./intimacy-memory')
    expect(looksLikeIntimateInvite('quiero estar más cerca de ti')).toBe(true)
    expect(looksLikeIntimateInvite('hablamos del clima')).toBe(false)
    const adv = advanceIntimateScenePhase({
      phase: 'idle',
      intimacyOpen: true,
      recentTexts: [],
      userText: 'quiero estar contigo ahora'
    })
    expect(adv.reason).toBe('s1_invite')
    expect(adv.phase).toBe('open')
  })
})


describe('current-turn phase', () => {
  it('returns to open when the current user turn changes to casual conversation', () => {
    const phase = resolveLiveIntimatePhase({
      relationship: {
        stage: 'intimate',
        intimacyOpen: true,
        scenePhase: 'scene_active',
        lastIntimateSceneAt: Date.now() - 60_000
      } as never,
      facts: [],
      recentTexts: ['te deseo más fuerte dentro de mí', 'Hola, ¿cómo estás?'],
      userText: 'Hola, ¿cómo estás?'
    })
    expect(phase).toBe('open')
  })

  it('does not let older scene signals override the latest casual turn', async () => {
    const { resolveLiveIntimatePhase } = await import('./intimacy-memory')
    const phase = resolveLiveIntimatePhase({
      relationship: { intimacyOpen: true, scenePhase: 'open' } as never,
      recentTexts: ['te deseo más fuerte dentro de mí', '¿Cómo va tu proyecto?'],
      userText: '¿Cómo va tu proyecto?'
    })
    expect(phase).toBe('open')
  })
})
