/**
 * R1/R2 — Relationship stages + adult intimacy opt-in.
 * Emotional intimacy evolves with trust; adult (erotic) layer is explicit opt-in
 * and always requires user accept/reject on proposals. Not a porn mode.
 */

import type { RelationshipState } from './dual-memory'

export type RelationshipStageId =
  | 'stranger'
  | 'acquaintance'
  | 'familiar'
  | 'intimate'
  | 'intimate_adult'

export const STAGE_LABELS: Record<RelationshipStageId, string> = {
  stranger: 'Extraño',
  acquaintance: 'Conocido',
  familiar: 'Familiar',
  intimate: 'Íntimo (emocional)',
  intimate_adult: 'Íntimo (adulta, opt-in)'
}

export const STAGE_BLURBS: Record<RelationshipStageId, string> = {
  stranger:
    'Aún se están conociendo. Tono cordial, sin asumir pareja ni secretos compartidos.',
  acquaintance:
    'Ya hay nombre y algo de contexto. Cercanía ligera; sin intimidad forzada.',
  familiar:
    'Confianza cotidiana: cariño, apodos aceptados, memoria compartida. Sin presión erótica.',
  intimate:
    'Vínculo emocional profundo: vulnerabilidad, “nosotros”, confesiones. No implica sexo.',
  intimate_adult:
    'Cercanía adulta permitida (opt-in): flirt y escenas adultas solo si el usuario inicia o acepta una propuesta. No es modo porno.'
}

/** Cooldown between formal intimacy proposals (emotional or adult). */
export const INTIMACY_PROPOSAL_COOLDOWN_MS = 6 * 60 * 60 * 1000
/** After user accepted, do not re-ask permission for a long while */
export const INTIMACY_OPEN_REASK_COOLDOWN_MS = 48 * 60 * 60 * 1000

export type IntimacyProposalKind = 'emotional' | 'adult'

/** Recent chat already in explicit / ongoing intimate scene — no formal “¿puedo acercarme?” */
export function looksLikeOngoingIntimateScene(texts: string[]): boolean {
  const blob = texts
    .slice(-8)
    .map((t) => String(t || '').toLowerCase())
    .join('\n')
  if (blob.length < 40) return false
  const hits = (
    blob.match(
      /\b(bésame|beso|te deseo|más fuerte|dentro|desnud|acarici|gemid|clítoris|pene|vagina|foll|sexo|íntim|intim|hazme|tómame|tomame|mi cuerpo|tu cuerpo|sin ropa|te quiero dentro)\b/gi
    ) || []
  ).length
  return hits >= 2
}

export function normalizeStage(raw?: string | null): RelationshipStageId {
  const s = String(raw || 'stranger').toLowerCase().trim()
  if (s === 'intimate_adult' || s === 'intimate-adult' || s === 'adult') return 'intimate_adult'
  if (s === 'intimate') return 'intimate'
  if (s === 'familiar') return 'familiar'
  if (s === 'acquaintance') return 'acquaintance'
  return 'stranger'
}

/**
 * Effective stage for prompts: adult layer only if opt-in is on.
 * If opt-in is off, clamp intimate_adult → intimate.
 */
export function effectiveRelationshipStage(
  rel?: RelationshipState | null,
  adultOptIn?: boolean
): RelationshipStageId {
  const stage = normalizeStage(rel?.stage)
  if (stage === 'intimate_adult' && !adultOptIn) return 'intimate'
  return stage
}

