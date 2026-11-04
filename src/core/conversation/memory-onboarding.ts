/**
 * M2 — Soft onboarding when user memory is sparse.
 * One question per turn; chips + free text; never a rigid form dump.
 */

import type { UserMemory } from './user-memory'
import { isUserMemorySparse } from './dual-memory'
import { mergeUserMemory, type ExtractedFacts } from './user-memory'

export type OnboardingStep = 'name' | 'nickname' | 'like' | 'dislike' | 'done'

export type MemoryOnboardingState = {
  active?: boolean
  step?: OnboardingStep
  /** User chose to skip the whole flow */
  dismissed?: boolean
  updatedAt?: number
}

export type OnboardingChip = {
  id: string
  label: string
  /** Value written into memory */
  value: string
}

const STEP_ORDER: OnboardingStep[] = ['name', 'nickname', 'like', 'dislike', 'done']

export function nextStep(current: OnboardingStep | undefined): OnboardingStep {
  const i = STEP_ORDER.indexOf(current || 'name')
  if (i < 0) return 'name'
  return STEP_ORDER[Math.min(i + 1, STEP_ORDER.length - 1)]
}

/** Derive step from what is already known (idempotent). */
export function inferStepFromMemory(mem?: UserMemory | null): OnboardingStep {
  if (!mem || isUserMemorySparse(mem)) {
    if (!(mem?.preferredName || '').trim()) return 'name'
  }
  if (!(mem?.preferredName || '').trim()) return 'name'
  if (!(mem?.nicknames?.length || mem?.preferredName)) return 'nickname'
  // if they set preferredName, nickname step can still offer an affectionate form
  if (!(mem?.likes?.length)) return 'like'
  if (!(mem?.dislikes?.length)) return 'dislike'
  return 'done'
}

export function shouldRunOnboarding(opts: {
  userMemory?: UserMemory | null
  onboarding?: MemoryOnboardingState | null
  /** true while restore banner is unresolved */
  memoryGatePending?: boolean
}): boolean {
  if (opts.memoryGatePending) return false
  if (opts.onboarding?.dismissed) return false
  if (opts.onboarding?.step === 'done') return false
  if (!isUserMemorySparse(opts.userMemory) && opts.onboarding?.active !== true) {
    // rich memory and not mid-flow
    const step = inferStepFromMemory(opts.userMemory)
    return step !== 'done' && opts.onboarding?.active === true
  }
  // sparse: run unless dismissed
  if (isUserMemorySparse(opts.userMemory)) return true
  // mid-flow with partial data
  return opts.onboarding?.active === true && (opts.onboarding?.step || 'name') !== 'done'
}

export function chipsForStep(step: OnboardingStep): OnboardingChip[] {
  switch (step) {
    case 'name':
      return []
    case 'nickname':
      return [
        { id: 'skip-nick', label: 'Solo mi nombre', value: '__skip__' },
        { id: 'amor', label: 'Amor', value: 'amor' },
        { id: 'cariño', label: 'Cariño', value: 'cariño' }
      ]
    case 'like':
      return [
        { id: 'cafe', label: 'Café', value: 'café' },
        { id: 'musica', label: 'Música', value: 'música' },
        { id: 'leer', label: 'Leer', value: 'leer' },
        { id: 'juegos', label: 'Juegos', value: 'juegos' }
      ]
    case 'dislike':
      return [
        { id: 'madrugar', label: 'Madrugar', value: 'madrugar' },
        { id: 'ruido', label: 'Ruido fuerte', value: 'ruido fuerte' },
        { id: 'espera', label: 'Esperar mucho', value: 'esperar mucho' }
      ]
    default:
      return []
  }
}

export function promptHintForStep(step: OnboardingStep): string {
  switch (step) {
    case 'name':
      return 'Pregunta con naturalidad cómo se llama (una sola pregunta). No listes un formulario.'
    case 'nickname':
      return 'Pregunta si prefiere un apodo o que uses solo su nombre. Una pregunta, tono cercano.'
    case 'like':
      return 'Pregunta un gusto simple (comida, hobby, etc.). Una sola pregunta.'
    case 'dislike':
      return 'Pregunta algo que no le guste, sin presión. Una pregunta.'
    default:
      return 'Ya conoces lo básico; conversa con normalidad.'
  }
}

export function buildOnboardingSystemPrompt(step: OnboardingStep): string {
  if (step === 'done') return ''
  return (
    'Estás conociendo a esta persona (memoria de usuario casi vacía). ' +
    promptHintForStep(step) +
    ' No digas que estás en un "modo onboarding". ' +
    'Tu rol de personaje (p. ej. novia) es la meta del vínculo, no un pasado inventado: puedes ser cariñosa, pero aún no conoces su nombre ni su historia. ' +
    'UNA sola respuesta breve y coherente: no repitas el mismo saludo ni el mismo bloque de texto. ' +
    'No ofrezcas generar fotos salvo que lo pida.'
  )
}

/** Apply a chip value to user memory + advance step */
export function applyOnboardingChip(
  mem: UserMemory | null | undefined,
  step: OnboardingStep,
  value: string
): { memory: UserMemory; step: OnboardingStep; patch: ExtractedFacts } {
  const patch: ExtractedFacts = {}
  if (value === '__skip__') {
    return {
      memory: mergeUserMemory(mem, {}),
      step: nextStep(step),
      patch: {}
    }
  }
  if (step === 'name') {
    patch.preferredName = value.trim().slice(0, 40)
  } else if (step === 'nickname') {
    patch.nicknames = [value.trim().slice(0, 32)]
    // optional: also preferred address
  } else if (step === 'like') {
    patch.likes = [value.trim().slice(0, 48)]
  } else if (step === 'dislike') {
    patch.dislikes = [value.trim().slice(0, 48)]
  }
  const memory = mergeUserMemory(mem, patch)
  let newStep = nextStep(step)
  // if name was set via chip empty path shouldn't happen
  if (step === 'name' && patch.preferredName) newStep = 'nickname'
  return { memory, step: newStep, patch }
}

/** After free-text extract, advance onboarding step if signal matched */
export function advanceOnboardingAfterExtract(
  step: OnboardingStep,
  patch: ExtractedFacts
): OnboardingStep {
  if (step === 'name' && patch.preferredName) return 'nickname'
  if (step === 'nickname' && (patch.nicknames?.length || patch.preferredName)) return 'like'
  if (step === 'like' && patch.likes?.length) return 'dislike'
  if (step === 'dislike' && patch.dislikes?.length) return 'done'
  // facts alone don't skip name
  return step
}

export function initialOnboardingState(mem?: UserMemory | null): MemoryOnboardingState {
  if (!isUserMemorySparse(mem)) {
    return { active: false, step: 'done', updatedAt: Date.now() }
  }
  return {
    active: true,
    step: inferStepFromMemory(mem),
    dismissed: false,
    updatedAt: Date.now()
  }
}
