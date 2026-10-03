
/**
 * Turn raw tool JSON / harness logs into plain Spanish for the chat.
 */

export type ToolObs = {
  tool?: string
  ok?: boolean
  summary?: string
  durationMs?: number
}

function parseObs(raw: string): ToolObs | null {
  try {
    const j = JSON.parse(raw) as ToolObs
    if (j && typeof j === 'object') return j
  } catch {
    /* not json */
  }
  return null
}

function humanEnsureFaceId(ok: boolean, summary: string): string {
  if (ok && /instalado|ya en disco|ok/i.test(summary)) {
    const files = summary.match(/ip-adapter[^,\s]+/gi) || []
    return (
      '**FaceID:** descarga lista' +
      (files.length ? ` (${files.slice(0, 3).join(', ')})` : '') +
      '.\n\n' +
      'Para que Forge lo use de verdad: **detén y vuelve a arrancar Forge**, y luego pide otra *foto tuya*.'
    )
  }
  if (!ok) {
    return (
      '**FaceID:** no se pudo instalar.\n' +
      summary.slice(0, 240) +
      '\n\nComprueba la red o di *«revisa Forge»*.'
    )
  }
  return summary
}

function humanProbeForge(ok: boolean, summary: string): string {
  const faceNo = /FaceID:\s*NO|Sin FaceID/i.test(summary)
  const faceYes = /FaceID:\s*SÍ|FaceID: SÍ/i.test(summary)
  const ck = summary.match(/Checkpoints:\s*(\d+)/i)
  const cn = summary.match(/ControlNet:\s*(\d+)/i)
  const running = /state":"running"|Forge listo|port":7860/i.test(summary)
  const lines: string[] = ['**Forge**']
  if (running) {
    lines.push('Está en marcha (puerto típico 7860).')
  } else if (!ok) {
    lines.push('No respondió bien a la API. Prueba *«arranca Forge»* o revisa Ajustes.')
  }
  if (ck) lines.push(`Checkpoints encontrados: **${ck[1]}**.`)
  if (cn) lines.push(`Modelos ControlNet listados: **${cn[1]}**.`)
  if (faceNo) {
    lines.push(
      '**Identidad facial (FaceID): no disponible** en ControlNet. Los autorretratos saldrán genéricos hasta instalarlo.'
    )
    lines.push('Sugerencia: di *«instala FaceID»*.')
  } else if (faceYes) {
    lines.push('**FaceID:** detectado — los autorretratos pueden fijar la cara del personaje.')
  }
  // extract a few checkpoint names
  const names = [...summary.matchAll(/·\s*([\w.-]+\.safetensors)/gi)].map((m) => m[1])
  if (names.length) {
    lines.push('Modelos: ' + names.slice(0, 4).join(', ') + (names.length > 4 ? '…' : ''))
  }
  return lines.join('\n')
}

function humanCheckFaceId(ok: boolean, summary: string): string {
  if (ok) return '**FaceID:** disponible en Forge.'
  return (
    '**FaceID:** aún no está cargado en Forge.\n' +
    (summary.includes('Instala') ? 'Sugerencia: *«instala FaceID»* y luego reinicia Forge.' : summary.slice(0, 200))
  )
}

function humanAssess(summary: string): string {
  // already somewhat human from formatStackGapsForChat
  return summary
}

