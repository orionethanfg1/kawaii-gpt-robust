
import { describe, it, expect } from 'vitest'
import { parseSceneSpecFromText, sceneSpecToSdFragments } from './scene-spec'
import { parseImageIntent } from '@core/generative/prompt-compose'
import { looksLikeRegenerate } from '@core/generative/image-revision'
import { buildChatImageRequest } from '../../renderer/src/features/chat/services/chatImageBuild'

describe('image acceptance (Hito 3)', () => {
  it('cuerpo entero → full framing + full-body tags', () => {
    const text = 'haz una foto de cuerpo entero de una chica hermosa de ojos azules'
    const intent = parseImageIntent(text)
    expect(intent.framing).toBe('full')
    const scene = parseSceneSpecFromText(text)
    expect(scene.framing).toBe('full')
    expect(scene.eyes).toMatch(/blue/i)
    const frag = sceneSpecToSdFragments(scene)
    expect(frag.positive.join(' ')).toMatch(/full body/i)
    expect(frag.negative.join(' ')).toMatch(/close-up|headshot/i)
  })

  it('catsuit → outfit tags', () => {
    const text = 'haz una foto de una chica en un catsuit'
    const scene = parseSceneSpecFromText(text)
    expect(scene.clothing.some((c) => c.garment === 'catsuit')).toBe(true)
    const frag = sceneSpecToSdFragments(scene)
    expect(frag.positive.join(' ')).toMatch(/catsuit/i)
  })

  it('vestido azul self', () => {
    const text = 'foto tuya con un vestido azul'
    const scene = parseSceneSpecFromText(text)
    expect(scene.isSelf).toBe(true)
    expect(scene.clothing.some((c) => c.color === 'blue')).toBe(true)
  })

  it('regenerar detect', () => {
    expect(looksLikeRegenerate('haz otro intento')).toBe(true)
    expect(looksLikeRegenerate('regenerar')).toBe(true)
  })
})
