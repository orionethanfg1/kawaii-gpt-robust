
import { balanceSingleAsterisks, preserveMdBreaks, wrapMarkdownSelection } from './normalize-markdown'

export type MdCheck = { id: string; ok: boolean; detail: string }

export function runMarkdownNormalizeChecks(): MdCheck[] {
  const out: MdCheck[] = []
  // Unpaired open * should be stripped, not left raw
  const open = '*Suelto una risita suave al escucharte.'
  const bal = balanceSingleAsterisks(open)
  out.push({
    id: 'md-balance-open-star',
    ok: !bal.startsWith('*') || bal.endsWith('*'),
    detail: bal
  })
  // Gemma noise: mí.* emoji
  const noise = 'detalle de mí.* 💕 ¡Ay, Nahum!*'
  const cleaned = balanceSingleAsterisks(noise)
  out.push({
    id: 'md-strip-emoji-stars',
    ok: !cleaned.includes('.*') && cleaned.includes('mí') && !/Nahum!\*/.test(cleaned),
    detail: cleaned
  })
  const okPair = '*risa suave* y luego texto'
  out.push({
    id: 'md-keep-balanced',
    ok: balanceSingleAsterisks(okPair).includes('*risa suave*'),
    detail: balanceSingleAsterisks(okPair)
  })
  const w = wrapMarkdownSelection('hola mundo', 0, 4, '**')
  out.push({
    id: 'md-wrap-bold',
    ok: w.text === '**hola** mundo',
    detail: w.text
  })
  out.push({
    id: 'md-soft-break',
    ok: preserveMdBreaks('Hola\nNiamh').includes('Hola'),
    detail: 'ok'
  })
  return out
}
