import { describe, expect, it } from 'vitest'
import { assessFaceIdFromModelNames, canApplyRequiredFaceId } from './faceid-status'

describe('FaceID capability detection', () => {
  it('distinguishes a generic IP-Adapter from an identity-capable FaceID model', () => {
    expect(assessFaceIdFromModelNames(['ip-adapter-plus_sdxl']).available).toBe(false)
    expect(assessFaceIdFromModelNames(['ip-adapter-plus_sdxl']).kind).toBe('ipadapter')
    expect(assessFaceIdFromModelNames(['ip-adapter-faceid-plusv2_sd15']).available).toBe(true)
    expect(assessFaceIdFromModelNames(['ip-adapter-faceid-plusv2_sd15']).kind).toBe('faceid')
  })

  it('requires an actual FaceID model and its LoRA for Plus v2', () => {
    expect(canApplyRequiredFaceId('ip-adapter-plus_sdxl')).toBe(false)
    expect(canApplyRequiredFaceId('ip-adapter-faceid_sd15')).toBe(true)
    expect(canApplyRequiredFaceId('ip-adapter-faceid-plusv2_sd15')).toBe(false)
    expect(canApplyRequiredFaceId('ip-adapter-faceid-plusv2_sd15', '', true)).toBe(true)
  })
})