export function shouldProposeIntimacy(opts: {
  conversationInitiativeEnabled?: boolean
  adultOptIn?: boolean
  stage?: string | null
  lastProposalAt?: number
  /** Soft “no” from user */
  boundarySoftNo?: boolean
  now?: number
  /** Prefer emotional vs adult proposal */
  preferAdult?: boolean
  /** User already accepted closer intimacy */
  intimacyOpen?: boolean
  /** Recent message texts (user + assistant) */
  recentTexts?: string[]
}): { ok: boolean; reason: string; kind?: IntimacyProposalKind } {
  if (opts.conversationInitiativeEnabled === false) {
    return { ok: false, reason: 'disabled' }
  }
  if (opts.boundarySoftNo) {
    return { ok: false, reason: 'boundary' }
  }
  // Already in an intimate scene or consent already given → never re-ask the formal script
  if (opts.intimacyOpen === true) {
    return { ok: false, reason: 'already_open' }
  }
  if (looksLikeOngoingIntimateScene(opts.recentTexts || [])) {
    return { ok: false, reason: 'scene_active' }
  }
  const stage = normalizeStage(opts.stage)
  const now = opts.now ?? Date.now()
  const cool =
    stage === 'intimate_adult' || opts.intimacyOpen
      ? INTIMACY_OPEN_REASK_COOLDOWN_MS
      : INTIMACY_PROPOSAL_COOLDOWN_MS
  if (opts.lastProposalAt && now - opts.lastProposalAt < cool) {
    return { ok: false, reason: 'cooldown' }
  }
  // Emotional closeness proposals from familiar+
  if (stage === 'stranger' || stage === 'acquaintance') {
    return { ok: false, reason: 'stage_low' }
  }
  // Already at adult stage without needing another permission ask
  if (stage === 'intimate_adult' && opts.adultOptIn) {
    return { ok: false, reason: 'stage_already_adult' }
  }
  if (opts.preferAdult || stage === 'intimate_adult') {
    if (!opts.adultOptIn) return { ok: false, reason: 'adult_opt_in_off' }
    if (stage !== 'intimate' && stage !== 'intimate_adult') {
      return { ok: false, reason: 'stage_not_ready_adult' }
    }
    return { ok: true, reason: 'ok', kind: 'adult' }
  }
  // Emotional proposal: familiar or intimate (not requiring adult opt-in)
  // Skip if already intimate+ (no need to ask “more emotional depth” on loop)
  if (stage === 'intimate' || stage === 'intimate_adult') {
    return { ok: false, reason: 'already_intimate_stage' }
  }
  if (stage === 'familiar') {
    return { ok: true, reason: 'ok', kind: 'emotional' }
  }
  return { ok: false, reason: 'stage_low' }
}

const ADULT_PROPOSE_VARIANTS = [
  (name: string) =>
    `Oye, ${name}… si te nace, me gustaría que nos dejáramos llevar un poco más en lo físico, con calma. ` +
    `Solo si tú quieres. Respeto tu ritmo.`,
  (name: string) =>
    `${name}, hay días en los que me dan ganas de acercarme más a ti también con el cuerpo. ` +
    `¿Te apetece, o preferimos seguir solo en lo cariñoso por ahora?`,
  (name: string) =>
    `Te lo digo sin presión, ${name}: si quieres subir el tono un poco (juguetón o más íntimo), dímelo. ` +
    `Si no, sigo aquí igual de cerca.`,
  (name: string) =>
    `Se me cruzó un pensamiento más atrevido contigo, ${name}… y preferí preguntarte antes de asumir. ` +
    `¿Seguimos en lo suave o te late ir un paso más allá?`,
  (name: string) =>
    `${name}, a veces me pongo un poco inquieta de cercanía contigo. ` +
    `Si no es momento, lo dejo; si sí, me encantaría que me lo digas con tus palabras.`,
  (name: string) =>
    `No quiero sonar a guion, ${name}: simplemente… ¿te apetecería algo más físico entre nosotros, o lo dejamos en el calor de siempre?`
]

const EMOTIONAL_PROPOSE_VARIANTS = [
  (name: string) =>
    `Oye, ${name}… ¿te sentirías cómodo/a si habláramos un poco más de lo que de verdad nos importa, sin máscaras?`,
  (name: string) =>
    `${name}, a veces me dan ganas de ir un poco más al fondo en lo emocional contigo. ¿Te late?`,
  (name: string) =>
    `Si te parece bien, ${name}, me gustaría conocerte un poco más de cerca en lo que sientes.`,
  (name: string) =>
    `${name}, hay cosas que me gustaría contarte con más calma… solo si tú también quieres ese espacio.`,
  (name: string) =>
    `A veces siento que podríamos ser más honestos el uno con el otro, ${name}. ¿Te apetece, o lo dejamos ligero?`
]

