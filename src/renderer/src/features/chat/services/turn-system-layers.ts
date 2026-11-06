/**
 * Turn system layers — extraSystem fragments for one chat turn.
 * Extracted from runChatOrchestrationTurn (X1 deflate plan).
 * Side effects limited to optional IPC (library list); no stream, no model call.
 */
import type { DecisionPacket } from '@core/agent/decision-packet'
import { looksLikeIdentityReject } from '@core/generative/image-revision'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'

export type TurnSystemLayersInput = {
  trimmed: string
  hasMediaJob: boolean
  imageContextForText?: string
  decisionPacket: DecisionPacket | null
  /** Injected for testability */
  buildAppAgentSystemBlock: () => Promise<string>
}

function appendBlock(base: string, block: string): string {
  const b = (block || '').trim()
  if (!b) return base
  return base ? `${base}\n\n${b}` : b
}

/** S6 — only inject time/weather when the turn can use it (not every casual message). */
async function buildTimeLayer(userText: string): Promise<string> {
  const t = (userText || '').toLowerCase()
  const wantsTime =
    /\b(hora|qu[eé] hora|hoy|ma[nñ]ana|tarde|noche|clima|tiempo|llueve|fr[ií]o|calor|plan|agenda|quedamos|cita)\b/i.test(
      t
    ) || /^\[APP\]/i.test(t)
  if (!wantsTime) return ''
  try {
    const { buildLocalTimeContextBlock } = await import('@core/conversation/local-time-context')
    const st = useSettingsStore.getState().settings as {
      weatherEnabled?: boolean
      weatherSummary?: string
      weatherFetchedAt?: number
      character?: { name?: string }
    }
    let weatherLine: string | null = null
    if (st.weatherEnabled && /\b(clima|tiempo|llueve|fr[ií]o|calor|outfit|ropa)\b/i.test(t)) {
      try {
        const { ensureWeatherFresh } = await import('./ensureWeatherFresh')
        await ensureWeatherFresh()
      } catch {
        /* */
      }
      const st2 = useSettingsStore.getState().settings as {
        weatherSummary?: string
        weatherFetchedAt?: number
      }
      if (
        st2.weatherSummary &&
        st2.weatherFetchedAt &&
        Date.now() - st2.weatherFetchedAt < 3 * 60 * 60 * 1000
      ) {
        weatherLine = st2.weatherSummary
      }
    }
    return buildLocalTimeContextBlock({
      characterName: st.character?.name,
      weatherLine
    })
  } catch {
    return ''
  }
}

async function buildHarnessLayer(
  input: TurnSystemLayersInput,
  prior: string
): Promise<string> {
  const { trimmed, hasMediaJob, decisionPacket, buildAppAgentSystemBlock } = input
  try {
    const wantsAgent =
      Boolean(
        decisionPacket?.inject.fullHarness ||
          decisionPacket?.needsTools ||
          decisionPacket?.task === 'files' ||
          decisionPacket?.inject.library
      ) ||
      /\b(diagn[oó]stico|autodiagn[oó]stico|qu[eé] puedes hacer|herramientas?|forge|faceid|instala(?:r)?|descarga(?:r)?\s+modelo|listar\s+modelos|estado\s+de\s+la\s+app|health_forge|APP_ACTION)\b/i.test(
        trimmed
      ) ||
      /^\[APP\]/i.test(trimmed.trim())

    if (hasMediaJob) {
      return (
        'El usuario pidió generar o revisar una imagen. Responde breve en lenguaje natural. ' +
        'NO uses bloques APP_ACTION ni herramientas de Forge/Ollama en este turno. ' +
        (looksLikeIdentityReject(trimmed)
          ? 'El usuario rechazó la imagen anterior porque NO era tu apariencia. ' +
            'No digas "aquí tienes la imagen" hasta que el sistema adjunte una nueva. ' +
            'Disculpate en 1 frase y espera el adjunto real.'
          : '')
      )
    }
    if (wantsAgent) {
      return await buildAppAgentSystemBlock()
    }
    return appendBlock(
      prior,
      '[HARNESS — mínimo] Eres el asistente de la app. No inventes listas de modelos ni digas que ejecutaste herramientas. ' +
        'Si el usuario pide diagnóstico o inventario de la app, diles que lo pida explícitamente.'
    )
  } catch {
    return prior
  }
}

