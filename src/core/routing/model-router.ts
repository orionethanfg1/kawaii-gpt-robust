/**
 * R1 — Pure auto-route decision: classify → pick → (caller applies settings + lifecycle).
 * Side effects (Zustand, VRAM) stay in the host adapter.
 */

import {
  classifyChatTask,
  pickBestInstalledForTask,
  resolveIntimateModelId,
  preferLiveAbliteratedId,
  type ChatTask
} from './task-route'
import { armIntimateSticky, isIntimateStickyActive } from './intimate-sticky'
import { effectiveAdultIntimacyOptIn } from '../user/age-gate'
import { isLocalModelDisabled, filterEnabledIds } from '../models/disabled-local-models'

export type ModelRouterSettingsSlice = {
  autoModelRouting?: boolean
  localModelPinned?: boolean
  localModel?: string
  localModelIntimate?: string
  providerMode?: string
  adultIntimacyOptIn?: boolean
  userBirthDate?: string
  relationshipState?: { stage?: string } | null
  relationshipRole?: string
  character?: { relationshipRole?: string } | null
  disabledLocalModels?: string[]
}

function adultOk(s: ModelRouterSettingsSlice): boolean {
  return effectiveAdultIntimacyOptIn({
    adultIntimacyOptIn: s.adultIntimacyOptIn,
    userBirthDate: s.userBirthDate
  })
}

export type ModelRouterInput = {
  userText: string
  settings: ModelRouterSettingsSlice
  installed: string[]
  installedMeta?: Array<{ id: string; source?: string; autoEligible?: boolean }>
  ramGB?: number
  vramGB?: number | null
  hasImageAttachment?: boolean
  forceTask?: ChatTask
  /** Active chat id for sticky binding (R5) */
  conversationId?: string | null
  /** Model already loaded in LMS/Ollama (VRAM) — prefer keeping it */
  residentModelId?: string | null
}

export type ModelRouterDecision = {
  applied: boolean
  task: ChatTask
  from: string
  to: string
  reason: string
  /** Caller should run switchToModel(to) when true or when to differs from resident */
  runLifecycle: boolean
  /** Arm sticky after successful intimacy route */
  armSticky?: boolean
  stickyConversationId?: string | null
}

function relationshipRoleOf(s: ModelRouterSettingsSlice): string {
  return (
    s.character?.relationshipRole ||
    s.relationshipRole ||
    ''
  )
}

/**
 * Precedence (R4): see docs/adr/002-auto-route-precedence.md
 */
