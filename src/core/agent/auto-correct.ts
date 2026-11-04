/**
 * AC1 — Autocorrección segura
 * Detectar fallo repetible → proponer en es-MX → sugerir tool (o auto-ejecutar solo si es segura).
 * Respeta failure-memory (no repetir a ciegas).
 * @see docs/COMPANION-EVOLUTION.md §3
 */

import { shouldSkipTool, type FailureEntry } from './failure-memory'

export type RecoveryProposal = {
  /** Human message for the chat / system (es-MX, natural) */
  humanMessage: string
  /** Preferred next tool(s) in order */
  nextTools: string[]
  /** May run without extra user confirmation (still goes through approve()) */
  safeAuto: boolean
  /** Why we propose this */
  reason: string
  /** Original failed tool */
  failedTool: string
  /** AC2 — short plan steps (human, not a dump) */
  planSteps?: string[]
}

type Rule = {
  matchTool?: RegExp
  matchSummary?: RegExp
  nextTools: string[]
  safeAuto: boolean
  human: (ctx: { tool: string; summary: string }) => string
  reason: string
}

const RULES: Rule[] = [
  {
    matchTool: /^(health_forge|probe_forge)$/,
    matchSummary: /error|stopped|no respond|fetch failed|detenido|no ok|apagad/i,
    nextTools: ['start_forge', 'health_forge'],
    safeAuto: true,
    reason: 'Forge no responde → arrancar',
    human: () =>
      'Parece que Forge (imágenes) no está respondiendo. Puedo intentar arrancarlo; si quieres, dime «arranca Forge».'
  },
  {
    matchTool: /^start_forge$/,
    matchSummary: /fail|error|timeout|no se pudo|cuda|gpu/i,
    nextTools: ['run_diagnosis'],
    safeAuto: false,
    reason: 'start_forge falló → diagnóstico',
    human: () =>
      'No pude arrancar Forge bien. ¿Revisamos el estado de la capa de imagen o prefieres generar en la nube?'
  },
  {
    matchTool: /^(check_faceid)$/,
    matchSummary: /sin faceid|no disponible|not found|falta/i,
    nextTools: ['ensure_faceid'],
    safeAuto: true,
    reason: 'FaceID ausente → instalar',
    human: () =>
      'Para que los autorretratos se parezcan más a mí hace falta FaceID en Forge. Puedo instalarlo; dime «instala FaceID» si quieres.'
  },
  {
    matchTool: /^ensure_faceid$/,
    matchSummary: /fail|error|no se pudo/i,
    nextTools: ['probe_forge', 'run_diagnosis'],
    safeAuto: false,
    reason: 'ensure_faceid falló',
    human: () =>
      'No lograré instalar FaceID solo ahora. Podemos revisar Forge o seguir sin él (identidad más débil en fotos).'
  },
  {
    matchTool: /^(check_local_runtime|list_installed_models)$/,
    matchSummary: /ollama|no responde|offline|connection refused|econnrefused/i,
    nextTools: ['start_ollama', 'check_local_runtime'],
    safeAuto: true,
    reason: 'Ollama caído → arrancar',
    human: () =>
      'El runtime local (Ollama) no responde. Puedo intentar levantarlo; si no, seguimos con la nube si hay red.'
  },
  {
    // Diagnosis completed but reported Ollama down (healthy=false)
    matchTool: /^run_diagnosis$/,
    matchSummary: /fail:\s*Ollama/i,
    nextTools: ['start_ollama', 'check_local_runtime'],
    safeAuto: true,
    reason: 'diagnóstico: Ollama caído',
    human: () =>
      'Ollama no está respondiendo (el resto del chequeo sí corrió). Puedo intentar arrancarlo; si LM Studio sigue arriba, el chat local no se queda sin modelo.'
  },
  {
    matchTool: /^run_diagnosis$/,
    matchSummary: /fail:\s*Forge|fail:.*[Ii]magen|fail:\s*A1111/i,
    nextTools: ['start_forge', 'health_forge'],
    safeAuto: true,
    reason: 'diagnóstico: Forge caído',
    human: () =>
      'La capa de imagen (Forge) falló en el chequeo. Puedo intentar arrancarla si quieres.'
  },
  {
    // Only when the tool itself blew up (not a component fail: line)
    matchTool: /^run_diagnosis$/,
    matchSummary: /^(TypeError|Error:|exception|failed to|ECONNREFUSED|no se pudo ejecutar)/i,
    nextTools: ['get_app_status'],
    safeAuto: true,
    reason: 'diagnóstico no pudo ejecutarse',
    human: () =>
      'No pude completar el diagnóstico automático. Voy a mirar solo el estado general de la app.'
  },
  {
    matchTool: /^(web_search|search_web)$/,
    matchSummary: /fail|error|0 hits|sin resultados|timeout|network/i,
    nextTools: ['run_diagnosis'],
    safeAuto: false,
    reason: 'búsqueda web falló',
    human: () =>
      'La búsqueda web no trajo nada útil o falló. Puedo reintentar con otras palabras o seguir con lo que ya sé — dime qué prefieres.'
  },
  {
    matchTool: /^(start_ollama|check_local_runtime)$/,
    matchSummary: /lm studio|openai-compatible|1234|no server/i,
    nextTools: ['get_app_status', 'list_installed_models'],
    safeAuto: true,
    reason: 'pista LM Studio / runtime',
    human: () =>
      'El runtime local tiene un detalle. Puedo checar qué está arriba (Ollama / LM Studio) y qué modelos hay.'
  },
  {
    matchTool: /^get_app_status$/,
    matchSummary: /forge.*error|imagen.*error|music=pendiente/i,
    nextTools: ['health_forge', 'start_forge'],
    safeAuto: false,
    reason: 'status apunta a capa caída',
    human: () =>
      'Vi que alguna capa no está del todo bien. Si es imagen, puedo intentar arrancar Forge; si es música, aún puede faltar instalar ACE.'
  }
]

