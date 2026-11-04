/**
 * Fase 2 — catalog dedupe + disk-only flags (pure).
 */

import {
  modelFingerprint,
  mergeDiskIntoSnapshot,
  dedupeCatalogByFingerprint,
  enrichCatalogForAuto,
  type LocalModelsSnapshot
} from '../providers/discover-local'

export type Phase2Check = { id: string; ok: boolean; detail: string }

export function runPhase2PureChecks(): Phase2Check[] {
  const out: Phase2Check[] = []

  const snap: LocalModelsSnapshot = {
    models: [
      {
        id: 'mlabonne_qwen3-14b-abliterated',
        name: 'mlabonne_qwen3-14b-abliterated',
        source: 'openai-compatible'
      },
      { id: 'qwen/qwen3-14b', name: 'qwen/qwen3-14b', source: 'openai-compatible' }
    ],
    ollama: false,
    openAI: { baseUrl: 'http://127.0.0.1:1234/v1', label: 'LMS' }
  }

  const merged = mergeDiskIntoSnapshot(snap, [
    {
      id: 'mlabonne_Qwen3-14B-abliterated-Q6_K_L',
      name: 'disk-ablit',
      source: 'lmstudio-disk',
      sizeBytes: 13e9
    },
    {
      id: 'orphan_only_on_disk-Q4_K_M',
      name: 'orphan',
      source: 'lmstudio-disk',
      sizeBytes: 4e9
    }
  ])

  const ablit = merged.models.filter((m) => /abliterat/i.test(m.id))
  out.push({
    id: 'phase2-merge-no-dup-ablit',
    ok: ablit.length === 1 && ablit[0].source === 'openai-compatible',
    detail: ablit.map((m) => `${m.id}/${m.source}`).join(' | ')
  })

  const orphan = merged.models.find((m) => /orphan/i.test(m.id))
  out.push({
    id: 'phase2-disk-only-flag',
    ok: Boolean(orphan?.diskOnly && orphan.autoEligible === false),
    detail: orphan
      ? `diskOnly=${orphan.diskOnly} autoEligible=${orphan.autoEligible}`
      : 'orphan missing'
  })

  const deduped = dedupeCatalogByFingerprint([
    ...merged.models,
    {
      id: 'mlabonne_qwen3-14b-abliterated',
      name: 'dup',
      source: 'lmstudio-disk',
      sizeHint: '12 GB'
    }
  ])
  const ablit2 = deduped.filter((m) => modelFingerprint(m.id) === modelFingerprint('mlabonne_qwen3-14b-abliterated'))
  out.push({
    id: 'phase2-dedupe-fingerprint',
    ok: ablit2.length === 1,
    detail: `count=${ablit2.length}`
  })

  const enriched = enrichCatalogForAuto([
    { id: 'only-disk-x', name: 'x', source: 'lmstudio-disk' },
    { id: 'live-y', name: 'y', source: 'ollama' }
  ])
  out.push({
    id: 'phase2-enrich-auto-eligible',
    ok:
      enriched.find((m) => m.id === 'only-disk-x')?.autoEligible === false &&
      enriched.find((m) => m.id === 'live-y')?.autoEligible === true,
    detail: enriched.map((m) => `${m.id}:${m.autoEligible}`).join(',')
  })

  return out
}
