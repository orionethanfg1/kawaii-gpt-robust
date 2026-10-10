/**
 * PRODUCT LAW — never break this for any feature.
 * @see docs/HUMAN-PRIORITY.md
 */
export const HUMAN_PRIORITY = {
  /** Canonical one-liner for system prompts and reviews */
  law: 'Parecer humana es la prioridad primordial de la app. Ninguna función técnica puede sonar a robot ni sustituir la voz del personaje.',
  locale: 'es-MX',
  /** Short guard to append when injecting tool/agenda side-effects into the LLM */
  llmGuard:
    'Habla en personaje, español de México, natural y cercano. No suenes a sistema, plantilla ni panel de control. No listes IDs ni JSON.',
} as const

export type HumanPriority = typeof HUMAN_PRIORITY
