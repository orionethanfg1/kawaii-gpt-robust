/**
 * Music workspace under preferredDataRoot (same disk policy as SD/Forge).
 */

import { join } from 'path'
import { existsSync } from 'fs'
import { mkdir, writeFile, readFile } from 'fs/promises'
import { totalmem } from 'os'
import {
  ensureMachineProfile,
  loadMachineProfile,
  type MachineProfile
} from './machine-profile'
import { analyzeMusicEligibility, type MusicEligibility } from '../core/music/catalog'

export type MusicInstallState = {
  ace: {
    present: boolean
    path: string
    stage: 'none' | 'cloned' | 'venv' | 'models' | 'ready' | 'error'
    lastError?: string
  }
  yue: {
    present: boolean
    path: string
    stage: 'none' | 'cloned' | 'venv' | 'models' | 'ready' | 'error' | 'disabled'
    lastError?: string
    disabledReason?: string
  }
  eligibility: MusicEligibility
  musicRoot: string
  updatedAt: string
}

function musicRootFromProfile(p: MachineProfile): string {
  return join(p.preferredDataRoot, 'music')
}

export async function ensureMusicWorkspace(): Promise<{
  musicRoot: string
  aceDir: string
  yueDir: string
  outputsDir: string
  statePath: string
}> {
  const { profile } = await ensureMachineProfile()
  const musicRoot = musicRootFromProfile(profile)
  const aceDir = join(musicRoot, 'ace-step')
  const yueDir = join(musicRoot, 'yue')
  const outputsDir = join(musicRoot, 'outputs')
  const statePath = join(musicRoot, 'music-state.json')
  for (const d of [musicRoot, aceDir, yueDir, outputsDir, join(musicRoot, 'downloads')]) {
    await mkdir(d, { recursive: true })
  }
  return { musicRoot, aceDir, yueDir, outputsDir, statePath }
}

function detectAcePresent(aceDir: string): boolean {
  return (
    existsSync(join(aceDir, 'pyproject.toml')) ||
    existsSync(join(aceDir, 'README.md')) ||
    existsSync(join(aceDir, '.installed'))
  )
}

function detectYuePresent(yueDir: string): boolean {
  return (
    existsSync(join(yueDir, 'README.md')) ||
    existsSync(join(yueDir, 'requirements.txt')) ||
    existsSync(join(yueDir, '.installed'))
  )
}

export async function loadMusicState(): Promise<MusicInstallState> {
  const { musicRoot, aceDir, yueDir, statePath } = await ensureMusicWorkspace()
  const profile = (await loadMachineProfile()) || (await ensureMachineProfile()).profile
  const vram = profile.vramGB ?? null
  const ramGB = Math.round(totalmem() / (1024 ** 3))
  const eligibility = analyzeMusicEligibility({ vramGB: vram, ramGB })

  let saved: Partial<MusicInstallState> = {}
  try {
    if (existsSync(statePath)) {
      saved = JSON.parse(await readFile(statePath, 'utf-8')) as Partial<MusicInstallState>
    }
  } catch {
    /* ignore */
  }

  const acePresent = detectAcePresent(aceDir)
  const yuePresent = detectYuePresent(yueDir)

  const state: MusicInstallState = {
    musicRoot,
    updatedAt: new Date().toISOString(),
    eligibility,
    ace: {
      present: acePresent,
      path: aceDir,
      stage: acePresent
        ? saved.ace?.stage === 'ready'
          ? 'ready'
          : saved.ace?.stage || 'cloned'
        : 'none',
      lastError: saved.ace?.lastError
    },
    yue: {
      present: yuePresent,
      path: yueDir,
      stage: !eligibility.yue.eligible
        ? 'disabled'
        : yuePresent
          ? saved.yue?.stage === 'ready'
            ? 'ready'
            : saved.yue?.stage || 'cloned'
          : 'none',
      lastError: saved.yue?.lastError,
      disabledReason: eligibility.yue.eligible ? undefined : eligibility.yue.reason
    }
  }
  await saveMusicState(state)
  return state
}

export async function saveMusicState(state: MusicInstallState): Promise<void> {
  const { statePath } = await ensureMusicWorkspace()
  await writeFile(statePath, JSON.stringify(state, null, 2), 'utf-8')
}

export async function getMusicStatusSnapshot(): Promise<MusicInstallState & { ok: boolean }> {
  const state = await loadMusicState()
  return {
    ...state,
    ok: state.ace.stage === 'ready' || state.yue.stage === 'ready'
  }
}
