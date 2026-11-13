export type MemorySnapshotInput = {
  createdAt?: number
  appVersion: string
  sources: Record<string, unknown>
}

export type MemorySnapshot = {
  schemaVersion: 1
  createdAt: number
  appVersion: string
  sources: Record<string, unknown>
  sha256?: string
}

export async function createMemorySnapshot(input: MemorySnapshotInput): Promise<MemorySnapshot> {
  const snapshot: MemorySnapshot = {
    schemaVersion: 1,
    createdAt: input.createdAt ?? Date.now(),
    appVersion: input.appVersion,
    sources: input.sources
  }
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const bytes = new TextEncoder().encode(JSON.stringify(snapshot))
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    snapshot.sha256 = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, '0')
    ).join('')
  }
  return snapshot
}
