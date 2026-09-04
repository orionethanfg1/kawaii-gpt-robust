import { create } from 'zustand'

export type ActivityKind = 'info' | 'progress' | 'success' | 'error'

export interface ActivityItem {
  id: string
  kind: ActivityKind
  title: string
  detail?: string
  /** 0–100 when kind is progress */
  progress?: number
  /** Auto-dismiss after ms (success/info). Errors stay longer. */
  ttlMs?: number
  createdAt: number
}

interface ActivityState {
  items: ActivityItem[]
  push: (item: Omit<ActivityItem, 'id' | 'createdAt'> & { id?: string }) => string
  update: (id: string, patch: Partial<Omit<ActivityItem, 'id' | 'createdAt'>>) => void
  dismiss: (id: string) => void
  clear: () => void
}

function uid(): string {
  return `act_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

export const useActivityStore = create<ActivityState>((set, get) => ({
  items: [],

  push: (item) => {
    const id = item.id ?? uid()
    const full: ActivityItem = {
      id,
      kind: item.kind,
      title: item.title,
      detail: item.detail,
      progress: item.progress,
      ttlMs: item.ttlMs,
      createdAt: Date.now()
    }
    set((s) => ({
      items: [full, ...s.items.filter((x) => x.id !== id)].slice(0, 8)
    }))

    const ttl =
      item.ttlMs ??
      (item.kind === 'error' ? 12_000 : item.kind === 'progress' ? 0 : 4500)
    if (ttl > 0) {
      window.setTimeout(() => {
        const still = get().items.find((x) => x.id === id)
        if (still && still.kind !== 'progress') get().dismiss(id)
      }, ttl)
    }
    return id
  },

  update: (id, patch) =>
    set((s) => ({
      items: s.items.map((x) => (x.id === id ? { ...x, ...patch } : x))
    })),

  dismiss: (id) => set((s) => ({ items: s.items.filter((x) => x.id !== id) })),

  clear: () => set({ items: [] })
}))

/** Fire-and-forget helpers for non-React code */
export function activityInfo(title: string, detail?: string): string {
  return useActivityStore.getState().push({ kind: 'info', title, detail })
}
export function activityProgress(
  title: string,
  detail?: string,
  progress?: number,
  id?: string
): string {
  return useActivityStore.getState().push({
    kind: 'progress',
    title,
    detail,
    progress,
    id,
    ttlMs: 0
  })
}
export function activitySuccess(title: string, detail?: string): string {
  return useActivityStore.getState().push({ kind: 'success', title, detail, ttlMs: 4000 })
}
export function activityError(title: string, detail?: string): string {
  return useActivityStore.getState().push({ kind: 'error', title, detail, ttlMs: 14_000 })
}

/** Run async work with progress → success/error toasts */
export async function withActivity<T>(
  title: string,
  work: (update: (detail: string, progress?: number) => void) => Promise<T>,
  opts?: { successMessage?: string | ((r: T) => string); errorTitle?: string }
): Promise<T> {
  const id = activityProgress(title, 'Iniciando…', 0)
  const update = (detail: string, progress?: number) => {
    useActivityStore.getState().update(id, {
      kind: 'progress',
      detail,
      progress,
      title
    })
  }
  try {
    const result = await work(update)
    const ok =
      typeof opts?.successMessage === 'function'
        ? opts.successMessage(result)
        : opts?.successMessage || 'Listo'
    useActivityStore.getState().update(id, {
      kind: 'success',
      title: ok,
      detail: undefined,
      progress: 100,
      ttlMs: 4000
    })
    window.setTimeout(() => useActivityStore.getState().dismiss(id), 4000)
    return result
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    useActivityStore.getState().update(id, {
      kind: 'error',
      title: opts?.errorTitle || title,
      detail: msg,
      progress: undefined,
      ttlMs: 14_000
    })
    window.setTimeout(() => useActivityStore.getState().dismiss(id), 14_000)
    throw err
  }
}