/** E-HMSG2 — drop machine-profile GPU scare when it confuses a simple stopped state */
function stripForgeScare(summary: string): string {
  return String(summary || '')
    .replace(/No se detectó GPU NVIDIA dedicada\.?/gi, '')
    .replace(/Forge CUDA no es fiable aquí;?\s*usa generación cloud \(Pollinations\)\.?/gi, '')
    .replace(/ollama run stable-diffusion/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** E-HMSG — start_forge / health without confusing Ollama unload notes */
function humanStartForge(ok: boolean, summary: string): string {
  const s = stripForgeScare(summary)
  if (/modelo de imagen cargado en Ollama/i.test(summary)) {
    return (
      '**Forge** es independiente de Ollama (no uses modelos de imagen en Ollama).\n' +
      'Para imágenes locales: *«arranca Forge»* y espera la API (puerto típico 7860).'
    )
  }
  if (ok || /Forge listo|en marcha|API OK/i.test(s)) {
    return '**Forge:** ' + (s || 'listo').slice(0, 320)
  }
  if (/arrancando/i.test(s)) {
    return '**Forge:** aún arrancando — ' + s.slice(0, 200)
  }
  return (
    '**Forge:** no quedó listo.\n' +
    (s || 'API detenida o sin respuesta.') +
    '\n\nForge ≠ Ollama y ≠ LM Studio. Usa *Capas → Arrancar Forge* o el log de la consola de Forge.'
  )
}

function humanHealthForge(ok: boolean, summary: string): string {
  const s = stripForgeScare(summary)
  if (ok) return '**Forge (health):** ' + (s || 'API OK')
  if (/detenido|stopped|no responde|en error/i.test(s + summary)) {
    return (
      '**Forge (health):** no listo — ' +
      (s || 'servicio detenido o API caída.') +
      '\n(Imagen local = Forge, no Ollama.)'
    )
  }
  return '**Forge (health):** no listo — ' + (s || summary).slice(0, 220)
}


function humanGetAppStatus(summary: string, userGoal?: string): string {
  const focusLm = /lm\s*studio/i.test(userGoal || '')
  const chat = summary.match(/Chat local:\s*([^|]+)/i)
  const forge = summary.match(/Forge\/imagen:\s*([^|]+)/i)
  const music = summary.match(/Música:\s*([^|]+)/i)
  const voice = summary.match(/Voz:\s*([^|]+)/i)
  const active = summary.match(/modelo activo:\s*([^|)\]]+)/i)

  const lmOk = /LM Studio[^·\n]*OK/i.test(summary) || /OpenAI-compatible OK/i.test(summary)
  const diskOnly = /modelo\(s\) en disco|servidor puede estar parado/i.test(summary)
  let lmCell = 'sin datos'
  if (lmOk && !diskOnly) lmCell = 'servidor **activo** (API OK)'
  else if (lmOk && diskOnly)
    lmCell = 'API visible + modelos en disco — confirma **Developer → Start Server** (puerto ≠ 11434)'
  else if (diskOnly) lmCell = 'solo disco / server posiblemente parado'
  else if (focusLm) lmCell = 'no claro — *«rescanea modelos»*'

  const rows: string[] = []
  rows.push('| Capa | Estado |')
  rows.push('| --- | --- |')
  if (chat) {
    const act = active ? ` · \`${active[1].trim()}\`` : ''
    rows.push(`| Chat local | ${chat[1].trim()}${act} |`)
  }
  if (focusLm || lmOk || diskOnly) rows.push(`| LM Studio | ${lmCell} |`)
  if (/Ollama OK/i.test(summary)) rows.push('| Ollama | OK |')
  if (forge) rows.push(`| Forge / imagen | ${forge[1].trim()} |`)
  if (music) rows.push(`| Música | ${music[1].trim()} |`)
  if (voice) rows.push(`| Voz | ${voice[1].trim()} |`)

  const title = focusLm ? '**LM Studio y chat local**' : '**Estado de capas**'
  return title + '\n\n' + rows.join('\n')
}

