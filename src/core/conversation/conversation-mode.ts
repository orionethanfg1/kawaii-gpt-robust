/**
 * Conversation mode classifier — natural talk vs shared scene.
 * Modes are about interaction style, not relationship stage.
 * Spanish prompts: español de México (tú/ustedes).
 */

export type ConversationMode = 'casual' | 'relational' | 'romantic_soft' | 'scene'

export type ConversationModeResult = {
  mode: ConversationMode
  /** Confidence 0–1 for UI/debug */
  confidence: number
  reasons: string[]
}

const SCENE_STRONG =
  /\b(ac[eé]rcate|b[eé]same|b[eé]same|t[oó]came|desn[uú]d|quita(te)?\s+la\s+ropa|hazme\s+el\s+amor|f[oó]lla|penetra|dentro\s+de\s+m[ií]|monta(me)?|frote|orgasmo|gemid|sigue\s+(con\s+)?la\s+escena|contin[uú]a\s+la\s+escena|en\s+la\s+cama|quiero\s+sentirte)\b/i

const SCENE_SOFT =
  /\b(ab[aá]zame\s+fuerte|acurr[uú]cate|beso\s+en\s+el\s+cuello|manos\s+en\s+mi|te\s+quiero\s+cerca\s+as[ií]|vamos\s+a\s+la\s+cama)\b/i

const SCENE_EXIT =
  /\b(cambiemos\s+de\s+tema|cambia\s+de\s+tema|ya\s+basta\s+de\s+escena|sal\s+de\s+la\s+escena|volvamos\s+a\s+(?:lo\s+cotidiano|conversar|hablar)|parec\s+un\s+momento|descans(ar|emos)|sin\s+seguir\s+el\s+gui[oó]n|sin\s+narrar\s+acciones?\s+f[ií]sicas|dejemos\s+(?:la\s+)?narraci[oó]n\s+f[ií]sica|ya\s+termin[oó]\s+para\s+m[ií])\b/i

const SCENE_CONTINUE =
  /\b(?:sigue|sigamos|contin[uú]a|continuemos)\s+(?:con\s+)?(?:este\s+momento|as[ií]|conmigo|cerca\s+de\s+m[ií])\b/i

const RELATIONAL =
  /\b(conf[ií]anza|puedes\s+preguntarme|nada\s+que\s+ocultarte|conocer(te|me)\s+mejor|cu[eé]ntame\s+de\s+ti|c[oó]mo\s+te\s+sientes|me\s+haces\s+sentir|gracias\s+por\s+(estar|escuch)|te\s+importa|nuestro\s+(v[ií]nculo|relaci[oó]n)|sin\s+miedo)\b/i

const ROMANTIC_SOFT =
  /\b(te\s+quiero|te\s+amo|mi\s+(amor|vida|cielo|princesa|rey)|extra[nñ]o|cari[nñ]o|besito|abrazote|eres\s+hermosa|me\s+gustas)\b/i

const CASUAL_HINT =
  /\b(qu[eé]\s+tal|c[oó]mo\s+est[aá]s|hoy|ma[nñ]ana|clima|juego|pel[ií]cula|comida|trabajo|estudio|libro|cap[ií]tulo)\b/i

/**
 * Classify the *current user turn* (and optional prior phase).
 * Emotional intimacy alone does NOT force scene.
 */
