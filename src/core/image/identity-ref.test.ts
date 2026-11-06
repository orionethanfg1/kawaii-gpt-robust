import { describe, it, expect } from 'vitest'
import { pickAvatarDataUrl, planIdentityLock, resolveIpAdapterFromModels } from './identity-ref'

describe('identity-ref 3.1', () => {
  it('picks avatar data url from gallery', () => {
    const u = pickAvatarDataUrl({
      visualGallery: [{ dataUrl: 'data:image/png;base64,abc' }]
    })
    expect(u?.startsWith('data:image/')).toBe(true)
  })

  it('locks self with avatar', () => {
    const plan = planIdentityLock({
      isSelf: true,
      character: { visualImageUrl: 'data:image/png;base64,xyz' }
    })
    expect(plan.locked).toBe(true)
    expect(plan.referenceImage).toBeTruthy()
    expect(plan.ipAdapterWeight).toBeGreaterThanOrEqual(0.75)
  })

  it('uses a single canonical face; outfit/scene only as low-weight secondary', () => {
    const plan = planIdentityLock({
      isSelf: true,
      character: {
        facePrimaryUrl: 'data:image/png;base64,main',
        visualImageUrl: 'data:image/png;base64,main',
        visualGallery: [
          { dataUrl: 'data:image/png;base64,portrait', label: 'face portrait', role: 'face' },
          {
            dataUrl: 'data:image/png;base64,scene',
            label: 'forest scene',
            role: 'scene',
            tags: ['scene:forest']
          },
          { dataUrl: 'data:image/png;base64,extra', label: 'night portrait', role: 'face' }
        ]
      }
    })

    expect(plan.referenceImage).toBe('data:image/png;base64,main')
    // Secondary must not include extra face photos
    const secs = plan.referenceImages || []
    expect(secs.every((u) => u !== 'data:image/png;base64,extra')).toBe(true)
    expect(secs.every((u) => u !== 'data:image/png;base64,portrait')).toBe(true)
    expect(plan.ipAdapterWeight).toBeGreaterThanOrEqual(0.82)
  })

  it('does not lock explicit other', () => {
    const plan = planIdentityLock({
      isSelf: true,
      explicitOther: true,
      character: { visualImageUrl: 'data:image/png;base64,xyz' }
    })
    expect(plan.locked).toBe(false)
    expect(plan.referenceImage).toBeUndefined()
  })

  it('resolves faceid model', () => {
    const r = resolveIpAdapterFromModels(
      ['ip-adapter_sd15.safetensors', 'ip-adapter-faceid-plusv2_sd15.safetensors'],
      'data:image/png;base64,xx',
      0.9
    )
    expect(r?.selected.kind).toBe('faceid')
    expect(r?.config.weight).toBe(0.9)
  })

  it('does not select the FaceID LoRA as the ControlNet model', () => {
    const plan = resolveIpAdapterFromModels(
      [
        'ip-adapter-faceid-plusv2_sd15_lora.safetensors',
        'ip-adapter_sd15.safetensors'
      ],
      'data:image/png;base64,xx'
    )

    expect(plan?.selected.name).toBe('ip-adapter_sd15.safetensors')
    expect(plan?.config.module).toBe('ip-adapter_clip_sd15')
  })

  it('matches the Forge module to the installed FaceID model variant', () => {
    const plan = resolveIpAdapterFromModels(
      ['ip-adapter-faceid_sd15.bin'],
      'data:image/png;base64,xx'
    )

    expect(plan?.config.module).toBe('ip-adapter-faceid_sd15')
  })
})
