import { effectiveVisualDescription, type CharacterProfile } from '../character/profile'

export type CharacterImageReference = {
  prompt: string
  negativePrompt: string
  referenceImage?: string
  referenceScenes: string[]
}

/** Build a stable identity anchor for local image generation. */
export function buildCharacterImageReference(
  character: CharacterProfile | null | undefined,
  opts?: { includeReferenceImage?: boolean }
): CharacterImageReference {
  if (!character) return { prompt: '', negativePrompt: '', referenceScenes: [] }

  const description = effectiveVisualDescription(character)
  const scenes = (character.visualGallery || [])
    .map((item) => (item.scene || item.label || '').trim())
    .filter(Boolean)
    .slice(0, 6)
  const prompt = [
    character.name ? `same recurring character, ${character.name}` : 'same recurring character',
    description ? `canonical appearance: ${description}` : '',
    scenes.length ? `reference wardrobe and scene notes: ${scenes.join('; ')}` : '',
    'preserve the same face, hair color, eye color, skin tone and facial proportions',
    'single subject, one face, coherent identity across variations'
  ]
    .filter(Boolean)
    .join(', ')

  return {
    prompt,
    negativePrompt:
      'different person, wrong face, changed eye color, changed hair color, twin, clone, ' +
      'second person, multiple faces, extra head, fused face, deformed face',
    referenceImage:
      opts?.includeReferenceImage && character.visualImageUrl?.startsWith('data:image/')
        ? character.visualImageUrl
        : undefined,
    referenceScenes: scenes
  }
}