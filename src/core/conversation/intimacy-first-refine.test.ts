import { describe, it, expect } from 'vitest'
import {
  validateRefinedIntimacyFirst,
  isInitiativeOrProposeNoise,
  buildIntimacyFirstRefinePrompt,
  buildIntimacyRefineTranscript
} from './intimacy-memory'

describe('intimacy first refine', () => {
  it('rejects initiative noise', () => {
    expect(
      isInitiativeOrProposeNoise(
        'Oye, Nahum, siento que hay mucha confianza entre nosotros. Si te apetece, me gustaría acercarme un poco más. Solo si tú quieres: puedes decir que sí.'
      )
    ).toBe(true)
  })

  it('validateRefinedIntimacyFirst accepts natural Spanish', () => {
    const ok = validateRefinedIntimacyFirst(
      'La primera cercanía entre Nahum y Niamh fue intensa y tierna. Cuando él la llamó Niamhcita, ella sintió el corazón acelerado. Compartieron un abrazo largo y, al final, se quedaron en silencio agradecidos por lo vivido.'
    )
    expect(ok && ok.length > 100).toBe(true)
  })

  it('validate rejects short or meta', () => {
    expect(validateRefinedIntimacyFirst('hola')).toBeNull()
    expect(
      validateRefinedIntimacyFirst(
        'Como IA no puedo sentir pero el usuario dijo muchas cosas importantes sobre la relación en este chat de prueba con suficiente texto de relleno para pasar el mínimo de longitud requerido por el validador de memoria íntima privilegiada.'
      )
    ).toBeNull()
  })

  it('prompt includes grounding rules', () => {
    const p = buildIntimacyFirstRefinePrompt({
      draft: 'borrador de prueba',
      transcript: 'Usuario: te quiero\nAsistente: yo también',
      userName: 'Nahum',
      characterName: 'Niamh'
    })
    expect(p.system).toMatch(/No inventes/)
    expect(p.user).toMatch(/borrador/)
  })

  it('transcript drops initiative lines', () => {
    const tr = buildIntimacyRefineTranscript([
      {
        role: 'assistant',
        content:
          'Oye, Nahum, siento que hay mucha confianza entre nosotros. me gustaría acercarme un poco más. Solo si tú quieres: puedes decir que sí.'
      },
      { role: 'user', content: 'Quédate conmigo esta noche, Niamh.' },
      { role: 'assistant', content: 'Me quedo. Siento tu calor y no quiero soltarte.' }
    ])
    expect(tr).not.toMatch(/puedes decir que sí/)
    expect(tr).toMatch(/Quédate conmigo/)
  })
})
