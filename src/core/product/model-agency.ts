/**
 * PRODUCT LAW — models do the heavy cognitive work; the app is the agent between them and the user.
 * Does not conflict with HUMAN_PRIORITY: the model speaks/reasons; the app routes, tools, and stays out of the way.
 * @see docs/HUMAN-PRIORITY.md
 * @see docs/MODEL-AGENCY.md
 */
export const MODEL_AGENCY = {
  law:
    'Aprovechar al máximo cada modelo (razonar, codificar, visión, herramientas). La app es un agente entre el modelo y el usuario, no un sustituto de su inteligencia.',
  principles: [
    'Preferir que el modelo razone y decida en lenguaje natural antes de hardcodear ramas rígidas.',
    'Si el modelo tiene visión, usarla para imágenes/archivos en lugar de solo metadatos de la app.',
    'Si puede usar herramientas, exponer tools claras y dejar que elija; no fingir el resultado en plantillas.',
    'Ruteo inteligente: el modelo adecuado a la tarea (código, visión, chat, razonamiento), no siempre el mismo.',
    'La app prepara contexto, memoria, tools y seguridad; el modelo interpreta y responde.',
  ],
  /** Injected near system context when relevant */
  llmHint:
    'Eres capaz de razonar con cuidado. Usa esa capacidad cuando haga falta (dudas, planes, código, imágenes). No te limites a frases vacías si puedes analizar o proponer algo concreto.',
} as const

export type ModelAgency = typeof MODEL_AGENCY
