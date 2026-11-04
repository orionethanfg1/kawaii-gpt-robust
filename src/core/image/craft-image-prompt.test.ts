import { describe, expect, it } from 'vitest'
import {
  buildImageCraftSystemPrompt,
  parseCraftedImagePromptJson,
  mergeCraftedWithIdentity,
  craftImagePromptWithLlm
} from './craft-image-prompt'
import type { IdentityProfile } from './identity-profile'

const sampleIdentity: IdentityProfile = {
  id: 'identity:luna',
  canonicalName: 'Luna',
  appearanceSummary: 'long red hair, violet eyes, fair skin',
  hairNotes: 'long red hair',
  eyesNotes: 'violet eyes',
  lockedFields: ['face', 'hair', 'eyes', 'skin'],
  secondaryRefs: []
}

describe('craft-image-prompt I1', () => {
  it('buildImageCraftSystemPrompt mentions self lock', () => {
    const s = buildImageCraftSystemPrompt({
      isSelf: true,
      characterName: 'Luna',
      appearanceSummary: 'long red hair, violet eyes',
      hasFaceIdRef: true
    })
    expect(s).toMatch(/SELF-PORTRAIT/i)
    expect(s).toMatch(/Luna/)
    expect(s).toMatch(/FaceID/)
    expect(s).toMatch(/JSON/)
  })

  it('parseCraftedImagePromptJson tolerates fences and prose', () => {
    const raw =
      'Sure.\n```json\n{"positive":"standing by window, soft light, white blouse","negative":"blurry","framing":"half","style":"casual_photo"}\n```'
    const p = parseCraftedImagePromptJson(raw)
    expect(p?.positive).toMatch(/window/)
    expect(p?.framing).toBe('half')
    expect(p?.style).toBe('casual_photo')
  })

  it('parseCraftedImagePromptJson rejects empty positive', () => {
    expect(parseCraftedImagePromptJson('{"positive":"x","negative":""}')).toBeNull()
    expect(parseCraftedImagePromptJson('not json')).toBeNull()
  })

  it('mergeCraftedWithIdentity forces DNA when isSelf', () => {
    const m = mergeCraftedWithIdentity(
      {
        positive: 'sitting on sofa, evening light, silk dress',
        negative: 'ugly',
        framing: 'half'
      },
      { isSelf: true, identity: sampleIdentity }
    )
    expect(m.source).toBe('llm')
    expect(m.positive.toLowerCase()).toMatch(/red hair|luna|same person/)
    expect(m.positive).toMatch(/sofa|silk/i)
    expect(m.negative.toLowerCase()).toMatch(/identity mismatch|wrong person/)
  })

  it('mergeCraftedWithIdentity does not force DNA when not self', () => {
    const m = mergeCraftedWithIdentity(
      { positive: 'a red dragon flying over mountains, volumetric clouds' },
      { isSelf: false, identity: sampleIdentity }
    )
    expect(m.positive.toLowerCase()).toMatch(/dragon/)
    expect(m.positive.toLowerCase()).not.toMatch(/same person as luna/)
  })

  it('mergeCraftedWithIdentity strips rival hair/eyes invented by LLM', () => {
    const brownId: IdentityProfile = {
      id: 'identity:niamh',
      canonicalName: 'Niamh',
      appearanceSummary: 'long brown hair, straight hair, green eyes, fair skin',
      hairNotes: 'brown straight hair',
      eyesNotes: 'green eyes',
      lockedFields: ['face', 'hair', 'eyes', 'skin'],
      secondaryRefs: []
    }
    const m = mergeCraftedWithIdentity(
      {
        positive:
          'upper body, (blonde hair:1.45), (curly hair:1.45), (green eyes:1.4), soft smile, black dress',
        framing: 'half'
      },
      { isSelf: true, identity: brownId }
    )
    expect(m.positive.toLowerCase()).toMatch(/brown hair/)
    expect(m.positive.toLowerCase()).not.toMatch(/blonde hair/)
    expect(m.positive.toLowerCase()).not.toMatch(/curly hair/)
    expect(m.negative.toLowerCase()).toMatch(/blonde hair/)
  })

  it('craftImagePromptWithLlm uses model JSON and times out soft', async () => {
    const ok = await craftImagePromptWithLlm(
      {
        userText: 'haz una foto tuya en la playa al atardecer',
        isSelf: true,
        characterName: 'Luna',
        identity: sampleIdentity,
        hasFaceIdRef: true
      },
      async () =>
        JSON.stringify({
          positive: 'beach at sunset, warm backlight, soft smile, summer dress',
          negative: 'night, indoor',
          framing: 'full',
          style: 'casual_photo'
        }),
      2000
    )
    expect(ok?.source).toBe('llm')
    expect(ok?.positive.toLowerCase()).toMatch(/beach|sunset/)
    expect(ok?.positive.toLowerCase()).toMatch(/red hair|luna/)

    const timed = await craftImagePromptWithLlm(
      { userText: 'foto', isSelf: false },
      async () => {
        await new Promise((r) => setTimeout(r, 80))
        return '{}'
      },
      20
    )
    expect(timed).toBeNull()
  })
})
