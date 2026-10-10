/**
 * Plain-language capability report for non-advanced PC users.
 * Pure functions — safe in renderer and tests.
 */

export interface HwSnapshot {
  totalMemoryGB: number
  cpuCores: number
  architecture: string
  gpuName?: string | null
  vramGB?: number | null
  hasDiscreteGpu?: boolean | null
}

export type CapabilityLevel = 'excellent' | 'good' | 'limited' | 'not_recommended'

export interface CapabilityItem {
  id: string
  title: string
  level: CapabilityLevel
  summary: string
  tip?: string
}

export interface ProductStackItem {
  name: string
  role: string
  note: string
}

/** A complete PC build tier — parts meant to work well together */
export interface HardwareBuildTier {
  id: 'starter' | 'recommended' | 'max'
  title: string
  tagline: string
  /** What the user can expect from the app on this build */
  appExperience: string
  parts: Array<{ role: string; suggestion: string; why: string }>
  /** Rough compatibility note */
  fitsTogether: string
}

export interface SystemCapabilityReport {
  headline: string
  overallLevel: CapabilityLevel
  overallBlurb: string
  hardwareLines: string[]
  /** How this PC compares to the "recommended" and "max" builds */
  vsRecommended: string
  vsMax: string
  capabilities: CapabilityItem[]
  /** Software that works together */
  productStack: ProductStackItem[]
  /** Hardware builds that work together */
  hardwareBuilds: HardwareBuildTier[]
  tips: string[]
}

function levelRank(l: CapabilityLevel): number {
  return { excellent: 4, good: 3, limited: 2, not_recommended: 1 }[l]
}

function minLevel(...levels: CapabilityLevel[]): CapabilityLevel {
  return levels.reduce((a, b) => (levelRank(a) <= levelRank(b) ? a : b))
}

