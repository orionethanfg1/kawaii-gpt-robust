/**
 * Persist Ollama pull jobs so Continuar / reinicio de app reanuda capas en disco.
 * Ollama already stores partial blobs; we only remember which models to retry.
 */
import { app } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { readFile, writeFile, mkdir } from 'fs/promises'

export type OllamaPullJob = {
  model: string
  status: 'running' | 'paused' | 'error' | 'done'
  error?: string
  updatedAt?: number
  progress?: number
}

function jobsPath(): string {
  return join(app.getPath('userData'), 'ollama-pull-jobs.json')
}

export async function loadOllamaPullJobs(): Promise<OllamaPullJob[]> {
  try {
    const p = jobsPath()
    if (!existsSync(p)) return []
    const raw = await readFile(p, 'utf-8')
    const data = JSON.parse(raw) as { jobs?: OllamaPullJob[] }
    return Array.isArray(data.jobs) ? data.jobs : []
  } catch {
    return []
  }
}

export async function saveOllamaPullJobs(jobs: OllamaPullJob[]): Promise<void> {
  const dir = app.getPath('userData')
  await mkdir(dir, { recursive: true })
  const active = jobs.filter((j) => j.status !== 'done').slice(-30)
  await writeFile(jobsPath(), JSON.stringify({ jobs: active, at: Date.now() }, null, 2), 'utf-8')
}

export async function upsertOllamaPullJob(job: OllamaPullJob): Promise<void> {
  const jobs = await loadOllamaPullJobs()
  const i = jobs.findIndex((j) => j.model === job.model)
  if (i >= 0) jobs[i] = { ...jobs[i], ...job, updatedAt: Date.now() }
  else jobs.push({ ...job, updatedAt: Date.now() })
  await saveOllamaPullJobs(jobs)
}

export async function removeOllamaPullJob(model: string): Promise<void> {
  const jobs = await loadOllamaPullJobs()
  await saveOllamaPullJobs(jobs.filter((j) => j.model !== model))
}

export async function listRecoverableOllamaPulls(): Promise<OllamaPullJob[]> {
  const jobs = await loadOllamaPullJobs()
  return jobs.filter((j) => j.status === 'error' || j.status === 'paused' || j.status === 'running')
}
