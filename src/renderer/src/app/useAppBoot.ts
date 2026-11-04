/**
 * Sequential boot: settings settle → wardrobe hydrate → machine → local models.
 */
import { useEffect, useState } from 'react'
import type { BootStep } from './BootSplash'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'
import { useChatStore } from '@shared/lib/stores/chatStore'

const BOOT_MIN_MS = 400
const BOOT_KEY = 'kawaii-boot-splash-v1'

function setStep(
  steps: BootStep[],
  id: string,
  patch: Partial<BootStep>
): BootStep[] {
  return steps.map((s) => (s.id === id ? { ...s, ...patch } : s))
}

const INITIAL: BootStep[] = [
  { id: 'settings', label: 'Preferencias y ficha', status: 'pending' },
  { id: 'wardrobe', label: 'Avatar y guardarropa (disco)', status: 'pending' },
  { id: 'chats', label: 'Chats e índices (cuota LS)', status: 'pending' },
  { id: 'machine', label: 'Perfil de hardware', status: 'pending' },
  { id: 'models', label: 'Catálogo de modelos locales', status: 'pending' }
]

export function useAppBoot(): {
  ready: boolean
  progress: number
  steps: BootStep[]
} {
  const [ready, setReady] = useState(false)
  const [steps, setSteps] = useState<BootStep[]>(INITIAL)
  const [progress, setProgress] = useState(4)

  useEffect(() => {
    let cancelled = false
    const t0 = Date.now()

    const run = async () => {
      // settings
      setSteps((s) => setStep(s, 'settings', { status: 'running' }))
      setProgress(12)
      await new Promise((r) => setTimeout(r, 120))
      try {
        // Zustand persist usually already applied; force a read
        const st = useSettingsStore.getState().settings
        const name = st?.character?.name || 'sin nombre'
        try {
          const raw = String(st?.character?.visualDescription || '')
          // Never rewrite a user-authored sheet (Persona: visualFromAvatar === false)
          const manual = st?.character?.visualFromAvatar === false
          if (raw && !manual) {
            const { sanitizeVisualDescription, isWeakVisualDescription } = await import(
              '@core/character/avatar-describe'
            )
            const cleaned = sanitizeVisualDescription(raw)
            if (cleaned && cleaned !== raw.trim() && !isWeakVisualDescription(cleaned)) {
              useSettingsStore.getState().update({
                character: {
                  ...st.character,
                  visualDescription: cleaned
                }
              })
            }
          }
        } catch {
          /* optional ficha clean */
        }
        try {
          const st2 = useSettingsStore.getState().settings
          const raw2 = String(st2?.character?.visualDescription || '')
          // Manual descriptions are sacred — no EN→ES rewrite on boot
          if (raw2 && st2?.character?.visualFromAvatar !== false) {
            const { looksEnglishVisualDescription } = await import('@core/character/avatar-describe')
            if (looksEnglishVisualDescription(raw2)) {
              const { englishVisualToSpanishHeuristic } = await import(
                '@core/character/visual-es-heuristic'
              )
              const es = englishVisualToSpanishHeuristic(raw2, st2.character?.name)
              if (es && es.length > 24) {
                useSettingsStore.getState().update({
                  character: { ...st2.character, visualDescription: es, visualFromAvatar: false }
                })
              }
            }
          }
        } catch {
          /* optional ES ficha */
        }
        try {
          const st3 = useSettingsStore.getState().settings as {
            weatherEnabled?: boolean
            weatherCity?: string
            weatherFetchedAt?: number
          }
          if (st3.weatherEnabled && (st3.weatherCity || '').trim()) {
            const { WEATHER_CACHE_MS, fetchWeatherForCity } = await import('@core/weather/open-meteo')
            const age = Date.now() - (st3.weatherFetchedAt || 0)
            if (age > WEATHER_CACHE_MS || !st3.weatherFetchedAt) {
              const w = await fetchWeatherForCity(st3.weatherCity!.trim())
              if (w) {
                useSettingsStore.getState().update({
                  weatherSummary: w.summary || '',
                  weatherTempC: w.tempC,
                  weatherCondition: w.condition || '',
                  weatherFetchedAt: Date.now()
                } as never)
              }
            }
          }
        } catch {
          /* weather optional offline */
        }
        try {
          const { restoreCharacterIdentityIfNeeded } = await import(
            '@features/settings/services/characterIdentityDisk'
          )
          const stId = useSettingsStore.getState().settings
          const restored = await restoreCharacterIdentityIfNeeded(stId.character || {})
          if (restored.applied && restored.visualDescription) {
            useSettingsStore.getState().update({
              character: {
                ...stId.character,
                visualDescription: restored.visualDescription,
                visualFromAvatar: restored.visualFromAvatar === true
              }
            })
          }
        } catch {
          /* identity disk optional */
        }
        if (cancelled) return
        setSteps((s) =>
          setStep(s, 'settings', {
            status: 'done',
            detail: `Personaje: ${name}`
          })
        )
        setProgress(28)
      } catch (e) {
        if (cancelled) return
        setSteps((s) =>
          setStep(s, 'settings', {
            status: 'error',
            detail: e instanceof Error ? e.message : String(e)
          })
        )
      }

      // wardrobe
      setSteps((s) => setStep(s, 'wardrobe', { status: 'running' }))
      setProgress(40)
      try {
        const {
          hydrateCharacterVisualFromDisk,
          ensureCharacterVisualsOnDisk
        } = await import('@features/settings/services/wardrobeDisk')
        const cur = useSettingsStore.getState().settings
        let ch = await ensureCharacterVisualsOnDisk(cur.character || {})
        const { character, hydrated } = await hydrateCharacterVisualFromDisk(ch)
        // Keep session hydrated (dataUrls) in memory; persist stays thin via partialize
        useSettingsStore.getState().update({
          character: {
            ...cur.character,
            ...character,
            visualImageUrl: character.visualImageUrl,
            facePrimaryUrl: character.facePrimaryUrl,
            visualGallery: character.visualGallery
          } as typeof cur.character
        })
        // Wait until principal (or any gallery item) has a real dataUrl when filePath exists
        const needImg =
          Boolean(character.visualImageUrl?.startsWith?.('data:image/')) ||
          (character.visualGallery || []).some(
            (g: { dataUrl?: string }) => g.dataUrl?.startsWith?.('data:image/')
          )
        const hadPaths =
          Boolean((cur.character as { visualGallery?: { filePath?: string }[] })?.visualGallery?.some(
            (g) => g.filePath
          )) || Boolean((cur.character as { visualImageUrl?: string })?.visualImageUrl)
        if (cancelled) return
        setSteps((s) =>
          setStep(s, 'wardrobe', {
            status: 'done',
            detail: needImg
              ? hydrated > 0
                ? `${hydrated} imagen(es) listas desde disco`
                : 'Imágenes en memoria'
              : hadPaths
                ? 'Rutas en disco sin dataUrl (revisa archivos)'
                : 'Sin avatar en disco aún'
          })
        )
        setProgress(48)
      } catch (e) {
        if (cancelled) return
        setSteps((s) =>
          setStep(s, 'wardrobe', {
            status: 'skip',
            detail: e instanceof Error ? e.message.slice(0, 80) : 'omitido'
          })
        )
        setProgress(48)
      }

      // chats: ensure attachment extracts on disk (P1 / D1 companion)
      setSteps((s) => setStep(s, 'chats', { status: 'running' }))
      setProgress(55)
      try {
        const { persistMissingChatAttachments } = await import(
          '@features/chat/services/persistChatAttachments'
        )
        const n = await persistMissingChatAttachments()
        let hydrated = 0
        try {
          const { useChatStore } = await import('@shared/lib/stores/chatStore')
          const { hydrateConversationIfNeeded } = await import(
            '@features/chat/services/chatDiskSpill'
          )
          const st = useChatStore.getState()
          const next = []
          for (const c of st.conversations || []) {
            const full = await hydrateConversationIfNeeded(c)
            if (full && (full.messages?.length || 0) > (c.messages?.length || 0)) {
              next.push(full)
              hydrated++
            } else {
              next.push(c)
            }
          }
          if (hydrated > 0) {
            useChatStore.setState({ conversations: next })
          }
          // Full recovery: merge any disk-only / longer chats
          try {
            const { recoverChatsFromDisk } = await import(
              '@features/chat/services/chatRecovery'
            )
            const rec = await recoverChatsFromDisk()
            if (rec.merged + rec.restored > 0) {
              hydrated += rec.merged + rec.restored
            }
          } catch {
            /* */
          }
        } catch {
          /* optional */
        }
        if (cancelled) return
        let docPendingNote = ''
        try {
          const { summarizePendingDocReadings, listPendingDocReadings } = await import(
            '@features/chat/services/documentReadingStore'
          )
          docPendingNote = summarizePendingDocReadings(3)
          const pending = listPendingDocReadings()
          if (pending.length && typeof window !== 'undefined') {
            try {
              const { notifyUser } = await import('@shared/lib/notify')
              void notifyUser(
                'Lectura de documento pendiente',
                pending[0]!.label +
                  (pending.length > 1 ? ` · y ${pending.length - 1} más` : '') +
                  '. Abre el chat y usa Continuar lectura o pregunta por un capítulo.',
                { kind: 'info', sticky: false, os: false }
              )
            } catch {
              /* notify optional */
            }
          }
        } catch {
          /* */
        }
        setSteps((s) =>
          setStep(s, 'chats', {
            status: 'done',
            detail:
              (n > 0 ? `${n} adjunto(s) · ` : '') +
              (hydrated > 0
                ? `${hydrated} chat(s) recuperados/hidratados`
                : 'Índice de chats listo') +
              (docPendingNote ? ` · ${docPendingNote}` : '')
          })
        )
        setProgress(62)
      } catch (e) {
        if (cancelled) return
        setSteps((s) =>
          setStep(s, 'chats', {
            status: 'skip',
            detail: e instanceof Error ? e.message.slice(0, 60) : 'omitido'
          })
        )
        setProgress(62)
      }

      // Heal garbage preferredName (dime cuál → «cuál»)
      try {
        const { sanitizeUserMemoryNames } = await import('@core/conversation/user-memory')
        const um = useSettingsStore.getState().settings.userMemory
        const cleaned = sanitizeUserMemoryNames(um)
        if (cleaned && cleaned !== um) {
          useSettingsStore.getState().update({ userMemory: cleaned })
        }
      } catch {
        /* */
      }

      // E0 — harvest preferred names / light facts from open chats into durable memory
      try {
        const { harvestFromConversations, applyHarvestToAssistantMemory } = await import(
          '@core/conversation/memory-harvest'
        )
        const { applyGrowthMilestone } = await import('@core/conversation/memory-growth')
        const { filterSalientNames } = await import('@core/conversation/memory-write-policy')
        const convs = useChatStore.getState().conversations || []
        const harvest = harvestFromConversations(
          convs.map((c) => ({
            id: c.id,
            title: c.title,
            messages: (c.messages || []).map((m) => ({
              role: m.role,
              content: typeof m.content === 'string' ? m.content : '',
              meta: m.meta as { kind?: string } | undefined
            }))
          })),
          { maxMessagesPerConv: 300, maxConvs: 30 }
        )
        const salient = filterSalientNames(harvest.preferredNames, { explicit: true })
        harvest.preferredNames = salient
        if (harvest.preferredNames.length || harvest.rejectedNames.length) {
          const prev = useSettingsStore.getState().settings.assistantMemory
          const { next, changed, addedNames } = applyHarvestToAssistantMemory(prev, harvest)
          let finalMem = next
          if (addedNames.length) {
            finalMem = applyGrowthMilestone(next, {
              type: 'nickname_harvested',
              names: addedNames
            })
          }
          if (changed || addedNames.length) {
            useSettingsStore.getState().update({ assistantMemory: finalMem })
          }
        }
      } catch {
        /* harvest optional — never block boot */
      }

      // machine
      setSteps((s) => setStep(s, 'machine', { status: 'running' }))
      setProgress(70)
      try {
        const p = await window.kawaii?.machineEnsureProfile?.()
        const mem = (p as { profile?: { totalMemoryGB?: number } })?.profile
          ?.totalMemoryGB
        if (cancelled) return
        setSteps((s) =>
          setStep(s, 'machine', {
            status: 'done',
            detail: typeof mem === 'number' ? `RAM ~${mem} GB` : 'perfil listo'
          })
        )
        setProgress(82)
      } catch {
        if (cancelled) return
        setSteps((s) =>
          setStep(s, 'machine', { status: 'skip', detail: 'sin IPC' })
        )
        setProgress(82)
      }

      // models catalog
      setSteps((s) => setStep(s, 'models', { status: 'running' }))
      try {
        const { discoverLocalModelsFull } = await import('@core/providers')
        const st = useSettingsStore.getState().settings
        const snap = await discoverLocalModelsFull({
          ollamaBaseUrl: st.localBaseUrl,
          openAIBaseUrl: (st.localOpenAIBaseUrl || '').trim() || undefined
        })
        if (cancelled) return
        const n = snap.models?.length || 0
        setSteps((s) =>
          setStep(s, 'models', {
            status: 'done',
            detail: n
              ? `${n} modelo(s)` +
                (snap.ollama ? ' · Ollama' : '') +
                (snap.openAI ? ' · LM Studio' : '')
              : 'ninguno detectado aún'
          })
        )
        setProgress(96)
      } catch (e) {
        if (cancelled) return
        setSteps((s) =>
          setStep(s, 'models', {
            status: 'skip',
            detail: e instanceof Error ? e.message.slice(0, 80) : 'omitido'
          })
        )
        setProgress(96)
      }

      const wait = Math.max(0, BOOT_MIN_MS - (Date.now() - t0))
      if (wait) await new Promise((r) => setTimeout(r, wait))
      if (cancelled) return
      setProgress(100)
      try {
        sessionStorage.setItem(BOOT_KEY, String(Date.now()))
      } catch {
        /* */
      }
      setReady(true)
    }

    void run()
    // Never leave the UI on an infinite cream splash (disk hang / quota)
    const hard = window.setTimeout(() => {
      if (!cancelled) {
        setProgress(100)
        setReady(true)
      }
    }, 25_000)
    return () => {
      cancelled = true
      window.clearTimeout(hard)
    }
  }, [])

  // Flush full chats: close/hide + every 45s while the app is open
  useEffect(() => {
    const flush = () => {
      try {
        void import('@features/chat/services/chatRecovery').then((r) => {
          void r.forceSpillAllChats()
        })
        void import('@features/chat/services/chatDiskSpill').then(async (m) => {
          try {
            const { useChatStore } = await import('@shared/lib/stores/chatStore')
            m.noteFullConversationsForSpill(useChatStore.getState().conversations || [])
            m.scheduleSpillLatestFull()
          } catch {
            m.scheduleSpillLatestFull()
          }
        })
      } catch {
        /* */
      }
    }
    window.addEventListener('beforeunload', flush)
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush()
    })
    const tick = window.setInterval(flush, 45_000)
    return () => {
      window.removeEventListener('beforeunload', flush)
      window.removeEventListener('pagehide', flush)
      window.clearInterval(tick)
    }
  }, [])

  return { ready, progress, steps }
}
