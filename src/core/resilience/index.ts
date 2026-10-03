type CircuitState = { failures: number; openUntil: number; lastError?: string }

class CircuitBreaker {
  private map = new Map<string, CircuitState>()
  private threshold = 3
  private cooldownMs = 30_000

  canRequest(id: string): boolean {
    const s = this.map.get(id)
    if (!s) return true
    if (s.openUntil && Date.now() < s.openUntil) return false
    return true
  }

  recordSuccess(id: string): void {
    this.map.delete(id)
  }

  recordFailure(id: string, message?: string): void {
    const s = this.map.get(id) || { failures: 0, openUntil: 0 }
    s.failures += 1
    s.lastError = message
    if (s.failures >= this.threshold) {
      s.openUntil = Date.now() + this.cooldownMs
    }
    this.map.set(id, s)
  }

  reset(id?: string): void {
    if (id) this.map.delete(id)
    else this.map.clear()
  }
}

export const globalCircuitBreaker = new CircuitBreaker()

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts?: { retries?: number; delayMs?: number }
): Promise<T> {
  const retries = opts?.retries ?? 2
  const delayMs = opts?.delayMs ?? 400
  let last: unknown
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn()
    } catch (e) {
      last = e
      if (i < retries) await new Promise((r) => setTimeout(r, delayMs * (i + 1)))
    }
  }
  throw last
}
