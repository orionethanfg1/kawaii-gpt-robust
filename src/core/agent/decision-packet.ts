/**
 * DecisionPacket — thin pre-LLM signal layer (Jarvis + companion).
 *
 * Pure module: no Zustand, no IPC, no model calls.
 * Aggregates existing classifiers (task-route, intimacy, doc/file hints)
 * into one object the orchestrator can consume without growing into a monolith.
 *
 * @see docs/DECISION-LAYER-AND-JARVIS-COMPANION.md
 */

import { classifyChatTask, type ChatTask } from '../routing/task-route'

export type DecisionTask =
  | 'chat'
  | 'intimacy'
  | 'code'
  | 'docs'
  | 'files'
  | 'image'
  | 'agenda'
  | 'review'
  | 'vision'
  | 'tools'
  | 'summary'
  | 'reason'
  | 'mixed'

export type DecisionRisk = 'low' | 'high'
export type DecisionScene = 'none' | 'hold' | 'soften' | 'exit'
export type ModelHint = 'sticky' | 'chat' | 'intimate' | 'coder' | 'vision'
export type DecisionConfidence = 'high' | 'low'

export type DecisionInject = {
  /** Known dirs / library index in system prompt */
  library: boolean
  /** Document chunks / reading state blocks */
  docs: boolean
  /** Full host harness / tool catalog (heavy) */
  fullHarness: boolean
  /** Intimate scene / intimacy memory block */
  intimacyBlock: boolean
}

export type DecisionPacket = {
  task: DecisionTask
  risk: DecisionRisk
  scene: DecisionScene
  needsVision: boolean
  needsWeb: boolean
  needsTools: boolean
  modelHint: ModelHint
  inject: DecisionInject
  reason: string
  confidence: DecisionConfidence
  /** Underlying classifyChatTask result when applicable */
  chatTask?: ChatTask
}

export type DecisionPacketInput = {
  userText: string
  /** True when this turn is app-driven doc continue / bare "sigue" with open reading */
  forceDocContinue?: boolean
  hasOpenDocReading?: boolean
  hasImageAttachment?: boolean
  hasFileAttachment?: boolean
  adultOptIn?: boolean
  relationshipStage?: string
  relationshipRole?: string
  /** Live intimacy phase from resolveLiveIntimatePhase */
  liveScenePhase?: string | null
  /** User explicitly asked for web / current events */
  wantsWeb?: boolean
  /** Explicit tool / folder / file mutation language */
  wantsFiles?: boolean
  wantsAgenda?: boolean
  /** App-internal instruction (never treat as user voice) */
  isAppInstruction?: boolean
}

const FILE_INTENT_RE =
  /\b(carpeta|archivos?|guardarropa|biblioteca|userData|organiza(r)?|mueve|mover|copia(r)?|renombra(r)?|borra(r)?|elimina(r)?|list(a|ar) (mis )?(archivos|carpetas)|en qu[eé] carpeta|abre (la )?carpeta|muestra (el )?archivo|d[oó]nde (est[aá]|guardaste)|quita (este|ese) archivo|limpia (la )?(biblioteca|carpeta)|clasifica (este|el) archivo)\b/i

const AGENDA_RE =
  /\b(agenda|recu[eé]rdame|alarma|cita|calendario|programa(r)? (una )?(cita|reuni[oó]n|aviso))\b/i

const WEB_RE =
  /\b(busca(r)? en (la )?web|internet|noticias?|qu[eé] hora es en|clima (en|de)|precio (actual|de)|cotizaci[oó]n)\b/i

const DOC_RE =
  /\b(lee|lectura|libro|cap[ií]tulo|documento|pdf|docx|tramo|contin[uú]a(r)? (leyendo|la lectura)|sigue leyendo)\b/i

function mapChatTask(t: ChatTask): DecisionTask {
  switch (t) {
    case 'intimacy':
      return 'intimacy'
    case 'code':
      return 'code'
    case 'vision':
      return 'vision'
    case 'summary':
      return 'summary'
    case 'tools':
      return 'tools'
    case 'reason':
      return 'reason'
    default:
      return 'chat'
  }
}

function modelHintFor(task: DecisionTask, chatTask?: ChatTask): ModelHint {
  if (task === 'intimacy' || chatTask === 'intimacy') return 'intimate'
  if (task === 'code' || chatTask === 'code') return 'coder'
  if (task === 'vision' || task === 'image' || chatTask === 'vision') return 'vision'
  if (task === 'docs') return 'sticky'
  return 'chat'
}

/**
 * Build a DecisionPacket from turn signals. Deterministic and side-effect free.
 */
