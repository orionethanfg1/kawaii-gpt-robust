/**
 * Fase 6 — image job UX pure checks.
 */

import {
  formatImageProgressLabel,
  humanizeImageError,
  labelForImagePhase
} from './job-ux'

export type Phase6Check = { id: string; ok: boolean; detail: string }

export function runPhase6PureChecks(): Phase6Check[] {
  const out: Phase6Check[] = []

  out.push({
    id: 'phase6-phase-label',
    ok: labelForImagePhase('txt2img').includes('Dibujando'),
    detail: labelForImagePhase('txt2img')
  })

  const prog = formatImageProgressLabel(42, 'FaceID weight 0.88', 'txt2img')
  out.push({
    id: 'phase6-progress-soft',
    ok: prog.includes('42%') && !/weight 0\.88/i.test(prog),
    detail: prog
  })

  const to = humanizeImageError('Timeout waiting for sdapi')
  out.push({
    id: 'phase6-error-timeout',
    ok: to.code === 'IMAGE_TIMEOUT' && to.retryable,
    detail: `${to.title} · ${to.code}`
  })

  const fid = humanizeImageError('KeyError in ControlNet postprocess_batch FaceID')
  out.push({
    id: 'phase6-error-faceid',
    ok: /identidad|FaceID/i.test(fid.title + fid.hint),
    detail: fid.title
  })

  const cancel = humanizeImageError('aborted by user')
  out.push({
    id: 'phase6-error-cancel',
    ok: cancel.code === 'IMAGE_CANCELLED' && !cancel.retryable,
    detail: cancel.title
  })

  return out
}