/** Reference builds — consumer PC parts that play nice together for KawaiiGPT */
export function getHardwareBuildTiers(): HardwareBuildTier[] {
  return [
    {
      id: 'starter',
      title: 'Equipo básico (funciona)',
      tagline: 'Chat cómodo + algo de imagen o música, no las dos a tope',
      appExperience:
        'Chat local o en la nube, imágenes ligeras (SD 1.5) o música ligera, de una en una.',
      parts: [
        {
          role: 'Tarjeta gráfica (GPU)',
          suggestion: 'NVIDIA GTX 1660 / RTX 3050 / 3060 de 6–8 GB (o similar AMD)',
          why: 'Mínimo razonable para Forge o ACE en modo ligero.'
        },
        {
          role: 'Memoria RAM',
          suggestion: '16 GB (2×8 GB a la misma velocidad)',
          why: 'El sistema + Ollama + un generador necesitan margen.'
        },
        {
          role: 'Procesador',
          suggestion: 'Intel i5 / Ryzen 5 de los últimos años (6+ núcleos)',
          why: 'Suficiente para la app y el chat; la GPU hace el trabajo pesado.'
        },
        {
          role: 'Disco',
          suggestion: 'SSD NVMe de 512 GB o más (modelos pesan varios GB)',
          why: 'Checkpoints, ACE y Ollama ocupan mucho; el SSD evita esperas eternas.'
        }
      ],
      fitsTogether:
        'GPU 6–8 GB + 16 GB RAM + SSD. No mezcles GPU de 4 GB con pretender SDXL y música a la vez.'
    },
    {
      id: 'recommended',
      title: 'Equipo recomendado (equilibrio)',
      tagline: 'El “punto dulce” para KawaiiGPT en casa',
      appExperience:
        'Chat fluido, buenas imágenes locales y música local turnándose capas. Experiencia cercana al máximo sin PC de servidor.',
      parts: [
        {
          role: 'Tarjeta gráfica (GPU)',
          suggestion: 'NVIDIA RTX 3060 12 GB · 4060 8–16 GB · 4070 12 GB (o AMD 6700 XT / 7600 similares)',
          why: '12 GB de VRAM dan aire a SD 1.5/algunos SDXL y ACE 0.6B sin ahogar Windows.'
        },
        {
          role: 'Memoria RAM',
          suggestion: '32 GB (2×16 GB, misma marca/velocidad si puedes)',
          why: 'Windows + navegador + Ollama + app; la paginación deja de ser el enemigo.'
        },
        {
          role: 'Procesador',
          suggestion: 'Intel i5/i7 o Ryzen 5/7 recientes (8 núcleos o más a gusto)',
          why: 'No hace falta el más caro; que no cuelle la GPU en discos lentos sí importa más.'
        },
        {
          role: 'Disco',
          suggestion: 'SSD NVMe 1 TB (o 512 GB sistema + otro SSD para modelos en D:)',
          why: 'La app puede guardar modelos en otra unidad para no llenar C:.'
        },
        {
          role: 'Fuente de alimentación',
          suggestion: 'Fuente fiable 550–750 W según la GPU (80+ Bronze o mejor)',
          why: 'GPU + PC estable; fuentes dudosas reinician al generar.'
        }
      ],
      fitsTogether:
        'RTX 3060 12 GB + 32 GB RAM + SSD NVMe es el combo más equilibrado: piezas fáciles de encontrar, se llevan bien y cubren chat + imagen + música (por turnos).'
    },
    {
      id: 'max',
      title: 'Equipo para el máximo de la app',
      tagline: 'Sacar todo el jugo (casi) sin pelearte con la memoria',
      appExperience:
        'Modelos de chat más grandes, SDXL con más soltura, música con menos cortes, menos “cierra Forge para generar canción”.',
      parts: [
        {
          role: 'Tarjeta gráfica (GPU)',
          suggestion: 'NVIDIA RTX 4070 Ti / 4080 / 5070+ con 16 GB VRAM o más (o AMD 7900 XT/XTX)',
          why: 'Más VRAM = menos tener que apagar una capa para usar la otra.'
        },
        {
          role: 'Memoria RAM',
          suggestion: '64 GB (2×32 GB)',
          why: 'Holgura real para Ollama grande + Windows + generadores sin pagefile de emergencia.'
        },
        {
          role: 'Procesador',
          suggestion: 'Intel i7/i9 o Ryzen 7/9 recientes',
          why: 'Útil si compilas, usas varios programas y chat local pesado a la vez.'
        },
        {
          role: 'Disco',
          suggestion: 'SSD NVMe 2 TB (o 1 TB sistema + 1 TB modelos)',
          why: 'Muchos checkpoints, LoRAs y pesos de música.'
        },
        {
          role: 'Fuente y refrigeración',
          suggestion: 'Fuente de calidad 750–1000 W + buen flujo de aire',
          why: 'Generar rato largo calienta; mejor evitar thermal throttle.'
        }
      ],
      fitsTogether:
        '16+ GB VRAM + 64 GB RAM + NVMe grande. Sigue siendo un PC de escritorio normal, no un servidor: prioriza GPU NVIDIA reciente con mucha VRAM y RAM abundante en dual channel.'
    }
  ]
}

