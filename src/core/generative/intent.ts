/**
 * Lightweight intent detection: when should the text hub call image/music/video?
 * Conservative: ONLY explicit visual requests. Emotional / relational chat must stay text.
 */

import type { GenerativeIntent, GenerativePlan } from './types'

/** Must mention a visual product OR a clear draw/generate-image verb+noun pair. */
const IMAGE_PATTERNS: RegExp[] = [
  /^\s*\/image\b/i,
  /^\s*\/img\b/i,
  /\btext[-\s]?to[-\s]?image\b/i,
  // Verb + image noun (required)
  /\b(genera|generame|gen[eé]rame|generá|dibuja|dibuj[aá]|dib[uú]jame|pinta|pintame|p[ií]ntame|crea|crear|haz|hacer)\b[\s\S]{0,80}\b(una?\s+)?(imagen|foto|dibujo|ilustraci[oó]n|picture|image|retrato)\b/i,
  /\b(quiero|necesito|me gustar[ií]a)\b[\s\S]{0,60}\b(una?\s+)?(imagen|foto|dibujo|ilustraci[oó]n)\b/i,
  /\b(puedes|podr[ií]as|podrias|can you)\b[\s\S]{0,50}\b(dibujar|generar|crear)\b[\s\S]{0,40}\b(una?\s+)?(imagen|foto|dibujo|ilustraci[oó]n)\b/i,
  /\b(una foto de|una imagen de|un dibujo de|un retrato de|an image of|a picture of)\b/i,
  /\b(imagen|foto|dibujo|retrato)\s+(tuya|tuyo|de ti|como t[uú]|como tu)\b/i,
  /\b(env[ií]a(?:me|rme)|m[aá]nda(?:me|rme)|muéstrame|muestrame|enséñame|ensename)\b[\s\S]{0,40}\b(una?\s+)?(foto|imagen|retrato)\s*(tuya|tuyo|de ti)?\b/i,
  /\b(selfie|autorretrato)\b/i,
  /\b(quiero ver|ens[eé][nñ]ame)\b[\s\S]{0,40}\b(una?\s+)?(imagen|foto|dibujo)\b/i,
  // Explicit visualize with required scene noun
  /\b(imagina|visualiza|ilustra)\b[\s\S]{0,40}\b(escena|imagen|foto|dibujo|paisaje|retrato)\b/i,
  // Edit existing image — must say imagen/foto/dibujo
  /\b(cambia|ajusta|modifica|mejora|regenera|edita)\b[\s\S]{0,40}\b(la\s+)?(imagen|foto|dibujo)\b/i,
  /\b(no me gusta|mejor otra|otra versi[oó]n)\b[\s\S]{0,40}\b(la\s+)?(imagen|foto|dibujo|esta imagen|esta foto)\b/i
]

const MUSIC_PATTERNS: RegExp[] = [
  /^\s*\/music\b/i,
  /^\s*\/song\b/i,
  /^\s*\/audio\b/i,
  /\b(genera|generame|comp[oó]n|crea)\b[\s\S]{0,40}\b(m[uú]sica|canci[oó]n|song|track|beat|melody)\b/i,
  /\btext[-\s]?to[-\s]?music\b/i,
  /\b(haz|hacer)\b[\s\S]{0,30}\b(una\s+)?(canci[oó]n|pista musical)\b/i
]

const VIDEO_PATTERNS: RegExp[] = [
  /^\s*\/video\b/i,
  /\b(genera|generame|crea)\b[\s\S]{0,40}\b(v[ií]deo|video|clip)\b/i,
  /\btext[-\s]?to[-\s]?video\b/i
]

function stripCommand(raw: string): string {
  return raw
    .replace(/^\s*\/(image|img|music|song|audio|video)\s*/i, '')
    .trim()
}

function score(patterns: RegExp[], text: string): number {
  let best = 0
  for (const p of patterns) {
    if (p.test(text)) {
      best = Math.max(best, p.source.startsWith('^') ? 0.95 : 0.8)
    }
  }
  return best
}

/** Detect primary non-text modality if any (highest confidence wins). */
export function detectGenerativeIntent(userText: string): GenerativeIntent {
  const raw = userText.trim()
  if (!raw) return { modality: 'text', confidence: 1 }

  // Long emotional / chat messages are almost never pure image prompts
  if (raw.length > 280 && !/\b(imagen|foto|dibujo|ilustraci[oó]n|picture|image)\b/i.test(raw)) {
    return { modality: 'text', confidence: 1 }
  }

  const image = score(IMAGE_PATTERNS, raw)
  const music = score(MUSIC_PATTERNS, raw)
  const video = score(VIDEO_PATTERNS, raw)

  const best = Math.max(image, music, video)
  if (best < 0.75) {
    return { modality: 'text', confidence: 1 }
  }

  if (video >= best && video >= 0.75) {
    return { modality: 'video', confidence: video, prompt: stripCommand(raw) || raw, raw }
  }
  if (music >= best && music >= 0.75) {
    return { modality: 'music', confidence: music, prompt: stripCommand(raw) || raw, raw }
  }
  if (image >= 0.75) {
    return { modality: 'image', confidence: image, prompt: stripCommand(raw) || raw, raw }
  }
  return { modality: 'text', confidence: 1 }
}

/**
 * Build an execution plan: text hub + optional side jobs.
 * Only schedules modalities that are available.
 */
export function planGenerativeTurn(
  userText: string,
  available: { image: boolean; music: boolean; video: boolean }
): GenerativePlan {
  const intent = detectGenerativeIntent(userText)

  if (intent.modality === 'text') {
    return {
      useText: true,
      sideJobs: [],
      reason: 'Conversación de texto'
    }
  }

  const mod = intent.modality
  const can =
    mod === 'image' ? available.image : mod === 'music' ? available.music : available.video

  if (!can) {
    return {
      useText: true,
      sideJobs: [],
      reason: `Pediste ${mod}, pero no hay generador configurado/disponible; se responde solo en texto.`
    }
  }

  // Image/music/video: do NOT run the text LLM first (avoids slow context summary).
  return {
    useText: false,
    sideJobs: [
      {
        modality: mod,
        prompt: intent.prompt
      }
    ],
    reason: `Solo ${mod} (sin resumen de chat)`
  }
}
