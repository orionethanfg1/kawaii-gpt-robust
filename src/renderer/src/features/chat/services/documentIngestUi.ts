/**
 * Lightweight pub/sub for document ingest ETL progress (renderer UI).
 */
import type { DocIngestJob } from '@core/chat/document-ingest-etl'

type Listener = (job: DocIngestJob | null) => void

const jobs = new Map<string, DocIngestJob>()
const listeners = new Set<Listener>()
let last: DocIngestJob | null = null

export function publishDocIngestJob(job: DocIngestJob): void {
  jobs.set(job.key, job)
  last = job
  for (const l of listeners) {
    try {
      l(job)
    } catch {
      /* */
    }
  }
  try {
    window.dispatchEvent(new CustomEvent('kawaii:doc-ingest', { detail: job }))
  } catch {
    /* */
  }
}

export function getLatestDocIngestJob(convId?: string): DocIngestJob | null {
  if (!convId) return last
  let best: DocIngestJob | null = null
  for (const j of jobs.values()) {
    if (j.convId !== convId) continue
    if (!best || j.updatedAt >= best.updatedAt) best = j
  }
  return best
}

export function subscribeDocIngest(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
