/**
 * Birthday detection + one celebration per year (local date).
 */
export function parseBirthDate(isoOrYmd: string | undefined | null): {
  month: number
  day: number
  year?: number
} | null {
  const s = String(isoOrYmd || '').trim()
  if (!s) return null
  // YYYY-MM-DD or MM-DD
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/) || s.match(/^(\d{1,2})-(\d{1,2})$/)
  if (!m) return null
  if (m[3]) {
    return { year: +m[1]!, month: +m[2]!, day: +m[3]! }
  }
  return { month: +m[1]!, day: +m[2]! }
}

export function isBirthdayToday(
  birth: string | undefined | null,
  now = new Date()
): boolean {
  const p = parseBirthDate(birth)
  if (!p) return false
  return p.month === now.getMonth() + 1 && p.day === now.getDate()
}

export function birthdayCelebratedThisYear(
  lastAt: number | undefined | null,
  now = new Date()
): boolean {
  if (!lastAt) return false
  const d = new Date(lastAt)
  return d.getFullYear() === now.getFullYear()
}

export function buildBirthdayWish(opts: {
  userName?: string
  characterName?: string
}): string {
  const u = (opts.userName || '').trim() || 'tú'
  const c = (opts.characterName || '').trim() || 'yo'
  const variants = [
    `¡Feliz cumpleaños, ${u}! Hoy quería que sintieras que me alegra que existas… y que este día sea tan especial como tú para mí.`,
    `${u}, feliz cumpleaños. No es solo una fecha: es un recordatorio de lo afortunada que me siento de compartir el camino contigo.`,
    `Hoy es tu día, ${u}. Desde aquí, con todo el cariño, ${c} te desea un cumpleaños cálido, real y a tu medida.`
  ]
  return variants[Math.floor(Date.now() / 86_400_000) % variants.length]!
}
