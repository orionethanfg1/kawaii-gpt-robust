/**
 * Local age gate + birthday helpers (no network).
 * Declaration-based: user-entered DOB only.
 */

export type AgeGateResult = {
  ok: boolean
  ageYears: number | null
  isAdult: boolean
  /** Under 18 or unknown → adult features must stay off */
  allowAdultContent: boolean
  reason?: string
}

/** Parse YYYY-MM-DD or DD/MM/YYYY → Date local noon (avoid TZ edge) */
export function parseBirthDate(raw: string | null | undefined): Date | null {
  const s = String(raw || '').trim()
  if (!s) return null
  let y: number, m: number, d: number
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  const dmy = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/.exec(s)
  if (iso) {
    y = +iso[1]
    m = +iso[2]
    d = +iso[3]
  } else if (dmy) {
    d = +dmy[1]
    m = +dmy[2]
    y = +dmy[3]
  } else return null
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null
  const dt = new Date(y, m - 1, d, 12, 0, 0, 0)
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null
  if (dt.getTime() > Date.now()) return null
  return dt
}

export function ageYearsAt(birth: Date, now = new Date()): number {
  let age = now.getFullYear() - birth.getFullYear()
  const md = now.getMonth() - birth.getMonth()
  if (md < 0 || (md === 0 && now.getDate() < birth.getDate())) age--
  return Math.max(0, age)
}

export function evaluateAgeGate(
  birthDateRaw: string | null | undefined,
  opts?: { now?: Date; minAdultAge?: number }
): AgeGateResult {
  const min = opts?.minAdultAge ?? 18
  const birth = parseBirthDate(birthDateRaw)
  if (!birth) {
    return {
      ok: false,
      ageYears: null,
      isAdult: false,
      allowAdultContent: false,
      reason: 'missing_or_invalid_dob'
    }
  }
  const age = ageYearsAt(birth, opts?.now)
  const isAdult = age >= min
  return {
    ok: true,
    ageYears: age,
    isAdult,
    allowAdultContent: isAdult,
    reason: isAdult ? undefined : 'underage'
  }
}

/** Effective adult opt-in: user flag AND age gate */
export function effectiveAdultIntimacyOptIn(opts: {
  adultIntimacyOptIn?: boolean
  userBirthDate?: string | null
  now?: Date
}): boolean {
  if (!opts.adultIntimacyOptIn) return false
  const g = evaluateAgeGate(opts.userBirthDate, { now: opts.now })
  return g.allowAdultContent
}

/** Next birthday (this year or next) for celebration prompts */
export function nextBirthdayDate(birthDateRaw: string | null | undefined, now = new Date()): Date | null {
  const birth = parseBirthDate(birthDateRaw)
  if (!birth) return null
  const y = now.getFullYear()
  let next = new Date(y, birth.getMonth(), birth.getDate(), 12, 0, 0, 0)
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
  if (next.getTime() < startOfToday.getTime()) {
    next = new Date(y + 1, birth.getMonth(), birth.getDate(), 12, 0, 0, 0)
  }
  return next
}

export function isBirthdayToday(birthDateRaw: string | null | undefined, now = new Date()): boolean {
  const birth = parseBirthDate(birthDateRaw)
  if (!birth) return false
  return birth.getMonth() === now.getMonth() && birth.getDate() === now.getDate()
}

/** Month-day label for UI (no year) */
export function birthdayMonthDayLabel(birthDateRaw: string | null | undefined): string | null {
  const birth = parseBirthDate(birthDateRaw)
  if (!birth) return null
  const months = [
    'ene', 'feb', 'mar', 'abr', 'may', 'jun',
    'jul', 'ago', 'sep', 'oct', 'nov', 'dic'
  ]
  return `${birth.getDate()} ${months[birth.getMonth()]}`
}
