/**
 * Catalog of generative (image) stacks the assistant can recommend.
 * We do not auto-download multi-GB weights into Electron — guide the user.
 */

export type GenerativeKind = 'chat-local' | 'image-local' | 'image-cloud'

export interface GenerativeRecommendation {
  id: string
  kind: GenerativeKind
  title: string
  summary: string
  /** Ollama pull name if applicable */
  ollamaPull?: string
  /** External install / docs */
  learnMoreUrl?: string
  minVramGB?: number
  steps: string[]
}

export function recommendGenerativeStack(hw: {
  totalMemoryGB: number
  vramGB?: number | null
  hasDiscreteGpu?: boolean | null
}): GenerativeRecommendation[] {
  const out: GenerativeRecommendation[] = []
  const vram = hw.vramGB ?? 0
  const discrete = hw.hasDiscreteGpu === true

  out.push({
    id: 'pollinations',
    kind: 'image-cloud',
    title: 'Imágenes cloud (Pollinations)',
    summary: 'Sin instalar nada. Ideal para empezar desde el chat.',
    steps: [
      'Activa “Generación de imágenes” en el asistente o Ajustes',
      'Usa el botón Generar imagen o el comando /image',
      'No requiere API key'
    ]
  })

  if (discrete && vram >= 4) {
    out.push({
      id: 'sd15',
      kind: 'image-local',
      title: 'Stable Diffusion 1.5 (local)',
      summary: 'Mejor calidad offline en GPU modestas (~4–8 GB VRAM).',
      minVramGB: 4,
      learnMoreUrl: undefined,
      steps: [
        'En el Asistente o Ajustes usa “Preparar carpeta SD” (se crea en datos de la app)',
        'Opcional: descarga el checkpoint SD 1.5 de prueba (~4 GB) desde la app',
        'Instala Forge portable en esa carpeta y arranca con --api',
        'En KawaiiGPT: imagen Local/Smart y URL http://127.0.0.1:7860'
      ]
    })
  }

  if (discrete && vram >= 8) {
    out.push({
      id: 'sdxl',
      kind: 'image-local',
      title: 'Stable Diffusion XL (local)',
      summary: 'Mayor resolución; conviene ≥ 8 GB VRAM.',
      minVramGB: 8,
      learnMoreUrl: 'https://github.com/lllyasviel/stable-diffusion-webui-forge',
      steps: [
        'Mismo WebUI que SD 1.5, checkpoint SDXL',
        'Si hay OOM, baja a 768px o activa medvram en el WebUI'
      ]
    })
  }

  if (!discrete || vram < 4) {
    out.push({
      id: 'no-gpu-image',
      kind: 'image-cloud',
      title: 'Sin GPU dedicada detectada',
      summary: 'No recomendamos descargar SD local. Usa Pollinations.',
      steps: [
        'Mantén el modo de imagen en Cloud',
        'Si más adelante tienes GPU, vuelve al Asistente → Imágenes'
      ]
    })
  }

  // Chat local always as tip when RAM ok
  if (hw.totalMemoryGB >= 8) {
    out.push({
      id: 'ollama-chat',
      kind: 'chat-local',
      title: 'Chat local (Ollama)',
      summary: 'Modelos de texto en tu PC; se descargan en segundo plano.',
      ollamaPull: hw.totalMemoryGB < 16 ? 'llama3.2:3b' : 'llama3.1:8b',
      steps: [
        'En el paso Local del asistente, elige un modelo recomendado',
        'Puedes Pausar/Continuar la descarga y seguir chateando',
        'Ollama reanuda descargas parciales al volver a hacer pull'
      ]
    })
  }

  return out
}