function humanListInstalledModels(summary: string, userGoal?: string): string {
  const focusLm = /lm\s*studio/i.test(userGoal || '')
  const rt = summary.match(/Runtime:\s*([^|]+)/i)
  const body = summary.replace(/^.*?Modelos\s*\(\d+\):\s*/i, '')
  const segs = body
    .split(/\s*·\s*/)
    .map((s) => s.trim())
    .filter(Boolean)

  type Row = { name: string; role: string; source: string }
  const rows: Row[] = []
  for (const s of segs) {
    const low = s.toLowerCase()
    let source = 'otro'
    if (/openai-compatible|lmstudio|lm studio/.test(low)) source = 'LM Studio'
    else if (/ollama/.test(low)) source = 'Ollama'
    const role =
      /visi[oó]n|vision|moondream|llava/.test(low)
        ? 'visión'
        : /c[oó]digo|code|coder/.test(low)
          ? 'código'
          : 'chat'
    const name = s.replace(/\s*[\(（].*$/, '').trim() || s
    if (name.length < 2) continue
    if (focusLm && source === 'Ollama') continue
    rows.push({ name, role, source })
  }

  if (!rows.length) {
    return (
      (focusLm ? '**Modelos LM Studio**\n\n' : '**Modelos locales**\n\n') +
      '_Ninguno listado por la API ahora._'
    )
  }

  const lines = [
    focusLm ? '**Modelos (prioridad LM Studio)**' : '**Modelos locales**',
    rt ? `\n_Runtime: ${rt[1].trim()}_` : '',
    '',
    '| Modelo | Rol | Origen |',
    '| --- | --- | --- |'
  ]
  for (const r of rows.slice(0, 14)) {
    lines.push(`| \`${r.name}\` | ${r.role} | ${r.source} |`)
  }
  if (rows.length > 14) lines.push(`| … | +${rows.length - 14} más | |`)
  return lines.filter((x, i) => x !== '' || i < 3).join('\n')
}

function humanRunDiagnosis(summary: string): string {
  const lines: string[] = ['**Diagnóstico rápido**']
  for (const p of summary.split(/\s*·\s*/)) {
    const t = p.trim()
    if (!t) continue
    if (/^ok:/i.test(t)) lines.push(`- ✓ ${t.replace(/^ok:\s*/i, '')}`)
    else if (/^warn:/i.test(t)) lines.push(`- ⚠ ${t.replace(/^warn:\s*/i, '')}`)
    else if (/^error:/i.test(t)) lines.push(`- ✗ ${t.replace(/^error:\s*/i, '')}`)
    else lines.push(`- ${t}`)
  }
  return lines.join('\n')
}


/**
 * Build a single friendly message from host tool observations.
 */
export function humanizeHostObservations(
  observations: string[],
  opts?: { userGoal?: string }
): string {
  try {
  return humanizeHostObservationsInner(observations, opts)
  } catch (e) {
    const bits = observations.map((o) => {
      try {
        const j = JSON.parse(o) as { tool?: string; summary?: string }
        if (j.tool && j.summary) return `**${j.tool}:** ${String(j.summary).slice(0, 400)}`
      } catch { /* */ }
      return o.slice(0, 200)
    })
    return 'Te lo resumo (modo simple):\n\n' + bits.join('\n\n')
  }
}

function humanSelfCheck(ok: boolean, summary: string): string {
  const lines = String(summary || '')
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  const body = lines
    .filter((l) => !/^run_chat_self_check/i.test(l) && !/^Self-check/i.test(l))
    .join('\n')
  const title = ok ? '**Chequeo interno:** todo en orden.' : '**Chequeo interno:** hay avisos.'
  return title + (body ? '\n\n' + body : '')
}

function humanizeHostObservationsInner(

  observations: string[],
  opts?: { userGoal?: string }
): string {
  const parts: string[] = []
  let anyFail = false
  let anyOk = false
  const suggestions = new Set<string>()

  for (const raw of observations) {
    const o = parseObs(raw)
    if (!o?.tool) {
      if (raw.trim().startsWith('{')) continue
      parts.push(raw.trim())
      continue
    }
    const sum = String(o.summary || '')
    if (o.ok) anyOk = true
    else anyFail = true

    switch (o.tool) {
      case 'probe_forge':
        parts.push(humanProbeForge(Boolean(o.ok), sum))
        if (/FaceID:\s*NO|Sin FaceID/i.test(sum)) suggestions.add('instala FaceID')
        break
      case 'check_faceid':
        parts.push(humanCheckFaceId(Boolean(o.ok), sum))
        if (!o.ok) suggestions.add('instala FaceID')
        break
      case 'assess_identity_stack':
        parts.push(sum)
        break
      case 'ensure_faceid':
        parts.push(humanEnsureFaceId(Boolean(o.ok), sum))
        if (o.ok) suggestions.add('reinicia Forge y pide foto tuya')
        break
      case 'assess_image_stack':
        parts.push(humanAssess(sum))
        if (/FaceID no disponible|instala FaceID/i.test(sum)) suggestions.add('instala FaceID')
        if (/Forge no está listo/i.test(sum)) suggestions.add('arranca Forge')
        if (/ControlNet/i.test(sum) && /Sin modelos|opcional/i.test(sum))
          suggestions.add('instala ControlNet')
        break
      case 'ensure_controlnet':
        parts.push(
          o.ok
            ? `**ControlNet:** ${sum}`
            : `**ControlNet:** no se instaló. ${sum.slice(0, 160)}`
        )
        break
      case 'list_host_commands':
        parts.push(sum)
        break
      case 'score_face_match':
      case 'score_identity_match':
      case 'analyze_identity_refs':
        parts.push(sum)
        break
      case 'recover_settings':
        parts.push(sum)
        break
      case 'run_chat_self_check':
        parts.push(humanSelfCheck(Boolean(o.ok), sum))
        break
      case 'start_forge':
        parts.push(humanStartForge(Boolean(o.ok), sum))
        if (!o.ok) suggestions.add('arranca Forge')
        break
      case 'health_forge':
        parts.push(humanHealthForge(Boolean(o.ok), sum))
        break
      case 'get_app_status':
        parts.push(humanGetAppStatus(sum, opts?.userGoal))
        // E-HMSG2: LM Studio hint only if the user asked about LM / estado general, not Forge
        if (
          /servidor puede estar parado/i.test(sum) &&
          !/forge|arranca\s+forge|start_forge|capa de imagen/i.test(opts?.userGoal || '')
        ) {
          suggestions.add('Start Server en LM Studio')
        }
        break
      case 'list_installed_models':
        parts.push(humanListInstalledModels(sum, opts?.userGoal))
        break
      case 'run_diagnosis':
        parts.push(humanRunDiagnosis(sum))
        break
      case 'check_local_runtime':
        parts.push(
          o.ok
            ? `**Runtime local:** ${sum.slice(0, 280)}`
            : `**Runtime local:** problema — ${sum.slice(0, 200)}`
        )
        break
      default:
        // avoid dumping raw tool:ok — noise
        if (sum.length < 40) break
        // Drop tool id prefix for short operational messages
        if (/^Self-check|^OK|^Listo/i.test(sum)) parts.push(sum.slice(0, 400))
        else parts.push(sum.slice(0, 320))
    }
  }

  if (!parts.length) {
    return 'Listo, pero no hubo detalle que mostrar.'
  }

  const intro =
    opts?.userGoal && /faceid|forge|falta|diagn|lm\s*studio|estado/i.test(opts.userGoal)
      ? ''
      : ''

  let out = intro + parts.join('\n\n')

  // E-HMSG2: if the goal is Forge, drop LM Studio suggestions
  const forgeFocus = /forge|arranca\s+forge|start_forge|capa de imagen|sdapi/i.test(
    opts?.userGoal || ''
  )
  if (forgeFocus) {
    suggestions.delete('Start Server en LM Studio')
    if (!anyOk && anyFail) suggestions.add('arranca Forge')
  }

  // Only emphasize next steps when something was wrong or install needs reboot
  if (suggestions.size > 0 && (anyFail || /reinicia Forge/i.test(out))) {
    out += '\n\n**Siguiente paso sugerido:** ' + [...suggestions].map((s) => `*«${s}»*`).join(' · ')
  } else if (!anyFail && anyOk) {
    if (/lm\s*studio/i.test(opts?.userGoal || '') && !forgeFocus) {
      out +=
        '\n\n_Si el chat no usa un modelo de LM Studio, elige uno `qwen/…` en Ajustes o di *«Auto»*._\n'
    } else if (!forgeFocus) {
      out += '\n\n_Chequeo esencial en orden (o ya corregido)._\n'
    }
  }

  return out
}