export function decideAutoRoute(input: ModelRouterInput): ModelRouterDecision {
  const s = input.settings
  const from = (s.localModel || '').trim()
  const empty = (reason: string, task: ChatTask = 'chat'): ModelRouterDecision => ({
    applied: false,
    task,
    from,
    to: from,
    reason,
    runLifecycle: false
  })

  if (s.autoModelRouting === false) {
    return empty('autoModelRouting desactivado')
  }
  if (s.providerMode === 'cloud') {
    return empty('modo solo cloud')
  }

  const task =
    input.forceTask ||
    classifyChatTask(input.userText, {
      hasImageAttachment: input.hasImageAttachment,
      adultOptIn: adultOk(s),
      relationshipStage: s.relationshipState?.stage,
      relationshipRole: relationshipRoleOf(s)
    })

  if (!input.installed.length) {
    return empty('sin modelos locales detectados', task)
  }

  let effectiveTask = task
  if (
    isIntimateStickyActive({
      adultOptIn: adultOk(s),
      conversationId: input.conversationId
    }) &&
    (task === 'chat' || (task as string) === 'decision')
  ) {
    effectiveTask = 'intimacy'
  }

  // R4: pin blocks Auto unless intimacy can resolve a dedicated model
  const pinned = s.localModelPinned === true && Boolean(from)
  if (pinned && effectiveTask !== 'intimacy') {
    return empty(
      `modelo fijado por el usuario (${from}) — usa Auto para liberar`,
      task
    )
  }

  const ram = input.ramGB ?? 16
  const vram = input.vramGB ?? null
  const meta = input.installedMeta?.length
    ? input.installedMeta
    : input.installed.map((id) => ({ id, source: '' }))

  if (effectiveTask === 'intimacy') {
    let intimate = resolveIntimateModelId({
      installed: input.installed,
      localModelIntimate: s.localModelIntimate,
      localModel: s.localModel,
      ramGB: ram,
      vramGB: vram,
      disabled: s.disabledLocalModels || []
    })
    if (intimate) {
      intimate = preferLiveAbliteratedId(intimate, meta)
      // Pin + intimacy: only override if we actually have an intimate target
      if (pinned && intimate === from) {
        return {
          applied: false,
          task: 'intimacy',
          from,
          to: from,
          reason: `pin + cercanía ya en ${from}`,
          // No lifecycle: avoid unload/reload of the same resident
          runLifecycle: false,
          armSticky: true,
          stickyConversationId: input.conversationId
        }
      }
      if (pinned && intimate !== from) {
        return {
          applied: true,
          task: 'intimacy',
          from,
          to: intimate,
          reason: `pin cedido a cercanía → ${intimate}`,
          runLifecycle: true,
          armSticky: true,
          stickyConversationId: input.conversationId
        }
      }
      const applied = intimate !== from
      return {
        applied,
        task: 'intimacy',
        from,
        to: intimate,
        reason: applied ? `cercanía → ${intimate}` : `ya en modelo cercanía (${intimate})`,
        // Lifecycle only when we actually switch (saves minutes on 26B)
        runLifecycle: applied,
        armSticky: true,
        stickyConversationId: input.conversationId
      }
    }
    if (pinned) {
      return empty(
        `modelo fijado (${from}); sin candidato intimacy en catálogo`,
        'intimacy'
      )
    }
    // fall through to generic pick with intimacy preference
  }

  // C2: generic pick ignores disk-only + user-disabled (never load unchecked models)
  const disabled = s.disabledLocalModels || []
  const eligibleInstalled = filterEnabledIds(
    input.installedMeta?.length
      ? input.installedMeta
          .filter((m) => m.autoEligible !== false && m.id)
          .map((m) => m.id)
      : input.installed.filter((id) => !/lmstudio-disk|ollama-disk/i.test(id)),
    disabled
  )

  // Prefer resident only if it is enabled — never treat a disabled model as "current"
  const rawResident = (input.residentModelId || '').trim()
  const rawLocal = (s.localModel || '').trim()
  const currentForPick =
    (rawResident && !isLocalModelDisabled(rawResident, disabled) ? rawResident : '') ||
    (rawLocal && !isLocalModelDisabled(rawLocal, disabled) ? rawLocal : '') ||
    ''
  const pick = pickBestInstalledForTask({
    installed: eligibleInstalled.length ? eligibleInstalled : filterEnabledIds(input.installed, disabled),
    task: effectiveTask,
    current: currentForPick,
    ramGB: ram,
    vramGB: vram,
    // Stickier when a model is already resident (chat); code/vision still switch early
    minDelta:
      task === 'vision' || task === 'code'
        ? 1
        : input.residentModelId
          ? 4
          : 2,
    preferUncensoredCompanion:
      adultOk(s) &&
      (effectiveTask === 'chat' ||
        (effectiveTask as string) === 'decision' ||
        effectiveTask === 'intimacy')
  })

  if (!pick.applied) {
    return {
      applied: false,
      task: effectiveTask,
      from: pick.from,
      to: pick.to,
      reason: pick.reason,
      runLifecycle: false
    }
  }

  return {
    applied: true,
    task: effectiveTask,
    from: pick.from,
    to: pick.to,
    reason: pick.reason,
    runLifecycle: true
  }
}

/** Apply sticky side-effect from a decision (host may call after settings update). */
export function applyStickyFromDecision(d: ModelRouterDecision): void {
  if (d.armSticky) {
    armIntimateSticky({ conversationId: d.stickyConversationId })
  }
}
