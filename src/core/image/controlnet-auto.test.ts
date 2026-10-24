import { describe, it, expect } from 'vitest'
import {
  inferControlNetKind,
  pickControlNetModel,
  planStructuralControlNet
} from './controlnet-auto'

describe('controlnet-auto 3.4', () => {
  it('infers openpose from full body / pose', () => {
    expect(inferControlNetKind('foto tuya de cuerpo completo, pose de yoga')).toBe('openpose')
  })

  it('infers canny and depth', () => {
    expect(inferControlNetKind('mismo sujeto, canny edges')).toBe('canny')
    expect(inferControlNetKind('escena con mapa de profundidad')).toBe('depth')
  })

  it('picks openpose model', () => {
    const m = pickControlNetModel(
      ['control_v11p_sd15_canny.pth', 'control_v11p_sd15_openpose.pth', 'ip-adapter-faceid'],
      'openpose'
    )
    expect(m).toMatch(/openpose/i)
  })

  it('plans unit when ref + model exist', () => {
    const plan = planStructuralControlNet({
      prompt: 'postura sentada, cuerpo completo',
      models: ['control_v11p_sd15_openpose.pth'],
      referenceImage: 'data:image/png;base64,aaa'
    })
    expect(plan.kind).toBe('openpose')
    expect(plan.unit?.model).toMatch(/openpose/i)
    expect(plan.note).toMatch(/ControlNet auto/i)
  })

  it('notes missing model', () => {
    const plan = planStructuralControlNet({
      prompt: 'openpose dance',
      models: [],
      referenceImage: 'data:image/png;base64,aaa'
    })
    expect(plan.unit).toBeNull()
    expect(plan.note).toMatch(/no hay modelo/i)
  })
})
