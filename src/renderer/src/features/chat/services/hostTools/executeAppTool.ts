/**
 * M2 — executeAppTool (host tool switch). Domain: models, forge, diagnostics, settings.
 */
import type { AppToolCall, AppToolName } from '@core/agent'
import {
  formatStatusForPrompt,
  listAppDataKeys,
  clearAllKawaiiLocalData,
  smartCleanupDiagnostics,
  pruneAppDiagnostics
} from '@core/agent'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'
import { runSelfDiagnosis } from '@core/diagnostics/self-heal'
import { discoverLocalModelsFull } from '@core/providers'
import type { ChatTask } from '@core/routing'
import {
  modelRegistry,
  buildAppStatusSnapshot,
  invalidateAppAgentStatusCache,
  applyAutoModelRouting,
  syncInstalledFromOllama,
  listOllamaModelNames,
  setStatusCache
} from './shared'

export async function executeAppTool(call: AppToolCall): Promise<{ ok: boolean; summary: string }> {
  invalidateAppAgentStatusCache()
  const s = useSettingsStore.getState()
  switch (call.tool) {
    case 'get_app_status': {
      const snap = await buildAppStatusSnapshot()
      invalidateAppAgentStatusCache()
      const layerTxt = Array.isArray((snap as { layers?: string[] }).layers)
        ? (snap as { layers: string[] }).layers.join(' | ')
        : formatStatusForPrompt(snap)
      const summary =
        layerTxt +
        (snap.notes?.length ? ' || notas: ' + snap.notes.slice(0, 6).join(' · ') : '')
      setStatusCache({ at: Date.now(), text: summary })
      return { ok: true, summary }
    }
    case 'set_provider_mode': {
      const mode = String(call.args?.mode || '')
      if (!['local', 'cloud', 'smart'].includes(mode)) {
        return { ok: false, summary: 'mode debe ser local|cloud|smart' }
      }
      s.update({ providerMode: mode as 'local' | 'cloud' | 'smart' })
      return { ok: true, summary: `Modo de chat → ${mode}` }
    }
    case 'set_local_model': {
      const model = String(call.args?.model || '').trim()
      if (!model) return { ok: false, summary: 'Falta args.model' }
      s.update({ localModel: model })
      return { ok: true, summary: `Modelo local → ${model}` }
    }
    case 'list_models': {
      await syncInstalledFromOllama(s.settings.localBaseUrl)
      const models = modelRegistry.getCatalog().models
      const installed = new Set(modelRegistry.listInstalled().map((m) => m.id))
      return {
        ok: true,
        summary: models
          .map(
            (model) =>
              `${model.displayName} [${model.id}] ref=${model.modelRef} · ${model.capabilities.join('/')} · RAM≥${model.minRamGB}GB · ${installed.has(model.id) ? 'INSTALADO' : 'no instalado'} · ${model.license}`
          )
          .join(' | ')
      }
    }
    case 'list_installed_models': {
      try {
        let ram = 32
        try {
          const p = await window.kawaii?.machineEnsureProfile?.()
          const mem = (p as { profile?: { totalMemoryGB?: number } })?.profile?.totalMemoryGB
          if (typeof mem === 'number') ram = mem
        } catch {
          /* ignore */
        }
        const snap = await discoverLocalModelsFull({
          ollamaBaseUrl: s.settings.localBaseUrl,
          openAIBaseUrl: (s.settings.localOpenAIBaseUrl || '').trim() || undefined,
          ramGB: ram
        })
        if (!snap.models.length) {
          return {
            ok: false,
            summary:
              'Ningún modelo local. Inicia Ollama o en LM Studio: Developer → Start Server (puerto 1234) y carga un modelo. También se buscan carpetas ~/.ollama y LM Studio en disco.'
          }
        }
        const parts = snap.models.map((m) => {
          const role =
            /moondream|llava|vision|bakllava|minicpm-v/i.test(m.name)
              ? 'visión'
              : /coder|code|deepseek-coder/i.test(m.name)
                ? 'código'
                : 'chat'
          const src =
            m.source === 'ollama-disk'
              ? 'ollama-disco'
              : m.source === 'lmstudio-disk'
                ? 'lmstudio-disco'
                : m.source
          return `${m.name} (${role}, ${src}${
            snap.recommended?.id === m.id ? ', ★recomendado' : ''
          })`
        })
        const rt = [
          snap.ollama ? 'Ollama' : null,
          snap.openAI ? snap.openAI.label : null,
          !snap.ollama && !snap.openAI && snap.diskCount ? 'solo disco' : null
        ]
          .filter(Boolean)
          .join(' + ')
        return {
          ok: true,
          summary:
            `Runtime: ${rt || 'ninguno'} | Modelos (${snap.models.length}): ` +
            parts.slice(0, 20).join(' · ')
        }
      } catch (e) {
        return { ok: false, summary: String(e) }
      }
    }
    case 'auto_route_model': {
      const taskArg = call.args?.task ? String(call.args.task) : undefined
      const text = String(call.args?.text || call.args?.goal || 'chat')
      const r = await applyAutoModelRouting(text, {
        forceTask: taskArg as ChatTask | undefined,
        hasImageAttachment: Boolean(call.args?.hasImage)
      })
      return {
        ok: true,
        summary: r.applied
          ? `Routing: ${r.from} → ${r.to} (${r.task}) · ${r.reason}`
          : `Sin cambio: ${r.reason}`
      }
    }
    case 'recommend_model': {
      await syncInstalledFromOllama(s.settings.localBaseUrl)
      const task = String(call.args?.task || 'chat') as
        | 'chat'
        | 'code'
        | 'vision'
        | 'tools'
        | 'summary'
      let ram = 64
      try {
        const p = await window.kawaii?.machineEnsureProfile?.()
        const mem = (p as { profile?: { totalMemoryGB?: number } })?.profile?.totalMemoryGB
        if (typeof mem === 'number' && mem > 0) ram = mem
      } catch {
        /* ignore */
      }
      const recommendations = modelRegistry.recommend(task, ram)
      return {
        ok: recommendations.length > 0,
        summary: recommendations.length
          ? recommendations
              .slice(0, 4)
              .map(
                (model) =>
                  `${model.displayName} [${model.id}] · ref ${model.modelRef} · minRAM ${model.minRamGB}GB`
              )
              .join(' · ')
          : `No hay modelos compatibles con ${task} para ~${ram}GB RAM`
      }
    }
    case 'check_local_runtime': {
      const health = await window.kawaii?.ollamaStatus?.(s.settings.localBaseUrl)
      const jobs = await window.kawaii?.ollamaListPullJobs?.()
      const jobN = jobs?.jobs?.length ?? 0
      return {
        ok: Boolean(health?.reachable),
        summary: health?.reachable
          ? `Ollama OK${jobN ? ` · ${jobN} descarga(s) en recovery` : ''}`
          : 'Ollama no disponible — usa start_ollama o instálalo'
      }
    }
    case 'set_active_model': {
      await syncInstalledFromOllama(s.settings.localBaseUrl)
      const modelId = String(call.args?.modelId || call.args?.model || '').trim()
      const model =
        modelRegistry.find(modelId) ||
        modelRegistry.getCatalog().models.find(
          (m) => m.modelRef === modelId || m.displayName === modelId
        )
      if (!model) {
        // Allow raw ollama tag if already installed
        const live = await listOllamaModelNames(s.settings.localBaseUrl)
        if (live.includes(modelId)) {
          s.update({ localModel: modelId })
          return { ok: true, summary: `Modelo activo → ${modelId} (tag Ollama)` }
        }
        return { ok: false, summary: 'Modelo desconocido. Usa list_models o list_installed_models.' }
      }
      if (!model.capabilities.includes('chat')) {
        return { ok: false, summary: 'El modelo no tiene capacidad chat' }
      }
      modelRegistry.setActive('chat', model.id)
      s.update({ localModel: model.modelRef })
      const installed = modelRegistry.listInstalled().some((m) => m.id === model.id)
      return {
        ok: true,
        summary: installed
          ? `Modelo activo → ${model.displayName} (${model.modelRef})`
          : `Modelo activo → ${model.displayName}, pero NO está instalado. Usa download_model modelId=${model.id}`
      }
    }
    case 'download_model': {
      const raw = String(call.args?.modelId || call.args?.model || '').trim()
      if (!raw) return { ok: false, summary: 'Falta args.modelId o args.model' }
      const model =
        modelRegistry.find(raw) ||
        modelRegistry.getCatalog().models.find((m) => m.modelRef === raw)
      const ref = model?.modelRef || raw
      try {
        const { unifiedPullModel, bridgesFromWindow } = await import('@core/providers/local-pull')
        // Fire unified pull (Ollama primary, LM Studio / HF fallback) without blocking forever
        const pullPromise = unifiedPullModel({
          model: ref,
          ollamaBaseUrl: s.settings.localBaseUrl,
          openAIBaseUrl: (s.settings.localOpenAIBaseUrl || '').trim() || undefined,
          tryStartOllama: true,
          bridges: bridgesFromWindow()
        })
        void pullPromise.then((r) => {
          if (r.acquired && model) modelRegistry.markInstalled(model.id)
          if (r.activeModel) {
            try {
              s.update({ localModel: r.activeModel })
            } catch {
              /* ignore */
            }
          }
        })
        return {
          ok: true,
          summary:
            `Adquisición unificada iniciada: ${ref}` +
            (model ? ` [${model.id}] · minRAM ${model.minRamGB}GB` : '') +
            `. Canales: Ollama pull (si está) → LM Studio guía → HF. ` +
            `Progreso en barra de descargas. pause/cancel_download model=${ref}`
        }
      } catch (e) {
        return { ok: false, summary: String(e) }
      }
    }
    case 'pause_download':
    case 'cancel_download': {
      const model = String(call.args?.model || call.args?.modelId || '').trim()
      try {
        await window.kawaii?.ollamaPullCancel?.(model || undefined)
        return {
          ok: true,
          summary: model
            ? `Descarga cancelada/pausada: ${model}. resume_download model=${model} reanuda el pull de Ollama.`
            : 'Todas las descargas Ollama canceladas'
        }
      } catch (e) {
        return { ok: false, summary: String(e) }
      }
    }
    case 'resume_download': {
      const raw = String(call.args?.model || call.args?.modelId || '').trim()
      if (!raw) return { ok: false, summary: 'Falta args.model' }
      const model =
        modelRegistry.find(raw) ||
        modelRegistry.getCatalog().models.find((m) => m.modelRef === raw)
      const ref = model?.modelRef || raw
      try {
        void window.kawaii?.ollamaPull?.(ref, s.settings.localBaseUrl)
        return { ok: true, summary: `Reanudando pull Ollama: ${ref}` }
      } catch (e) {
        return { ok: false, summary: String(e) }
      }
    }
    case 'delete_model': {
      const raw = String(call.args?.modelId || call.args?.model || '').trim()
      if (!raw) return { ok: false, summary: 'Falta args.modelId o args.model' }
      const model =
        modelRegistry.find(raw) ||
        modelRegistry.getCatalog().models.find((m) => m.modelRef === raw)
      const ref = model?.modelRef || raw
      try {
        const r = await window.kawaii?.ollamaDelete?.(ref, s.settings.localBaseUrl)
        if (model) modelRegistry.markUninstalled(model.id)
        const ok = Boolean((r as { ok?: boolean })?.ok !== false)
        return {
          ok,
          summary: ok ? `Modelo eliminado: ${ref}` : `No se pudo eliminar ${ref}: ${JSON.stringify(r).slice(0, 120)}`
        }
      } catch (e) {
        return { ok: false, summary: String(e) }
      }
    }
    case 'list_download_jobs': {
      try {
        const r = await window.kawaii?.ollamaListPullJobs?.()
        const jobs = r?.jobs || []
        if (!jobs.length) return { ok: true, summary: 'No hay descargas Ollama pendientes' }
        return {
          ok: true,
          summary: jobs
            .map(
              (j) =>
                `${j.model}: ${j.status}${typeof j.progress === 'number' ? ` ${Math.round(j.progress)}%` : ''}${j.error ? ` · ${j.error}` : ''}`
            )
            .join(' · ')
        }
      } catch (e) {
        return { ok: false, summary: String(e) }
      }
    }
    case 'set_image_mode': {
      const mode = String(call.args?.mode || '')
      if (!['off', 'local', 'cloud', 'smart'].includes(mode)) {
        return { ok: false, summary: 'mode=off|local|cloud|smart' }
      }
      s.update({
        imageProviderMode: mode as 'off' | 'local' | 'cloud' | 'smart',
        imageGenEnabled: mode !== 'off'
      })
      return { ok: true, summary: `Imágenes → ${mode}` }
    }
    case 'set_ui_mode': {
      const mode = String(call.args?.mode || '')
      if (!['smart', 'advanced'].includes(mode)) {
        return { ok: false, summary: 'mode=smart|advanced' }
      }
      s.update({ uiComplexity: mode as 'smart' | 'advanced' })
      return { ok: true, summary: `UI → ${mode}` }
    }
    case 'start_forge': {
      try {
        // forge:start en main ya hace unload de LLMs grandes; refuerzo explícito opcional
        try {
          await window.kawaii?.unloadLocalModels?.({ minSizeGB: 4 })
        } catch {
          /* main also unloads */
        }
        const st = (await window.kawaii?.forgeStart?.()) as {
          state?: string
          baseUrl?: string | null
          port?: number | null
          message?: string
          unloadNote?: string
        } | null
        const state = String(st?.state || '')
        const base = (st?.baseUrl || '').replace(/\/$/, '')
        const msg = String(st?.message || '').trim()
        const unload = String(st?.unloadNote || '').trim()
        // E-HMSG: no tratar R2/unload como el mensaje principal de fallo
        const lines: string[] = []
        if (state === 'running' || (base && /listo|running|http/i.test(msg + base))) {
          lines.push(base ? `Forge listo en ${base}.` : 'Forge en marcha.')
        } else if (state === 'starting') {
          lines.push(msg || 'Forge arrancando…')
        } else if (state === 'error') {
          lines.push(msg || 'Forge reportó error al arrancar.')
        } else {
          lines.push(msg || 'Arranque de Forge solicitado.')
        }
        if (unload) {
          if (/ning[uú]n modelo|ningun modelo|0 modelo|sin modelos/i.test(unload)) {
            lines.push('(No había LLM de Ollama en VRAM que liberar — normal.)')
          } else {
            lines.push(`Memoria: ${unload.slice(0, 140)}`)
          }
        }
        const ok = state !== 'error'
        return { ok, summary: lines.join(' ') }
      } catch (e) {
        return { ok: false, summary: String(e) }
      }
    }
    case 'stop_forge': {
      try {
        await window.kawaii?.forgeStop?.()
        return { ok: true, summary: 'Forge detenido' }
      } catch (e) {
        return { ok: false, summary: String(e) }
      }
    }
    case 'health_forge': {
      try {
        const h =
          (await window.kawaii?.forgeRefreshHealth?.()) ||
          (await window.kawaii?.imageA1111Health?.())
        const obj = h && typeof h === 'object' ? (h as Record<string, unknown>) : {}
        const state = String(obj.state || '')
        const base = String(obj.baseUrl || obj.base || '').replace(/\/$/, '')
        const msg = String(obj.message || obj.error || '').trim()
        const apiOk = obj.apiOk === true || obj.ok === true
        const running =
          state === 'running' ||
          (apiOk && Boolean(base)) ||
          (/listo|running/i.test(msg) && Boolean(base))
        // E-HMSG2: never OK when stopped; no raw JSON
        if (running) {
          return {
            ok: true,
            summary: base ? 'Forge API OK en ' + base + '.' : 'Forge API OK (en marcha).'
          }
        }
        if (state === 'starting') {
          return { ok: false, summary: ('Forge arrancando… ' + msg.slice(0, 140)).trim() }
        }
        const clean = msg
          .replace(/No se detectó GPU NVIDIA dedicada\.?/gi, '')
          .replace(/Forge CUDA no es fiable aquí;?\s*usa generación cloud \(Pollinations\)\.?/gi, '')
          .replace(/\s+/g, ' ')
          .trim()
        if (state === 'error') {
          return {
            ok: false,
            summary: ('Forge en error. ' + (clean || msg || 'Revisa Capas → log de Forge.')).slice(
              0,
              280
            )
          }
        }
        return {
          ok: false,
          summary: (
            'Forge detenido (API no responde). ' +
            (clean || 'Di «arranca Forge» o usa Capas → Arrancar Forge.')
          ).slice(0, 280)
        }
      } catch (e) {
        return { ok: false, summary: String(e) }
      }
    }
    case 'scan_local_models': {
      try {
        const r = await window.kawaii?.catalogScanLocalModels?.(true)
        if (!r?.ok && !r?.count) {
          return { ok: false, summary: r?.error || 'No se pudo escanear modelos' }
        }
        const top = (r.rows || [])
          .slice()
          .sort((a: any, b: any) => (b.scoreChat || 0) - (a.scoreChat || 0))
          .slice(0, 8)
          .map(
            (x: any) =>
              `· **${x.id}** (${x.runtime}) chat:${x.scoreChat} razon:${x.scoreReason} rápido:${x.scoreFast}`
          )
        return {
          ok: true,
          summary:
            `Catálogo local: **${r.count}** modelos` +
            (r.fromCache ? ' (caché)' : ' (escaneo fresco)') +
            (r.error ? `\n_${r.error}_` : '') +
            (top.length ? '\n\nTop chat:\n' + top.join('\n') : '')
        }
      } catch (e) {
        return { ok: false, summary: String(e) }
      }
    }
    case 'list_model_scores': {
      try {
        const r = await window.kawaii?.catalogListModelScores?.()
        const rows = (r?.rows || []) as any[]
        if (!rows.length) {
          return {
            ok: true,
            summary: 'Aún no hay scores en caché. Di *«rescanea modelos»*.'
          }
        }
        const lines = rows
          .slice()
          .sort((a, b) => (b.scoreChat || 0) - (a.scoreChat || 0))
          .slice(0, 12)
          .map(
            (x) =>
              `· ${x.id} · ${x.runtime} · chat ${x.scoreChat} / razón ${x.scoreReason}`
          )
        return {
          ok: true,
          summary:
            `Scores en DB (${rows.length}).` +
            (r?.dbPath ? `\nRuta: \`${r.dbPath}\`` : '') +
            '\n' +
            lines.join('\n')
        }
      } catch (e) {
        return { ok: false, summary: String(e) }
      }
    }
    case 'list_host_commands': {
      try {
        const { formatCommandCatalogForChat } = await import('@core/agent/host-command-catalog')
        const { formatCapabilitiesForChat } = await import('@core/agent/capabilities-registry')
        return {
          ok: true,
          summary:
            formatCapabilitiesForChat() +
            '\n\n---\n\n' +
            formatCommandCatalogForChat()
        }
      } catch (e) {
        return { ok: false, summary: String(e) }
      }
    }
    case 'assess_image_stack': {
      try {
        const lines: string[] = []
        let forgeOk = false
        let forgeState = ''
        let checkpointCount = 0
        let cnNames: string[] = []
        let hasFaceIdDisk = false
        try {
          const h =
            (await window.kawaii?.forgeRefreshHealth?.()) ||
            (await window.kawaii?.imageA1111Health?.())
          forgeOk = Boolean((h as { ok?: boolean })?.ok)
          forgeState = String((h as { state?: string })?.state || (forgeOk ? 'ok' : 'down'))
        } catch {
          forgeState = 'error'
        }
        try {
          const base = (s.settings.a1111BaseUrl || '').trim() || undefined
          const models = await window.kawaii?.imageA1111Models?.(base)
          checkpointCount = ((models as { models?: unknown[] })?.models || []).length
        } catch {
          /* */
        }
        try {
          const base = (s.settings.a1111BaseUrl || '').trim() || undefined
          const cn = await window.kawaii?.imageControlNetModels?.(base)
          if (cn?.ok && Array.isArray(cn.models)) cnNames = cn.models
        } catch {
          /* */
        }
        try {
          const hf = await window.kawaii?.forgeHasFaceId?.()
          hasFaceIdDisk = Boolean(hf?.hasFaceId)
        } catch {
          /* */
        }
        const char = s.settings.character
        const hasAvatar = Boolean(
          char &&
            (typeof (char as { avatarDataUrl?: string }).avatarDataUrl === 'string' ||
              typeof (char as { avatarPath?: string }).avatarPath === 'string' ||
              typeof (char as { visualDescription?: string }).visualDescription === 'string')
        )
        const { assessImageStackGaps, formatStackGapsForChat } = await import(
          '@core/image/stack-gaps'
        )
        const gaps = assessImageStackGaps({
          forgeOk,
          forgeState,
          checkpointCount,
          controlNetModels: cnNames,
          hasFaceIdDisk,
          hasFaceIdApi: cnNames.some((m) => /faceid/i.test(m)),
          hasAvatar,
          forSelfPortrait: true
        })
        return { ok: true, summary: formatStackGapsForChat(gaps) }
      } catch (e) {
        return { ok: false, summary: String(e) }
      }
    }
    case 'ensure_controlnet': {
      try {
        const r = await window.kawaii?.forgeInstallControlNetModels?.()
        return {
          ok: Boolean(r?.ok),
          summary: r?.ok
            ? `ControlNet básico: ${(r.installed || []).join(', ') || 'ok'}`
            : r?.error || 'No se pudo instalar ControlNet'
        }
      } catch (e) {
        return { ok: false, summary: String(e) }
      }
    }
    case 'probe_forge': {
      try {
        const lines: string[] = []
        const h =
          (await window.kawaii?.forgeRefreshHealth?.()) ||
          (await window.kawaii?.imageA1111Health?.())
        const ok = Boolean((h as { ok?: boolean })?.ok)
        lines.push(ok ? 'Forge/API: OK' : `Forge/API: no OK · ${JSON.stringify(h).slice(0, 160)}`)
        try {
          const base = (s.settings.a1111BaseUrl || '').trim() || undefined
          const models = await window.kawaii?.imageA1111Models?.(base)
          const list = (models as { models?: Array<{ title?: string; model_name?: string }> })?.models || []
          lines.push(`Checkpoints: ${list.length}`)
          for (const m of list.slice(0, 8)) {
            lines.push(`  · ${m.model_name || m.title || '?'}`)
          }
        } catch (e) {
          lines.push(`Checkpoints: error ${e instanceof Error ? e.message : String(e)}`)
        }
        let cnNames: string[] = []
        try {
          const base = (s.settings.a1111BaseUrl || '').trim() || undefined
          const cn = await window.kawaii?.imageControlNetModels?.(base)
          if (cn?.ok && Array.isArray(cn.models)) cnNames = cn.models
        } catch {
          /* */
        }
        if (!cnNames.length) {
          try {
            const { assessFaceIdFromModelNames } = await import('@core/image/faceid-status')
            const st = assessFaceIdFromModelNames([])
            lines.push(`ControlNet: sin lista · ${st.message}`)
          } catch {
            lines.push('ControlNet: sin lista')
          }
        } else {
          const { assessFaceIdFromModelNames } = await import('@core/image/faceid-status')
          const st = assessFaceIdFromModelNames(cnNames)
          lines.push(`ControlNet: ${cnNames.length} modelos`)
          lines.push(
            st.available
              ? `FaceID: SÍ (${st.kind}${st.modelName ? ` · ${st.modelName}` : ''})`
              : `FaceID: NO · ${st.message}`
          )
        }
        return { ok: true, summary: lines.join('\n') }
      } catch (e) {
        return { ok: false, summary: String(e) }
      }
    }

        case 'assess_identity_stack': {
      try {
        const disk = await window.kawaii?.forgeHasFaceId?.()
        const probe = await window.kawaii?.forgeProbe?.()
        const cn = (probe as { controlNetModels?: string[] })?.controlNetModels || []
        const present = (cn.join(' ') + ' ' + ((disk as { files?: string[] })?.files || []).join(' ')).toLowerCase()
        const hasFace = /faceid/i.test(present) || Boolean((disk as { hasFaceId?: boolean })?.hasFaceId)
        const hasLora =
          Boolean((disk as { hasLora?: boolean })?.hasLora) || /faceid.*lora|lora.*faceid/i.test(present)
        const bits: string[] = []
        bits.push(hasFace ? 'FaceID: en disco/ControlNet' : 'FaceID: FALTA — di «instala FaceID»')
        bits.push(
          hasLora
            ? 'LoRA FaceID: detectada'
            : 'LoRA FaceID: no listada — instala FaceID (trae el .safetensors) y reinicia Forge'
        )
        bits.push('Autorretrato usa batch=1 + tag LoRA en prompt (app 0.9.104+).')
        if (!hasFace) {
          return { ok: false, summary: bits.join(' · ') }
        }
        return {
          ok: hasLora,
          summary: bits.join(' · ') + (hasLora ? '' : ' · Identidad puede salir débil sin LoRA.')
        }
      } catch (e) {
        return {
          ok: false,
          summary: e instanceof Error ? e.message : String(e)
        }
      }
    }
case 'ensure_faceid': {
      try {
        const has = await window.kawaii?.forgeHasFaceId?.()
        if (has?.hasFaceId) {
          return { ok: true, summary: `FaceID ya en disco · ${has.dir || ''}` }
        }
        const unsub = window.kawaii?.onForgeFaceIdProgress?.((p) => {
          /* progress visible via harness log only if host surfaces it */
        })
        const r = await window.kawaii?.forgeInstallFaceId?.()
        try {
          unsub?.()
        } catch {
          /* */
        }
        if (r?.ok) {
          return {
            ok: true,
            summary: `FaceID instalado: ${(r.installed || []).join(', ') || 'ok'}. Reinicia Forge si no aparece en ControlNet.`
          }
        }
        return { ok: false, summary: r?.error || 'No se pudo instalar FaceID' }
      } catch (e) {
        return { ok: false, summary: String(e) }
      }
    }
    case 'check_faceid': {
      try {
        let names: string[] = []
        try {
          const base = (s.settings.a1111BaseUrl || '').trim() || undefined
          const cn = await window.kawaii?.imageControlNetModels?.(base)
          if (cn?.ok && Array.isArray(cn.models)) names = cn.models
        } catch {
          /* */
        }
        const { assessFaceIdFromModelNames } = await import('@core/image/faceid-status')
        const st = assessFaceIdFromModelNames(names)
        return {
          ok: st.available,
          summary: st.available
            ? `FaceID disponible (${st.kind}${st.modelName ? `: ${st.modelName}` : ''}) · ${st.message}`
            : st.message
        }
      } catch (e) {
        return { ok: false, summary: String(e) }
      }
    }
    case 'preview_scene': {
      try {
        const text = String(call.args?.text || call.args?.prompt || '').trim()
        if (!text) return { ok: false, summary: 'Falta args.text con la descripción de escena' }
        const { parseSceneSpecFromText, sceneSpecToSdFragments } = await import(
          '@core/image/scene-spec'
        )
        const { applySceneForceToPrompts } = await import('@core/image/scene-force')
        const scene = parseSceneSpecFromText(text)
        const frag = sceneSpecToSdFragments(scene)
        const forced = applySceneForceToPrompts(frag.positive.join(', '), frag.negative.join(', '), text, scene)
        return {
          ok: true,
          summary: [
            `framing=${scene.framing} self=${scene.isSelf}`,
            `clothing=${JSON.stringify(scene.clothing)}`,
            `env=${scene.environment || '—'} night=${scene.timeOfDay || '—'}`,
            `+ ${forced.prompt.slice(0, 400)}`,
            `− ${forced.negative.slice(0, 250)}`
          ].join('\n')
        }
      } catch (e) {
        return { ok: false, summary: String(e) }
      }
    }
    case 'clean_diagnostics_exports': {
      try {
        const r = await window.kawaii?.diagnosticsClearExports?.()
        return {
          ok: Boolean(r?.ok !== false),
          summary: `Exports en disco: ${r?.removed ?? 0} eliminados${r?.dir ? ` · ${r.dir}` : ''}`
        }
      } catch (e) {
        return { ok: false, summary: String(e) }
      }
    }
    case 'start_ollama': {
      try {
        const r = await window.kawaii?.ollamaStart?.(s.settings.localBaseUrl)
        return { ok: Boolean((r as { ok?: boolean })?.ok !== false), summary: JSON.stringify(r).slice(0, 200) }
      } catch (e) {
        return { ok: false, summary: String(e) }
      }
    }
        case 'web_search': {
      const q = String(call.args?.query || call.args?.q || '').trim()
      if (!q) return { ok: false, summary: 'Falta query para web_search' }
      try {
        const results = await window.kawaii.webSearch(q, Number(call.args?.maxResults) || 5)
        if (!results.length) {
          return {
            ok: false,
            summary: 'web_search: 0 resultados (backends vacíos o red bloqueada)'
          }
        }
        const lines = results.map(
          (r, i) =>
            (i + 1) +
            '. ' +
            r.title +
            (r.url ? ' — ' + r.url : '') +
            '\n   ' +
            (r.snippet || '').slice(0, 180)
        )
        return {
          ok: true,
          summary: 'web_search (' + results.length + '):\n' + lines.join('\n')
        }
      } catch (e) {
        return {
          ok: false,
          summary: 'web_search error: ' + (e instanceof Error ? e.message : String(e))
        }
      }
    }
case 'run_diagnosis': {
      try {
        const live = s.settings
        const report = await runSelfDiagnosis({
          localBaseUrl: live.localBaseUrl,
          localModel: live.localModel,
          cloudBaseUrl: live.cloudBaseUrl,
          hasCloudKey: false,
          providerMode: live.providerMode,
          ollamaStart: async () => {
            const result = await window.kawaii?.ollamaStart?.(live.localBaseUrl)
            return { ok: Boolean(result?.ok), message: result?.message || 'Ollama solicitado' }
          },
          imageGenEnabled: live.imageGenEnabled,
          imageProviderMode: live.imageProviderMode,
          a1111BaseUrl: live.a1111BaseUrl,
          cloudflareAccountId: live.cloudflareAccountId,
          cloudflareProbe: async (id: string) =>
            (await window.kawaii?.imageCloudflareProbe?.(id)) ?? { ok: false, error: 'n/a' },
          imageA1111Health: async (url?: string) =>
            (await window.kawaii?.imageA1111Health?.(url)) ?? { ok: false, error: 'n/a' }
        })
        return {
          ok: Boolean(report?.healthy),
          summary: (report?.checks || [])
            .map((c) => `${c.status}: ${c.label}`)
            .slice(0, 8)
            .join(' · ') || 'Diagnóstico listo'
        }
      } catch (e) {
        return { ok: false, summary: String(e) }
      }
    }
    case 'start_music': {
      try {
        const r = await window.kawaii?.musicEnsureReady?.()
        const ok = Boolean((r as { ok?: boolean })?.ok !== false)
        return {
          ok,
          summary: ok
            ? `Música lista: ${JSON.stringify(r).slice(0, 180)}`
            : `Música no lista: ${JSON.stringify(r).slice(0, 180)}`
        }
      } catch (e) {
        return { ok: false, summary: String(e) }
      }
    }
    case 'stop_music': {
      try {
        const r = await window.kawaii?.musicStop?.()
        return { ok: true, summary: `Música detenida ${JSON.stringify(r).slice(0, 120)}` }
      } catch (e) {
        return { ok: false, summary: String(e) }
      }
    }
    case 'voice_ensure': {
      try {
        const r = await window.kawaii?.voiceEnsure?.()
        return {
          ok: Boolean((r as { ok?: boolean })?.ok),
          summary: JSON.stringify(r).slice(0, 200)
        }
      } catch (e) {
        return { ok: false, summary: String(e) }
      }
    }
    case 'open_settings_hint':
      return { ok: true, summary: 'Abre Ajustes (icono engranaje) para cambios manuales.' }
    case 'list_app_logs': {
      const keys = listAppDataKeys()
      return {
        ok: true,
        summary: keys.length ? `Claves locales: ${keys.join(', ')}` : 'Sin datos kawaii-gpt en localStorage'
      }
    }
    case 'clear_app_logs': {
      const mode = String(call.args?.mode || 'soft').toLowerCase()
      if (mode === 'all') {
        const r = clearAllKawaiiLocalData()
        return { ok: r.ok, summary: `Limpieza total: ${r.detail} · ${r.cleared.join(', ')}` }
      }
      if (mode === 'smart' || mode === 'auto') {
        const r = smartCleanupDiagnostics()
        return {
          ok: r.ok,
          summary: `Limpieza smart (tests/logs obsoletos): ${r.detail}. Borrado: ${r.cleared.join(', ') || 'nada'}`
        }
      }
      if (mode === 'telemetry') {
        try {
          const { clearRouteTelemetry } = await import('@core/telemetry/route-telemetry')
          clearRouteTelemetry()
          return { ok: true, summary: 'Telemetría de rutas/modelos borrada (aprendizaje local reiniciado)' }
        } catch (e) {
          return { ok: false, summary: String(e) }
        }
      }
      const r = pruneAppDiagnostics({
        clearFailures: true,
        clearSuccess: mode === 'success' || mode === 'soft',
        clearFeedbackActive: mode === 'feedback' || mode === 'hard',
        clearFeedbackArchives: mode === 'feedback' || mode === 'hard',
        clearTestHistory: mode === 'tests' || mode === 'hard' || mode === 'soft'
      })
      return {
        ok: r.ok,
        summary: `Limpieza (${mode}): ${r.detail}. Borrado: ${r.cleared.join(', ') || 'nada'}`
      }
    }
    case 'rename_conversation': {
      let title = String(call.args?.title || call.args?.name || '').trim()
      title = title
        .replace(/^(?:este\s+)?(?:chat|conversaci[oó]n)\s+a\s+/i, '')
        .replace(/^renombra(?:r)?\s+/i, '')
        .replace(/^[«"']|[»"']$/g, '')
        .trim()
        .slice(0, 60)
      if (!title) return { ok: false, summary: 'Falta args.title' }
      try {
        const { useChatStore } = await import('@shared/lib/stores/chatStore')
        const store = useChatStore.getState()
        const id = store.activeId
        if (!id) return { ok: false, summary: 'No hay chat activo' }
        store.rename(id, title)
        return { ok: true, summary: `Chat renombrado → «${title}»` }
      } catch (e) {
        return { ok: false, summary: String(e) }
      }
    }

    case 'analyze_identity_refs': {
      try {
        const refsRaw = call.args?.refs ?? call.args?.ref
        const refs: string[] = Array.isArray(refsRaw)
          ? refsRaw.map(String).filter(Boolean)
          : refsRaw
            ? [String(refsRaw)]
            : []
        if (!refs.length) {
          return {
            ok: false,
            summary: 'Falta args.refs (rutas). Plugin E4: tools/identity_match.py analyze'
          }
        }
        const args = refs.flatMap((r) => ['--ref', r])
        const res = await window.kawaii?.pythonRunToolScript?.({
          script: 'identity_match.py',
          args: ['analyze', ...args],
          timeoutMs: 90_000
        })
        if (!res) return { ok: false, summary: 'pythonRunToolScript no disponible' }
        const j = res.json as { ok?: boolean; summary?: string; reason?: string } | null
        if (j && typeof j === 'object') {
          return {
            ok: Boolean(j.ok !== false && j.reason !== 'deps_missing'),
            summary:
              j.summary ||
              (j.reason === 'deps_missing'
                ? 'Plugin identity-match sin InsightFace (opcional). FaceID de Forge sigue activo.'
                : res.stderr || res.stdout || 'sin salida')
          }
        }
        return {
          ok: Boolean(res.ok),
          summary: (res.stdout || res.stderr || res.error || 'sin salida').slice(0, 500)
        }
      } catch (e) {
        return { ok: false, summary: e instanceof Error ? e.message : String(e) }
      }
    }
    case 'score_identity_match': {
      try {
        const ref = String(call.args?.ref || call.args?.reference || '').trim()
        const image = String(call.args?.image || call.args?.path || '').trim()
        if (!ref || !image) {
          return {
            ok: false,
            summary: 'Faltan args.ref y args.image. Plugin E4: tools/identity_match.py score'
          }
        }
        const threshold = Number(call.args?.threshold ?? 0.45)
        const res = await window.kawaii?.pythonRunToolScript?.({
          script: 'identity_match.py',
          args: [
            'score',
            '--ref',
            ref,
            '--image',
            image,
            '--threshold',
            String(threshold)
          ],
          timeoutMs: 60_000
        })
        if (!res) return { ok: false, summary: 'pythonRunToolScript no disponible' }
        const j = res.json as {
          ok?: boolean
          summary?: string
          reason?: string
        } | null
        if (j && typeof j === 'object') {
          return {
            ok: Boolean(j.ok !== false && j.reason !== 'deps_missing'),
            summary:
              j.summary ||
              (j.reason === 'deps_missing'
                ? 'Plugin identity-match sin InsightFace (opcional).'
                : res.stderr || res.stdout || 'sin salida')
          }
        }
        return {
          ok: Boolean(res.ok),
          summary: (res.stdout || res.stderr || res.error || 'sin salida').slice(0, 500)
        }
      } catch (e) {
        return { ok: false, summary: e instanceof Error ? e.message : String(e) }
      }
    }
    case 'score_face_match': {
      try {
        const ref = String(call.args?.ref || call.args?.reference || '').trim()
        const image = String(call.args?.image || call.args?.path || '').trim()
        if (!ref || !image) {
          return {
            ok: false,
            summary:
              'Faltan args.ref y args.image (rutas de archivo). Plugin: tools/face_similarity.py'
          }
        }
        const threshold = Number(call.args?.threshold ?? 0.5)
        const res = await window.kawaii?.pythonRunToolScript?.({
          script: 'face_similarity.py',
          args: ['--ref', ref, '--image', image, '--threshold', String(threshold), '--json'],
          timeoutMs: 60_000
        })
        if (!res) return { ok: false, summary: 'pythonRunToolScript no disponible' }
        const j = res.json as {
          ok?: boolean
          score?: number
          same_person?: boolean
          summary?: string
          reason?: string
        } | null
        if (j && typeof j === 'object') {
          return {
            ok: Boolean(j.ok !== false && j.reason !== 'deps_missing'),
            summary:
              j.summary ||
              (j.reason === 'deps_missing'
                ? 'Plugin sin InsightFace (opcional). FaceID de Forge sigue activo.'
                : res.stderr || res.stdout || 'sin salida')
          }
        }
        return {
          ok: Boolean(res.ok),
          summary: (res.stdout || res.stderr || res.error || 'sin salida').slice(0, 500)
        }
      } catch (e) {
        return { ok: false, summary: e instanceof Error ? e.message : String(e) }
      }
    }
    case 'recover_settings': {
      try {
        const { runFullSettingsRecovery } = await import('@shared/lib/settings-backup')
        const { useSettingsStore } = await import('@shared/lib/stores/settingsStore')
        const cur = useSettingsStore.getState().settings
        const { settings, report } = await runFullSettingsRecovery(cur)
        if (report.recovered) {
          useSettingsStore.setState({ settings })
          try {
            const { backupSettingsNow } = await import('@shared/lib/settings-backup')
            if (typeof backupSettingsNow === 'function') backupSettingsNow(settings)
          } catch {
            /* optional */
          }
        }
        const lines = [
          report.recovered
            ? '**Recuperación:** se restauró desde «' + (report.source || '?') + '».'
            : '**Recuperación:** no había un backup mejor que lo actual.',
          'Score: ' + report.scoreBefore + ' → ' + report.scoreAfter,
          report.imageCandidates
            ? 'Imágenes en disco detectadas: ' + report.imageCandidates
            : '',
          '',
          ...report.notes.map((n: string) => '- ' + n)
        ].filter(Boolean)
        return { ok: true, summary: lines.join('\n') }
      } catch (e) {
        return {
          ok: false,
          summary: e instanceof Error ? e.message : String(e)
        }
      }
    }
    case 'run_chat_self_check': {
      try {
        const checks: string[] = []
        const snap = await buildAppStatusSnapshot()
        checks.push(snap.localOk ? '✓ runtime local' : '✗ runtime local')
        checks.push(snap.localModel ? `✓ modelo activo: ${snap.localModel}` : '⚠ sin modelo activo')
        try {
          const { humanizeHostObservations } = await import('@core/agent/humanize-host-reply')
          const sample = humanizeHostObservations(
            [
              JSON.stringify({
                tool: 'get_app_status',
                ok: true,
                summary: 'Chat local: OK | Ollama OK · LM Studio OK'
              })
            ],
            { userGoal: 'revisar estado de ollama' }
          )
          checks.push(
            sample && !sample.trim().startsWith('{')
              ? '✓ humanize host'
              : '✗ humanize host'
          )
        } catch {
          checks.push('✗ humanize host')
        }
        try {
          const { formatCapabilitiesForChat } = await import(
            '@core/agent/capabilities-registry'
          )
          const c = formatCapabilitiesForChat()
          checks.push(c.length > 40 ? '✓ registry capacidades' : '✗ registry vacío')

        try {
          const { wantsWebSearch } = await import('@core/tools/web-search-intent')
          checks.push(
            wantsWebSearch('busca en la web cómo cocer un huevo')
              ? '✓ intent web (busca en la web…)'
              : '✗ intent web'
          )
          checks.push(
            !wantsWebSearch('gracias linda, he estado leyendo')
              ? '✓ intent web no dispara en charla'
              : '✗ intent web falso positivo'
          )
        } catch {
          checks.push('✗ intent web (import)')
        }
        try {
          const { runFullSettingsRecovery, scoreSettings } = await import(
            '@shared/lib/settings-backup'
          )
          const { useSettingsStore } = await import('@shared/lib/stores/settingsStore')
          const cur = useSettingsStore.getState().settings
          const sc = scoreSettings(cur)
          checks.push(
            typeof sc.score === 'number'
              ? '✓ recovery scoreSettings (' + sc.score + ')'
              : '✗ scoreSettings'
          )
          const { report } = await runFullSettingsRecovery(cur)
          checks.push(
            report && typeof report.scoreBefore === 'number'
              ? '✓ recovery dry-run (' + report.scoreBefore + '→' + report.scoreAfter + ')'
              : '✗ recovery dry-run'
          )
        } catch (e) {
          checks.push(
            '✗ recovery: ' + (e instanceof Error ? e.message : String(e))
          )
        }
        try {
          const { decideRoute } = await import('@core/routing')
          const d = decideRoute({
            prompt: 'hola',
            networkOnline: true,
            localAvailable: true,
            cloudAvailable: true,
            preferLocal: true,
            webSearchEnabled: true,
            localMaxTokens: 2048,
            cloudMaxTokens: 4096
          })
          checks.push(
            d.target === 'local' || d.target === 'web-augmented-local'
              ? '✓ router hola→' + d.target
              : '⚠ router hola→' + d.target
          )
        } catch {
          checks.push('✗ router decideRoute')
        }

        } catch {
          checks.push('✗ registry capacidades')
        }
        try {
          const { buildVisionSystemHint } = await import('@core/chat/vision-attach')
          const h = buildVisionSystemHint({
            trimmed: '',
            imageCount: 1,
            characterName: 'Niamh',
            visualDescription: 'cabello cobrizo, ojos claros',
            galleryRefs: [{ label: 'vestido', scene: 'bosque', primary: false }]
          })
          checks.push(
            /identidad|galería|ficha/i.test(h) ? '✓ visión multi-ref' : '✗ visión hint'
          )
        } catch {
          checks.push('✗ visión multi-ref')
        }
        const ok = checks.every((c) => c.startsWith('✓'))
        return {
          ok,
          summary:
            (ok ? 'Self-check OK\n' : 'Self-check con avisos\n') + checks.join('\n')
        }
      } catch (e) {
        return { ok: false, summary: e instanceof Error ? e.message : String(e) }
      }
    }
    default:
      return { ok: false, summary: `Herramienta desconocida: ${call.tool}` }
  }
}