async function buildLibraryLayer(decisionPacket: DecisionPacket | null): Promise<string> {
  if (decisionPacket && !decisionPacket.inject.library) return ''
  // No packet → keep previous permissive behavior only if we cannot know; prefer skip
  if (!decisionPacket) return ''
  try {
    const { buildLibraryAwarenessBlock, mergeLibraryCatalog } = await import(
      '@core/chat/library-awareness'
    )
    const diskItems: Array<{
      name: string
      path?: string
      kind: string
      size?: number
      isImage?: boolean
    }> = []
    try {
      const lib = await window.kawaii?.filesListLibrary?.()
      if (lib?.ok && lib.items?.length) {
        for (const it of lib.items.slice(0, 40)) {
          diskItems.push({
            name: it.name,
            path: it.path,
            kind: it.kind,
            size: it.size,
            isImage: it.isImage
          })
        }
      }
    } catch {
      /* */
    }
    const fromChats: typeof diskItems = []
    try {
      const { useChatStore } = await import('@shared/lib/stores/chatStore')
      for (const c of useChatStore.getState().conversations || []) {
        for (const m of c.messages || []) {
          for (const a of m.attachments || []) {
            if (a?.name)
              fromChats.push({
                name: a.name,
                path: a.filePath,
                kind: a.filePath && /app-context/i.test(a.filePath) ? 'context' : 'user',
                isImage: Boolean(a.mimeType?.startsWith('image/'))
              })
          }
        }
      }
    } catch {
      /* */
    }
    const merged = mergeLibraryCatalog(diskItems, fromChats)
    return buildLibraryAwarenessBlock(merged, { maxItems: 20 }) || ''
  } catch {
    return ''
  }
}

/**
 * Compose time + harness (+ optional media context) + library (gated).
 * Vision / wardrobe / docs stay in the orchestrator until X2+.
 */
export async function buildTurnSystemLayers(input: TurnSystemLayersInput): Promise<string> {
  // S6: time/weather only when relevant; harness/library already gated by DecisionPacket
  let extra = await buildTimeLayer(input.trimmed)
  extra = await buildHarnessLayer(input, extra)
  if (input.imageContextForText) {
    extra = appendBlock(extra, input.imageContextForText)
  }
  const lib = await buildLibraryLayer(input.decisionPacket)
  extra = appendBlock(extra, lib)
  // X6 — file NL protocol when packet wants files (tools still gated post-reply)
  // X8 intimacy only when packet asks
  try {
    const { buildIntimacyInjectBlock } = await import('./turn-intimacy-inject')
    const isAppDoc =
      /^\[APP\]/i.test(input.trimmed) &&
      /(lectura|documento|tramo|archivo)/i.test(input.trimmed)
    const intimacy = await buildIntimacyInjectBlock({
      packet: input.decisionPacket,
      settings: useSettingsStore.getState().settings,
      isAppDocContinue: isAppDoc
    })
    extra = appendBlock(extra, intimacy)
  } catch {
    /* optional */
  }
  try {
    const { packetWantsFileNl, buildFileNlSystemBlock } = await import('./turn-file-nl')
    if (packetWantsFileNl(input.decisionPacket)) {
      const name = (
        useSettingsStore.getState().settings as { character?: { name?: string } }
      ).character?.name
      extra = appendBlock(extra, buildFileNlSystemBlock({ characterName: name }))
      // Prefer full harness so APP_ACTION catalog is available
      if (input.decisionPacket && !input.hasMediaJob) {
        const wantsFull =
          input.decisionPacket.inject.fullHarness || input.decisionPacket.needsTools
        if (wantsFull && !extra.includes('APP_ACTION') && !extra.includes('[HARNESS')) {
          /* harness layer already ran; file block is enough + post-reply tools */
        }
      }
    }
  } catch {
    /* optional */
  }
  return extra
}
