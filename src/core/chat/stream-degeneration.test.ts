import { describe, it, expect } from 'vitest'
import {
  detectCharLoop,
  detectNgramLoop,
  detectPlanLeak,
  detectStreamDegeneration,
  isUnusableAssistantVisible
} from './stream-degeneration'

describe('stream-degeneration R0', () => {
  it('detects slash wall', () => {
    const wall = 'ok\n' + '/'.repeat(80)
    const v = detectCharLoop(wall)
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toBe('char_loop')
  })

  it('detects plan leak from screenshot pattern', () => {
    const leak =
      'Me alegra mucho que me hayas hecho algo especial... Ask what did you do?\n' +
      'Show curiosity and admiration.\n' +
      'Also maybe respond with a little playful teasing about receiving prize, etc.\n' +
      'Ok produce response in Spanish Mexico style: use "ustedes" no; we are singular female\n' +
      'Use "tú".\n' +
      'But instructions say never "vosotros/vais/'
    const v = detectPlanLeak(leak)
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toBe('plan_leak')
    expect(detectStreamDegeneration(leak).ok).toBe(false)
  })

  it('allows normal Spanish reply', () => {
    const ok =
      'Ay, Nahum… me dejas sin palabras. Gracias por el detalle, princesa o no, me siento muy querida. ❤️'
    expect(detectStreamDegeneration(ok).ok).toBe(true)
    expect(isUnusableAssistantVisible(ok, ok).ok).toBe(true)
  })

  it('flags empty after strip of long dump', () => {
    const raw = 'Okay, the user asked something. I need to respond carefully. '.repeat(4)
    const v = isUnusableAssistantVisible(raw, '')
    expect(v.ok).toBe(false)
  })

  it('detects ngram stutter', () => {
    const piece = 'hola mundo otra vez '
    const t = piece.repeat(6)
    const v = detectNgramLoop(t)
    expect(v.ok).toBe(false)
  })
})
