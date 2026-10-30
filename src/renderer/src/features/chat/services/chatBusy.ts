/**
 * Cross-hook flag: chat generation / doc auto-read in flight.
 * Initiative and other background jobs must not race the main turn.
 */
let busy = false
let busySince = 0
let docReadUntil = 0

/** Max time we trust "busy" without a clearLoading (stuck image/stream). */
const BUSY_STALE_MS = 3 * 60_000

export function setChatBusy(v: boolean): void {
  busy = Boolean(v)
  busySince = v ? Date.now() : 0
}

export function isChatBusy(): boolean {
  if (busy && busySince > 0 && Date.now() - busySince > BUSY_STALE_MS) {
    busy = false
    busySince = 0
  }
  return busy || Date.now() < docReadUntil
}

/** Mark document progressive reading window (suppresses initiative). */
export function markDocReadingActive(ms = 120_000): void {
  docReadUntil = Date.now() + Math.max(5_000, ms)
}

export function clearDocReadingActive(): void {
  docReadUntil = 0
}
