/**
 * Cross-hook flag: chat generation / doc auto-read in flight.
 * Initiative and other background jobs must not race the main turn.
 */
let busy = false
let docReadUntil = 0

export function setChatBusy(v: boolean): void {
  busy = Boolean(v)
}

export function isChatBusy(): boolean {
  return busy || Date.now() < docReadUntil
}

/** Mark document progressive reading window (suppresses initiative). */
export function markDocReadingActive(ms = 120_000): void {
  docReadUntil = Date.now() + Math.max(5_000, ms)
}

export function clearDocReadingActive(): void {
  docReadUntil = 0
}
