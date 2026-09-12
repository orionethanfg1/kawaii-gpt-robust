/**
 * Unified store: in-app activity toasts + mini-game modes (adventure/chess).
 * Do NOT replace toast helpers — many modules import activityInfo/Success/Error/Progress.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  createAdventure,
  createChess,
  type AdventureState,
  type ChessState,
  adventureSystemBlock,
  chessSystemBlock,
  applyAdventurePlayerMove
} from '@core/activities'

export type ActivityKind = 'info' | 'progress' | 'success' | 'error'

export type ActivityItem = {
  id: string
  kind: ActivityKind
  title: string
  detail?: string
  progress?: number
  sticky?: boolean
  ttlMs?: number
  createdAt: number
}

type GameMode = 'none' | 'adventure' | 'chess'

type ActivityState = {
  items: ActivityItem[]
  push: (item: Omit<ActivityItem, 'id' | 'createdAt'> & { id?: string }) => string
  update: (id: string, patch: Partial<ActivityItem>) => void
  dismiss: (id: string) => void
  clear: () => void

  mode: GameMode
  adventure: AdventureState | null
  chess: ChessState | null
  startAdventure: (title?: string) => void
  startChess: () => void
  stop: () => void
  noteAdventureMove: (text: string) => void
  extraSystemBlock: (companionName?: string) => string | null
}

let seq = 0
function nextId(): string {
  seq += 1
  return `act_${Date.now()}_${seq}`
}

export const useActivityStore = create<ActivityState>()(
  persist(
    (set, get) => ({
      items: [],
      push: (item) => {
        const id = item.id || nextId()
        const full: ActivityItem = {
          id,
          kind: item.kind,
          title: item.title,
          detail: item.detail,
          progress: item.progress,
          sticky: item.sticky,
          ttlMs: item.ttlMs,
          createdAt: Date.now()
        }
        set((s) => ({ items: [...s.items.slice(-19), full] }))
        const ttl = item.sticky ? undefined : item.ttlMs ?? (item.kind === 'progress' ? undefined : 5000)
        if (ttl && typeof window !== 'undefined') {
          window.setTimeout(() => {
            get().dismiss(id)
          }, ttl)
        }
        return id
      },
      update: (id, patch) => {
        set((s) => ({
          items: s.items.map((it) => (it.id === id ? { ...it, ...patch } : it))
        }))
      },
      dismiss: (id) => {
        set((s) => ({ items: s.items.filter((it) => it.id !== id) }))
      },
      clear: () => set({ items: [] }),

      mode: 'none',
      adventure: null,
      chess: null,
      startAdventure: (title) =>
        set({ mode: 'adventure', adventure: createAdventure(title), chess: null }),
      startChess: () => set({ mode: 'chess', chess: createChess(), adventure: null }),
      stop: () => set({ mode: 'none', adventure: null, chess: null }),
      noteAdventureMove: (text) => {
        const a = get().adventure
        if (!a?.active) return
        set({ adventure: applyAdventurePlayerMove(a, text) })
      },
      extraSystemBlock: (companionName?: string) => {
        const { mode, adventure, chess } = get()
        const name = companionName || 'tu compañera'
        if (mode === 'adventure' && adventure?.active) return adventureSystemBlock(adventure, name)
        if (mode === 'chess' && chess?.active) return chessSystemBlock(chess, name)
        return null
      }
    }),
    {
      name: 'kawaii-gpt-activities-v1',
      // Only persist game mode, not transient toasts
      partialize: (s) =>
        ({
          mode: s.mode,
          adventure: s.adventure,
          chess: s.chess
        }) as unknown as ActivityState
    }
  )
)

export function activityInfo(title: string, detail?: string, opts?: { sticky?: boolean }): string {
  return useActivityStore.getState().push({
    kind: 'info',
    title,
    detail,
    sticky: opts?.sticky,
    ttlMs: opts?.sticky ? undefined : 4500
  })
}

export function activitySuccess(
  title: string,
  detail?: string,
  opts?: { sticky?: boolean; ttlMs?: number }
): string {
  return useActivityStore.getState().push({
    kind: 'success',
    title,
    detail,
    sticky: opts?.sticky,
    ttlMs: opts?.sticky ? undefined : opts?.ttlMs ?? 4500
  })
}

export function activityError(
  title: string,
  detail?: string,
  opts?: { sticky?: boolean; ttlMs?: number }
): string {
  return useActivityStore.getState().push({
    kind: 'error',
    title,
    detail,
    sticky: opts?.sticky,
    ttlMs: opts?.sticky ? undefined : opts?.ttlMs ?? 10_000
  })
}

/** Returns activity id so callers can update/dismiss */
export function activityProgress(title: string, detail?: string, progress = 10): string {
  return useActivityStore.getState().push({
    kind: 'progress',
    title,
    detail,
    progress,
    ttlMs: undefined
  })
}

export async function withActivity<T>(
  title: string,
  fn: (upd: (detail: string, progress?: number) => void) => Promise<T>,
  opts?: { successMessage?: string }
): Promise<T> {
  const id = activityProgress(title, '…', 5)
  const upd = (detail: string, progress?: number) => {
    useActivityStore.getState().update(id, {
      kind: 'progress',
      detail,
      progress: progress ?? 50
    })
  }
  try {
    const result = await fn(upd)
    useActivityStore.getState().update(id, {
      kind: 'success',
      title: opts?.successMessage || title,
      detail: undefined,
      progress: 100,
      ttlMs: 4000
    })
    window.setTimeout(() => useActivityStore.getState().dismiss(id), 4000)
    return result
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    useActivityStore.getState().update(id, {
      kind: 'error',
      title,
      detail: msg,
      progress: 100,
      ttlMs: 12_000
    })
    window.setTimeout(() => useActivityStore.getState().dismiss(id), 12_000)
    throw e
  }
}
