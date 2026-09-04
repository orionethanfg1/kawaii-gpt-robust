/**
 * Provider-scoped circuit breaker with exponential backoff + jitter.
 * States: closed → open → half-open → closed
 */

export type CircuitState = 'closed' | 'open' | 'half-open'

export interface CircuitBreakerOptions {
  /** Failures before opening */
  failureThreshold?: number
  /** Base cooldown in ms when open */
  baseCooldownMs?: number
  /** Max cooldown cap */
  maxCooldownMs?: number
  /** Successes in half-open needed to close */
  successThreshold?: number
}

interface CircuitEntry {
  state: CircuitState
  failures: number
  successes: number
  openedAt: number
  cooldownMs: number
  lastError?: string
}

export class CircuitBreaker {
  private circuits = new Map<string, CircuitEntry>()
  private failureThreshold: number
  private baseCooldownMs: number
  private maxCooldownMs: number
  private successThreshold: number

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 3
    this.baseCooldownMs = options.baseCooldownMs ?? 5_000
    this.maxCooldownMs = options.maxCooldownMs ?? 60_000
    this.successThreshold = options.successThreshold ?? 1
  }

  private getOrCreate(key: string): CircuitEntry {
    let entry = this.circuits.get(key)
    if (!entry) {
      entry = {
        state: 'closed',
        failures: 0,
        successes: 0,
        openedAt: 0,
        cooldownMs: this.baseCooldownMs
      }
      this.circuits.set(key, entry)
    }
    return entry
  }

  /** Returns true if the call is allowed right now */
  canRequest(key: string, now = Date.now()): boolean {
    const entry = this.getOrCreate(key)

    if (entry.state === 'closed') return true

    if (entry.state === 'open') {
      if (now - entry.openedAt >= entry.cooldownMs) {
        entry.state = 'half-open'
        entry.successes = 0
        return true
      }
      return false
    }

    // half-open: allow a single probe
    return entry.successes === 0
  }

  recordSuccess(key: string): void {
    const entry = this.getOrCreate(key)

    if (entry.state === 'half-open') {
      entry.successes += 1
      if (entry.successes >= this.successThreshold) {
        entry.state = 'closed'
        entry.failures = 0
        entry.cooldownMs = this.baseCooldownMs
        entry.lastError = undefined
      }
      return
    }

    // closed: reset failure streak
    entry.failures = 0
  }

  recordFailure(key: string, errorMessage?: string, now = Date.now()): void {
    const entry = this.getOrCreate(key)
    entry.lastError = errorMessage
    entry.failures += 1

    if (entry.state === 'half-open') {
      // probe failed → back to open with increased cooldown
      entry.state = 'open'
      entry.openedAt = now
      entry.cooldownMs = Math.min(entry.cooldownMs * 2, this.maxCooldownMs)
      entry.successes = 0
      return
    }

    if (entry.failures >= this.failureThreshold) {
      entry.state = 'open'
      entry.openedAt = now
      // jitter ±20%
      const jitter = 0.8 + Math.random() * 0.4
      entry.cooldownMs = Math.min(
        Math.round(entry.cooldownMs * jitter),
        this.maxCooldownMs
      )
    }
  }

  getState(key: string): CircuitState {
    return this.getOrCreate(key).state
  }

  getInfo(key: string) {
    const entry = this.getOrCreate(key)
    return { ...entry }
  }

  reset(key?: string): void {
    if (key) {
      this.circuits.delete(key)
    } else {
      this.circuits.clear()
    }
  }
}

/** Singleton shared across the app */
export const globalCircuitBreaker = new CircuitBreaker()
