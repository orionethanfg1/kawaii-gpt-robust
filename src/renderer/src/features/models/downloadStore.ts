import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type PullJobState = 'running' | 'paused' | 'error' | 'done'

export interface PullJob {
  model: string
  status: string
  progress?: number
  state: PullJobState
  error?: string
  updatedAt: number
  kind?: 'ollama' | 'sd' | 'forge'
  /** User hid this job from the bar (still may exist on disk until discard) */
  dismissed?: boolean
}

interface DownloadState {
  jobs: Record<string, PullJob>
  barCollapsed: boolean
  upsert: (job: Partial<PullJob> & { model: string }) => void
  remove: (model: string) => void
  markPaused: (model: string) => void
  dismiss: (model: string) => void
  clearErrors: () => void
  setBarCollapsed: (v: boolean) => void
}

export const useDownloadStore = create<DownloadState>()(
  persist(
    (set) => ({
      jobs: {},
      barCollapsed: false,
      upsert: (job) =>
        set((s) => {
          const prev = s.jobs[job.model]
          // Don't resurrect dismissed errors unless explicitly running again
          if (
            prev?.dismissed &&
            job.state !== 'running' &&
            (job.state === 'error' || job.state === 'paused')
          ) {
            return s
          }
          const next: PullJob = {
            model: job.model,
            status: job.status ?? prev?.status ?? '…',
            progress: job.progress ?? prev?.progress,
            state: job.state ?? prev?.state ?? 'running',
            error: job.error,
            kind: job.kind ?? prev?.kind,
            updatedAt: Date.now(),
            dismissed:
              job.state === 'running' ? false : (job.dismissed ?? prev?.dismissed)
          }
          if (
            prev &&
            prev.status === next.status &&
            prev.progress === next.progress &&
            prev.state === next.state &&
            prev.error === next.error &&
            prev.kind === next.kind &&
            prev.dismissed === next.dismissed
          ) {
            return s
          }
          return { jobs: { ...s.jobs, [job.model]: next } }
        }),
      remove: (model) =>
        set((s) => {
          if (!(model in s.jobs)) return s
          const jobs = { ...s.jobs }
          delete jobs[model]
          return { jobs }
        }),
      markPaused: (model) =>
        set((s) => {
          const j = s.jobs[model]
          if (!j || j.state === 'paused') return s
          return {
            jobs: {
              ...s.jobs,
              [model]: {
                ...j,
                state: 'paused',
                status: 'Pausado — Continuar reanuda desde disco',
                updatedAt: Date.now()
              }
            }
          }
        }),
      dismiss: (model) =>
        set((s) => {
          const j = s.jobs[model]
          if (!j) return s
          // Remove from bar entirely
          const jobs = { ...s.jobs }
          delete jobs[model]
          return { jobs }
        }),
      clearErrors: () =>
        set((s) => {
          const jobs = { ...s.jobs }
          for (const k of Object.keys(jobs)) {
            if (jobs[k].state === 'error') delete jobs[k]
          }
          return { jobs }
        }),
      setBarCollapsed: (v) => set({ barCollapsed: v })
    }),
    {
      name: 'kawaii-downloads-v2',
      partialize: (s) => ({
        barCollapsed: s.barCollapsed,
        jobs: Object.fromEntries(
          Object.entries(s.jobs).filter(
            ([, j]) =>
              !j.dismissed &&
              (j.state === 'running' || j.state === 'paused' || j.state === 'error')
          )
        )
      })
    }
  )
)
