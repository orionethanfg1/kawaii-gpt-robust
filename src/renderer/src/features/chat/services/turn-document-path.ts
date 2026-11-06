/**
 * Document turn path — progressive read, budget, DOC_READ (X2).
 * @see docs/ORCHESTRATOR-DEFLATE-PLAN.md
 */
import {
  buildDocumentsWithState,
  collectDocAttachmentsFromMessages,
  hydrateAttachmentTextsFromDisk
} from '@core/chat/document-attach'
import {
  findLatestDocText,
  isDocReadingComplete,
  essentialsFromDocState
} from '@core/chat/document-reading-state'
import {
  getDocReadingStatesForConv,
  upsertDocReadingStates
} from './documentReadingStore'
import { scheduleRefineDocRollingSummary } from './refineDocRollingSummary'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'

export type DocumentTurnPathInput = {
  convId: string
  trimmed: string
  attachments?: Array<{
    id?: string
    name?: string
    filePath?: string
    textContent?: string
    mimeType?: string
    dataUrl?: string
  }>
  settings: { localModel?: string; localBaseUrl?: string }
  getMessages: () => Array<{ attachments?: DocumentTurnPathInput['attachments']; role?: string }>
  extraSystem: string
}

export async function applyDocumentTurnPath(input: DocumentTurnPathInput): Promise<string> {
  const { convId, trimmed, attachments, settings, getMessages } = input
  let extraSystem = input.extraSystem

    // Align progressive slice size with live model context (checkpoint unchanged)
    try {
      const mid = String(settings.localModel || '').trim()
      if (mid) {
        const { resolveDynamicLocalBudget, progressiveSliceCharsForBudget, setLiveDocSliceChars } =
          await import('@core/conversation/dynamic-context-budget')
        let baseUrl = String((settings as { localBaseUrl?: string }).localBaseUrl || '').trim()
        if (!baseUrl) {
          try {
            const { discoverLmStudioServer } = await import('@core/providers/lmstudio-ports')
            const probe = await discoverLmStudioServer({ timeoutMs: 1_200 })
            if (probe.ok && probe.baseUrl) baseUrl = probe.baseUrl
          } catch {
            baseUrl = 'http://127.0.0.1:1234'
          }
        }
        const dyn = await resolveDynamicLocalBudget(mid, { baseUrl, kind: 'local' })
        setLiveDocSliceChars(progressiveSliceCharsForBudget(dyn.budget))
      }
    } catch {
      /* keep default slice */
    }

    // Text / code documents for local/cloud models (progressive + rolling summary)
    try {
      const priorStates = getDocReadingStatesForConv(convId)
      // D1: rehydrate — attachments of this turn OR docs from history (continuar lectura)
      let docAtts = attachments
      try {
        const hist = collectDocAttachmentsFromMessages(getMessages())
        const merged = [...(attachments || []), ...hist]
        // de-dupe by filePath/name
        const seen = new Set<string>()
        const uniq = []
        for (const a of merged) {
          const k = (a.filePath || a.name || a.id || '').toLowerCase()
          if (!k || seen.has(k)) continue
          seen.add(k)
          uniq.push(a)
        }
        docAtts = await hydrateAttachmentTextsFromDisk(uniq)
        // Force full re-extract from original office when extract looks truncated
        try {
          const ensure = (window as unknown as {
            kawaii?: {
              filesEnsureDocExtract?: (p: {
                sourcePath?: string
                extractPath?: string
                name?: string
              }) => Promise<{
                ok?: boolean
                text?: string
                extractPath?: string
                totalChars?: number
                repaired?: boolean
              }>
            }
          }).kawaii?.filesEnsureDocExtract
          if (typeof ensure === 'function' && docAtts?.length) {
            const next = []
            for (const a of docAtts) {
              const textLen = String(a.textContent || '').length
              const src = String((a as { sourceFilePath?: string }).sourceFilePath || a.filePath || '')
              if (textLen > 800_000 && !/\.extract\.txt$/i.test(String(a.filePath || ''))) {
                next.push(a)
                continue
              }
              try {
                const er = await ensure({
                  sourcePath: src,
                  extractPath: /\.extract\.txt$/i.test(String(a.filePath || ''))
                    ? String(a.filePath)
                    : undefined,
                  name: a.name
                })
                if (er?.ok && er.text && er.text.length > textLen) {
                  next.push({
                    ...a,
                    textContent: er.text,
                    filePath: er.extractPath || a.filePath,
                    sourceFilePath:
                      (a as { sourceFilePath?: string }).sourceFilePath ||
                      (/\.(docx|pdf)$/i.test(src) ? src : undefined)
                  })
                  if (er.repaired) {
                    try {
                      const { notifyUser } = await import('@shared/lib/notify')
                      void notifyUser(
                        'Extracto del libro ampliado',
                        `Ahora ${er.totalChars || er.text.length} caracteres en app-context (antes incompleto).`,
                        { kind: 'success', sticky: false, os: false }
                      )
                    } catch {
                      /* */
                    }
                  }
                } else next.push(a)
              } catch {
                next.push(a)
              }
            }
            docAtts = next
          }
        } catch {
          /* */
        }
      } catch {
        try {
          const { hydrateAttachmentTextsFromDisk: hyd } = await import('@core/chat/document-attach')
          docAtts = await hyd(attachments)
        } catch {
          docAtts = attachments
        }
      }
      const recovered: Array<{ name: string; text: string }> = []
      const hasFreshDoc = Boolean(
        docAtts?.some((a) => a.textContent && String(a.textContent).trim().length > 80)
      )
      if (!hasFreshDoc) {
        const fromHist = findLatestDocText(getMessages())
        if (fromHist) recovered.push(fromHist)
        // Last resort: any hydrated text still short — keep recovered
        for (const a of docAtts || []) {
          const tx = String(a.textContent || '').trim()
          if (tx.length > 80) recovered.push({ name: a.name || 'documento', text: tx })
        }
      }
      // Explicit read-advance only. Do NOT treat «en el libro» in romantic chat as doc intent
      // (that re-opened progressive reading + auto-chain mid-conversation).
      const wantsAdvance =
        /\b(sigue\s+leyendo|contin[uú]a\s+leyendo|continuar\s+la\s+lectura|siguiente\s+(cap[ií]tulo|tramo|parte)|next\s+chapter|lee\s+(el\s+)?(siguiente|otro)\s+(cap[ií]tulo|tramo)|avanza\s+(en\s+)?(el\s+)?(libro|documento|cap[ií]tulo))\b/i.test(
          trimmed
        ) ||
        (/\b(sigue|contin[uú]a|continuar)\b/i.test(trimmed) &&
          /\b(cap[ií]tulo|tramo|documento|archivo|pdf|docx|p[aá]ginas?)\b/i.test(trimmed))
      const refersToExistingDoc =
        priorStates.length > 0 &&
        /\b(lee(r|me|lo|la)?|lectura|repasa|revisa\s+el\s+(libro|documento)|abre\s+el\s+(libro|documento)|qu[eé]\s+dice\s+el\s+(libro|documento)|contin[uú]a\s+con\s+el\s+(libro|documento))\b/i.test(
          trimmed
        )
      const bareSigue =
        /^(sigue|contin[uú]a|continuar)(\s+por\s+favor)?[.!…]?$/i.test(trimmed.trim()) ||
        /\[APP\].*(continuar la lectura del documento|Continuaci[oó]n autom[aá]tica de lectura)/i.test(
          trimmed
        )
      // Bare «sigue» alone only advances doc if there is open progressive reading AND
      // the last assistant turn was also a doc turn (not intimate chat).
      const forceDocContinue =
        priorStates.length > 0 &&
        (wantsAdvance || refersToExistingDoc || bareSigue)

      // Context eviction: full text only when the turn needs the document
      const hasImageThisTurn = Boolean(
        attachments?.some(
          (a) =>
            a.dataUrl &&
            (String(a.mimeType || '').startsWith('image/') ||
              /\.(png|jpe?g|webp|gif)$/i.test(String(a.name || '')))
        )
      )
      let contextTurnKind: import('@core/chat/context-eviction').ContextTurnKind = 'general'
      try {
        const { classifyContextTurn } = await import('@core/chat/context-eviction')
        contextTurnKind = classifyContextTurn({
          userText: trimmed,
          hasImageThisTurn,
          hasDocThisTurn: Boolean(hasFreshDoc),
          hasDocReadingState: priorStates.length > 0
        })
        // recovered text in history alone is NOT doc_active (avoids reading mid-romance)
        if (forceDocContinue || hasFreshDoc) {
          contextTurnKind = hasImageThisTurn ? 'vision' : 'doc_active'
        }
      } catch {
        contextTurnKind = hasImageThisTurn
          ? 'vision'
          : forceDocContinue || hasFreshDoc
            ? 'doc_active'
            : priorStates.length
              ? 'doc_memory'
              : 'general'
      }

      // Full progressive inject only on explicit read / new attach — never because
      // a prior message still has textContent in history.
      const wantFullDoc =
        !hasImageThisTurn &&
        (hasFreshDoc ||
          forceDocContinue ||
          refersToExistingDoc ||
          (wantsAdvance && priorStates.length > 0) ||
          (contextTurnKind === 'doc_active' && (forceDocContinue || hasFreshDoc)))

      // Light memory/index ONLY when this turn is about the document (not every romantic chat)
      if (
        !wantFullDoc &&
        priorStates.length > 0 &&
        (contextTurnKind === 'doc_active' || contextTurnKind === 'doc_memory')
      ) {
        try {
          const { buildEvictedDocMemoryBlock, shouldInjectDocMemory } = await import(
            '@core/chat/context-eviction'
          )
          if (shouldInjectDocMemory(contextTurnKind)) {
            const { buildCanonicalIndexBlock } = await import('@core/chat/document-ingest-etl')
            const mem = buildEvictedDocMemoryBlock(priorStates)
            if (mem) {
              extraSystem = (extraSystem ? extraSystem + '\n\n' : '') + mem
            }
            for (const ps of priorStates) {
              const idxBlock = buildCanonicalIndexBlock(ps as never)
              if (idxBlock) {
                extraSystem = (extraSystem ? extraSystem + '\n\n' : '') + idxBlock
              }
            }
          }
        } catch {
          /* optional */
        }
      }

      if (wantFullDoc) {
        const { block, states } = buildDocumentsWithState(docAtts, {
          userMessage: trimmed,
          convId,
          priorStates,
          recoveredDocs: recovered.length ? recovered : undefined
        })
        if (block) {
          extraSystem = (extraSystem ? extraSystem + '\n\n' : '') + block
          if (forceDocContinue || bareSigue || /\[APP\].*lectura del documento/i.test(trimmed)) {
            extraSystem +=
              '\n\n[LECTURA DE DOCUMENTO — prioridad]\n' +
              'El usuario quiere que CONTINÚES LEYENDO el archivo adjunto (siguiente tramo/capítulo).\n' +
              'Responde sobre el texto del documento: resumen, opinión, reacciones al contenido.\n' +
              'PROHIBIDO interpretar «sigue» como continuar una escena íntima o romántica salvo que el documento lo diga.\n' +
              'No inventes que el usuario escribió solo la palabra sigue; actúa como lectora atenta del libro/archivo.'
          }
        }
        if (states.length) {
          // Clear uiSuspended + mark activity when this turn is real reading
          try {
            const { resumeDocReadingUi } = await import('./documentReadingStore')
            if (forceDocContinue || bareSigue || hasFreshDoc || /\[APP\].*lectura/i.test(trimmed)) {
              resumeDocReadingUi(convId)
            }
          } catch {
            /* */
          }
          // Ensure states are not suspended on active read
          const stamped = states.map((s) => ({
            ...s,
            uiSuspended: false,
            lastDocTurnAt: Date.now()
          }))
          upsertDocReadingStates(stamped)
          // Close finished books so UI / auto-chain do not stay open forever
          try {
            const { pruneCompletedDocReadings } = await import('./documentReadingStore')
            pruneCompletedDocReadings(convId)
          } catch {
            /* */
          }
          try {
            if (hasFreshDoc) {
              sessionStorage.setItem('kawaii-doc-auto-chain:' + convId, '0')
              sessionStorage.setItem('kawaii-doc-auto-paused:' + convId, '0')
            }
          } catch {
            /* */
          }
          // LLM refine of rolling summary (async, non-blocking)
          scheduleRefineDocRollingSummary(states)
          // Auto-continue chain + transparent DOC_READ memory
          try {
            const incomplete = states.filter((s) => !isDocReadingComplete(s))
            const complete = states.filter((s) => isDocReadingComplete(s))
            if (complete.length && !incomplete.length) {
              extraSystem =
                (extraSystem ? extraSystem + '\n\n' : '') +
                '[LECTURA CERRADA] Has terminado el/los documento(s) de esta sesión. ' +
                'No pidas «Continuar lectura» ni inventes más capítulos. ' +
                'Si el usuario sube una versión nueva del archivo, se detectará y se reiniciará la lectura.'
              try {
                sessionStorage.setItem('kawaii-doc-auto-chain:' + convId, '0')
                sessionStorage.setItem('kawaii-doc-auto-paused:' + convId, '0')
              } catch {
                /* */
              }
            }
            // Persist essentials into userMemory.facts (transparent, not a full book dump)
            if (states.length) {
              const { useSettingsStore } = await import('@shared/lib/stores/settingsStore')
              const s = useSettingsStore.getState().settings
              const facts = [...(s.userMemory?.facts || [])]
              for (const st of states) {
                const line = essentialsFromDocState(st)
                const key = `DOC_READ «${st.fileName || 'documento'}»`
                const idx = facts.findIndex((f) => String(f).startsWith(key) || String(f).includes(key.slice(0, 40)))
                if (idx >= 0) facts[idx] = line
                else facts.push(line)
              }
              useSettingsStore.getState().update({
                userMemory: {
                  ...(s.userMemory || { facts: [] }),
                  facts: facts.slice(-40),
                  updatedAt: Date.now()
                }
              })
            }
            // Stash for onDone auto-continue (same turn)
            // Only arm auto-chain when this turn explicitly continued reading
            // (APP chip / sigue leyendo / fresh attach) — never after casual «libro» mention.
            const armAuto =
              forceDocContinue ||
              bareSigue ||
              hasFreshDoc ||
              /\[APP\].*lectura/i.test(trimmed)
            ;(globalThis as unknown as {
              __kawaiiDocAuto?: {
                convId: string
                incomplete: boolean
                fileName?: string
                armed?: boolean
              }
            }).__kawaiiDocAuto = armAuto
              ? {
                  convId,
                  incomplete: incomplete.length > 0,
                  fileName: incomplete[0]?.fileName || complete[0]?.fileName,
                  armed: true
                }
              : {
                  convId,
                  incomplete: false,
                  fileName: incomplete[0]?.fileName || complete[0]?.fileName,
                  armed: false
                }
          } catch {
            /* memory optional */
          }
        }
      }
    } catch {
      /* ignore */
    }


  // Pure chat with open progressive state → hide Continuar lectura (keep progress)
  try {
    const prior = getDocReadingStatesForConv(convId)
    const explicit =
      /\[APP\].*lectura|sigue\s+leyendo|contin[uú]a\s+leyendo|continuar\s+la\s+lectura/i.test(
        String(trimmed || '')
      ) ||
      Boolean(
        attachments?.some(
          (a) => a.textContent || /\.(pdf|docx?|txt|md)$/i.test(String(a.name || ''))
        )
      )
    if (prior.length && !explicit) {
      // Heuristic: if this path did not request full doc, suspend UI
      const stillOpen = prior.some((s) => !s.uiSuspended)
      if (stillOpen && !/\[LECTURA DE DOCUMENTO/i.test(extraSystem)) {
        const { suspendDocReadingUi } = await import('./documentReadingStore')
        suspendDocReadingUi(convId)
      }
    }
  } catch {
    /* */
  }

  return extraSystem
}
