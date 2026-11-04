/**
 * Fase 0 — pure checks (importable from Tester without network).
 * A1: intimacy classify + resolve abliterated
 * A2: fingerprint / mergeDisk single row
 */

import {
  modelFingerprint,
  mergeDiskIntoSnapshot,
  type LocalModelsSnapshot
} from '../providers/discover-local'
import {
  classifyChatTask,
  resolveIntimateModelId,
  preferLiveAbliteratedId
} from './task-route'
import { isNearEchoOfPrevious, textSimilarity } from '../chat/echo-detect'

export type Phase0Check = {
  id: string
  ok: boolean
  detail: string
}

export function runPhase0PureChecks(): Phase0Check[] {
  const out: Phase0Check[] = []

  // ——— A2 fingerprint ———
  const fpApi = modelFingerprint('mlabonne_qwen3-14b-abliterated')
  const fpDisk = modelFingerprint('mlabonne_Qwen3-14B-abliterated-Q6_K_L')
  const fpPub = modelFingerprint('bartowski/mlabonne_Qwen3-14B-abliterated-GGUF')
  const fpMatch = fpApi.length >= 6 && fpApi === fpDisk && fpApi === fpPub
  out.push({
    id: 'phase0-fingerprint-abliterated',
    ok: fpMatch,
    detail: fpMatch
      ? `fp=${fpApi}`
      : `api=${fpApi} disk=${fpDisk} pub=${fpPub} — deben coincidir`
  })

  const snap: LocalModelsSnapshot = {
    models: [
      {
        id: 'mlabonne_qwen3-14b-abliterated',
        name: 'mlabonne_qwen3-14b-abliterated',
        source: 'openai-compatible'
      },
      {
        id: 'qwen/qwen3-14b',
        name: 'qwen/qwen3-14b',
        source: 'openai-compatible'
      }
    ],
    ollama: false,
    openAI: { baseUrl: 'http://127.0.0.1:1234/v1', label: 'LMS' },
    diskCount: 0
  }
  const merged = mergeDiskIntoSnapshot(snap, [
    {
      id: 'mlabonne_Qwen3-14B-abliterated-Q6_K_L',
      name: 'mlabonne_Qwen3-14B-abliterated-Q6_K_L',
      source: 'lmstudio-disk',
      sizeBytes: 12.5e9
    }
  ])
  const ablitRows = merged.models.filter((m) => /abliterat/i.test(m.id))
  const oneRow = ablitRows.length === 1 && ablitRows[0].id === 'mlabonne_qwen3-14b-abliterated'
  const hasSize = Boolean(ablitRows[0]?.sizeHint)
  out.push({
    id: 'phase0-merge-single-abliterated',
    ok: oneRow && hasSize,
    detail: oneRow
      ? `1 fila live + sizeHint=${ablitRows[0].sizeHint}`
      : `filas abliterated=${ablitRows.map((m) => m.id).join(' | ')} (esperado 1 live)`
  })

  // ——— A1 intimacy route ———
  const task = classifyChatTask('Eso ya me lo dijiste, pero yo quiero besar tus labios', {
    adultOptIn: true,
    relationshipStage: 'intimate_adult',
    relationshipRole: 'novios'
  })
  out.push({
    id: 'phase0-classify-besar-labios',
    ok: task === 'intimacy',
    detail: `task=${task}`
  })

  const installed = [
    'qwen/qwen3-14b',
    'mlabonne_qwen3-14b-abliterated',
    'mlabonne_Qwen3-14B-abliterated-Q6_K_L',
    'openai/gpt-oss-20b'
  ]
  // User disabled the disk id only — live abliterated must still win
  const intimate = resolveIntimateModelId({
    installed,
    localModel: 'qwen/qwen3-14b',
    disabled: ['mlabonne_Qwen3-14B-abliterated-Q6_K_L'],
    ramGB: 32
  })
  const liveId = preferLiveAbliteratedId(intimate || '', [
    { id: 'mlabonne_qwen3-14b-abliterated', source: 'openai-compatible' },
    { id: 'mlabonne_Qwen3-14B-abliterated-Q6_K_L', source: 'lmstudio-disk' },
    { id: 'qwen/qwen3-14b', source: 'openai-compatible' }
  ])
  const picksAblit =
    Boolean(intimate) &&
    /abliterat/i.test(String(intimate)) &&
    /abliterat/i.test(liveId) &&
    !/^qwen\/qwen3-14b$/i.test(liveId)
  out.push({
    id: 'phase0-resolve-intimate-abliterated',
    ok: picksAblit,
    detail: `intimate=${intimate} live=${liveId}`
  })

  // Disable live abliterated exact only — disk still eligible then map to… disk id
  const intimateDiskOnly = resolveIntimateModelId({
    installed,
    localModel: 'qwen/qwen3-14b',
    disabled: ['mlabonne_qwen3-14b-abliterated'],
    ramGB: 32
  })
  out.push({
    id: 'phase0-disable-exact-not-fuzzy',
    ok: Boolean(intimateDiskOnly && /abliterat/i.test(intimateDiskOnly)),
    detail: `with live disabled → ${intimateDiskOnly} (debe seguir siendo abliterated de disco)`
  })

  // ——— A4 echo helper ———
  const prev =
    'Mi amorcito, sé que anhelas más de lo que podemos dar en este momento pero tú eres mi luz incluso entre las sombras.'
  const echo = prev + ' Y eso me hace más feliz que cualquier beso.'
  const fresh = 'Claro, un beso suave en tus labios mientras te abrazo.'
  out.push({
    id: 'phase0-echo-detect',
    ok:
      isNearEchoOfPrevious(prev, echo) === true &&
      isNearEchoOfPrevious(prev, fresh) === false &&
      textSimilarity(prev, prev) > 0.99,
    detail: `echo=${isNearEchoOfPrevious(prev, echo)} fresh=${isNearEchoOfPrevious(prev, fresh)}`
  })

  return out
}
