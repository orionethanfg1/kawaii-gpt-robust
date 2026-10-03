
/** Resolve FaceID status from generate result without false positives on "sin-FaceID". */
export type FaceIdResultStatus = 'applied' | 'missing' | 'unknown'

export function resolveFaceIdStatus(result: {
  faceIdApplied?: boolean
  model?: string
  faceIdWarning?: string
}): FaceIdResultStatus {
  if (result.faceIdApplied === true) return 'applied'
  if (result.faceIdApplied === false) return 'missing'
  const m = String(result.model || '')
  // Check missing markers FIRST — "sin-FaceID" contains the substring "FaceID"
  if (/sin-FaceID|sin FaceID|sin-faceid/i.test(m)) return 'missing'
  if (result.faceIdWarning && /sin FaceID|sin-FaceID|Avatar sin/i.test(result.faceIdWarning))
    return 'missing'
  if (/FaceID:|· FaceID/i.test(m)) return 'applied'
  return 'unknown'
}
