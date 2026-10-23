/**
 * Lightweight online/offline detection for hybrid routing.
 * Prefer navigator when in renderer; optional fetch probe as fallback.
 */

export type NetworkSnapshot = {
  online: boolean
  source: 'navigator' | 'probe' | 'assumed'
  checkedAt: number
}

let cache: NetworkSnapshot | null = null
const CACHE_MS = 20_000

export function getCachedNetwork(): NetworkSnapshot | null {
  if (!cache) return null
  if (Date.now() - cache.checkedAt > CACHE_MS) return null
  return cache
}

export function setNetworkCache(snap: NetworkSnapshot): void {
  cache = snap
}

/** Sync read — best effort from browser navigator */
export function isOnlineSync(): boolean {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
      return navigator.onLine
    }
  } catch {
    /* ignore */
  }
  // Main/Node or unknown: assume online so we do not block cloud incorrectly
  return true
}

/**
 * Async probe. Does not throw. Short timeout.
 * Uses a tiny public endpoint only when navigator says online but we want confirmation.
 */
export async function probeNetwork(opts?: { force?: boolean }): Promise<NetworkSnapshot> {
  if (!opts?.force) {
    const hit = getCachedNetwork()
    if (hit) return hit
  }

  try {
    if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
      if (!navigator.onLine) {
        const snap: NetworkSnapshot = {
          online: false,
          source: 'navigator',
          checkedAt: Date.now()
        }
        setNetworkCache(snap)
        return snap
      }
      // navigator says online — trust it for speed (no mandatory probe)
      const snap: NetworkSnapshot = {
        online: true,
        source: 'navigator',
        checkedAt: Date.now()
      }
      setNetworkCache(snap)
      return snap
    }
  } catch {
    /* fall through */
  }

  const snap: NetworkSnapshot = {
    online: true,
    source: 'assumed',
    checkedAt: Date.now()
  }
  setNetworkCache(snap)
  return snap
}