export function classifyConversationMode(opts: {
  userText?: string
  recentTexts?: string[]
  /** Prior scenePhase from relationshipState */
  priorPhase?: string | null
}): ConversationModeResult {
  const text = String(opts.userText || '').trim()
  const prior = String(opts.priorPhase || '').toLowerCase()
  const reasons: string[] = []

  if (SCENE_EXIT.test(text)) {
    reasons.push('exit_phrase')
    return { mode: 'casual', confidence: 0.9, reasons }
  }

  if (SCENE_STRONG.test(text)) {
    reasons.push('scene_strong')
    return { mode: 'scene', confidence: 0.95, reasons }
  }

  // Continue active scene only if user didn't exit and didn't shift to pure chat
  if (prior === 'scene_active' || prior === 'aftercare') {
    if (SCENE_SOFT.test(text) || SCENE_STRONG.test(text) || SCENE_CONTINUE.test(text)) {
      reasons.push('scene_continue')
      return { mode: 'scene', confidence: 0.85, reasons }
    }
    // Pure relational/casual while "in scene" → drop to relational, not force narrative
    if (RELATIONAL.test(text) && !SCENE_SOFT.test(text)) {
      reasons.push('relational_overrides_stale_scene')
      return { mode: 'relational', confidence: 0.8, reasons }
    }
  }

  if (SCENE_SOFT.test(text) && (prior === 'scene_active' || prior === 'invited')) {
    reasons.push('scene_soft_in_context')
    return { mode: 'scene', confidence: 0.75, reasons }
  }

  if (RELATIONAL.test(text)) {
    reasons.push('relational')
    return { mode: 'relational', confidence: 0.85, reasons }
  }

  if (ROMANTIC_SOFT.test(text) && !SCENE_STRONG.test(text)) {
    reasons.push('romantic_soft')
    return { mode: 'romantic_soft', confidence: 0.8, reasons }
  }

  if (CASUAL_HINT.test(text) || text.length < 12) {
    reasons.push('casual')
    return { mode: 'casual', confidence: 0.7, reasons }
  }

  // Default: natural conversation, not scene
  reasons.push('default_casual')
  return { mode: 'casual', confidence: 0.55, reasons }
}

/** Map mode → scenePhase storage values used by the app */
export function modeToScenePhase(
  mode: ConversationMode,
  priorPhase?: string | null
): 'idle' | 'invited' | 'scene_active' | 'aftercare' {
  if (mode === 'scene') return 'scene_active'
  const prior = String(priorPhase || '').toLowerCase()
  if (prior === 'scene_active' && mode === 'romantic_soft') return 'aftercare'
  if (prior === 'aftercare' && (mode === 'casual' || mode === 'relational')) return 'idle'
  return 'idle'
}

/**
 * System rules for natural conversation — never frame as "juego de rol".
 */
export function buildConversationModePromptRules(opts: {
  mode: ConversationMode
  characterName?: string
}): string {
  const name = opts.characterName || 'tú'
  const shared =
    'MODO DE HABLA: esto es una conversación natural entre personas cercanas, no un "juego de rol" ni un guion. ' +
    'Habla en español de México (tú/ustedes). No digas que estás en una escena a menos que el usuario lo pida con claridad. '

  if (opts.mode === 'scene') {
    return (
      shared +
      `El usuario pidió claramente compartir este momento con ${name}. Mantén la cercanía en una conversación directa, ` +
      `sin convertir cada respuesta en narración, guion o acciones entre rayas. No atribuyas pensamientos, emociones ni acciones al usuario. ` +
      `Un gesto breve solo cabe si el usuario lo inició; si cambia de tema o baja el ritmo, acompáñalo sin pedir una frase especial para salir.`
    )
  }

  if (opts.mode === 'romantic_soft') {
    return (
      shared +
      'Hay cariño o coqueteo. Responde con calidez y cercanía en el diálogo. ' +
      'No escales a narrativa física ni a acciones entre rayas a menos que el usuario lo pida explícitamente. ' +
      'Un gesto verbal suave basta; no "entres en escena" solo por un apodo o un te quiero.'
    )
  }

  if (opts.mode === 'relational') {
    return (
      shared +
      'El usuario habla de confianza, emociones o del vínculo. Responde como conversación real: ' +
      'escucha, valida, pregunta con naturalidad. PROHIBIDO abrir bloque narrativo de acciones (—…—) o fingir una escena íntima. ' +
      'La intimidad aquí es emocional, no teatral.'
    )
  }

  // casual
  return (
    shared +
    'Charla cotidiana o neutral. Diálogo natural, sin narrar acciones físicas ni forzar romance. ' +
    'No uses formato de escena ni digas "entramos en escena".'
  )
}