export function buildDecisionPacket(input: DecisionPacketInput): DecisionPacket {
  const text = String(input.userText || '')
  const reasons: string[] = []

  const forceDoc =
    Boolean(input.forceDocContinue) ||
    Boolean(input.hasOpenDocReading && /^(sigue|contin[uú]a|continuar)(\s+por\s+fa(vor)?)?\.?$/i.test(text.trim()))

  const wantsFiles = Boolean(input.wantsFiles) || FILE_INTENT_RE.test(text)
  const wantsAgenda = Boolean(input.wantsAgenda) || AGENDA_RE.test(text)
  const wantsWeb = Boolean(input.wantsWeb) || WEB_RE.test(text)
  const wantsDoc = forceDoc || Boolean(input.hasOpenDocReading && DOC_RE.test(text)) || DOC_RE.test(text)

  const chatTask = classifyChatTask(text, {
    hasImageAttachment: input.hasImageAttachment,
    adultOptIn: input.adultOptIn,
    relationshipStage: input.relationshipStage,
    relationshipRole: input.relationshipRole,
    forceIntimacy: false
  })

  let task: DecisionTask = mapChatTask(chatTask)
  let confidence: DecisionConfidence = 'high'

  if (forceDoc || (input.hasOpenDocReading && (wantsDoc || /sigue/i.test(text)))) {
    task = 'docs'
    reasons.push(forceDoc ? 'forceDocContinue' : 'openDocReading')
  } else if (wantsFiles && chatTask !== 'intimacy') {
    task = 'files'
    reasons.push('fileIntent')
  } else if (wantsAgenda) {
    task = 'agenda'
    reasons.push('agendaIntent')
  } else if (input.hasImageAttachment) {
    task = chatTask === 'vision' ? 'vision' : 'image'
    reasons.push('imageAttachment')
  } else {
    reasons.push(`classifyChatTask=${chatTask}`)
  }

  // Scene from live phase (orchestrator already computed; we only map)
  const phase = String(input.liveScenePhase || '').toLowerCase()
  let scene: DecisionScene = 'none'
  if (phase.includes('active') || phase === 'scene_active' || phase === 'intimate') {
    scene = 'hold'
    reasons.push('liveScene=hold')
  } else if (phase.includes('wind') || phase.includes('after')) {
    scene = 'soften'
  }

  // Doc continue must not keep intimacy route as primary task
  if (task === 'docs' && scene === 'hold') {
    reasons.push('docsOverridesIntimacyTask')
  }

  const risk: DecisionRisk =
    wantsFiles || task === 'files' || (chatTask === 'intimacy' && Boolean(input.adultOptIn))
      ? task === 'files' || wantsFiles
        ? 'high'
        : 'low'
      : 'low'

  if (task === 'files') reasons.push('risk=high(files)')

  const needsVision = Boolean(input.hasImageAttachment) || task === 'vision' || chatTask === 'vision'
  const needsWeb = wantsWeb
  const needsTools =
    task === 'files' ||
    task === 'agenda' ||
    task === 'tools' ||
    chatTask === 'tools' ||
    wantsFiles

  // inject: default off — only open gates when this turn needs them (prefill budget)
  const inject: DecisionInject = {
    library: task === 'files' || wantsFiles,
    docs: task === 'docs' || forceDoc || Boolean(input.hasOpenDocReading && wantsDoc),
    fullHarness: needsTools && task !== 'chat' && task !== 'intimacy',
    intimacyBlock:
      task === 'intimacy' ||
      scene === 'hold' ||
      scene === 'soften' ||
      chatTask === 'intimacy'
  }

  if (inject.docs) reasons.push('inject.docs')
  if (inject.library) reasons.push('inject.library')
  if (inject.fullHarness) reasons.push('inject.fullHarness')
  if (inject.intimacyBlock) reasons.push('inject.intimacyBlock')

  // Mixed: file ask during intimacy
  if (chatTask === 'intimacy' && wantsFiles) {
    task = 'mixed'
    confidence = 'low'
    reasons.push('mixed=intimacy+files')
  }

  if (input.isAppInstruction) {
    reasons.push('appInstruction')
  }

  const modelHint = modelHintFor(task, chatTask)
  // Prefer sticky resident for docs / chat / agenda unless code/vision/intimacy needs switch
  const hint: ModelHint =
    task === 'docs' || task === 'agenda' || task === 'chat' || task === 'summary'
      ? 'sticky'
      : modelHint

  return {
    task,
    risk: task === 'files' || wantsFiles ? 'high' : risk,
    scene,
    needsVision,
    needsWeb,
    needsTools,
    modelHint: hint,
    inject,
    reason: reasons.join('|') || 'default',
    confidence,
    chatTask
  }
}

/** One-line log for main/renderer consoles */
export function formatDecisionLog(p: DecisionPacket): string {
  return `[decision] task=${p.task} hint=${p.modelHint} scene=${p.scene} risk=${p.risk} conf=${p.confidence} inject=${[
    p.inject.docs && 'docs',
    p.inject.library && 'lib',
    p.inject.fullHarness && 'harness',
    p.inject.intimacyBlock && 'intimacy'
  ]
    .filter(Boolean)
    .join(',') || 'none'} · ${p.reason}`
}
