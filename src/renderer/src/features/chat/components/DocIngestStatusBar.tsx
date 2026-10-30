/**
 * Visualización de ingesta de documentos (pipeline ETL ligero).
 */
import { useEffect, useState } from 'react'
import { BookOpen, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import {
  getLatestDocIngestJob,
  subscribeDocIngest
} from '../services/documentIngestUi'
import type { DocIngestJob } from '@core/chat/document-ingest-etl'
import { phaseFromDocState } from '@core/chat/document-ingest-etl'
import { getDocReadingStatesForConv } from '../services/documentReadingStore'
import { useChatStore } from '@shared/lib/stores/chatStore'

const PHASE_LABEL: Record<string, string> = {
  idle: 'En espera',
  extract: 'Extract',
  map: 'MAP',
  reduce: 'REDUCE',
  seed: 'Índice LLM',
  load: 'Load',
  ready: 'Listo',
  error: 'Error'
}

export function DocIngestStatusBar() {
  const activeId = useChatStore((s) => s.activeId)
  const [job, setJob] = useState<DocIngestJob | null>(null)

  useEffect(() => {
    if (!activeId) {
      setJob(null)
      return
    }
    // Hydrate from reading store
    try {
      const states = getDocReadingStatesForConv(activeId)
      if (states.length) {
        const st = states.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0]
        setJob(phaseFromDocState(st as never))
      }
    } catch {
      /* */
    }
    const live = getLatestDocIngestJob(activeId)
    if (live) setJob(live)

    const unsub = subscribeDocIngest((j) => {
      if (!j) return
      if (j.convId === activeId) setJob(j)
    })
    const onEv = (e: Event) => {
      const d = (e as CustomEvent).detail as DocIngestJob
      if (d?.convId === activeId) setJob(d)
    }
    window.addEventListener('kawaii:doc-ingest', onEv)
    const STUCK_MS = 3 * 60 * 1000
    const tick = window.setInterval(() => {
      try {
        const states = getDocReadingStatesForConv(activeId)
        if (!states.length) return
        const st = states.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0]
        const derived = phaseFromDocState(st as never)
        setJob((prev) => {
          if (prev?.phase === 'ready') return prev
          // Stuck REDUCE/seed while model is busy on chat → surface ready with heuristic
          if (
            prev &&
            (prev.phase === 'reduce' || prev.phase === 'seed' || prev.phase === 'map') &&
            Date.now() - (prev.updatedAt || 0) > STUCK_MS
          ) {
            return {
              ...prev,
              phase: 'ready',
              progress: 100,
              detail: 'Resumen heurístico (LLM de fondo no respondió a tiempo)',
              updatedAt: Date.now()
            }
          }
          if (prev?.phase === 'seed' && derived.phase !== 'ready' && Date.now() - (prev.updatedAt || 0) < STUCK_MS) {
            return prev
          }
          return derived
        })
      } catch {
        /* */
      }
    }, 4000)
    return () => {
      unsub()
      window.removeEventListener('kawaii:doc-ingest', onEv)
      window.clearInterval(tick)
    }
  }, [activeId])

  if (!job || job.phase === 'idle') return null
  // Don't keep the book bar on screen during normal chat
  if (job.phase === 'ready') return null  // never keep book bar during normal chat
  // Hide ready after a quiet period is optional — keep short chip if ready
  if (job.phase === 'ready' && Date.now() - job.updatedAt > 120_000) return null

  const busy = job.phase === 'map' || job.phase === 'reduce' || job.phase === 'seed' || job.phase === 'extract'
  const Icon =
    job.phase === 'ready'
      ? CheckCircle2
      : job.phase === 'error'
        ? AlertCircle
        : busy
          ? Loader2
          : BookOpen

  return (
    <div
      className="mx-4 mb-1 rounded-lg border border-violet-200/80 bg-violet-50/70 px-3 py-1.5 text-[11px] text-violet-950 flex items-center gap-2"
      title="Pipeline de ingesta de documentos (Extract → MAP → REDUCE → índice LLM)"
    >
      <Icon className={'w-3.5 h-3.5 shrink-0 ' + (busy ? 'animate-spin' : '')} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold">{PHASE_LABEL[job.phase] || job.phase}</span>
          <span className="text-violet-800/80 truncate">{job.fileName}</span>
          <span className="tabular-nums text-violet-700">{job.progress}%</span>
        </div>
        <p className="text-[10px] text-violet-900/75 truncate">{job.detail}</p>
        <div className="mt-0.5 h-1 rounded-full bg-violet-100 overflow-hidden">
          <div
            className="h-full bg-violet-400/90 transition-all duration-500"
            style={{ width: `${Math.min(100, Math.max(0, job.progress))}%` }}
          />
        </div>
      </div>
    </div>
  )
}