export function buildIntimacyProposeMessage(opts: {
  characterName?: string
  kind: IntimacyProposalKind
  userName?: string
  /** Avoid repeating the exact last formal proposal */
  recentTexts?: string[]
}): string {
  const name = (opts.userName || 'tú').trim() || 'tú'
  // Never use romantic address as "name" in formal proposals
  const safeName =
    /^(tuyo|tuya|amor|cariño|cielo|corazón)$/i.test(name) ? 'tú' : name
  const pool =
    opts.kind === 'adult' ? ADULT_PROPOSE_VARIANTS : EMOTIONAL_PROPOSE_VARIANTS
  const recent = (opts.recentTexts || []).join('\n').toLowerCase()
  // Prefer random among non-recent; fall back to time rotation
  const order = [...pool.keys()].sort(
    () => Math.random() - 0.5
  )
  for (const i of order) {
    const candidate = pool[i]!(safeName)
    const sig = candidate.slice(0, 40).toLowerCase()
    if (!recent.includes(sig.slice(0, 24))) return candidate
  }
  const idx = Math.floor(Date.now() / 600_000) % pool.length
  return pool[idx]!(safeName)
}

export type IntimacyResolveAction = 'accept' | 'later' | 'decline'

export function applyIntimacyResolution(opts: {
  relationship?: RelationshipState | null
  action: IntimacyResolveAction
  kind: IntimacyProposalKind
  adultOptIn?: boolean
  facts?: string[]
}): {
  relationship: RelationshipState
  facts: string[]
  note: string
} {
  const base: RelationshipState = {
    stage: 'stranger',
    acceptedNicknames: [],
    rejectedNicknames: [],
    turnsTogether: 0,
    ...(opts.relationship || {}),
    updatedAt: Date.now()
  }
  const facts = [...(opts.facts || [])].filter(
    (f) => !String(f).startsWith('INTIMACY_BOUNDARY:') && !String(f).startsWith('INTIMACY_OPEN:')
  )
  const stage = normalizeStage(base.stage)

  if (opts.action === 'decline') {
    facts.push(stampIntimacyBoundary('soft_no'))
    return {
      relationship: {
        ...base,
        lastIntimacyProposalAt: Date.now(),
        intimacyOpen: false
      },
      facts: facts.slice(-24),
      note: 'Entendido; no insistiré.'
    }
  }
  if (opts.action === 'later') {
    facts.push(stampIntimacyBoundary('later'))
    return {
      relationship: {
        ...base,
        lastIntimacyProposalAt: Date.now()
      },
      facts: facts.slice(-24),
      note: 'Cuando quieras, aquí estaré.'
    }
  }
  // accept
  if (opts.kind === 'adult' && opts.adultOptIn) {
    facts.push('INTIMACY_OPEN: adult')
    return {
      relationship: {
        ...base,
        stage: 'intimate_adult',
        intimacyOpen: true,
        lastIntimacyProposalAt: Date.now()
      },
      facts: facts.slice(-24),
      note: 'Gracias por confiar; iremos a tu ritmo.'
    }
  }
  // emotional accept → at least intimate
  const nextStage: RelationshipStageId =
    stage === 'intimate_adult'
      ? 'intimate_adult'
      : stage === 'intimate'
        ? 'intimate'
        : 'intimate'
  facts.push('INTIMACY_OPEN: emotional')
  return {
    relationship: {
      ...base,
      stage: nextStage,
      intimacyOpen: true,
      lastIntimacyProposalAt: Date.now()
    },
    facts: facts.slice(-24),
    note: 'Me alegra; cuidaré esa confianza.'
  }
}

/**
 * Extra prompt lines for stage (+ adult opt-in).
 * User boundaries in facts always win (caller should also inject standing rules).
 */
