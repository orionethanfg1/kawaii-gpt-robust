/**
 * App-owned lock (no OS biometrics / Windows Hello).
 * PIN → PBKDF2-SHA-256 hash stored locally; session unlock is in-memory only.
 */

const PBKDF2_ITERATIONS = 120_000
const SALT_BYTES = 16
const KEY_BITS = 256

export type AppLockConfig = {
  enabled: boolean
  /** base64 salt */
  saltB64?: string
  /** base64 derived key */
  pinHashB64?: string
  /** Minutes of inactivity before re-lock (1–60) */
  timeoutMinutes?: number
  /** Blur UI when window hidden */
  discreteMode?: boolean
}

/** In-memory session (lost on process exit → must re-enter PIN) */
let sessionUnlocked = false
let lastActivityAt = 0

export function isSessionUnlocked(): boolean {
  return sessionUnlocked
}

export function markSessionUnlocked(): void {
  sessionUnlocked = true
  lastActivityAt = Date.now()
}

export function lockSession(): void {
  sessionUnlocked = false
}

export function touchActivity(): void {
  if (sessionUnlocked) lastActivityAt = Date.now()
}

export function shouldRelockForInactivity(timeoutMinutes: number): boolean {
  if (!sessionUnlocked) return false
  const mins = Math.max(1, Math.min(120, timeoutMinutes || 5))
  return Date.now() - lastActivityAt > mins * 60_000
}

function bufToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!)
  return btoa(s)
}

function b64ToBuf(b64: string): ArrayBuffer {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out.buffer
}

async function deriveKey(pin: string, salt: ArrayBuffer): Promise<ArrayBuffer> {
  const enc = new TextEncoder()
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(pin),
    'PBKDF2',
    false,
    ['deriveBits']
  )
  return crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256'
    },
    baseKey,
    KEY_BITS
  )
}

/** Validate PIN shape: 4–12 digits (local app lock, not bank-grade). */
export function isValidPinFormat(pin: string): boolean {
  return /^\d{4,12}$/.test(String(pin || '').trim())
}

export async function hashPin(pin: string): Promise<{ saltB64: string; pinHashB64: string }> {
  const cleaned = String(pin || '').trim()
  if (!isValidPinFormat(cleaned)) {
    throw new Error('El PIN debe tener entre 4 y 12 dígitos')
  }
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const hash = await deriveKey(cleaned, salt.buffer)
  return { saltB64: bufToB64(salt.buffer), pinHashB64: bufToB64(hash) }
}

export async function verifyPin(
  pin: string,
  saltB64: string,
  pinHashB64: string
): Promise<boolean> {
  try {
    const cleaned = String(pin || '').trim()
    if (!isValidPinFormat(cleaned) || !saltB64 || !pinHashB64) return false
    const hash = await deriveKey(cleaned, b64ToBuf(saltB64))
    const a = new Uint8Array(hash)
    const b = new Uint8Array(b64ToBuf(pinHashB64))
    if (a.length !== b.length) return false
    let diff = 0
    for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!
    return diff === 0
  } catch {
    return false
  }
}

/** Whether the UI must show the lock gate */
export function needsLockGate(cfg: AppLockConfig | null | undefined): boolean {
  if (!cfg?.enabled || !cfg.pinHashB64 || !cfg.saltB64) return false
  if (!sessionUnlocked) return true
  if (shouldRelockForInactivity(cfg.timeoutMinutes ?? 5)) {
    lockSession()
    return true
  }
  return false
}

export async function tryUnlock(
  pin: string,
  cfg: AppLockConfig
): Promise<{ ok: boolean; error?: string }> {
  if (!cfg.saltB64 || !cfg.pinHashB64) {
    return { ok: false, error: 'Candado no configurado' }
  }
  const ok = await verifyPin(pin, cfg.saltB64, cfg.pinHashB64)
  if (!ok) return { ok: false, error: 'PIN incorrecto' }
  markSessionUnlocked()
  return { ok: true }
}

export async function setupLock(
  pin: string,
  confirm: string
): Promise<{ ok: true; saltB64: string; pinHashB64: string } | { ok: false; error: string }> {
  if (pin !== confirm) return { ok: false, error: 'Los PIN no coinciden' }
  try {
    const { saltB64, pinHashB64 } = await hashPin(pin)
    markSessionUnlocked()
    return { ok: true, saltB64, pinHashB64 }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
