/**
 * Fase 4 / resiliencia — pure checks.
 */

import {
  classifyRuntimeError,
  modelLooksVisionCapable,
  sanitizeMessagesForModel
} from './runtime-errors'

export type Phase4Check = { id: string; ok: boolean; detail: string }

export function runPhase4PureChecks(): Phase4Check[] {
  const out: Phase4Check[] = []

  const imgErr = classifyRuntimeError(
    'Engine protocol predict request returned 500: image input is not supported - hint: mmproj'
  )
  out.push({
    id: 'phase4-classify-image-error',
    ok: imgErr.kind === 'image_not_supported',
    detail: `${imgErr.kind}: ${imgErr.title}`
  })

  out.push({
    id: 'phase4-vision-heuristic',
    ok:
      modelLooksVisionCapable('moondream:latest') === true &&
      modelLooksVisionCapable('openai-gpt-oss-20b-heretic-uncensored') === false,
    detail: 'moondream=vision · heretic=text'
  })

  const san = sanitizeMessagesForModel(
    [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'qué hay' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,xx' } }
        ]
      }
    ],
    'openai-gpt-oss-20b-heretic-uncensored'
  )
  out.push({
    id: 'phase4-strip-images-text-model',
    ok: san.strippedImages === true,
    detail: `stripped=${san.strippedImages} content=${JSON.stringify(san.messages[0]?.content).slice(0, 80)}`
  })

  const keep = sanitizeMessagesForModel(
    [
      {
        role: 'user',
        content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,xx' } }]
      }
    ],
    'moondream:latest'
  )
  out.push({
    id: 'phase4-keep-images-vision-model',
    ok: keep.strippedImages === false,
    detail: `stripped=${keep.strippedImages}`
  })

  return out
}
