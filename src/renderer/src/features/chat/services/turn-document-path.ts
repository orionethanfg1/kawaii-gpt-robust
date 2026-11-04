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
      const wantsAdvance =
        /\b(sigue|continua|contin\u00faa|siguiente (capitulo|cap\u00edtulo|parte)|next chapter|capitulo|cap\u00edtulo)\b/i.test(
          trimmed
        )
      // Soft: user points at already-attached book without re-uploading
      const refersToExistingDoc =
        priorStates.length > 0 &&
        /\b(m[ií]ralo|miralo|v[eé]alo|velo|puedes verlo|verlo t[uú]|eso puedes ver|puedes verlo t[uú] misma|rev[ií]salo|ves el|el (libro|documento|archivo|pdf|docx)|adjunto|lo que (te )?(sub[ií]|adjunt[eé]?|envi[eé]))\b/i.test(
          trimmed
        )
      // Bare "sigue" / APP doc-continue with open reading state → always document path
      const bareSigue =
        /^(sigue|contin[uú]a|continuar)(\s+por\s+favor)?[.!…]?$/i.test(trimmed.trim()) ||
        /\[APP\].*continuar la lectura del documento/i.test(trimmed)
      const forceDocContinue =
        priorStates.length > 0 && (wantsAdvance || refersToExistingDoc || bareSigue)

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
        if (forceDocContinue || hasFreshDoc || recovered.length) {
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

      const wantFullDoc =
        !hasImageThisTurn &&
        (contextTurnKind === 'doc_active' ||
          hasFreshDoc ||
          recovered.length > 0 ||
          (wantsAdvance && priorStates.length > 0) ||
          refersToExistingDoc ||
          forceDocContinue)

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
          upsertDocReadingStates(states)
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
            ;(globalThis as unknown as { __kawaiiDocAuto?: { convId: string; incomplete: boolean; fileName?: string } }).__kawaiiDocAuto =
              {
                convId,
                incomplete: incomplete.length > 0,
                fileName: incomplete[0]?.fileName || complete[0]?.fileName
              }
          } catch {
            /* memory optional */
          }
        }
      }
    } catch {
      /* ignore */
    }


  return extraSystem
}
