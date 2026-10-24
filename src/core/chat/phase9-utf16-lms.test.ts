
import { sanitizeLoneSurrogates, sanitizeEmojiField } from './sanitize-utf16'

export type Phase9Check = { id: string; ok: boolean; detail: string }

export function runPhase9PureChecks(): Phase9Check[] {
  const out: Phase9Check[] = []
  const broken = 'Emoji asociado: \uD83D' // will be actual chars below
  const lone = 'Hola ' + String.fromCharCode(0xd83d) + ' mundo'
  const fixed = sanitizeLoneSurrogates(lone)
  out.push({
    id: 'phase9-strip-lone-surrogate',
    ok: !fixed.includes(String.fromCharCode(0xd83d)) && fixed.includes('Hola') && fixed.includes('mundo'),
    detail: JSON.stringify(fixed)
  })
  const pair = 'hi ' + String.fromCharCode(0xd83d, 0xde0a) // 😊
  out.push({
    id: 'phase9-keep-valid-emoji',
    ok: sanitizeLoneSurrogates(pair).includes(String.fromCharCode(0xd83d, 0xde0a)),
    detail: 'kept pair'
  })
  out.push({
    id: 'phase9-emoji-field',
    ok: sanitizeEmojiField(String.fromCharCode(0xd83d)) === '',
    detail: 'lone rejected'
  })
  return out
}
