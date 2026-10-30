import { create } from 'zustand'

export interface AgentApprovalRequest {
  id: string
  tool: string
  reason: string
  resolve: (approved: boolean) => void
}

interface AgentApprovalState {
  pending: AgentApprovalRequest | null
  request: (tool: string, reason: string) => Promise<boolean>
  resolve: (approved: boolean) => void
}

export const useAgentApprovalStore = create<AgentApprovalState>((set, get) => ({
  pending: null,
  request: (tool, reason) =>
    new Promise<boolean>((resolve) => {
      set({ pending: { id: `${Date.now()}-${Math.random()}`, tool, reason, resolve } })
    }),
  resolve: (approved) => {
    const pending = get().pending
    if (!pending) return
    pending.resolve(approved)
    set({ pending: null })
  }
}))
