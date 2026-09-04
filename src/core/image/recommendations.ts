
import type { ImageProviderMode } from './types'

export interface ImageHardwareHints {
  totalMemoryGB: number
  vramGB?: number | null
  hasDiscreteGpu?: boolean | null
  gpuName?: string | null
}

export interface ImageStackRecommendation {
  preferLocal: boolean
  localTier: 'none' | 'sd15' | 'sdxl' | 'sdxl-comfortable'
  suggestedSize: { width: number; height: number }
  maxSteps: number
  warnings: string[]
  summary: string
}

export function recommendImageStack(hw: ImageHardwareHints): ImageStackRecommendation {
  const warnings: string[] = []
  const vram = hw.vramGB
  const discrete = hw.hasDiscreteGpu

  if (vram == null && discrete !== true) {
    warnings.push('No se detectó GPU dedicada; usa cloud (Pollinations) por defecto.')
    return {
      preferLocal: false,
      localTier: 'none',
      suggestedSize: { width: 768, height: 768 },
      maxSteps: 20,
      warnings,
      summary: 'Solo cloud recomendado (sin GPU clara).'
    }
  }

  const v = vram ?? (discrete ? 6 : 0)

  if (v < 4) {
    warnings.push('VRAM baja: evita Stable Diffusion local.')
    return {
      preferLocal: false,
      localTier: 'none',
      suggestedSize: { width: 512, height: 512 },
      maxSteps: 15,
      warnings,
      summary: 'Cloud only — VRAM insuficiente para SD local.'
    }
  }

  if (v < 8) {
    return {
      preferLocal: true,
      localTier: 'sd15',
      suggestedSize: { width: 512, height: 512 },
      maxSteps: 22,
      warnings: ['Ideal: SD 1.5 a 512px. SDXL puede fallar por memoria.'],
      summary: 'Local viable: Stable Diffusion 1.5 (512×512).'
    }
  }

  if (v < 12) {
    return {
      preferLocal: true,
      localTier: 'sdxl',
      suggestedSize: { width: 768, height: 768 },
      maxSteps: 25,
      warnings: ['SDXL posible; usa medvram en WebUI si hay OOM.'],
      summary: 'Local: SDXL a 768px o SD 1.5 cómodo.'
    }
  }

  return {
    preferLocal: true,
    localTier: 'sdxl-comfortable',
    suggestedSize: { width: 1024, height: 1024 },
    maxSteps: 28,
    warnings: [],
    summary: 'Local holgado: SDXL 1024×1024.'
  }
}

export function resolveImageRoute(
  mode: ImageProviderMode,
  localHealthy: boolean,
  hw: ImageHardwareHints
): 'pollinations' | 'a1111' | 'none' {
  if (mode === 'off') return 'none'
  const rec = recommendImageStack(hw)
  if (mode === 'cloud') return 'pollinations'
  if (mode === 'local') return localHealthy ? 'a1111' : 'none'
  // smart
  if (localHealthy && rec.preferLocal) return 'a1111'
  return 'pollinations'
}