function compareToBuilds(hw: HwSnapshot): { vsRecommended: string; vsMax: string } {
  const ram = hw.totalMemoryGB || 0
  const vram = hw.vramGB

  let vsRecommended: string
  if (vram != null && vram >= 10 && ram >= 32) {
    vsRecommended =
      'Estás en el rango del equipo recomendado o por encima en lo importante (GPU/RAM). Puedes usar la app con soltura.'
  } else if (vram != null && vram >= 8 && ram >= 16) {
    vsRecommended =
      'Cerca del recomendado: imágenes y chat bien; música mejor por turnos y con modelo ligero. Subir a 32 GB RAM ayuda mucho si aún tienes 16.'
  } else if (vram != null && vram >= 6) {
    vsRecommended =
      'Por debajo del recomendado en GPU o RAM. La app funciona, pero con límites (modelos más pequeños, una capa creativa a la vez).'
  } else {
    vsRecommended =
      'Aún no llegas al equipo recomendado para creativo local. Chat en la nube + imagen nube son la vía más fiable; el Asistente te guía.'
  }

  let vsMax: string
  if (vram != null && vram >= 16 && ram >= 48) {
    vsMax =
      'Muy cerca del “máximo”: puedes exigir más a SDXL y modelos grandes; la app igual reparte capas para no saturar.'
  } else if (vram != null && vram >= 12 && ram >= 32) {
    vsMax =
      'Buen PC de casa, no hace falta el tope de gama. El “máximo” sería más VRAM (16 GB+) y 64 GB RAM para menos restricciones.'
  } else {
    vsMax =
      'El máximo de la app pide sobre todo más memoria de vídeo (16 GB+) y 64 GB de RAM. No es obligatorio: el modo recomendado ya se disfruta mucho.'
  }

  return { vsRecommended, vsMax }
}

