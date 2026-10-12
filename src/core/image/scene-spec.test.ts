import { describe, it, expect } from 'vitest'
import { parseSceneSpecFromText, sceneSpecToSdFragments, parseSceneSpecFromLlmJson } from './scene-spec'

describe('scene-spec I1', () => {
  it('parses full body + blue eyes', () => {
    const s = parseSceneSpecFromText(
      'haz una foto de cuerpo entero de una chica hermosa de ojos azules'
    )
    expect(s.framing).toBe('full')
    expect(s.eyes).toMatch(/blue/i)
    expect(s.isSelf).toBe(false)
    const frag = sceneSpecToSdFragments(s)
    expect(frag.positive.some((p) => /full body/i.test(p))).toBe(true)
  })

  it('parses catsuit', () => {
    const s = parseSceneSpecFromText('haz una foto de una chica en un catsuit')
    expect(s.clothing.some((c) => c.garment === 'catsuit')).toBe(true)
    const frag = sceneSpecToSdFragments(s)
    expect(frag.positive.some((p) => /catsuit/i.test(p))).toBe(true)
  })

  it('parses self + blue dress', () => {
    const s = parseSceneSpecFromText('foto tuya con un vestido azul')
    expect(s.isSelf).toBe(true)
    expect(s.clothing.some((c) => c.color === 'blue')).toBe(true)
  })

  it('parses a dragon as the image subject rather than a human portrait', () => {
    const s = parseSceneSpecFromText('haz la foto de un dragón realista')
    expect(s.isSelf).toBe(false)
    expect(s.subject).toMatch(/dragon/i)
    expect(s.framing).toBe('wide')
    expect(sceneSpecToSdFragments(s).positive.join(', ')).toMatch(/dragon/i)
  })
})

describe('scene-spec I1b JSON', () => {
  it('merges llm json', () => {
    const base = parseSceneSpecFromText('foto de una chica')
    const merged = parseSceneSpecFromLlmJson(
      '{"framing":"full","clothing":[{"garment":"catsuit","color":"black"}],"environment":"city street at night"}',
      base
    )
    expect(merged?.framing).toBe('full')
    expect(merged?.clothing[0]?.garment).toBe('catsuit')
    expect(merged?.environment).toMatch(/city/i)
  })

  it('does not let a scene director turn a dragon request into a self portrait', () => {
    const base = parseSceneSpecFromText('haz la foto de un dragón realista')
    const merged = parseSceneSpecFromLlmJson(
      '{"isSelf":true,"framing":"close","subject":"beautiful young woman"}',
      base
    )

    expect(merged?.isSelf).toBe(false)
    expect(merged?.subject).toMatch(/dragon/i)
    expect(merged?.framing).toBe('wide')
  })
})
