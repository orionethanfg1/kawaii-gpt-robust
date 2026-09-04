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
            updatedAt: Date.now()
          },
          dismissed: false
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

/** Call on boot: if dirty and recent, show recovery UI */
export function shouldOfferRecovery(maxAgeMs = 24 * 60 * 60 * 1000): boolean {
  const { checkpoint, dismissed } = useRecoveryStore.getState()
  if (dismissed || !checkpoint.dirty) return false
  if (!checkpoint.updatedAt) return false
  return Date.now() - checkpoint.updatedAt < maxAgeMs
}
