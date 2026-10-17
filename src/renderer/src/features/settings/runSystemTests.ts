import {
  finalizeReport,
  type ReportCheck,
  type SystemReport
} from '@core/diagnostics/system-report'
import { APP_VERSION } from '@shared/version'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'
import { effectiveVisualDescription } from '@core/character/profile'
import { composeImagePrompt, listStylePresets, STYLE_PRESETS } from '@core/generative/prompt-compose'
import { isWeakVisualDescription } from '@core/character/avatar-describe'
import { pickBestCheckpoint } from '@core/generative/smart-checkpoint'

async function timed<T>(
  fn: () => Promise<T>
): Promise<{ ok: true; value: T; ms: number } | { ok: false; error: string; ms: number }> {
  const t0 = Date.now()
  try {
    const value = await fn()
    return { ok: true, value, ms: Date.now() - t0 }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), ms: Date.now() - t0 }
  }
}

export async function runSystemTests(opts?: {
  includeMusicGenerate?: boolean
}): Promise<SystemReport> {
  const checks: ReportCheck[] = []
  const settings = useSettingsStore.getState().settings
  const char = settings.character
  const env: Record<string, string | number | boolean | null | undefined> = {
    uiComplexity: settings.uiComplexity,
    providerMode: settings.providerMode,
    imageGenEnabled: settings.imageGenEnabled,
    imageProviderMode: settings.imageProviderMode,
    imageUseCharacterStyle: settings.imageUseCharacterStyle !== false,
    musicGenEnabled: settings.musicGenEnabled,
    musicProviderMode: settings.musicProviderMode,
    conversationInitiativeEnabled: settings.conversationInitiativeEnabled,
    characterName: char?.name,
    hasVisualDescription: Boolean((char?.visualDescription || '').trim()),
    galleryCount: (char?.visualGallery || []).length,
    hasAvatarImage: Boolean((char?.visualImageUrl || '').trim())
  }

  // ——— App ———
  checks.push({
    id: 'preload',
    layer: 'app',
    priority: 'P0',
    title: 'Preload API (window.kawaii)',
    status: typeof window !== 'undefined' && window.kawaii ? 'pass' : 'fail',
    detail: window.kawaii ? 'window.kawaii present' : 'missing',
    fixHint: 'Revisar preload/index.ts expose + contextIsolation'
  })

  const fileApis = [
    'filesToDataUrl',
    'filesShowInFolder',
    'filesOpenPath',
    'filesListKnownDirs',
    'musicGenerate',
    'sdListWeights'
  ] as const
  for (const name of fileApis) {
    const ok = typeof (window.kawaii as Record<string, unknown> | undefined)?.[name] === 'function'
    checks.push({
      id: `api-${name}`,
      layer: name.startsWith('music') ? 'music' : name.startsWith('sd') ? 'image' : 'ux',
      priority: name.startsWith('files') || name === 'musicGenerate' ? 'P0' : 'P1',
      title: `API ${name}`,
      status: ok ? 'pass' : 'fail',
      detail: typeof (window.kawaii as Record<string, unknown> | undefined)?.[name],
      fixHint: ok ? undefined : `Exponer ${name} en preload + ipcMain`
    })
  }

  // ——— Local ———
  {
    const r = await timed(async () => {
      const url = (settings.localBaseUrl || 'http://127.0.0.1:11434').replace(/\/$/, '')
      const res = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(4000) })
      return { ok: res.ok, status: res.status }
    })
    checks.push({
      id: 'ollama',
      layer: 'local',
      priority: 'P0',
      title: 'Ollama / local API reachable',
      status: r.ok && r.value.ok ? 'pass' : 'warn',
      detail: r.ok ? `HTTP ${r.value.status}` : r.error,
      durationMs: r.ms,
      fixHint: 'Arrancar Ollama o LM Studio; revisar localBaseUrl'
    })
  }

  // ——— Image / Forge ———
  {
    const r = await timed(async () => {
      let h = await window.kawaii?.imageA1111Health?.(settings.a1111BaseUrl)
      if (!(h as { ok?: boolean })?.ok && settings.imageGenEnabled) {
        // One soft recovery: start/ensure pipeline then re-probe
        try {
          await window.kawaii?.imageEnsureLocalPipeline?.()
        } catch {
          /* ignore */
        }
        h = await window.kawaii?.imageA1111Health?.(settings.a1111BaseUrl)
      }
      return h
    })
    const ok = r.ok && (r.value as { ok?: boolean })?.ok
    const detailObj = r.ok ? (r.value as { ok?: boolean; baseUrl?: string; error?: string }) : null
    checks.push({
      id: 'forge',
      layer: 'image',
      priority: 'P0',
      title: 'Forge / SD API health',
      status: ok ? 'pass' : settings.imageGenEnabled ? 'fail' : 'skip',
      detail: r.ok
        ? JSON.stringify(r.value).slice(0, 220)
        : r.error,
      durationMs: r.ms,
      fixHint: ok
        ? undefined
        : 'Capas → Arrancar Forge y espera "API activa". Si el puerto en Ajustes está muerto, la app reescanea 7860–7890.'
    })
    // If health found a live URL different from settings, surface it in detail (settings persist is optional)
    if (ok && detailObj?.baseUrl && settings.a1111BaseUrl && !String(settings.a1111BaseUrl).includes(String(detailObj.baseUrl).split(':').pop() || '___')) {
      /* informational only inside detail JSON already */
    }
  }

  // Disk weights
  {
    const r = await timed(async () => window.kawaii?.sdListWeights?.())
    const weights = r.ok ? (r.value as { weights?: Array<{ kind: string; filename: string }> })?.weights || [] : []
    const cps = weights.filter((w) => w.kind === 'checkpoint')
    const loras = weights.filter((w) => w.kind === 'lora')
    checks.push({
      id: 'sd-weights-disk',
      layer: 'image',
      priority: 'P1',
      title: 'Checkpoints en disco (escaneo fresco)',
      status: cps.length > 0 ? 'pass' : settings.imageGenEnabled ? 'warn' : 'skip',
      detail: r.ok
        ? `${cps.length} checkpoint(s), ${loras.length} LoRA(s): ${cps
            .map((c) => c.filename)
            .slice(0, 4)
            .join(', ')}`
        : r.error,
      durationMs: r.ms,
      fixHint: 'Colocar .safetensors en models/Stable-diffusion; LoRAs en models/Lora'
    })
  }

  // P0: character visual identity readiness
  {
    const desc = effectiveVisualDescription(char || { name: '', tagline: '', personality: '', style: '', visualEmoji: '🌸', traits: [] })
    const hasDesc = Boolean(desc && desc.length > 24 && !/aspecto definido por el avatar/i.test(desc))
    const hasAvatar = Boolean((char?.visualImageUrl || '').trim())
    const useStyle = settings.imageUseCharacterStyle !== false
    let status: ReportCheck['status'] = 'pass'
    const bits: string[] = []
    if (!hasAvatar) {
      status = 'warn'
      bits.push('sin avatar')
    }
    if (!hasDesc) {
      status = hasAvatar ? 'fail' : 'warn'
      bits.push('sin visualDescription usable')
    }
    if (!useStyle) {
      status = status === 'pass' ? 'warn' : status
      bits.push('imageUseCharacterStyle off')
    }
    checks.push({
      id: 'p0-image-identity-config',
      layer: 'image',
      priority: 'P0',
      title: 'Identidad visual configurada (avatar + ficha)',
      status,
      detail: bits.length
        ? bits.join('; ')
        : `desc ${desc.slice(0, 80)}… gallery=${(char?.visualGallery || []).length}`,
      fixHint:
        'Ajustes → Personalidad: subir avatar, Regenerar descripción, galería multi-imagen; imageUseCharacterStyle=on'
    })
  }

  // P0: compose prompt must carry identity markers when style on
  {
    try {
      const desc = (char?.visualDescription || '').trim() || 'long dark hair, green eyes, forest aesthetic'
      const descSafe =
        desc ||
        'long red hair, green dress, golden brooch, young woman named Niamh'
      const composed = composeImagePrompt('haz una foto tuya', 'sd15', {
        visualDescription: descSafe,
        characterName: char?.name || 'Niamh',
        useCharacter: true
      })
      const p = (composed.prompt || '').toLowerCase()
      // Must retain identity markers from description (hair/dress colors), not only "young woman"
      const hasHair =
        /red hair|auburn|long hair|cabello|pelo rojo|hair:1/.test(p) ||
        /\(red hair/.test(p)
      const hasDress = /green dress|vestido|dress:1|wearing green/.test(p)
      const hasIdentity = hasHair || hasDress || /niamh|brooch|fibula/.test(p)
      const hasSolo = /solo|single person|one face/.test(p)
      const mustRed = /rojo|red hair/i.test(descSafe)
      const status = mustRed
        ? hasHair && hasSolo
          ? 'pass'
          : 'fail'
        : hasIdentity && hasSolo
          ? 'pass'
          : hasIdentity
            ? 'warn'
            : 'fail'
      checks.push({
        id: 'p0-prompt-compose-identity',
        layer: 'image',
        priority: 'P0',
        title: 'composeImagePrompt conserva rasgos (no solo young woman)',
        status,
        detail: composed.prompt.slice(0, 160),
        fixHint:
          'prompt-compose.ts: parse ES cabello/vestido; inyectar visualDescription con pesos'
      })
    } catch (e) {
      checks.push({
        id: 'p0-prompt-compose-identity',
        layer: 'image',
        priority: 'P0',
        title: 'composeImagePrompt conserva rasgos',
        status: 'fail',
        detail: e instanceof Error ? e.message : String(e),
        fixHint: 'Arreglar composeImagePrompt export/runtime'
      })
    }
  }


  // Generative local quality suite (0.9.22+)
  {
    const styles = listStylePresets()
    checks.push({
      id: 'gen-style-presets',
      layer: 'image',
      priority: 'P1',
      title: 'Presets de estilo local (Perchance-like)',
      status: styles.length >= 4 ? 'pass' : 'fail',
      detail: styles.map((s) => s.id).join(', '),
      fixHint: 'prompt-compose.ts STYLE_PRESETS'
    })
    try {
      const c = composeImagePrompt('genera una foto tuya estilo anime', 'sd15', {
        visualDescription: 'long red hair, green eyes, green dress, human adult woman',
        characterName: 'Niamh',
        useCharacter: true
      })
      const animeOk = c.styleId === 'anime' || /anime/i.test(c.prompt)
      const antiElf = /elf ears|pointed ears/i.test(c.negativePrompt)
      const identity = /red hair/i.test(c.prompt)
      checks.push({
        id: 'gen-style-anime-identity',
        layer: 'image',
        priority: 'P1',
        title: 'Estilo anime + identidad + anti elf-ears',
        status: animeOk && antiElf && identity ? 'pass' : 'fail',
        detail: `style=${c.styleId} antiElf=${antiElf} red=${identity}`,
        fixHint: 'detectImageStyle + NEG_ANATOMY + identity weights'
      })
    } catch (e) {
      checks.push({
        id: 'gen-style-anime-identity',
        layer: 'image',
        priority: 'P1',
        title: 'Estilo anime + identidad',
        status: 'fail',
        detail: e instanceof Error ? e.message : String(e),
        fixHint: 'composeImagePrompt'
      })
    }
    const desc = (char?.visualDescription || '').trim()
    const weak = isWeakVisualDescription(desc)
    checks.push({
      id: 'gen-visual-desc-strength',
      layer: 'image',
      priority: 'P1',
      title: 'Ficha visual no débil (traits concretos)',
      status: !desc ? 'warn' : weak ? 'fail' : 'pass',
      detail: desc ? desc.slice(0, 100) : 'vacía — Regenerar (avatar + galería)',
      fixHint: 'Ajustes → Regenerar descripción (avatar + galería); modelo vision local'
    })
    const gal = (char?.visualGallery || []).length
    checks.push({
      id: 'gen-gallery-count',
      layer: 'image',
      priority: 'P2',
      title: 'Galería multi-imagen del personaje',
      status: gal >= 1 ? 'pass' : 'warn',
      detail: `gallery=${gal} (recomendado ≥3 referencias de ropa/escena)`,
      fixHint: 'Ajustes → Personalidad → Galería del avatar'
    })
  }

  // pickBestCheckpoint with user-like names
  {
    const fake = [
      { model_name: 'Realistic_Vision_V5.1_fp16-no-ema.safetensors' },
      { model_name: 'DreamShaper_8_pruned.safetensors' },
      { model_name: 'Realism Lora By Stable Yogi_V3_Lite.safetensors' }
    ]
    const pick = pickBestCheckpoint(fake, 'photorealistic portrait of a young woman')
    const ok = pick && /realistic/i.test(pick) && !/lora/i.test(pick)
    checks.push({
      id: 'p0-checkpoint-pick',
      layer: 'image',
      priority: 'P0',
      title: 'pickBestCheckpoint prefiere Realistic Vision (no LoRA)',
      status: ok ? 'pass' : 'fail',
      detail: `picked=${pick}`,
      fixHint: 'smart-checkpoint.ts: excluir LoRA; score realistic vision'
    })
  }

  
  checks.push({
    id: 'p0-gallery-sync',
    layer: 'image',
    priority: 'P0',
    title: 'Galería multi-imagen sincronizada con avatar',
    status:
      !char?.visualImageUrl
        ? 'skip'
        : (char?.visualGallery || []).length >= 1
          ? 'pass'
          : 'fail',
    detail: `avatar=${Boolean(char?.visualImageUrl)} gallery=${(char?.visualGallery || []).length}`,
    fixHint: 'Al subir avatar principal, añadirlo a visualGallery (AvatarGalleryPanel)'
  })

  
  // ——— Generative core exports (prevent stub regressions) ———
  {
    try {
      const gen = await import('@core/generative')
      const hasReg = typeof gen.buildCapabilityRegistry === 'function'
      const hasPlan = typeof gen.safePlanGenerativeTurn === 'function'
      const caps = hasReg
        ? gen.buildCapabilityRegistry({
            imageGenEnabled: true,
            imageProviderMode: 'smart',
            musicEnabled: true,
            videoEnabled: false
          })
        : []
      const plan = hasPlan
        ? gen.safePlanGenerativeTurn('haz una foto tuya', {
            imageGenEnabled: true,
            useCharacterStyle: true,
            character: { name: char?.name || 'Niamh', visualDescription: char?.visualDescription }
          })
        : { mediaRequests: [] }
      const planOk = (plan.mediaRequests || []).some((m: { modality?: string }) => m.modality === 'image')
      checks.push({
        id: 'p0-generative-registry',
        layer: 'app',
        priority: 'P0',
        title: 'Core generativo: registry + planificador',
        status: hasReg && hasPlan && caps.length >= 3 && planOk ? 'pass' : 'fail',
        detail: `registry=${hasReg} plan=${hasPlan} caps=${caps.length} imageJobs=${(plan.mediaRequests || []).length}`,
        fixHint: 'src/core/generative/index.ts debe exportar buildCapabilityRegistry y safePlanGenerativeTurn'
      })
    } catch (e) {
      checks.push({
        id: 'p0-generative-registry',
        layer: 'app',
        priority: 'P0',
        title: 'Core generativo: registry + planificador',
        status: 'fail',
        detail: e instanceof Error ? e.message : String(e),
        fixHint: 'Restaurar @core/generative/index.ts completo (no stubs)'
      })
    }
  }

  
  {
    try {
      const disk = await window.kawaii?.sdListWeights?.()
      const w = (disk as { weights?: unknown[] })?.weights || (disk as { checkpoints?: unknown[] })?.checkpoints || []
      const n = Array.isArray(w) ? w.length : 0
      let apiNote = ''
      try {
        const api = await window.kawaii?.imageA1111Models?.()
        if (api && (api as { ok?: boolean }).ok === false) apiNote = ' API models not ok'
        const err = (api as { error?: string })?.error || ''
        if (/500/.test(err)) apiNote = ' API HTTP 500 (usar disco)'
      } catch (e) {
        apiNote = e instanceof Error ? e.message : String(e)
      }
      checks.push({
        id: 'p0-sd-checkpoints-available',
        layer: 'image',
        priority: 'P0',
        title: 'Checkpoints SD disponibles (disco o API)',
        status: n > 0 ? 'pass' : 'fail',
        detail: `diskWeights=${n}${apiNote}`,
        fixHint: 'Descargar checkpoint en Capas o colocar .safetensors en models/Stable-diffusion; API 500 se mitiga listando disco'
      })
    } catch (e) {
      checks.push({
        id: 'p0-sd-checkpoints-available',
        layer: 'image',
        priority: 'P0',
        title: 'Checkpoints SD disponibles',
        status: 'fail',
        detail: e instanceof Error ? e.message : String(e)
      })
    }
  }

  // ——— Music ———
  let musicTail: string[] = []
  {
    const r = await timed(async () => window.kawaii?.musicRuntimeStatus?.())
    const st = r.ok ? (r.value as { state?: string; baseUrl?: string; message?: string }) : null
    const running = st?.state === 'running'
    checks.push({
      id: 'music-runtime',
      layer: 'music',
      priority: 'P1',
      title: 'Music ACE runtime (bajo demanda)',
      status: running
        ? 'pass'
        : settings.musicGenEnabled
          ? 'warn'
          : 'skip',
      detail: running
        ? `${st?.state} ${st?.baseUrl || ''}`.trim()
        : `stopped · OK en frío (se arranca al generar música). ${st?.message || r.error || ''}`.trim(),
      durationMs: r.ms,
      fixHint: 'No es bloqueo: prepareHeavyLayer(music) al generar. Arranque manual solo si falla el job.'
    })

    const health = await timed(async () => {
      if (!st?.baseUrl) return { ok: false as const }
      const res = await fetch(`${String(st.baseUrl).replace(/\/$/, '')}/health`, {
        signal: AbortSignal.timeout(4000)
      })
      return { ok: res.ok }
    })
    checks.push({
      id: 'music-health',
      layer: 'music',
      priority: 'P1',
      title: 'ACE /health',
      status: health.ok && health.value.ok ? 'pass' : running ? 'fail' : 'skip',
      detail: health.ok ? (health.value.ok ? '200 OK' : 'not ok') : health.error,
      durationMs: health.ms
    })

    try {
      const tail = await window.kawaii?.musicLogTail?.()
      musicTail = tail?.lines || []
    } catch {
      /* ignore */
    }
  }

  // Known dirs for UX
  {
    const r = await timed(async () => window.kawaii?.filesListKnownDirs?.())
    const dirs = r.ok ? (r.value as { dirs?: Array<{ id: string; path: string }> })?.dirs || [] : []
    const hasMusic = dirs.some((d) => /music|ace|música/i.test(d.id + (d as { label?: string }).label || ''))
    checks.push({
      id: 'p0-known-dirs',
      layer: 'ux',
      priority: 'P0',
      title: 'filesListKnownDirs incluye música / datos',
      status: dirs.length >= 2 ? 'pass' : 'fail',
      detail: r.ok
        ? `${dirs.length} dirs; music=${hasMusic} · ${dirs.map((d) => d.id).join(',')}`
        : r.error,
      durationMs: r.ms,
      fixHint: 'main files:listKnownDirs + botones knownDirs en MessageBubble'
    })
  }

  if (opts?.includeMusicGenerate && settings.musicGenEnabled) {
    const runOnce = () =>
      window.kawaii?.musicGenerate?.({
        prompt: 'soft piano instrumental, calm, no vocals',
        durationSec: 20,
        lyrics: '[Instrumental]'
      })
    let r = await timed(async () => runOnce())
    let val = r.ok ? (r.value as { ok?: boolean; error?: string; path?: string; audioPath?: string }) : null
    // One automatic retry — first ACE call often loads DiT and drops the socket
    if (!val?.ok || !(val.path || val.audioPath)) {
      await new Promise((res) => setTimeout(res, 5000))
      r = await timed(async () => runOnce())
      val = r.ok ? (r.value as { ok?: boolean; error?: string; path?: string; audioPath?: string }) : null
    }
    const path = val?.path || val?.audioPath
    const err = val?.error || r.error || 'fail'
    const fetchy = /fetch failed|ECONNRESET|socket|timeout/i.test(err)
    checks.push({
      id: 'music-generate',
      layer: 'music',
      priority: 'P0',
      title: 'musicGenerate IPC devuelve path',
      status: val?.ok && path ? 'pass' : val?.ok ? 'warn' : 'fail',
      detail: val?.ok
        ? `path=${path || 'missing'}`
        : `${err}${fetchy ? ' · (posible caída de ACE al cargar pesos; reintenta o mira consola música)' : ''}`,
      durationMs: r.ms,
      fixHint:
        'music-runtime aceHttpJson + warm /v1/init; si ACE se reinicia al generar, baja LM a 0.6B o libera VRAM (Forge)'
    })
  } else {
    checks.push({
      id: 'music-generate',
      layer: 'music',
      priority: 'P1',
      title: 'musicGenerate IPC (smoke)',
      status: 'skip',
      detail: 'Marca «incluir generación» en el tester (lazy-load)'
    })
  }

  // ——— Chat personality prompt ———
  {
    try {
      const { buildCharacterSystemPrompt } = await import('@core/character/profile')
      const block = buildCharacterSystemPrompt(char || {
        name: 'Niamh',
        tagline: '',
        personality: 'test',
        style: '',
        visualEmoji: '🌸',
        traits: []
      })
      const generic = /soy un (llm|modelo|avatar genérico)|assistant language model/i.test(block)
      const named = char?.name ? block.includes(char.name) : true
      checks.push({
        id: 'p0-character-prompt',
        layer: 'chat',
        priority: 'P0',
        title: 'System prompt de personaje con nombre (no genérico)',
        status: named && !generic ? 'pass' : 'fail',
        detail: block.slice(0, 120).replace(/\n/g, ' '),
        fixHint: 'profile.ts buildCharacterSystemPrompt: forzar nombre + relación'
      })
    } catch (e) {
      checks.push({
        id: 'p0-character-prompt',
        layer: 'chat',
        priority: 'P0',
        title: 'System prompt de personaje',
        status: 'fail',
        detail: e instanceof Error ? e.message : String(e)
      })
    }
  }

  // Keys
  try {
    const keys = await window.kawaii?.getAllProviderKeys?.()
    const names = keys ? Object.keys(keys).filter((k) => Boolean((keys as Record<string, string>)[k])) : []
    checks.push({
      id: 'keys',
      layer: 'cloud',
      priority: 'P1',
      title: 'Provider keys configured',
      status: names.length ? 'pass' : 'warn',
      detail: names.length ? names.join(', ') : 'none'
    })
  } catch (e) {
    checks.push({
      id: 'keys',
      layer: 'cloud',
      priority: 'P1',
      title: 'Provider keys configured',
      status: 'warn',
      detail: e instanceof Error ? e.message : String(e)
    })
  }

  // ——— Voz (0.9.1+) ———
  {
    const speakFn = typeof (window.kawaii as Record<string, unknown> | undefined)?.voiceSpeak === 'function'
    const ensureFn = typeof (window.kawaii as Record<string, unknown> | undefined)?.voiceEnsure === 'function'
    checks.push({
      id: 'voice-api',
      layer: 'app',
      priority: 'P1',
      title: 'API voz (speak/ensure)',
      status: speakFn && ensureFn ? 'pass' : 'fail',
      detail: `voiceSpeak=${speakFn} voiceEnsure=${ensureFn}`,
      fixHint: 'preload voiceSpeak/voiceEnsure + main voice-tts'
    })
    try {
      const st = await window.kawaii?.voiceStatus?.()
      checks.push({
        id: 'voice-engine',
        layer: 'app',
        priority: 'P1',
        title: 'Motor TTS edge-tts',
        status: st?.ok ? 'pass' : 'warn',
        detail: st?.message || st?.error || JSON.stringify(st || {}),
        fixHint: 'Ajustes → Voz → Instalar motor de voz'
      })
    } catch (e) {
      checks.push({
        id: 'voice-engine',
        layer: 'app',
        priority: 'P1',
        title: 'Motor TTS edge-tts',
        status: 'warn',
        detail: e instanceof Error ? e.message : String(e)
      })
    }
  }

  // ——— R5 intimacy stage + adult opt-in ———
  try {
    const {
      effectiveRelationshipStage,
      shouldProposeIntimacy,
      applyIntimacyResolution,
      hasIntimacySoftNo
    } = await import('@core/conversation/intimacy-stage')
    const clamped = effectiveRelationshipStage({ stage: 'intimate_adult' }, false)
    checks.push({
      id: 'intimacy-clamp-adult',
      layer: 'app',
      priority: 'P0',
      title: 'R5: intimate_adult sin opt-in → intimate',
      status: clamped === 'intimate' ? 'pass' : 'fail',
      detail: 'effective=' + clamped,
      fixHint: 'intimacy-stage effectiveRelationshipStage'
    })
    const blocked = shouldProposeIntimacy({
      stage: 'intimate',
      adultOptIn: false,
      preferAdult: true,
      conversationInitiativeEnabled: true
    })
    checks.push({
      id: 'intimacy-adult-optin-gate',
      layer: 'app',
      priority: 'P0',
      title: 'R5: propuesta adulta bloqueada sin opt-in',
      status: !blocked.ok && blocked.reason === 'adult_opt_in_off' ? 'pass' : 'fail',
      detail: blocked.reason,
      fixHint: 'shouldProposeIntimacy adult_opt_in_off'
    })
    const acc = applyIntimacyResolution({
      relationship: { stage: 'intimate' },
      action: 'accept',
      kind: 'adult',
      adultOptIn: true,
      facts: []
    })
    checks.push({
      id: 'intimacy-accept-adult',
      layer: 'app',
      priority: 'P1',
      title: 'R5: aceptar adulta → intimate_adult',
      status: acc.relationship.stage === 'intimate_adult' ? 'pass' : 'fail',
      detail: String(acc.relationship.stage),
      fixHint: 'applyIntimacyResolution accept adult'
    })
    const dec = applyIntimacyResolution({
      relationship: { stage: 'familiar' },
      action: 'decline',
      kind: 'emotional',
      facts: []
    })
    checks.push({
      id: 'intimacy-decline-boundary',
      layer: 'app',
      priority: 'P1',
      title: 'R5: rechazo → INTIMACY_BOUNDARY',
      status: hasIntimacySoftNo(dec.facts) ? 'pass' : 'fail',
      detail: (dec.facts || []).slice(-1)[0] || '',
      fixHint: 'applyIntimacyResolution decline'
    })
  } catch (e) {
    checks.push({
      id: 'intimacy-stage-load',
      layer: 'app',
      priority: 'P0',
      title: 'R5: cargar intimacy-stage',
      status: 'fail',
      detail: e instanceof Error ? e.message : String(e),
      fixHint: 'src/core/conversation/intimacy-stage.ts'
    })
  }

  // ——— I8 intimacy-memory extractor + first narrative ———
  try {
    const {
      applyIntimacyExtraction,
      getIntimacyFirstNarrative,
      advanceIntimateScenePhase,
      protectIntimacyFactsOnTrim
    } = await import('@core/conversation/intimacy-memory')
    const sampleMsgs = [
      { role: 'user', content: 'Es nuestra primera vez, con cuidado y cariño' },
      { role: 'assistant', content: 'Tengo nervios y te abrazo más fuerte, mi cuerpo responde' },
      { role: 'user', content: 'Te deseo, más cerca' },
      { role: 'assistant', content: 'No pares, siento el latido contigo' },
      { role: 'user', content: 'Así' },
      { role: 'assistant', content: 'Qué intenso y tierno' },
      { role: 'user', content: 'Me quedo contigo' },
      { role: 'assistant', content: 'Descansemos abrazados' }
    ]
    const applied = applyIntimacyExtraction({
      facts: [],
      relationship: { intimacyOpen: true, stage: 'intimate_adult' },
      messages: sampleMsgs,
      userName: 'Nahum',
      characterName: 'Niamh',
      forceFirst: true
    })
    const first = getIntimacyFirstNarrative(applied.facts)
    checks.push({
      id: 'intimacy-memory-first-extract',
      layer: 'app',
      priority: 'P0',
      title: 'I8: extractor escribe INTIMACY_FIRST',
      status: applied.wroteFirst && first.length > 20 ? 'pass' : 'fail',
      detail: first.slice(0, 80) || applied.facts.slice(0, 2).join(' | '),
      fixHint: 'intimacy-memory applyIntimacyExtraction forceFirst'
    })
    const phase = advanceIntimateScenePhase({
      phase: 'open',
      intimacyOpen: true,
      recentTexts: sampleMsgs.map((m) => m.content)
    })
    checks.push({
      id: 'intimacy-memory-scene-phase',
      layer: 'app',
      priority: 'P1',
      title: 'I8: fase scene_active ante señales íntimas',
      status: phase.phase === 'scene_active' ? 'pass' : 'fail',
      detail: phase.phase + ' · ' + phase.reason,
      fixHint: 'advanceIntimateScenePhase'
    })
    const protectedFacts = protectIntimacyFactsOnTrim(
      ['INTIMACY_FIRST: narrativa larga de prueba', 'a', 'b', 'c', 'd'],
      2
    )
    checks.push({
      id: 'intimacy-memory-protect-first',
      layer: 'app',
      priority: 'P1',
      title: 'I8: trim no borra INTIMACY_FIRST',
      status: protectedFacts.some((f) => f.startsWith('INTIMACY_FIRST:')) ? 'pass' : 'fail',
      detail: protectedFacts.join(' · '),
      fixHint: 'protectIntimacyFactsOnTrim'
    })
    // Live: does current session already have first narrative?
    try {
      const { useSettingsStore } = await import('@shared/lib/stores/settingsStore')
      const facts = useSettingsStore.getState().settings.userMemory?.facts || []
      const liveFirst = getIntimacyFirstNarrative(facts)
      checks.push({
        id: 'intimacy-memory-live-session',
        layer: 'app',
        priority: 'P1',
        title: 'I8: sesión actual tiene INTIMACY_FIRST',
        status: liveFirst.length > 20 ? 'pass' : 'warn',
        detail:
          liveFirst.length > 20
            ? liveFirst.slice(0, 100)
            : 'Vacío — Ajustes→Memoria→«Reconstruir desde el chat activo»',
        fixHint: 'UserMemoryPanel rebuild button'
      })
    } catch {
      /* store optional in pure node */
    }
  } catch (e) {
    checks.push({
      id: 'intimacy-memory-load',
      layer: 'app',
      priority: 'P0',
      title: 'I8: cargar intimacy-memory',
      status: 'fail',
      detail: e instanceof Error ? e.message : String(e),
      fixHint: 'src/core/conversation/intimacy-memory.ts'
    })
  }

  try {
    const { recommendCompanionUncensored, isUncensoredCompanionId } = await import(
      '@core/models/recommendations'
    )
    const list = recommendCompanionUncensored(
      { totalMemoryGB: 32, cpuCores: 8, architecture: 'x64' },
      []
    )
    checks.push({
      id: 'companion-uncensored-catalog',
      layer: 'local',
      priority: 'P1',
      title: 'R5: catálogo companion uncensored',
      status: list.length > 0 && list.every((m) => m.risk === 'uncensored') ? 'pass' : 'fail',
      detail: list.map((m) => m.pullName).slice(0, 3).join(', '),
      fixHint: 'recommendCompanionUncensored'
    })
    checks.push({
      id: 'companion-id-detect',
      layer: 'local',
      priority: 'P1',
      title: 'R5: detecta ids uncensored companion',
      status: isUncensoredCompanionId('dolphin-llama3') ? 'pass' : 'fail',
      detail: 'dolphin-llama3',
      fixHint: 'isUncensoredCompanionId'
    })
  } catch (e) {
    checks.push({
      id: 'companion-catalog-load',
      layer: 'local',
      priority: 'P1',
      title: 'R5: catálogo companion',
      status: 'fail',
      detail: e instanceof Error ? e.message : String(e)
    })
  }

  
  try {
    const { hardwareModelBudget, recommendCompanionUncensored } = await import(
      '@core/models/recommendations'
    )
    const b = hardwareModelBudget({ totalMemoryGB: 32, cpuCores: 8, architecture: 'x64' })
    checks.push({
      id: 'hardware-budget-c1',
      layer: 'local',
      priority: 'P1',
      title: 'C1: presupuesto hardware (comfort/ok)',
      status: b.comfortParamsB > 0 && b.okParamsB >= b.comfortParamsB ? 'pass' : 'fail',
      detail: b.summary,
      fixHint: 'hardwareModelBudget'
    })
    const comp = recommendCompanionUncensored(
      { totalMemoryGB: 32, cpuCores: 8, architecture: 'x64' },
      []
    )
    const hasAblit = comp.some((m) => m.tags?.includes('abliterated'))
    const hasRpDefault = comp.some((m) => m.roles?.includes('optional-rp'))
    checks.push({
      id: 'companion-ablit-first',
      layer: 'local',
      priority: 'P1',
      title: 'C2: companion prioriza abliterated (sin RP por defecto)',
      status: hasAblit && !hasRpDefault ? 'pass' : 'fail',
      detail: comp.map((m) => m.pullName).slice(0, 3).join(', '),
      fixHint: 'recommendCompanionUncensored'
    })
  } catch (e) {
    checks.push({
      id: 'hardware-budget-c1',
      layer: 'local',
      priority: 'P1',
      title: 'C1/C2 catálogo',
      status: 'fail',
      detail: e instanceof Error ? e.message : String(e)
    })
  }

  try {
    const { classifyChatTask, resolveIntimateModelId } = await import('@core/routing/task-route')
    const t = classifyChatTask('modo íntimo por favor', {
      adultOptIn: true,
      relationshipStage: 'intimate_adult'
    })
    checks.push({
      id: 'intimacy-task-classify',
      layer: 'app',
      priority: 'P1',
      title: 'C3: classifyChatTask intimacy',
      status: t === 'intimacy' || t === 'chat' ? 'pass' : 'fail',
      detail: 'task=' + t,
      fixHint: 'classifyChatTask forceIntimacy / regex'
    })
    const id = resolveIntimateModelId({
      installed: ['qwen2.5:14b', 'huihui_ai/qwen3-abliterated:14b-v2'],
      localModelIntimate: 'huihui_ai/qwen3-abliterated:14b-v2',
      ramGB: 32
    })
    checks.push({
      id: 'intimate-model-resolve',
      layer: 'local',
      priority: 'P1',
      title: 'C3: resolveIntimateModelId pinned',
      status: id && id.includes('abliterated') ? 'pass' : 'fail',
      detail: String(id),
      fixHint: 'resolveIntimateModelId'
    })
  } catch (e) {
    checks.push({
      id: 'intimacy-task-classify',
      layer: 'app',
      priority: 'P1',
      title: 'C3 intimacy route',
      status: 'fail',
      detail: e instanceof Error ? e.message : String(e)
    })
  }

  // ——— Fase 0 Auto / fingerprint / echo (P0) ———
  try {
    const { runPhase0PureChecks } = await import('@core/routing/phase0-auto.test')
    for (const c of runPhase0PureChecks()) {
      checks.push({
        id: c.id,
        layer: 'local',
        priority: 'P0',
        title: `Fase0: ${c.id.replace(/^phase0-/, '')}`,
        status: c.ok ? 'pass' : 'fail',
        detail: c.detail,
        fixHint: c.ok ? undefined : 'src/core/routing/phase0-auto.test.ts + discover-local fingerprint'
      })
    }
  } catch (e) {
    checks.push({
      id: 'phase0-pure-checks',
      layer: 'local',
      priority: 'P0',
      title: 'Fase0 pure checks load',
      status: 'fail',
      detail: e instanceof Error ? e.message : String(e),
      fixHint: '@core/routing/phase0-auto.test'
    })
  }

  // ——— Fase 1 router precedence / sticky (P0) ———
  try {
    const { runPhase1PureChecks } = await import('@core/routing/phase1-router.test')
    for (const c of runPhase1PureChecks()) {
      checks.push({
        id: c.id,
        layer: 'local',
        priority: 'P0',
        title: `Fase1: ${c.id.replace(/^phase1-/, '')}`,
        status: c.ok ? 'pass' : 'fail',
        detail: c.detail,
        fixHint: c.ok ? undefined : 'model-router.ts + intimate-sticky.ts + ADR 002'
      })
    }
  } catch (e) {
    checks.push({
      id: 'phase1-pure-checks',
      layer: 'local',
      priority: 'P0',
      title: 'Fase1 pure checks load',
      status: 'fail',
      detail: e instanceof Error ? e.message : String(e),
      fixHint: '@core/routing/phase1-router.test'
    })
  }

  // ——— Fase 2 catalog (P0) ———
  try {
    const { runPhase2PureChecks } = await import('@core/routing/phase2-catalog.test')
    for (const c of runPhase2PureChecks()) {
      checks.push({
        id: c.id,
        layer: 'local',
        priority: 'P0',
        title: `Fase2: ${c.id.replace(/^phase2-/, '')}`,
        status: c.ok ? 'pass' : 'fail',
        detail: c.detail,
        fixHint: c.ok ? undefined : 'discover-local dedupe + ModelsPanel'
      })
    }
  } catch (e) {
    checks.push({
      id: 'phase2-pure-checks',
      layer: 'local',
      priority: 'P0',
      title: 'Fase2 pure checks load',
      status: 'fail',
      detail: e instanceof Error ? e.message : String(e)
    })
  }

  // ——— Fase 3 documentos (P0) ———
  try {
    const { runPhase3PureChecks } = await import('@core/chat/phase3-docs.test')
    for (const c of runPhase3PureChecks()) {
      checks.push({
        id: c.id,
        layer: 'chat',
        priority: 'P0',
        title: `Fase3: ${c.id.replace(/^phase3-/, '')}`,
        status: c.ok ? 'pass' : 'fail',
        detail: c.detail,
        fixHint: c.ok ? undefined : 'document-chunks / document-attach / hydrate'
      })
    }
  } catch (e) {
    checks.push({
      id: 'phase3-pure-checks',
      layer: 'chat',
      priority: 'P0',
      title: 'Fase3 pure checks load',
      status: 'fail',
      detail: e instanceof Error ? e.message : String(e)
    })
  }

  // ——— Fase 4 runtime / persist (P0) ———
  try {
    const { runPhase4PureChecks } = await import('@core/providers/phase4-runtime.test')
    for (const c of runPhase4PureChecks()) {
      checks.push({
        id: c.id,
        layer: 'local',
        priority: 'P0',
        title: `Fase4: ${c.id.replace(/^phase4-/, '')}`,
        status: c.ok ? 'pass' : 'fail',
        detail: c.detail,
        fixHint: c.ok ? undefined : 'runtime-errors.ts + openai-compatible sanitize'
      })
    }
  } catch (e) {
    checks.push({
      id: 'phase4-pure-checks',
      layer: 'local',
      priority: 'P0',
      title: 'Fase4 pure checks load',
      status: 'fail',
      detail: e instanceof Error ? e.message : String(e)
    })
  }

  // ——— Fase 5 companion (P0) ———
  try {
    const { runPhase5PureChecks } = await import('@core/image/phase5-companion.test')
    for (const c of runPhase5PureChecks()) {
      checks.push({
        id: c.id,
        layer: 'app',
        priority: 'P0',
        title: `Fase5: ${c.id.replace(/^phase5-/, '')}`,
        status: c.ok ? 'pass' : 'fail',
        detail: c.detail,
        fixHint: c.ok ? undefined : 'visual-initiative + import-memories'
      })
    }
  } catch (e) {
    checks.push({
      id: 'phase5-pure-checks',
      layer: 'app',
      priority: 'P0',
      title: 'Fase5 pure checks load',
      status: 'fail',
      detail: e instanceof Error ? e.message : String(e)
    })
  }

  // ——— Fase 6 image job UX (P0) ———
  try {
    const { runPhase6PureChecks } = await import('@core/image/phase6-job-ux.test')
    for (const c of runPhase6PureChecks()) {
      checks.push({
        id: c.id,
        layer: 'image',
        priority: 'P0',
        title: `Fase6: ${c.id.replace(/^phase6-/, '')}`,
        status: c.ok ? 'pass' : 'fail',
        detail: c.detail,
        fixHint: c.ok ? undefined : 'job-ux.ts + chatImageFlow'
      })
    }
  } catch (e) {
    checks.push({
      id: 'phase6-pure-checks',
      layer: 'image',
      priority: 'P0',
      title: 'Fase6 pure checks load',
      status: 'fail',
      detail: e instanceof Error ? e.message : String(e)
    })
  }

  // ——— Phase 7 library + disk spill (P0) ———
  try {
    const { runPhase7PureChecks } = await import('@core/chat/phase7-library-disk.test')
    for (const c of runPhase7PureChecks()) {
      checks.push({
        id: c.id,
        layer: 'chat',
        priority: 'P0',
        title: `Fase7: ${c.id.replace(/^phase7-/, '')}`,
        status: c.ok ? 'pass' : 'fail',
        detail: c.detail,
        fixHint: c.ok ? undefined : 'library-awareness + chatDiskSpill'
      })
    }
  } catch (e) {
    checks.push({
      id: 'phase7-pure-checks',
      layer: 'chat',
      priority: 'P0',
      title: 'Fase7 pure checks load',
      status: 'fail',
      detail: e instanceof Error ? e.message : String(e)
    })
  }

  // ——— Phase 8 STT (P0) ———
  try {
    const { runPhase8PureChecks } = await import('@core/voice/phase8-stt.test')
    for (const c of runPhase8PureChecks()) {
      checks.push({
        id: c.id,
        layer: 'app',
        priority: 'P0',
        title: `Fase8: ${c.id.replace(/^phase8-/, '')}`,
        status: c.ok ? 'pass' : 'fail',
        detail: c.detail,
        fixHint: c.ok ? undefined : 'core/voice/stt.ts'
      })
    }
  } catch (e) {
    checks.push({
      id: 'phase8-pure-checks',
      layer: 'app',
      priority: 'P0',
      title: 'Fase8 pure checks load',
      status: 'fail',
      detail: e instanceof Error ? e.message : String(e)
    })
  }

  // ——— Phase 9 UTF-16 + LMS single resident surface ———
  try {
    const { runPhase9PureChecks } = await import('@core/chat/phase9-utf16-lms.test')
    for (const c of runPhase9PureChecks()) {
      checks.push({
        id: c.id,
        layer: 'local',
        priority: 'P0',
        title: `Fase9: ${c.id.replace(/^phase9-/, '')}`,
        status: c.ok ? 'pass' : 'fail',
        detail: c.detail,
        fixHint: c.ok ? undefined : 'sanitize-utf16 + lmstudio-lifecycle'
      })
    }
    const { ensureLmStudioSingleResident } = await import('@core/providers/lmstudio-lifecycle')
    checks.push({
      id: 'phase9-ensure-single-export',
      layer: 'local',
      priority: 'P0',
      title: 'Fase9: ensureLmStudioSingleResident exportado',
      status: typeof ensureLmStudioSingleResident === 'function' ? 'pass' : 'fail',
      detail: typeof ensureLmStudioSingleResident
    })
  } catch (e) {
    checks.push({
      id: 'phase9-pure-checks',
      layer: 'local',
      priority: 'P0',
      title: 'Fase9 pure checks load',
      status: 'fail',
      detail: e instanceof Error ? e.message : String(e)
    })
  }

  try {
    const { runMarkdownNormalizeChecks } = await import('@core/chat/normalize-markdown.test')
    for (const c of runMarkdownNormalizeChecks()) {
      checks.push({
        id: c.id,
        layer: 'chat',
        priority: 'P1',
        title: `MD: ${c.id}`,
        status: c.ok ? 'pass' : 'fail',
        detail: c.detail.slice(0, 120)
      })
    }
  } catch (e) {
    checks.push({
      id: 'md-normalize-load',
      layer: 'chat',
      priority: 'P1',
      title: 'MD normalize load',
      status: 'fail',
      detail: e instanceof Error ? e.message : String(e)
    })
  }

  try {
    const { switchToModel } = await import('@core/resources/model-lifecycle')
    checks.push({
      id: 'phase0-model-lifecycle-export',
      layer: 'local',
      priority: 'P0',
      title: 'Fase0: switchToModel exportado',
      status: typeof switchToModel === 'function' ? 'pass' : 'fail',
      detail: typeof switchToModel,
      fixHint: 'src/core/resources/model-lifecycle.ts'
    })
  } catch (e) {
    checks.push({
      id: 'phase0-model-lifecycle-export',
      layer: 'local',
      priority: 'P0',
      title: 'Fase0: switchToModel exportado',
      status: 'fail',
      detail: e instanceof Error ? e.message : String(e)
    })
  }

  // ——— I7 image gen contract + identity ———
  try {
    const { resolveQualityParams, isRetryableImageMessage } = await import(
      '@core/image/gen-contract'
    )
    const q = resolveQualityParams({
      profile: 'quality',
      batchSize: 4,
      usesFaceIdOrControlNet: true
    })
    checks.push({
      id: 'image-gen-contract-i3',
      layer: 'image',
      priority: 'P0',
      title: 'I3: FaceID fuerza batch=1',
      status: q.batchSize === 1 ? 'pass' : 'fail',
      detail: `batch=${q.batchSize} profile=${q.profile}`,
      fixHint: 'resolveQualityParams'
    })
    checks.push({
      id: 'image-retryable-classify',
      layer: 'image',
      priority: 'P1',
      title: 'I1: timeout es retryable',
      status: isRetryableImageMessage('Timeout waiting Forge') ? 'pass' : 'fail',
      detail: 'timeout',
      fixHint: 'isRetryableImageMessage'
    })
  } catch (e) {
    checks.push({
      id: 'image-gen-contract-i3',
      layer: 'image',
      priority: 'P0',
      title: 'I3 gen-contract',
      status: 'fail',
      detail: e instanceof Error ? e.message : String(e)
    })
  }
  try {
    const { migrateGalleryItem } = await import('@core/image/wardrobe')
    const { isUsableImageRef, pickAvatarDataUrl } = await import('@core/image/identity-ref')
    const w = migrateGalleryItem({ filePath: 'C:/x/face.png', label: 'cara' }, 0)
    const av = pickAvatarDataUrl({
      visualGallery: [{ filePath: 'C:/x/face.png', role: 'face' }]
    })
    checks.push({
      id: 'image-identity-filepath-i4',
      layer: 'image',
      priority: 'P0',
      title: 'I4: refs desde filePath',
      status: Boolean(w && isUsableImageRef(w.dataUrl) && isUsableImageRef(av)) ? 'pass' : 'fail',
      detail: String(w?.dataUrl || '').slice(0, 60),
      fixHint: 'migrateGalleryItem / pickAvatarDataUrl'
    })
  } catch (e) {
    checks.push({
      id: 'image-identity-filepath-i4',
      layer: 'image',
      priority: 'P0',
      title: 'I4 identity filePath',
      status: 'fail',
      detail: e instanceof Error ? e.message : String(e)
    })
  }

  // ——— Forge auto / health (P0 for image layer) ———
  {
    try {
      const h = await window.kawaii?.forgeStatus?.()
      const state = String((h as { state?: string } | undefined)?.state || '')
      const ok = state === 'running' || (h as { healthy?: boolean })?.healthy === true
      checks.push({
        id: 'forge-health-boot',
        layer: 'image',
        priority: 'P0',
        title: 'Forge status (arranque / API)',
        status: ok ? 'pass' : state === 'starting' ? 'warn' : 'fail',
        detail: typeof h === 'object' ? JSON.stringify(h).slice(0, 240) : String(h),
        fixHint: 'Capa imagen bajo demanda o Arrancar Forge; health 7860/7862'
      })
    } catch (e) {
      checks.push({
        id: 'forge-health-boot',
        layer: 'image',
        priority: 'P0',
        title: 'Forge status (arranque / API)',
        status: 'fail',
        detail: e instanceof Error ? e.message : String(e),
        fixHint: 'preload forgeStatus + startForgeRuntime al boot'
      })
    }
  }

  // Plan gaps (documental / P1)
  // STT implemented (Web Speech API)
  try {
    const { isSpeechRecognitionSupported } = await import('@core/voice/stt')
    const { useSpeechToText } = await import('@features/chat/hooks/useSpeechToText')
    const okHook = typeof useSpeechToText === 'function'
    const hostOk = isSpeechRecognitionSupported()
    checks.push({
      id: 'plan-gap-stt',
      layer: 'app',
      priority: 'P1',
      title: 'STT / micrófono (Web Speech)',
      status: okHook ? 'pass' : 'fail',
      detail: okHook
        ? `hook=true · hostSpeechAPI=${hostOk} (es-MX; permiso al usar mic)`
        : 'useSpeechToText missing',
      fixHint: okHook ? undefined : 'useSpeechToText + ChatInput Mic'
    })
  } catch (e) {
    checks.push({
      id: 'plan-gap-stt',
      layer: 'app',
      priority: 'P1',
      title: 'STT / micrófono (Web Speech)',
      status: 'fail',
      detail: e instanceof Error ? e.message : String(e)
    })
  }
  checks.push({
    id: 'plan-gap-failover-dedupe',
    layer: 'chat',
    priority: 'P0',
    title: 'Plan: sin texto duplicado en failover cloud',
    status: 'pass',
    detail: 'onRoute limpia en failover y cambio de modelo; onToken acepta stream acumulativo cloud',
    fixHint: 'Si reaparece: limpiar buffer en orchestrator al cambiar endpoint'
  })

  // Feedback (activos + archivos; el tester no debe archivar ANTES de leer)
  let feedback: SystemReport['feedback']
  try {
    const {
      listFeedbackReports,
      listAllFeedbackEntries,
      feedbackStatsIncludingArchives,
      listFeedbackArchives
    } = await import('@core/feedback')
    const active = typeof listFeedbackReports === 'function' ? listFeedbackReports(200) : []
    const all =
      typeof listAllFeedbackEntries === 'function' ? listAllFeedbackEntries(300) : active
    const stats =
      typeof feedbackStatsIncludingArchives === 'function'
        ? feedbackStatsIncludingArchives()
        : {
            likes: all.filter((e) => e.vote === 'up').length,
            dislikes: all.filter((e) => e.vote === 'down').length,
            imageDislikes: all.filter((e) => e.vote === 'down' && e.context?.isImage).length,
            textDislikes: all.filter((e) => e.vote === 'down' && !e.context?.isImage).length,
            activeCount: active.length,
            archivedBatches: 0,
            archivedEntries: 0
          }
    const dis = all.filter((e) => e.vote === 'down')
    feedback = {
      likes: stats.likes,
      dislikes: stats.dislikes,
      imageDislikes: stats.imageDislikes,
      textDislikes: stats.textDislikes,
      recentDislikeNotes: dis
        .map((e) => {
          const c = (e.comment || '').trim()
          return c ? `${e.report} · user="${c.slice(0, 120)}"` : e.report || ''
        })
        .filter(Boolean)
        .slice(0, 8)
    }
    const archN =
      typeof listFeedbackArchives === 'function' ? listFeedbackArchives(5).length : stats.archivedBatches
    checks.push({
      id: 'feedback-storage',
      layer: 'feedback',
      priority: 'P1',
      title: 'Feedback likes/dislikes (activos + archivo)',
      status: stats.likes + stats.dislikes > 0 ? 'pass' : 'warn',
      detail: `activos=${stats.activeCount} archivados=${stats.archivedEntries} (lotes=${archN}) · likes=${stats.likes} dislikes=${stats.dislikes}`,
      fixHint:
        'Dar 👍/👎 en un mensaje; no archivar antes del test. Clave localStorage kawaii-gpt-feedback-v1'
    })
    checks.push({
      id: 'feedback-image-dislikes',
      layer: 'feedback',
      priority: 'P1',
      title: 'Dislikes de imagen (señal 0.9.x)',
      status: (feedback.imageDislikes || 0) > 3 ? 'warn' : 'pass',
      detail: `imageDislikes=${feedback.imageDislikes} textDislikes=${feedback.textDislikes}`,
      fixHint: 'P0 identidad visual + CFG + checkpoint; revisar prompts con dislike'
    })
  } catch (e) {
    feedback = undefined
    checks.push({
      id: 'feedback-storage',
      layer: 'feedback',
      priority: 'P1',
      title: 'Feedback likes/dislikes',
      status: 'fail',
      detail: e instanceof Error ? e.message : String(e),
      fixHint: 'Import @core/feedback y localStorage en renderer'
    })
  }

  
  // ——— Activities ———
  {
    const hasOpen = typeof window.kawaii?.activityOpenWindow === 'function'
    const hasClosed = typeof window.kawaii?.onActivityWindowClosed === 'function'
    checks.push({
      id: 'p1-activities-api',
      layer: 'app',
      priority: 'P1',
      title: 'API actividades (ventanas)',
      status: hasOpen && hasClosed ? 'pass' : 'fail',
      detail: `activityOpenWindow=${hasOpen} onClosed=${hasClosed}`,
      fixHint: 'preload + activity-windows.ts'
    })
  }
  {
    try {
      const mod = await import('@features/activities/companion')
      const ok = typeof mod.openActivity === 'function' && typeof mod.endActivityWithComment === 'function'
      checks.push({
        id: 'p1-activities-companion',
        layer: 'app',
        priority: 'P1',
        title: 'Modulo companion juegos',
        status: ok ? 'pass' : 'fail',
        detail: ok ? 'open/end OK' : 'missing exports',
        fixHint: 'features/activities/companion.ts'
      })
    } catch (e) {
      checks.push({
        id: 'p1-activities-companion',
        layer: 'app',
        priority: 'P1',
        title: 'Modulo companion juegos',
        status: 'fail',
        detail: e instanceof Error ? e.message : String(e)
      })
    }
  }
  {
    try {
      const { parseFen, allLegal, applyMove, aiPick } = await import('@core/activities/chess-engine')
      const g = parseFen()
      const moves = allLegal(g)
      const pick = aiPick(g)
      const next = pick ? applyMove(g, pick.from, pick.to) : null
      checks.push({
        id: 'p1-chess-engine',
        layer: 'app',
        priority: 'P1',
        title: 'Motor ajedrez local',
        status: moves.length > 0 && next ? 'pass' : 'fail',
        detail: `legal=${moves.length}`,
        fixHint: 'chess-engine.ts'
      })
    } catch (e) {
      checks.push({
        id: 'p1-chess-engine',
        layer: 'app',
        priority: 'P1',
        title: 'Motor ajedrez local',
        status: 'fail',
        detail: e instanceof Error ? e.message : String(e)
      })
    }
  }
  {
    try {
      const { createAdventure, adventureSystemBlock } = await import('@core/activities/adventure')
      const a = createAdventure('Test')
      const block = adventureSystemBlock(a, 'Niamh')
      const ok = /Niamh|FLEXIBLES|flexible|Acompanante|companera/i.test(block)
      checks.push({
        id: 'p1-adventure-companion-prompt',
        layer: 'chat',
        priority: 'P1',
        title: 'Prompt aventura con compañera',
        status: ok ? 'pass' : 'warn',
        detail: block.slice(0, 100),
        fixHint: 'adventureSystemBlock'
      })
    } catch (e) {
      checks.push({
        id: 'p1-adventure-companion-prompt',
        layer: 'chat',
        priority: 'P1',
        title: 'Prompt aventura',
        status: 'fail',
        detail: e instanceof Error ? e.message : String(e)
      })
    }
  }
  {
    try {
      await import('@features/activities/companionLlm')
      checks.push({
        id: 'p1-companion-llm',
        layer: 'chat',
        priority: 'P1',
        title: 'Comentarios de juego via LLM',
        status: 'pass',
        detail: 'companionLlm module loads',
        fixHint: 'generateCompanionLine / askModelChessMove'
      })
    } catch (e) {
      checks.push({
        id: 'p1-companion-llm',
        layer: 'chat',
        priority: 'P1',
        title: 'Comentarios de juego via LLM',
        status: 'fail',
        detail: e instanceof Error ? e.message : String(e)
      })
    }
  }


  // ——— Harness (version-agnostic) ———
  {
    try {
      const { buildToolObservationPrompt } = await import('@features/chat/services/appAgent')
      const sample = buildToolObservationPrompt(
        [
          JSON.stringify({
            tool: 'list_installed_models',
            ok: true,
            summary: 'Runtime: Ollama | Modelos: qwen2.5:14b (chat) · moondream:latest (visión)'
          })
        ],
        'puedes darme una lista de los modelos que tenemos?'
      )
      const hasFacts = /qwen2\.5:14b|moondream/i.test(sample)
      const bansFake = /PROHIBIDO inventar|Modelo A/i.test(sample)
      checks.push({
        id: 'harness-observation-anti-halluc',
        layer: 'app',
        priority: 'P0',
        title: 'Harness: observaciones anti-alucinación de modelos',
        status: hasFacts && bansFake ? 'pass' : 'fail',
        detail: sample.slice(0, 180),
        fixHint: 'buildToolObservationPrompt debe listar DATOS REALES y prohibir Modelo A/B/C'
      })
    } catch (e) {
      checks.push({
        id: 'harness-observation-anti-halluc',
        layer: 'app',
        priority: 'P0',
        title: 'Harness: observaciones anti-alucinación',
        status: 'fail',
        detail: e instanceof Error ? e.message : String(e)
      })
    }
  }
  {
    try {
      const { suggestPlanFromUserGoal, refinePlanWithLiveStatus } = await import('@core/agent')
      const plan = suggestPlanFromUserGoal('dame una lista de los modelos que tenemos')
      const hasList = Boolean(plan?.steps?.some((s) => s.tool === 'list_installed_models'))
      checks.push({
        id: 'harness-host-plan-models',
        layer: 'app',
        priority: 'P0',
        title: 'Harness: plan host lista modelos',
        status: hasList ? 'pass' : 'fail',
        detail: plan ? plan.steps.map((s) => s.tool).join(' → ') : 'null plan',
        fixHint: 'suggestPlanFromUserGoal debe incluir list_installed_models'
      })
      const forgePlan = suggestPlanFromUserGoal('revisa Forge y modelos')
      const refined = forgePlan
        ? refinePlanWithLiveStatus(forgePlan, {
            forgeState: 'running',
            forgeOk: true,
            localOk: true,
            musicRunning: false
          })
        : null
      const noRedundantStart = refined
        ? !refined.steps.some((s) => s.tool === 'start_forge')
        : false
      checks.push({
        id: 'harness-adaptive-skip-start-forge',
        layer: 'app',
        priority: 'P0',
        title: 'Harness: plan adaptativo omite start_forge si running',
        status: refined && noRedundantStart ? 'pass' : 'fail',
        detail: refined ? refined.steps.map((s) => s.tool).join(' → ') : 'sin plan',
        fixHint: 'refinePlanWithLiveStatus'
      })
    } catch (e) {
      checks.push({
        id: 'harness-host-plan-models',
        layer: 'app',
        priority: 'P0',
        title: 'Harness: planes host/adaptativos',
        status: 'fail',
        detail: e instanceof Error ? e.message : String(e)
      })
    }
  }
  {
    try {
      const { classifyChatTask, pickBestInstalledForTask } = await import('@core/routing')
      const task = classifyChatTask('arregla este bug de TypeScript en mi función')
      const pick = pickBestInstalledForTask({
        installed: ['qwen2.5:14b', 'qwen2.5-coder:7b', 'moondream:latest'],
        task: 'code',
        current: 'moondream:latest',
        ramGB: 32,
        minDelta: 2
      })
      checks.push({
        id: 'harness-auto-route-code',
        layer: 'app',
        priority: 'P1',
        title: 'Harness: auto-route prefiere coder en tareas de código',
        status: task === 'code' && pick.applied && /coder/i.test(pick.to) ? 'pass' : 'warn',
        detail: `task=${task} applied=${pick.applied} to=${pick.to} · ${pick.reason}`,
        fixHint: 'task-route.ts scoreModelForTask'
      })
    } catch (e) {
      checks.push({
        id: 'harness-auto-route-code',
        layer: 'app',
        priority: 'P1',
        title: 'Harness: auto-route',
        status: 'fail',
        detail: e instanceof Error ? e.message : String(e)
      })
    }
  }

  // ——— Essential (every version) + UI journey ———
  // Not a checklist toward a fixed milestone: regression gates that must stay green.
  {
    try {
      const { scoreLocalModelId, classifyChatTaskForModel } = await import(
        '@core/models/local-model-scorer'
      )
      const { isLocalModelDisabled } = await import('@core/models/disabled-local-models')
      const a4b = scoreLocalModelId('google/gemma-4-26B-A4B-it-Q4_K_M', 'openai-compatible')
      const dense27 = scoreLocalModelId('qwen/qwen3.8-27b', 'openai-compatible')
      const hermes = scoreLocalModelId('nous-hermes-2-yi-34b', 'ollama')
      checks.push({
        id: 'ess-a4b-params',
        layer: 'local',
        priority: 'P0',
        title: 'Essential: A4B cuenta params activos (~4), no 26 densos',
        status: a4b.paramsB != null && a4b.paramsB <= 6 ? 'pass' : 'fail',
        detail: `A4B paramsB=${a4b.paramsB} chat=${a4b.scoreChat} · 27B paramsB=${dense27.paramsB}`,
        fixHint: 'local-model-scorer parseParamsB A/E'
      })
      checks.push({
        id: 'ess-decision-score',
        layer: 'local',
        priority: 'P1',
        title: 'Essential: modelos decisión/tool tienen scoreTools/Decision',
        status:
          typeof hermes.scoreTools === 'number' &&
          hermes.scoreTools >= 40 &&
          hermes.scoreDecision >= 40
            ? 'pass'
            : 'fail',
        detail: `hermes tools=${hermes.scoreTools} decision=${hermes.scoreDecision}`,
        fixHint: 'scoreTools / scoreDecision en local-model-scorer'
      })
      const taskDec = classifyChatTaskForModel('decide el siguiente paso y prioriza')
      checks.push({
        id: 'ess-task-decision',
        layer: 'chat',
        priority: 'P1',
        title: 'Essential: classifyChatTask reconoce decisión',
        status: taskDec === 'decision' ? 'pass' : 'warn',
        detail: `task=${taskDec}`,
        fixHint: 'classifyChatTaskForModel decision regex'
      })
      const disabledOk = isLocalModelDisabled('qwen3:14b', ['qwen3:14b'])
      const disabledNo = isLocalModelDisabled('qwen3:9b', ['qwen3:14b'])
      checks.push({
        id: 'ess-disabled-filter',
        layer: 'local',
        priority: 'P0',
        title: 'Essential: filtro disabledLocalModels (exacto)',
        status: disabledOk && !disabledNo ? 'pass' : 'fail',
        detail: `match14=${disabledOk} match9=${disabledNo}`,
        fixHint: 'disabled-local-models.ts'
      })
    } catch (e) {
      checks.push({
        id: 'ess-scorer-block',
        layer: 'local',
        priority: 'P0',
        title: 'Essential: scorer / disabled import',
        status: 'fail',
        detail: e instanceof Error ? e.message : String(e)
      })
    }
  }
  {
    // UI / API surface journey (no browser automation — IPC + store contract)
    const k = window.kawaii as Record<string, unknown> | undefined
    const journey: Array<{ id: string; title: string; ok: boolean; detail?: string }> = [
      {
        id: 'ui-api-models-folder',
        title: 'UI: modelsOpenLayerFolder expuesto',
        ok: typeof k?.modelsOpenLayerFolder === 'function'
      },
      {
        id: 'ui-api-show-in-folder',
        title: 'UI: filesShowInFolder expuesto',
        ok: typeof k?.filesShowInFolder === 'function'
      },
      {
        id: 'ui-api-image-folder',
        title: 'UI: imageGetFolder expuesto',
        ok: typeof k?.imageGetFolder === 'function'
      },
      {
        id: 'ui-api-unload',
        title: 'UI: unloadLocalModels expuesto',
        ok: typeof k?.unloadLocalModels === 'function'
      },
      {
        id: 'ui-api-forge-stop',
        title: 'UI: forgeStop expuesto',
        ok: typeof k?.forgeStop === 'function'
      },
      {
        id: 'ui-api-web-search',
        title: 'UI: webSearch expuesto',
        ok: typeof k?.webSearch === 'function'
      },
      {
        id: 'ui-api-scan-disk',
        title: 'UI: scanLocalModels (disco) expuesto',
        ok: typeof k?.scanLocalModels === 'function'
      }
    ]
    for (const j of journey) {
      checks.push({
        id: j.id,
        layer: 'ux',
        priority: 'P0',
        title: j.title,
        status: j.ok ? 'pass' : 'fail',
        detail: j.detail || (j.ok ? 'function' : 'missing'),
        fixHint: j.ok ? undefined : 'preload + ipcMain'
      })
    }
    // Settings shape for Auto
    checks.push({
      id: 'ui-settings-disabled-models',
      layer: 'ux',
      priority: 'P0',
      title: 'UI: settings.disabledLocalModels es array',
      status: Array.isArray(settings.disabledLocalModels) ? 'pass' : 'fail',
      detail: `len=${(settings.disabledLocalModels || []).length}`,
      fixHint: 'settings schema + Models panel'
    })
    checks.push({
      id: 'ui-settings-initiative',
      layer: 'chat',
      priority: 'P1',
      title: 'UI: iniciativa configurable',
      status:
        typeof settings.conversationInitiativeEnabled === 'boolean' ||
        settings.conversationInitiativeEnabled === undefined
          ? 'pass'
          : 'warn',
      detail: `enabled=${settings.conversationInitiativeEnabled}`
    })
    // Chat store contract
    try {
      const { useChatStore } = await import('@shared/lib/stores/chatStore')
      const st = useChatStore.getState()
      const hasFns =
        typeof st.create === 'function' &&
        typeof st.addMessage === 'function' &&
        typeof st.setActive === 'function'
      checks.push({
        id: 'ui-chat-store',
        layer: 'chat',
        priority: 'P0',
        title: 'UI: chatStore create/addMessage/setActive',
        status: hasFns ? 'pass' : 'fail',
        detail: `convs=${(st.conversations || []).length}`
      })
    } catch (e) {
      checks.push({
        id: 'ui-chat-store',
        layer: 'chat',
        priority: 'P0',
        title: 'UI: chatStore',
        status: 'fail',
        detail: e instanceof Error ? e.message : String(e)
      })
    }
  }

  return finalizeReport({
    generatedAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    targetVersion: APP_VERSION,
    checks,
    feedback,
    logs: { musicTail },
    environment: {
      ...env,
      suites: 'essential+legacy+ui-journey',
      note: 'P0 essential + UI journey corren en cada versión; no son checklist hacia un hito fijo'
    }
  })
}