export function buildSystemCapabilityReport(hw: HwSnapshot): SystemCapabilityReport {
  const ram = hw.totalMemoryGB || 0
  const vram = hw.vramGB
  const gpu = (hw.gpuName || '').trim()
  const discrete = hw.hasDiscreteGpu === true || (vram != null && vram >= 4)
  const cores = hw.cpuCores || 0

  const hardwareLines: string[] = [
    `Memoria RAM: ${ram ? `${ram} GB` : 'no detectada'}`,
    `Procesador: ${cores ? `${cores} núcleos` : 'no detectado'} (${hw.architecture || '?'})`,
    gpu
      ? `Tarjeta gráfica: ${gpu}${vram != null ? ` · ${vram} GB de memoria de vídeo (VRAM)` : ''}`
      : vram != null
        ? `Memoria de vídeo (VRAM): ${vram} GB`
        : 'Tarjeta gráfica: no detectada con claridad (la app usará modos seguros)'
  ]

  const chat: CapabilityItem = (() => {
    if (ram >= 32)
      return {
        id: 'chat',
        title: 'Chat (hablar con la IA)',
        level: 'excellent',
        summary: 'Puedes usar modelos locales cómodos y también la nube.',
        tip: 'En local, modelos de 7B–14B suelen ir fluidos con esta RAM.'
      }
    if (ram >= 16)
      return {
        id: 'chat',
        title: 'Chat (hablar con la IA)',
        level: 'good',
        summary: 'Chat local y en la nube van bien. Prefiere modelos medianos en local.',
        tip: 'Recomendado en local: modelos ~3B–8B (más ligeros = respuestas más rápidas).'
      }
    if (ram >= 8)
      return {
        id: 'chat',
        title: 'Chat (hablar con la IA)',
        level: 'limited',
        summary: 'El chat funciona; en local usa modelos pequeños o prioriza la nube.',
        tip: 'Modelos grandes en local pueden ir lentos o quedarse sin memoria.'
      }
    return {
      id: 'chat',
      title: 'Chat (hablar con la IA)',
      level: 'limited',
      summary: 'Mejor usar proveedores en la nube; el PC tiene poca RAM para modelos locales grandes.',
      tip: 'Configura una clave en Ajustes → Proveedores (Groq, OpenRouter, etc.).'
    }
  })()

  const image: CapabilityItem = (() => {
    if (!discrete && (vram == null || vram < 4))
      return {
        id: 'image',
        title: 'Imágenes en el PC (Forge / Stable Diffusion)',
        level: 'not_recommended',
        summary: 'Sin GPU dedicada suficiente, las imágenes locales serán muy lentas o no arrancarán.',
        tip: 'Puedes generar con opciones en la nube (Pollinations, Cloudflare) si las activas.'
      }
    if (vram != null && vram < 6)
      return {
        id: 'image',
        title: 'Imágenes en el PC (Forge / Stable Diffusion)',
        level: 'limited',
        summary: 'Puede generar, pero solo con modelos ligeros y tamaños moderados.',
        tip: 'Usa Stable Diffusion 1.5, no SDXL. Cierra otras apps pesadas al generar.'
      }
    if (vram != null && vram < 10)
      return {
        id: 'image',
        title: 'Imágenes en el PC (Forge / Stable Diffusion)',
        level: 'good',
        summary: 'Buen equipo para fotos realistas con SD 1.5 y algunos modelos medianos.',
        tip: 'SDXL puede ir justo; SD 1.5 + buenos checkpoints es la opción más estable.'
      }
    if (vram != null && vram >= 10)
      return {
        id: 'image',
        title: 'Imágenes en el PC (Forge / Stable Diffusion)',
        level: 'excellent',
        summary: 'Excelente para generar imágenes locales con calidad alta.',
        tip: 'Puedes probar SDXL con cuidado; la app prioriza calidad y estabilidad.'
      }
    return {
      id: 'image',
      title: 'Imágenes en el PC (Forge / Stable Diffusion)',
      level: 'limited',
      summary: 'No medimos bien la GPU; la app probará modos seguros.',
      tip: 'Si al generar falla, usa modo nube o revisa Capas → Forge.'
    }
  })()

  const music: CapabilityItem = (() => {
    if (vram != null && vram < 6)
      return {
        id: 'music',
        title: 'Música en el PC (ACE-Step)',
        level: 'not_recommended',
        summary: 'Hace falta más memoria de vídeo para música local decente.',
        tip: 'Puedes pedir letras y ideas al chat; la generación local puede no estar disponible.'
      }
    if (vram != null && vram < 10)
      return {
        id: 'music',
        title: 'Música en el PC (ACE-Step)',
        level: 'limited',
        summary: 'Música local posible en modo ligero; no uses Forge e imágenes a la vez.',
        tip: 'La app pausa la capa de imágenes al generar música para liberar memoria.'
      }
    if (vram != null && vram >= 10 && ram >= 16)
      return {
        id: 'music',
        title: 'Música en el PC (ACE-Step)',
        level: 'good',
        summary: 'Música local viable. Mejor con el modelo ligero (0.6B) y sin Forge abierto.',
        tip: 'Si Windows avisa de “archivo de paginación”, cierra Forge u otras apps al generar.'
      }
    if (vram != null && vram >= 16 && ram >= 24)
      return {
        id: 'music',
        title: 'Música en el PC (ACE-Step)',
        level: 'excellent',
        summary: 'Equipo holgado para música local y capas más exigentes.',
        tip: 'Aun así la app evita cargar imagen y música pesada al mismo tiempo.'
      }
    return {
      id: 'music',
      title: 'Música en el PC (ACE-Step)',
      level: 'limited',
      summary: 'Se intentará el modo más ligero; depende de la GPU real.',
      tip: 'Genera música cuando no estés creando imágenes.'
    }
  })()

  const multi: CapabilityItem = {
    id: 'layers',
    title: 'Usar imagen y música a la vez',
    level:
      vram != null && vram >= 20
        ? 'good'
        : vram != null && vram >= 12
          ? 'limited'
          : 'not_recommended',
    summary:
      vram != null && vram >= 20
        ? 'Hay margen, pero la app igual reparte las capas para no saturar el PC.'
        : 'No es recomendable tener las dos capas pesadas activas juntas.',
    tip: 'KawaiiGPT activa solo una capa “pesada” según lo que pidas (canción o imagen).'
  }

  const capabilities = [chat, image, music, multi]
  const overallLevel = minLevel(...capabilities.map((c) => c.level))

  const headline =
    overallLevel === 'excellent'
      ? 'Tu PC está muy bien preparado para KawaiiGPT'
      : overallLevel === 'good'
        ? 'Tu PC puede aprovechar bien la app'
        : overallLevel === 'limited'
          ? 'Tu PC puede usar la app con algunos límites'
          : 'Tu PC usará sobre todo modos ligeros o en la nube'

  const overallBlurb =
    overallLevel === 'excellent'
      ? 'Chat, imágenes y música local son realistas si dejas que la app gestione las capas.'
      : overallLevel === 'good'
        ? 'Disfrutarás chat e imágenes; la música local funciona mejor sin generar fotos a la vez.'
        : overallLevel === 'limited'
          ? 'Prioriza chat y una sola función creativa cada vez. La nube ayuda cuando el PC va justo.'
          : 'Te recomendamos chat en la nube y generar creativo con calma, una cosa cada vez.'

  const productStack: ProductStackItem[] = [
    {
      name: 'Ollama (chat local)',
      role: 'Hablar sin internet obligatorio',
      note:
        ram >= 16
          ? 'Compatible. Modelos sugeridos: Qwen2.5 3B–7B o Llama 3.x medianos.'
          : 'Compatible con modelos pequeños (2B–3B) o usa nubes gratuitas/rápidas (Groq, etc.).'
    },
    {
      name: 'Forge + Stable Diffusion',
      role: 'Imágenes en el PC',
      note:
        vram != null && vram >= 6
          ? 'Compatible. Mejor SD 1.5 / Realistic Vision; SDXL solo si tienes ≥8–10 GB libres.'
          : 'Mejor usar generadores en la nube desde la app.'
    },
    {
      name: 'ACE-Step (música)',
      role: 'Canciones / instrumentales locales',
      note:
        vram != null && vram >= 6
          ? 'Compatible en modo ligero (modelo 0.6B). No lo uses a la vez que Forge.'
          : 'Probablemente no cómodo en este equipo.'
    },
    {
      name: 'Proveedores en la nube',
      role: 'Chat e imágenes por internet',
      note: 'Siempre compatibles si tienes clave (OpenRouter, Groq, Gemini, OpenAI, Cloudflare…). Ideal como respaldo.'
    }
  ]

  const { vsRecommended, vsMax } = compareToBuilds(hw)

  const tips = [
    'No hace falta ser experto: el Asistente y Ajustes te guían paso a paso.',
    'Pide una cosa creativa a la vez (“una imagen” o “una canción”), no las dos juntas.',
    'Si montas o amplías el PC, mira la sección “PCs que encajan con la app”: GPU y RAM deben ir a la par.',
    'Si algo falla al generar, cierra otras apps pesadas y reintenta; la app avisa cuando cambia de capa.',
    'El chat puede seguir usándose mientras una capa arranca (a veces tarda un minuto la primera vez).',
    ram >= 32 && (vram == null || vram < 8)
      ? 'Tienes mucha RAM: el cuello de botella suele ser la tarjeta gráfica, no la memoria del sistema.'
      : 'Asegúrate de que Windows tenga archivo de paginación suficiente si generas música o imágenes grandes.'
  ].filter(Boolean) as string[]

  return {
    headline,
    overallLevel,
    overallBlurb,
    hardwareLines,
    vsRecommended,
    vsMax,
    capabilities,
    productStack,
    hardwareBuilds: getHardwareBuildTiers(),
    tips
  }
}

export function levelLabelEs(level: CapabilityLevel): string {
  switch (level) {
    case 'excellent':
      return 'Excelente'
    case 'good':
      return 'Bien'
    case 'limited':
      return 'Con límites'
    case 'not_recommended':
      return 'No recomendado'
  }
}

export function levelEmoji(level: CapabilityLevel): string {
  switch (level) {
    case 'excellent':
      return '🟢'
    case 'good':
      return '🟡'
    case 'limited':
      return '🟠'
    case 'not_recommended':
      return '⚪'
  }
}
