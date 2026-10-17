/**
 * Fase 6 — User-facing labels for image jobs (progress + errors).
 * Keeps technical dumps out of the chat bubble when possible.
 */

import type { ImageGenJobPhase } from './gen-contract'
import { classifyGenFailureCode, isRetryableImageMessage } from './gen-contract'

const PHASE_ES: Record<ImageGenJobPhase, string> = {
  queued: 'En cola…',
  resolve_runtime: 'Preparando motor de imagen…',
  unload_llm: 'Liberando memoria del chat…',
  validate_payload: 'Comprobando prompt y referencias…',
  txt2img: 'Dibujando…',
  save: 'Guardando…',
  fallback_cloud: 'Probando proveedor alternativo…',
  done: 'Listo',
  error: 'Error'
}

export function labelForImagePhase(phase: string | undefined, detail?: string): string {
  const p = String(phase || '').toLowerCase() as ImageGenJobPhase
  const d = String(detail || '').trim()
  // Soften raw technical lines first
  if (/faceid|ip-adapter/i.test(d)) {
    return p && PHASE_ES[p] ? `${PHASE_ES[p]} · identidad` : 'Anclando identidad (FaceID)…'
  }
  if (p && PHASE_ES[p]) {
    const base = PHASE_ES[p]
    if (
      d &&
      d.length < 80 &&
      !/lora|controlnet|sdapi|checkpoint|weight|batch=/i.test(d)
    ) {
      return `${base} ${d}`
    }
    return base
  }
  if (!d) return 'Generando imagen…'
  if (/forge|sdapi|a1111/i.test(d)) return 'Conectando con Forge…'
  if (/pollinations|cloudflare|openai/i.test(d)) return 'Proveedor en la nube…'
  if (/batch/i.test(d)) return 'Variantes…'
  if (d.length > 90) return d.slice(0, 87) + '…'
  return d
}

export function formatImageProgressLabel(pct: number, detail?: string, phase?: string): string {
  const base = labelForImagePhase(phase, detail)
  const n = Math.max(0, Math.min(100, Math.round(pct || 0)))
  if (n <= 0) return base
  return `${base} · ${n}%`
}

export type HumanImageError = {
  title: string
  hint: string
  retryable: boolean
  code: string
}

export function humanizeImageError(raw: unknown): HumanImageError {
  const msg = String(
    typeof raw === 'string'
      ? raw
      : raw && typeof raw === 'object' && 'message' in (raw as object)
        ? (raw as { message?: string }).message
        : raw || ''
  ).slice(0, 500)
  const code = classifyGenFailureCode(msg)
  const retryable = isRetryableImageMessage(msg)

  if (code === 'IMAGE_CANCELLED') {
    return {
      title: 'Generación cancelada',
      hint: 'Puedes pedir otra imagen cuando quieras.',
      retryable: false,
      code
    }
  }
  if (code === 'IMAGE_TIMEOUT') {
    return {
      title: 'Se agotó el tiempo',
      hint: 'Prueba perfil Fast, baja resolución o reinicia Forge.',
      retryable: true,
      code
    }
  }
  if (code === 'IMAGE_BACKEND_DOWN') {
    return {
      title: 'Forge no responde',
      hint: 'Ajustes → Capas → Arrancar Forge, o di «arranca la capa de imagen».',
      retryable: true,
      code
    }
  }
  if (code === 'IMAGE_UNSUPPORTED_HW') {
    return {
      title: 'Sin memoria de GPU/RAM',
      hint: 'Cierra otros modelos, usa perfil Fast o un checkpoint más ligero.',
      retryable: true,
      code
    }
  }
  if (/faceid|controlnet|postprocess|keyerror/i.test(msg)) {
    return {
      title: 'Falló el anclaje de identidad',
      hint: 'Di «instala FaceID» o reintenta; la app fuerza batch=1 en autorretrato.',
      retryable: true,
      code: String(code)
    }
  }
  if (/invalid prompt|prompt vacío/i.test(msg)) {
    return {
      title: 'Prompt vacío o inválido',
      hint: 'Describe un poco más la escena o el look.',
      retryable: false,
      code: String(code)
    }
  }
  return {
    title: 'No pude generar la imagen',
    hint: msg.slice(0, 160) || 'Revisa Forge o prueba de nuevo en unos segundos.',
    retryable,
    code: String(code)
  }
}

export function formatHumanImageErrorLine(err: HumanImageError): string {
  return `${err.title}. ${err.hint}`
}
