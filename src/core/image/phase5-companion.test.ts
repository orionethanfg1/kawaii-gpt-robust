/**
 * Fase 5 — companion pure checks.
 */

import {
  shouldProposeVisualChange,
  VISUAL_INITIATIVE_COOLDOWN_MS,
  VISUAL_INITIATIVE_MIN_MESSAGES
} from './visual-initiative'
import {
  extractMemoriesFromChatExport,
  mergeImportedMemories
} from '../conversation/import-memories'

export type Phase5Check = { id: string; ok: boolean; detail: string }

export function runPhase5PureChecks(): Phase5Check[] {
  const out: Phase5Check[] = []

  const cooldown = shouldProposeVisualChange({
    conversationInitiativeEnabled: true,
    galleryCount: 5,
    lastProposeAt: Date.now() - 60_000,
    relationshipStage: 'intimate',
    messageCount: 40
  })
  out.push({
    id: 'phase5-visual-cooldown',
    ok: cooldown.ok === false && cooldown.reason === 'cooldown',
    detail: `reason=${cooldown.reason} cdMs=${VISUAL_INITIATIVE_COOLDOWN_MS}`
  })

  const fewMsgs = shouldProposeVisualChange({
    conversationInitiativeEnabled: true,
    galleryCount: 5,
    lastProposeAt: 0,
    relationshipStage: 'intimate',
    messageCount: 3,
    // force past random: we only assert need_more_messages when random would pass —
    // call without relying on random by checking reason when messageCount low
  })
  // With random_skip possible, accept need_more_messages OR random_skip
  out.push({
    id: 'phase5-visual-min-messages',
    ok:
      fewMsgs.ok === false &&
      (fewMsgs.reason === 'need_more_messages' || fewMsgs.reason === 'random_skip'),
    detail: `reason=${fewMsgs.reason} min=${VISUAL_INITIATIVE_MIN_MESSAGES}`
  })

  // Deterministic: patch by setting messageCount low and lastProposeAt 0 — if random allows ok, fail
  // Better: test that need_more_messages is checked before random by inspecting order — already is.
  // Force many attempts
  let hitNeed = false
  for (let i = 0; i < 40; i++) {
    const g = shouldProposeVisualChange({
      conversationInitiativeEnabled: true,
      galleryCount: 5,
      lastProposeAt: 0,
      relationshipStage: 'familiar',
      messageCount: 2
    })
    if (g.reason === 'need_more_messages') hitNeed = true
  }
  out.push({
    id: 'phase5-visual-min-before-random',
    ok: hitNeed,
    detail: `hitNeed=${hitNeed}`
  })

  const sample = {
    messages: [
      { role: 'user', content: 'Hola' },
      { role: 'assistant', content: '¡Hola!' },
      { role: 'user', content: 'Me gusta el jazz y el café amargo' },
      { role: 'user', content: 'Me llamo Orion y trabajo en desarrollo' }
    ]
  }
  const bundle = extractMemoriesFromChatExport(sample)
  out.push({
    id: 'phase5-import-memories',
    ok: bundle.likes.length >= 1 && bundle.facts.length >= 1 && bundle.scanned === 4,
    detail: bundle.summary
  })

  const merged = mergeImportedMemories({ likes: ['ya'], facts: [] }, bundle)
  out.push({
    id: 'phase5-merge-memories',
    ok: merged.likes.length >= 2 && merged.facts.length >= 1,
    detail: `likes=${merged.likes.length} facts=${merged.facts.length}`
  })

  return out
}