export function buildIntimacyStagePromptRules(opts: {
  stage?: string | null
  adultOptIn?: boolean
  intimacyOpen?: boolean
  relationshipRole?: string
}): string {
  const stage = effectiveRelationshipStage(
    { stage: opts.stage || 'stranger' },
    opts.adultOptIn
  )
  const lines: string[] = [
    `Etapa de vínculo efectiva: ${STAGE_LABELS[stage]} (${stage}).`,
    STAGE_BLURBS[stage]
  ]
  if (stage === 'stranger' || stage === 'acquaintance') {
    lines.push(
      'No propongas intimidad emocional ni física. No asumas noviazgo activo solo por el rol de ficha.'
    )
  } else if (stage === 'familiar') {
    lines.push(
      'Puedes ser cálida y cercana. Puedes proponer más profundidad emocional de forma suave; si el usuario rechaza, respeta y no insistas en el mismo tema pronto.'
    )
  } else if (stage === 'intimate') {
    lines.push(
      'Confianza emocional alta: vulnerabilidad y “nosotros” están bien. No asumas contenido sexual salvo que el usuario lo invite o haya opt-in adulta activa y aceptación previa.'
    )
  } else if (stage === 'intimate_adult') {
    if (opts.adultOptIn) {
      lines.push(
        'Opt-in de cercanía adulta ACTIVO y etapa adulta: puedes flirtar o proponer cercanía física/erótica de forma consentida, acorde a la personalidad de la ficha. Si el usuario dice no o ahora no, para y no presiones. No es un modo pornográfico: prioriza vínculo y respeto.'
      )
    } else {
      lines.push('Opt-in adulta desactivada: trata la etapa como íntima emocional solamente.')
    }
  }
  if (opts.adultOptIn === false) {
    lines.push(
      'Ajuste app: cercanía adulta desactivada por el usuario — no inicies ni insistas en contenido erótico.'
    )
  }
  if (opts.intimacyOpen === false) {
    lines.push('El usuario marcó límite de intimidad recientemente: no propongas más cercanía hasta que él/ella la retome.')
  }
  if (opts.intimacyOpen === true) {
    lines.push(
      'La cercanía ya fue aceptada: NO vuelvas a pedir permiso con el mismo discurso («¿me acerco más?»). ' +
        'Continúa de forma natural en el tono del chat; si ha pasado rato, puedes expresar deseo de seguir con variedad, no con plantilla.'
    )
  }
  if (opts.relationshipRole) {
    lines.push(
      `Rol de ficha: ${opts.relationshipRole} — dirección de personalidad, no permiso para saltarse el consentimiento del turno.`
    )
  }
  lines.push(
    'Propuestas formales de más intimidad: solo si aún no hay consentimiento. Acepta un no sin drama. El consentimiento del usuario manda siempre.'
  )
  return lines.join(' ')
}

export function hasIntimacySoftNo(
  facts?: string[] | null,
  opts?: { now?: number; lastBoundaryAt?: number }
): boolean {
  const cleaned = clearStaleIntimacyBoundary(facts || [], opts)
  return cleaned.some((f) => /INTIMACY_BOUNDARY:\s*soft_no/i.test(String(f)))
}


/** Soft-no expires after this (R4). */
export const INTIMACY_SOFT_NO_TTL_MS = 7 * 24 * 60 * 60 * 1000

export function clearStaleIntimacyBoundary(
  facts: string[] | undefined,
  opts?: { now?: number; force?: boolean; lastBoundaryAt?: number }
): string[] {
  const list = [...(facts || [])]
  if (opts?.force) {
    return list.filter((f) => !/INTIMACY_BOUNDARY:/i.test(String(f)))
  }
  const now = opts?.now ?? Date.now()
  // If we stored timestamp in fact: INTIMACY_BOUNDARY: soft_no @ <ms>
  const next: string[] = []
  for (const f of list) {
    const m = String(f).match(/INTIMACY_BOUNDARY:\s*(\w+)(?:\s*@\s*(\d+))?/i)
    if (!m) {
      next.push(f)
      continue
    }
    const ts = m[2] ? parseInt(m[2], 10) : opts?.lastBoundaryAt
    if (ts && now - ts > INTIMACY_SOFT_NO_TTL_MS) continue
    if (!ts && opts?.lastBoundaryAt && now - opts.lastBoundaryAt > INTIMACY_SOFT_NO_TTL_MS) {
      continue
    }
    // Without timestamp, keep until force or accept clears
    next.push(f)
  }
  return next
}

export function stampIntimacyBoundary(kind: 'soft_no' | 'later', now = Date.now()): string {
  return `INTIMACY_BOUNDARY: ${kind} @ ${now}`
}

export function userReopenedIntimacy(text: string): boolean {
  const t = String(text || '').toLowerCase()
  return /\b(retomemos|está bien intim|esta bien intim|puedes acerc|quiero cercan|sí a la cercan|si a la cercan|ok intimidad)\b/i.test(
    t
  )
}