/**
 * Propose recovery after a tool failure. Returns null if nothing useful / cooldown says skip.
 */
export function proposeRecoveryAfterFailure(
  tool: string,
  summary?: string,
  opts?: { force?: boolean }
): RecoveryProposal | null {
  const t = String(tool || '').trim()
  const s = String(summary || '')
  if (!t) return null

  for (const rule of RULES) {
    if (rule.matchTool && !rule.matchTool.test(t)) continue
    if (rule.matchSummary && s && !rule.matchSummary.test(s)) {
      // still allow tool-only match if no summary filter needed
      if (rule.matchSummary && s.length > 0) continue
    }
    // If summary empty, allow tool-based rules
    if (rule.matchSummary && !s) {
      // soft match on tool only for forge health
      if (!/forge|faceid|ollama|diagnosis/i.test(t)) continue
    }

    const next = rule.nextTools.filter((nt) => {
      const skip = shouldSkipTool(nt, { force: opts?.force || rule.safeAuto })
      return !skip.skip
    })
    if (!next.length) {
      // All recovery tools in cooldown — still tell the user
      return {
        failedTool: t,
        nextTools: [],
        safeAuto: false,
        reason: rule.reason + ' (en espera por fallos recientes)',
        humanMessage:
          rule.human({ tool: t, summary: s }) +
          ' Hace poco ya falló algo parecido; esperamos un momento o lo intentamos cuando digas.'
      }
    }
    const humanMessage = rule.human({ tool: t, summary: s })
    const planSteps =
      next.length > 0
        ? [
            'Entender qué falló (' + t + ')',
            next[0] ? 'Intentar: ' + next[0].replace(/_/g, ' ') : 'Revisar estado',
            next[1] ? 'Si hace falta: ' + next[1].replace(/_/g, ' ') : 'Contarte el resultado en claro'
          ]
        : ['Esperar un poco (hubo fallos recientes)', 'Reintentar cuando digas']
    return {
      failedTool: t,
      nextTools: next,
      safeAuto: rule.safeAuto && next.length > 0,
      reason: rule.reason,
      humanMessage,
      planSteps
    }
  }

  // Generic fallback for unknown tools
  if (/fail|error|timeout|no ok/i.test(s) || !s) {
    const skip = shouldSkipTool('run_diagnosis', { force: false })
    if (skip.skip) return null
    return {
      failedTool: t,
      nextTools: ['run_diagnosis'],
      safeAuto: false,
      reason: 'fallo genérico → diagnóstico',
      humanMessage:
        'Algo no salió bien con esa acción. Si quieres, hacemos un diagnóstico rápido de la app.'
    }
  }
  return null
}

/** One-line for system / observation injection */
export function formatRecoveryProposal(p: RecoveryProposal): string {
  const steps = (p.planSteps || []).filter(Boolean).slice(0, 3)
  const plan =
    steps.length > 0
      ? ' Plan breve: ' + steps.map((s, n) => String(n + 1) + ') ' + s).join(' · ') + '.'
      : ''
  const auto = p.safeAuto && p.nextTools[0]
    ? ' Voy a intentar «' + p.nextTools[0].replace(/_/g, ' ') + '» con cuidado.'
    : p.nextTools[0]
      ? ' Si quieres, el siguiente paso sería «' + p.nextTools[0].replace(/_/g, ' ') + '».'
      : ''
  return (p.humanMessage || '').trim() + plan + auto
}


export function recoveryTipFromResults(
  results: Array<{ tool: string; ok?: boolean; summary?: string; skipped?: boolean }>
): RecoveryProposal | null {
  for (let i = results.length - 1; i >= 0; i--) {
    const r = results[i]
    if (r.skipped) continue
    // Diagnosis may return ok:true with fail: lines in summary — still recover
    if (r.ok && r.tool === 'run_diagnosis' && /fail:\s*\w+/i.test(String(r.summary || ''))) {
      const p = proposeRecoveryAfterFailure(r.tool, r.summary)
      if (p) return p
      continue
    }
    if (r.ok) continue
    const p = proposeRecoveryAfterFailure(r.tool, r.summary)
    if (p) return p
  }
  return null
}
