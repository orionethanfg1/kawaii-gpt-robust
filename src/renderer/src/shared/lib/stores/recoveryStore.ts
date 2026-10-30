/**
 * Recovery mode: if the app closed mid-chat / mid-download, restore work.
 * Lightweight checkpoint every few seconds while "busy".
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface RecoveryCheckpoint {
  updatedAt: number
  /** True if last session looked interrupted */
  dirty: boolean
  activeConversationId?: string
  draftText?: string
  /** Message id being streamed (incomplete) */
  pendingAssistantId?: string
  pendingUserPreview?: string
  ollamaPullModel?: string
  ollamaPullProgress?: number
  lastErrorCode?: string
  lastErrorMessage?: string
  lastRemedy?: string
}

interface RecoveryState {
  checkpoint: RecoveryCheckpoint
  /** User dismissed recovery banner this session */
  dismissed: boolean
  touch: (patch: Partial<RecoveryCheckpoint>) => void
  markDirty: () => void
  markClean: () => void
  dismiss: () => void
  clear: () => void
}

const empty: RecoveryCheckpoint = {
  updatedAt: 0,
  dirty: false
}

export const useRecoveryStore = create<RecoveryState>()(
  persist(
    (set, get) => ({
      checkpoint: empty,
      dismissed: false,
      touch: (patch) =>
        set({
          checkpoint: {
            ...get().checkpoint,
            ...patch,
            updatedAt: Date.now()
          }
        }),
      markDirty: () =>
        set({
          checkpoint: { ...get().checkpoint, dirty: true, updatedAt: Date.now() }
        }),
      markClean: () =>
        set({
          checkpoint: {
            ...get().checkpoint,
            dirty: false,
            pendingAssistantId: undefined,
            pendingUserPreview: undefined,
            ollamaPullModel: undefined,
            ollamaPullProgress: undefined,
            lastErrorCode: undefined,
            lastErrorMessage: undefined,
            lastRemedy: undefined,
            updatedAt: Date.now()
          },
          dismissed: true
        }),
      dismiss: () => set({ dismissed: true }),
      clear: () => set({ checkpoint: empty, dismissed: false })
    }),
    {
      name: 'kawaii-recovery-v1',
      partialize: (s) => ({ checkpoint: s.checkpoint })
    }
  )
)

/**
 * Only offer banner for real mid-stream interruptions (pending draft/stream),
 * not for every past error. Max 2h. Chat agent still sees recovery via status.
 */
export function shouldOfferRecovery(maxAgeMs = 30 * 60 * 1000): boolean {
  const { checkpoint, dismissed } = useRecoveryStore.getState()
  if (dismissed || !checkpoint.dirty) return false
  if (!checkpoint.updatedAt) return false
  if (Date.now() - checkpoint.updatedAt >= maxAgeMs) return false
  // Only mid-stream / pull real — NOT solo pendingUserPreview (el usuario suele seguir chateando)
  const softError =
    /reintentar|timeout|en un momento|cancel/i.test(
      String(checkpoint.lastErrorMessage || '') + ' ' + String(checkpoint.lastRemedy || '')
    )
  if (softError && !checkpoint.pendingAssistantId && !checkpoint.ollamaPullModel) {
    return false
  }
  const actionable = Boolean(
    checkpoint.pendingAssistantId || checkpoint.ollamaPullModel
  )
  return actionable
}

/** Compact fact for agent / status (no UI banner). */
export function recoveryContextForAgent(): string | null {
  const { checkpoint } = useRecoveryStore.getState()
  if (!checkpoint.dirty && !checkpoint.lastErrorCode) return null
  const parts: string[] = []
  if (checkpoint.pendingUserPreview) {
    parts.push(`último mensaje pendiente: «${checkpoint.pendingUserPreview.slice(0, 80)}»`)
  }
  if (checkpoint.lastErrorCode) {
    parts.push(`último error: ${checkpoint.lastErrorCode}`)
  }
  if (checkpoint.lastRemedy && !/prefer_cloud|Preferir cloud/i.test(String(checkpoint.lastRemedy))) {
    parts.push(`nota: ${String(checkpoint.lastRemedy).slice(0, 100)}`)
  }
  if (!parts.length) return null
  return 'Recuperación (silenciosa): ' + parts.join(' · ')
}
