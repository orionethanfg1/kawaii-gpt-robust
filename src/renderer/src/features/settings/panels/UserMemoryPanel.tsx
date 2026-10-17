import { runOpenChatsMemoryConsistency } from '../services/runMemoryConsistency'
import { compactAssistantMemory, memoryListsChanged } from '@core/conversation/assistant-memory-compact'
/**
 * Contexto y memoria del usuario — editable, visible, limpia.
 * Complementa el aprendizaje automático del chat (mergeUserMemory).
 */
import { useEffect, useMemo, useState } from 'react'
import { Brain, Pin, Trash2, Plus, User } from 'lucide-react'
import {
  assistantLikeLabels,
  inferAssistantGender
} from '@core/character/pronouns'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'
import {
  STAGE_LABELS,
  STAGE_BLURBS,
  effectiveRelationshipStage
} from '@core/conversation/intimacy-stage'
import { evaluateAgeGate } from '@core/user/age-gate'
import { Button } from '@shared/ui/Button'
import { AgendaMemoryPanel } from './AgendaMemoryPanel'
import {
  flattenFacts,
  normalizeLikePhrase,
  type UserMemory,
  type NamedPerson
} from '@core/conversation/user-memory'
import {
  snapshotUserMemory,
  restoreLatestUserMemory,
  hasUserMemoryBackup,
  getUserMemoryBackupMeta,
  acknowledgeMemoryGate,
  evaluateMemoryGate
} from '@core/conversation/memory-backup-gate'
import { isUserMemorySparse } from '@core/conversation/dual-memory'
import {
  emptyAssistantMemory,
  partitionAssistantLikes,
  type AssistantMemory
} from '@core/conversation/assistant-memory'
import {
  hydrateAssistantMemoryFromMirror,
  peekAssistantMemoryMirror
} from '@features/chat/services/assistantMemoryCollector'
import {
  getLastMemoryCollectStatus,
  subscribeMemoryCollectStatus,
  formatMemoryCollectStatus
} from '@core/conversation/memory-collect-status'

function updateMemory(patch: Partial<UserMemory>) {
  const prev = useSettingsStore.getState().settings.userMemory || { facts: [] }
  useSettingsStore.getState().update({
    userMemory: {
      ...prev,
      ...patch,
      updatedAt: Date.now()
    }
  })
}

function ChipList({
  items,
  onRemove,
  onEdit,
  empty,
  hint
}: {
  items: string[]
  onRemove: (i: number) => void
  onEdit?: (i: number, next: string) => void
  empty: string
  hint?: string
}) {
  if (!items.length) {
    return <p className="text-[10px] text-kawaii-text-muted italic">{empty}</p>
  }
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((x, i) => (
        <li
          key={`${x}-${i}`}
          className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-white border border-kawaii-border"
          title={hint || x}
        >
          <span className="max-w-[14rem] truncate">{x}</span>
          {onEdit ? (
            <button
              type="button"
              className="text-kawaii-text-muted hover:text-violet-600 text-[10px]"
              title="Editar"
              onClick={() => {
                const next = window.prompt('Editar recuerdo:', x)
                if (next == null) return
                const v = next.trim()
                if (!v || v === x) return
                onEdit(i, v)
              }}
            >
              ✎
            </button>
          ) : null}
          <button
            type="button"
            className="text-kawaii-text-muted hover:text-rose-600"
            title="Quitar"
            onClick={() => onRemove(i)}
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </li>
      ))}
    </ul>
  )
}

export function UserMemoryPanel() {
  const settings = useSettingsStore((s) => s.settings)
  const mem = settings.userMemory || { facts: [] }
  const facts = useMemo(() => flattenFacts(mem), [mem])
  /** Hechos generales (sin prefijos INTIMACY_*) — van a la sección íntima */
  const generalFacts = useMemo(
    () => facts.filter((f) => !/^INTIMACY_/i.test(String(f))),
    [facts]
  )
  const intimacyFacts = useMemo(
    () => facts.filter((f) => /^INTIMACY_/i.test(String(f))),
    [facts]
  )
  const intimacyFirst = useMemo(
    () =>
      intimacyFacts
        .find((f) => String(f).startsWith('INTIMACY_FIRST:'))
        ?.replace(/^INTIMACY_FIRST:\s*/i, '') || '',
    [intimacyFacts]
  )
  const intimacyNotes = useMemo(
    () =>
      intimacyFacts
        .filter((f) => String(f).startsWith('INTIMACY_MEMORY:'))
        .map((f) => f.replace(/^INTIMACY_MEMORY:\s*/i, '')),
    [intimacyFacts]
  )
  const [factDraft, setFactDraft] = useState('')
  const [rebuildConvId, setRebuildConvId] = useState<string>('')
  // One-shot: clear preferredName if it was wrongly set to «tuyo» etc.
  useEffect(() => {
    try {
      const { looksLikePersonName } = require('@core/conversation/user-memory') as typeof import('@core/conversation/user-memory')
      const pref = mem.preferredName
      if (pref && !looksLikePersonName(pref)) {
        const fromSummary = String(mem.relationshipSummary || '').match(/\b(Nahum|[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,})\b/)
        const healed = fromSummary?.[1] && looksLikePersonName(fromSummary[1]) ? fromSummary[1] : undefined
        updateMemory({
          preferredName: healed,
          userName: (mem as { userName?: string }).userName || healed
        } as Parameters<typeof updateMemory>[0])
      } else if (pref && looksLikePersonName(pref) && !(mem as { userName?: string }).userName) {
        updateMemory({ userName: pref } as Parameters<typeof updateMemory>[0])
      }
    } catch {
      /* */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // Retro: chats con señales íntimas → privados si ya hay INTIMACY_FIRST
  useEffect(() => {
    try {
      const hasFirst = facts.some((f) => String(f).startsWith('INTIMACY_FIRST:'))
      if (!hasFirst) return
      const { useChatStore } = require('@shared/lib/stores/chatStore') as typeof import('@shared/lib/stores/chatStore')
      const { looksLikeOngoingIntimateScene } = require('@core/conversation/intimacy-stage') as typeof import('@core/conversation/intimacy-stage')
      const st = useChatStore.getState()
      for (const c of st.conversations || []) {
        if (c.isPrivate) continue
        const texts = (c.messages || []).slice(-12).map((m: { content?: string }) => String(m.content || ''))
        if (looksLikeOngoingIntimateScene(texts)) {
          st.setPrivate?.(c.id, true)
        }
      }
    } catch {
      /* */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])


  const [likeDraft, setLikeDraft] = useState('')
  const [dislikeDraft, setDislikeDraft] = useState('')
  const [goalDraft, setGoalDraft] = useState('')
  const [personName, setPersonName] = useState('')
  const [personRel, setPersonRel] = useState('')
  const [consistencyNote, setConsistencyNote] = useState('')

  useEffect(() => {
    let cancelled = false
    const id = window.setTimeout(() => {
      if (cancelled) return
      try {
        const r = runOpenChatsMemoryConsistency()
        if (!cancelled && (r.assistantAdded.length || r.userAdded.length || r.favoritesFound.length)) {
          setConsistencyNote(
            `Auto-revisión (${r.durationMs}ms): ` +
              [...r.favoritesFound.slice(0, 3), ...r.assistantAdded.slice(0, 2)].filter(Boolean).join(' · ')
          )
        }
      } catch {
        /* ignore */
      }
    }, 500)
    return () => {
      cancelled = true
      window.clearTimeout(id)
    }
  }, []) // consistency-auto
  const [tab, setTab] = useState<'user' | 'assistant' | 'intimate' | 'agenda'>('user')
  const showIntimateTab = Boolean(
    settings.adultIntimacyOptIn ||
      settings.relationshipState?.intimacyOpen ||
      /intimate/i.test(String(settings.relationshipState?.stage || '')) ||
      facts.some((f) => /^INTIMACY_/i.test(String(f))) ||
      /novia|pareja|románt|romant|esposa|esposo|lover/i.test(
        String(settings.character?.relationshipRole || '')
      )
  )
  const [collectStatusTick, setCollectStatusTick] = useState(0)
  const [showSensitiveMood, setShowSensitiveMood] = useState(false)
  useEffect(() => {
    return subscribeMemoryCollectStatus(() => setCollectStatusTick((n) => n + 1))
  }, [])
  const lastCollect = getLastMemoryCollectStatus()
  void collectStatusTick

  const aMem: AssistantMemory = (() => {
    const fromSettings = settings.assistantMemory
    const n =
      (fromSettings?.likes?.length || 0) +
      (fromSettings?.dislikes?.length || 0) +
      (fromSettings?.habits?.length || 0) +
      (fromSettings?.relational?.length || 0)
    let base =
      n > 0 && fromSettings
        ? fromSettings
        : peekAssistantMemoryMirror() || fromSettings || emptyAssistantMemory()
    // B2: split relational chips out of legacy likes
    try {
      base = partitionAssistantLikes(base)
    } catch {
      /* ignore */
    }
    return base
  })()
  const aGender = inferAssistantGender({
    explicit: (settings.character as { gender?: string } | undefined)?.gender,
    relationshipRole: settings.character?.relationshipRole,
    name: settings.character?.name,
    personality: settings.character?.personality
  })
  const aLabels = assistantLikeLabels(aGender)
  const [aLikeDraft, setALikeDraft] = useState('')
  const [aDislikeDraft, setADislikeDraft] = useState('')
  const [aRelDraft, setARelDraft] = useState('')

  // Rehydrate assistant memory + B2 partition + drop legacy garbage likes
  useEffect(() => {
    const empty =
      !(
        aMem.likes?.length ||
        aMem.dislikes?.length ||
        aMem.habits?.length ||
        aMem.relational?.length
      )
    if (empty) {
      try {
        hydrateAssistantMemoryFromMirror()
      } catch {
        /* ignore */
      }
    }
    // B2: persist partitioned likes → relational if needed
    try {
      const cur = useSettingsStore.getState().settings.assistantMemory
      if (cur?.likes?.length) {
        const part = partitionAssistantLikes(cur)
        const moved =
          (part.relational?.length || 0) > (cur.relational?.length || 0) ||
          (part.likes?.length || 0) < (cur.likes?.length || 0)
        if (moved) {
          useSettingsStore.getState().update({ assistantMemory: part })
        }
      }
    } catch {
      /* ignore */
    }
    try {
      const prev = useSettingsStore.getState().settings.userMemory
      const likes = (prev?.likes || []).map(normalizeLikePhrase).filter(Boolean)
      if (prev?.likes && likes.join('|') !== prev.likes.join('|')) {
        useSettingsStore.getState().update({
          userMemory: { ...prev, likes, updatedAt: Date.now() }
        })
      }
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  // B7 — compact near-duplicate likes when opening assistant memory
  useEffect(() => {
    if (tab !== 'assistant') return
    try {
      const cur = useSettingsStore.getState().settings.assistantMemory
      if (!cur) return
      const next = compactAssistantMemory(cur)
      if (memoryListsChanged(cur, next)) {
        useSettingsStore.getState().update({ assistantMemory: { ...next, updatedAt: Date.now() } })
      }
    } catch {
      /* ignore */
    }
  }, [tab])


  const updateAssistant = (patch: Partial<AssistantMemory>) => {
    const prev = useSettingsStore.getState().settings.assistantMemory || emptyAssistantMemory()
    useSettingsStore.getState().update({
      assistantMemory: { ...prev, ...patch, updatedAt: Date.now() }
    })
  }

  const addFact = () => {
    const t = factDraft.trim()
    if (!t) return
    const next = [...facts, t].slice(-40)
    updateMemory({ facts: next, factEntries: undefined })
    setFactDraft('')
  }

  const removeFact = (i: number) => {
    const next = facts.filter((_, idx) => idx !== i)
    updateMemory({ facts: next, factEntries: [] })
  }

  const clearAll = () => {
    if (!window.confirm('¿Borrar toda la memoria del usuario? Se guardará un respaldo local por si quieres recuperarla.')) {
      return
    }
    const prev = useSettingsStore.getState().settings.userMemory
    snapshotUserMemory(prev, 'panel-clear')
    updateMemory({
      facts: [],
      factEntries: [],
      preferredName: undefined,
      nicknames: [],
      pendingNickname: undefined,
      goals: [],
      currentFocus: undefined,
      likes: [],
      favorites: [],
      dislikes: [],
      people: [],
      emotionalNotes: [],
      relationshipSummary: undefined,
      appearanceNotes: undefined,
      avatarScenes: []
    })
    useSettingsStore.getState().update({
      memoryGatePending: true,
      relationshipState: {
        stage: 'stranger',
        acceptedNicknames: [],
        rejectedNicknames: [],
        turnsTogether: 0,
        updatedAt: Date.now()
      },
      memoryOnboarding: {
        active: true,
        step: 'name',
        dismissed: false,
        updatedAt: Date.now()
      }
    })
  }

  const restoreFromBackup = () => {
    const m = restoreLatestUserMemory()
    if (!m) {
      window.alert('No hay respaldo de memoria de usuario.')
      return
    }
    updateMemory({ ...m, updatedAt: Date.now() })
    acknowledgeMemoryGate('restore')
    useSettingsStore.getState().update({ memoryGatePending: false })
  }

  const startFresh = () => {
    acknowledgeMemoryGate('fresh')
    useSettingsStore.getState().update({
      memoryGatePending: false,
      memoryOnboarding: { active: true, step: 'name', dismissed: false, updatedAt: Date.now() }
    })
  }

  const gate = evaluateMemoryGate(mem)
  const showGate =
    settings.memoryGatePending || gate.kind === 'offer-restore' || (isUserMemorySparse(mem) && hasUserMemoryBackup())
  const backupMeta = getUserMemoryBackupMeta()

  return (
    <div
      id="settings-memory"
      className="scroll-mt-4 border border-kawaii-border rounded-kawaii p-3 space-y-4 bg-violet-50/40"
    >
      {showGate && backupMeta ? (
        <div className="rounded-kawaii border border-amber-200 bg-amber-50/80 p-3 text-xs space-y-2">
          <p className="text-kawaii-text">
            Hay un <strong>respaldo</strong> de memoria de usuario
            {backupMeta.at ? ` (${new Date(backupMeta.at).toLocaleString()})` : ''}.
            ¿Quieres recuperarlo o empezar de cero?
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" className="text-[11px]" onClick={restoreFromBackup}>
              Restaurar respaldo
            </Button>
            <Button type="button" className="text-[11px]" onClick={startFresh}>
              Empezar de nuevo
            </Button>
          </div>
        </div>
      ) : null}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
        <div className="space-y-2 min-w-0 flex-1">
          <h3 className="font-bold text-sm text-kawaii-text flex items-center gap-1.5">
            <Brain className="w-4 h-4 text-violet-600" />
            Contexto y memoria del usuario
          </h3>
          <p className="text-[10px] text-kawaii-text-muted mt-0.5 max-w-xl">
            Datos que el chat usa para conocerte (nombre, gustos, personas, metas). Se actualizan al
            conversar y también puedes editarlos aquí. No guarda el historial completo, solo hechos
            curados.
            {(() => {
              const st = effectiveRelationshipStage(
                settings.relationshipState,
                settings.adultIntimacyOptIn
              )
              const label = STAGE_LABELS[st] || st
              return (
                <span className="block mt-1 text-violet-700">
                  Vínculo: <strong>{label}</strong>
                  {typeof settings.relationshipState?.turnsTogether === 'number'
                    ? ' · ' + String(settings.relationshipState.turnsTogether) + ' turnos'
                    : ''}
                  {settings.adultIntimacyOptIn ? ' · cercanía adulta on' : ''}
                </span>
              )
            })()}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="text-[11px] px-2.5 py-1 rounded-full border border-kawaii-border bg-white hover:bg-pink-50 text-kawaii-text"
              onClick={() => {
                try {
                  const r = runOpenChatsMemoryConsistency()
                  const bits = [
                    r.favoritesFound.length
                      ? 'favoritos: ' + r.favoritesFound.slice(0, 4).join(', ')
                      : null,
                    r.assistantAdded.length
                      ? '+asistente: ' + r.assistantAdded.slice(0, 3).join(', ')
                      : null,
                    r.userAdded.length
                      ? '+usuario: ' + r.userAdded.slice(0, 3).join(', ')
                      : null
                  ].filter(Boolean)
                  setConsistencyNote(
                    bits.length
                      ? 'Consistencia OK (' + r.durationMs + 'ms) · ' + bits.join(' · ')
                      : 'Consistencia OK (' + r.durationMs + 'ms) · sin novedades en chats abiertos'
                  )
                } catch (e) {
                  setConsistencyNote(
                    'No se pudo revisar: ' + (e instanceof Error ? e.message : String(e))
                  )
                }
              }}
            >
              Revisar consistencia de memoria
            </button>
            {consistencyNote ? (
              <span className="text-[10px] text-kawaii-text-muted">{consistencyNote}</span>
            ) : null}
          </div>
        </div>
        {tab === 'user' ? (
          <Button className="text-[11px] shrink-0" onClick={clearAll}>
            Limpiar memoria del usuario
          </Button>
        ) : null}
      </div>

      <div className="rounded-xl border border-violet-200/80 bg-violet-50/40 p-3 space-y-2">
        
        <p className="text-[11px] font-semibold text-kawaii-text">Flujo de relación</p>
        <p className="text-[10px] text-kawaii-text-muted leading-relaxed">
          Evoluciona con naturalidad: profesional → compañero → cercanía → íntimo (opt-in adulto).
          La pestaña Íntimo y el chip de escena solo aparecen cuando el vínculo lo amerita.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              { id: 'stranger', label: 'Profesional / nuevo', tip: 'Asistente útil, sin cercanía forzada' },
              { id: 'acquaintance', label: 'Conocidos', tip: 'Ya hay trato frecuente' },
              { id: 'familiar', label: 'Compañero', tip: 'Confianza y afecto cotidiano' },
              { id: 'intimate', label: 'Cercanía', tip: 'Vínculo emocional profundo' },
              ...(settings.adultIntimacyOptIn
                ? [{ id: 'intimate_adult' as const, label: 'Íntimo (adulto)', tip: 'Cercanía física opt-in' }]
                : [])
            ] as const
          ).map((row) => {
            const cur = effectiveRelationshipStage(
              settings.relationshipState,
              settings.adultIntimacyOptIn
            )
            const active = cur === row.id
            return (
              <button
                key={row.id}
                type="button"
                title={row.tip}
                className={`text-[10px] px-2 py-1 rounded-full border ${
                  active
                    ? 'bg-violet-100 border-violet-300 text-violet-950 font-semibold'
                    : 'bg-white/80 border-kawaii-border text-kawaii-text-muted hover:bg-white'
                }`}
                onClick={() => {
                  useSettingsStore.getState().update({
                    relationshipState: {
                      ...(settings.relationshipState || {
                        stage: 'stranger',
                        acceptedNicknames: [],
                        rejectedNicknames: [],
                        turnsTogether: 0
                      }),
                      stage: row.id as 'stranger' | 'acquaintance' | 'familiar' | 'intimate' | 'intimate_adult',
                      intimacyOpen:
                        row.id === 'intimate' || row.id === 'intimate_adult'
                          ? true
                          : settings.relationshipState?.intimacyOpen,
                      updatedAt: Date.now()
                    }
                  })
                }}
              >
                {row.label}
              </button>
            )
          })}
        </div>
<p className="text-[11px] font-semibold text-kawaii-text">Nivel de familiaridad</p>
        <p className="text-[10px] text-kawaii-text-muted leading-relaxed">
          {STAGE_BLURBS[
            effectiveRelationshipStage(settings.relationshipState, settings.adultIntimacyOptIn)
          ]}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              'stranger',
              'acquaintance',
              'familiar',
              'intimate',
              ...(settings.adultIntimacyOptIn ? (['intimate_adult'] as const) : [])
            ] as const
          ).map((id) => {
            const cur = effectiveRelationshipStage(
              settings.relationshipState,
              settings.adultIntimacyOptIn
            )
            const active = cur === id
            return (
              <button
                key={id}
                type="button"
                className={
                  'text-[10px] px-2 py-0.5 rounded-full border ' +
                  (active
                    ? 'bg-violet-600 text-white border-violet-600'
                    : 'bg-white border-kawaii-border text-kawaii-text-muted hover:bg-white/90')
                }
                onClick={() => {
                  const rel = settings.relationshipState || {}
                  useSettingsStore.getState().update({
                    relationshipState: {
                      ...rel,
                      stage: id,
                      updatedAt: Date.now()
                    }
                  })
                }}
              >
                {STAGE_LABELS[id]}
              </button>
            )
          })}
        </div>
        <label className="block text-[11px] text-kawaii-text pt-1 space-y-1">
          <span className="font-medium">Fecha de nacimiento</span>
          <input
            type="date"
            className="input-kawaii text-sm max-w-[200px]"
            value={(settings.userBirthDate || '').slice(0, 10)}
            onChange={(e) => {
              const v = e.target.value
              useSettingsStore.getState().update({
                userBirthDate: v,
                ageGateCompleted: Boolean(v)
              })
              const g = evaluateAgeGate(v)
              if (!g.allowAdultContent && settings.adultIntimacyOptIn) {
                useSettingsStore.getState().update({
                  adultIntimacyOptIn: false,
                  relationshipState: settings.relationshipState
                    ? {
                        ...settings.relationshipState,
                        stage:
                          settings.relationshipState.stage === 'intimate_adult'
                            ? 'intimate'
                            : settings.relationshipState.stage,
                        updatedAt: Date.now()
                      }
                    : settings.relationshipState
                })
              }
            }}
          />
          <span className="block text-[10px] text-kawaii-text-muted">
            Solo en este dispositivo. Sirve para no mostrar contenido adulto a menores y para
            felicitarte el cumpleaños.
          </span>
        </label>
        <label className="flex items-start gap-2 text-[11px] text-kawaii-text cursor-pointer pt-1">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={Boolean(settings.adultIntimacyOptIn)}
            disabled={!evaluateAgeGate(settings.userBirthDate).allowAdultContent}
            onChange={(e) => {
              const on = e.target.checked
              if (!on && settings.relationshipState?.stage === 'intimate_adult') {
                useSettingsStore.getState().update({
                  adultIntimacyOptIn: false,
                  relationshipState: {
                    ...settings.relationshipState,
                    stage: 'intimate',
                    updatedAt: Date.now()
                  }
                })
              } else {
                useSettingsStore.getState().update({ adultIntimacyOptIn: on })
              }
            }}
          />
          <span>
            <span className="font-medium">Permitir cercanía adulta (opt-in)</span>
            <span className="block text-[10px] text-kawaii-text-muted mt-0.5">
              Requiere 18+ (fecha de nacimiento). No es un modo pornográfico: flirt/intimidad
              física solo con tu consentimiento. El chat puede proponer; tú aceptas o rechazas.
            </span>
          </span>
        </label>
      </div>

      
      <div className="flex gap-1 border-b border-kawaii-border pb-2 flex-wrap">
        <button
          type="button"
          className={`text-[11px] px-3 py-1 rounded-t ${tab === 'user' ? 'bg-white border border-b-0 border-kawaii-border font-semibold' : 'text-kawaii-text-muted'}`}
          onClick={() => setTab('user')}
        >
          Usuario
        </button>
        <button
          type="button"
          className={`text-[11px] px-3 py-1 rounded-t ${tab === 'assistant' ? 'bg-white border border-b-0 border-kawaii-border font-semibold' : 'text-kawaii-text-muted'}`}
          onClick={() => setTab('assistant')}
        >
          Asistente
        </button>
        {showIntimateTab ? (
          <button
            type="button"
            className={`text-[11px] px-3 py-1 rounded-t ${tab === 'intimate' ? 'bg-rose-50 border border-b-0 border-rose-200 font-semibold text-rose-900' : 'text-kawaii-text-muted'}`}
            onClick={() => setTab('intimate')}
          >
            Íntimo
          </button>
        ) : null}
        <button
          type="button"
          className={`text-[11px] px-3 py-1 rounded-t ${tab === 'agenda' ? 'bg-white border border-b-0 border-kawaii-border font-semibold' : 'text-kawaii-text-muted'}`}
          onClick={() => setTab('agenda')}
        >
          Agenda
        </button>
      </div>
      {tab === 'intimate' && showIntimateTab ? (
        <div className="space-y-3">
          <p className="text-[11px] text-kawaii-text-muted">
            Recuerdos compartidos de cercanía (usuario + asistente). No se mezclan con hechos
            generales ni con la memoria solo del asistente.
          </p>
      {/* Sección especial · Intimidad (siempre visible, no mezclar con hechos) */}
      <div
        id="kawaii-intimacy-memory"
        className="rounded-xl border-2 border-rose-300 bg-gradient-to-b from-rose-50 to-white p-3.5 space-y-2.5 shadow-sm"
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-bold text-rose-900 tracking-tight">
              Sección especial · Intimidad
            </p>
            <p className="text-[10px] text-rose-800/80 leading-snug mt-0.5">
              Primera vez privilegiada, fase de escena y notas íntimas. No se listan abajo en
              «Hechos».
            </p>
          </div>
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 shrink-0">
            {settings.relationshipState?.intimacyOpen ? 'open' : 'cerrada'}
          </span>
        </div>
        <div className="flex flex-wrap gap-2 text-[10px] text-kawaii-text">
          <span className="px-2 py-0.5 rounded-md bg-white border border-rose-200">
            Fase:{' '}
            <strong>
              {String(
                (settings.relationshipState as { scenePhase?: string } | undefined)?.scenePhase ||
                  'idle'
              )}
            </strong>
          </span>
          <span className="px-2 py-0.5 rounded-md bg-white border border-rose-200">
            Primera vez:{' '}
            <strong>
              {intimacyFirst ||
              (settings.relationshipState as { firstIntimateSceneDone?: boolean } | undefined)
                ?.firstIntimateSceneDone
                ? 'registrada'
                : 'pendiente'}
            </strong>
          </span>
          <span className="px-2 py-0.5 rounded-md bg-white border border-rose-200">
            Tags: <strong>{intimacyFacts.length}</strong>
          </span>
        </div>
        {intimacyFirst ? (
          <div className="text-[12px] text-kawaii-text bg-white rounded-lg p-2.5 border border-rose-200 whitespace-pre-wrap max-h-48 overflow-y-auto leading-relaxed">
            <div className="text-[10px] font-bold uppercase tracking-wide text-rose-700 mb-1">
              INTIMACY_FIRST · memoria privilegiada
            </div>
            {intimacyFirst}
          </div>
        ) : (
          <div className="text-[11px] text-rose-900/80 bg-white/70 rounded-lg p-2.5 border border-dashed border-rose-300">
            Aún no hay narrativa de la primera vez. Con el chat de esa escena abierto, pulsa
            el botón de abajo para reconstruirla desde el historial.
          </div>
        )}
        {intimacyNotes.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold text-rose-800 mb-1">Escenas posteriores</p>
            <ul className="text-[11px] text-kawaii-text space-y-1 list-disc pl-4">
              {intimacyNotes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </div>
        )}
        {intimacyFacts.filter(
          (f) =>
            !String(f).startsWith('INTIMACY_FIRST:') &&
            !String(f).startsWith('INTIMACY_MEMORY:')
        ).length > 0 && (
          <div className="flex flex-wrap gap-1">
            {intimacyFacts
              .filter(
                (f) =>
                  !String(f).startsWith('INTIMACY_FIRST:') &&
                  !String(f).startsWith('INTIMACY_MEMORY:')
              )
              .map((f, i) => (
                <span
                  key={i}
                  className="text-[10px] px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-900 border border-rose-200"
                >
                  {f}
                </span>
              ))}
          </div>
        )}
        
        <label className="text-[10px] text-kawaii-text-muted block w-full">
          Chat fuente
          <select
            className="input-kawaii w-full text-xs mt-0.5"
            value={rebuildConvId}
            onChange={(e) => setRebuildConvId(e.target.value)}
          >
            <option value="">Chat activo</option>
            {(() => {
              try {
                const { useChatStore } = require('@shared/lib/stores/chatStore') as typeof import('@shared/lib/stores/chatStore')
                return useChatStore.getState().conversations.map((c: { id: string; title?: string }) => (
                  <option key={c.id} value={c.id}>
                    {(c.title || c.id).slice(0, 48)}
                  </option>
                ))
              } catch {
                return null
              }
            })()}
          </select>
        </label>
<div className="flex flex-wrap gap-1.5 pt-0.5">
          <Button
            type="button"
            className="text-[11px] bg-rose-600 text-white hover:bg-rose-700 border-rose-700"
            onClick={() => {
              void (async () => {
                try {
                  const { applyIntimacyExtraction } = await import(
                    '@core/conversation/intimacy-memory'
                  )
                  const { useChatStore } = await import('@shared/lib/stores/chatStore')
                  const stChat = useChatStore.getState()
                  const active = rebuildConvId
                    ? stChat.conversations.find((c: { id: string }) => c.id === rebuildConvId)
                    : stChat.getActive?.()
                  const msgs = (active?.messages || []).map(
                    (m: { role?: string; content?: string }) => ({
                      role: m.role,
                      content: String(m.content || '')
                    })
                  )
                  if (msgs.length < 4) {
                    alert('El chat activo tiene pocos mensajes para reconstruir.')
                    return
                  }
                  const sI = useSettingsStore.getState().settings
                  const applied = applyIntimacyExtraction({
                    facts: sI.userMemory?.facts || [],
                    relationship: sI.relationshipState,
                    messages: msgs,
                    userName: (sI.userMemory as { userName?: string } | undefined)?.userName,
                    preferredName: sI.userMemory?.preferredName,
                    characterName: sI.character?.name,
                    relationshipSummary: sI.userMemory?.relationshipSummary,
                    forceFirst: true
                  })
                  useSettingsStore.getState().update({
                    userMemory: {
                      ...(sI.userMemory || { facts: [] }),
                      facts: applied.facts,
                      updatedAt: Date.now()
                    },
                    relationshipState: applied.relationship
                  })
                  if (applied.wroteFirst || applied.wroteNote) {
                    try {
                      const id = useChatStore.getState().activeId
                      if (id) useChatStore.getState().setPrivate?.(id, true)
                    } catch {
                      /* */
                    }
                  }
                  // LLM refine of privileged first memory (local-first; heuristic fallback)
                  let refineNote = ''
                  try {
                    const firstLine = applied.facts.find((f: string) =>
                      String(f).startsWith('INTIMACY_FIRST:')
                    )
                    const draft = firstLine
                      ? String(firstLine).replace(/^INTIMACY_FIRST:\s*/i, '')
                      : ''
                    if (draft.length > 40) {
                      const {
                        refineIntimacyFirstInApp,
                        commitIntimacyFirstNarrative
                      } = await import('../../chat/services/refineIntimacyFirst')
                      const refined = await refineIntimacyFirstInApp({
                        draft,
                        messages: msgs,
                        userName:
                          (sI.userMemory as { userName?: string } | undefined)?.userName ||
                          sI.userMemory?.preferredName,
                        characterName: sI.character?.name
                      })
                      if (refined.source === 'llm' && refined.text) {
                        commitIntimacyFirstNarrative(refined.text)
                        refineNote = ' · refinada con modelo local'
                      } else if (refined.error) {
                        refineNote = ' · refine omitido (' + refined.error + ')'
                      }
                    }
                  } catch (re) {
                    refineNote =
                      ' · refine omitido (' +
                      (re instanceof Error ? re.message : String(re)) +
                      ')'
                  }
                  alert(
                    applied.wroteFirst || applied.facts.some((f: string) => f.startsWith('INTIMACY_FIRST:'))
                      ? 'INTIMACY_FIRST actualizada' + refineNote + '. Pestaña Íntimo.'
                      : 'No se detectó escena íntima suficiente en este chat.'
                  )
                } catch (e) {
                  alert(e instanceof Error ? e.message : String(e))
                }
              })()
            }}
          >
            Reconstruir memoria íntima del chat activo
          </Button>
        </div>
      </div>


        </div>
      ) : null}

      {tab === 'user' ? (
        <>
          <div className="rounded-lg border border-amber-200/80 bg-amber-50/40 p-2.5 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold text-amber-950">Ánimo (sensible)</p>
              <button
                type="button"
                className="text-[10px] text-violet-700 underline"
                onClick={() => setShowSensitiveMood((v) => !v)}
              >
                {showSensitiveMood ? 'Ocultar' : 'Mostrar'}
              </button>
            </div>
            <p className="text-[9px] text-kawaii-text-muted">
              Estados como «hoy me siento…» con fecha. Ocultos por defecto.
            </p>
            {showSensitiveMood ? (
              <ul className="text-[11px] space-y-1">
                {((settings as { userMood?: Array<{ text: string; at: number }> }).userMood || [])
                  .length === 0 ? (
                  <li className="text-kawaii-text-muted italic">Sin registros de ánimo</li>
                ) : (
                  ((settings as { userMood?: Array<{ text: string; at: number }> }).userMood || []).map(
                    (m, i) => (
                      <li
                        key={i}
                        className="flex justify-between gap-2 border-b border-amber-100/80 py-0.5"
                      >
                        <span className="truncate">{m.text}</span>
                        <span className="text-[9px] text-kawaii-text-muted shrink-0">
                          {new Date(m.at).toLocaleString()}
                        </span>
                      </li>
                    )
                  )
                )}
              </ul>
            ) : (
              <p className="text-[10px] text-kawaii-text-muted italic">
                Contenido oculto — pulsa Mostrar
              </p>
            )}
          </div>

      {/* Identity */}
      <div className="rounded-lg border border-kawaii-border bg-white/90 p-3 space-y-2">
        <p className="text-xs font-semibold text-kawaii-text flex items-center gap-1">
          <User className="w-3.5 h-3.5" /> Cómo te llama
        </p>
        <div className="grid sm:grid-cols-2 gap-2">
          <label className="text-[10px] text-kawaii-text-muted block">
            Nombre (identidad)
            <input
              className="input-kawaii w-full text-xs mt-0.5"
              value={(mem as { userName?: string }).userName || ''}
              placeholder="Ej. Nahum"
              onChange={(e) =>
                updateMemory({
                  userName: e.target.value.trim() || undefined
                } as Parameters<typeof updateMemory>[0])
              }
            />
            <span className="text-[9px] text-kawaii-text-muted">Tu nombre real en el vínculo</span>
          </label>
          <label className="text-[10px] text-kawaii-text-muted block">
            Cómo le gusta que le digan
            <input
              className="input-kawaii w-full text-xs mt-0.5"
              value={mem.preferredName || ''}
              placeholder="Apodo de trato (opcional)"
              onChange={(e) => updateMemory({ preferredName: e.target.value.trim() || undefined })}
            />
            <span className="text-[9px] text-kawaii-text-muted">
              No confundir con frases como «soy tuyo»
            </span>
          </label>
          <label className="text-[10px] text-kawaii-text-muted block sm:col-span-2">
            Enfoque actual
            <input
              className="input-kawaii w-full text-xs mt-0.5"
              value={mem.currentFocus || ''}
              placeholder="En qué estás ahora"
              onChange={(e) => updateMemory({ currentFocus: e.target.value.trim() || undefined })}
            />
          </label>
          <label className="text-[10px] text-kawaii-text-muted block sm:col-span-2">
            Cómo te hablan (género)
            <select
              className="input-kawaii w-full text-xs mt-0.5"
              value={settings.userGender || ''}
              onChange={(e) =>
                useSettingsStore.getState().update({
                  userGender: (e.target.value || undefined) as
                    | 'female'
                    | 'male'
                    | 'neutral'
                    | undefined
                })
              }
            >
              <option value="">Sin marcar (no asumir)</option>
              <option value="female">Femenino</option>
              <option value="male">Masculino</option>
              <option value="neutral">Neutro</option>
            </select>
          </label>
        </div>
        <label className="text-[10px] text-kawaii-text-muted block">
          Apodos (separados por coma)
          <input
            className="input-kawaii w-full text-xs mt-0.5"
            value={(mem.nicknames || []).join(', ')}
            placeholder="amor, cariño…"
            onChange={(e) =>
              updateMemory({
                nicknames: e.target.value
                  .split(',')
                  .map((x) => x.trim())
                  .filter(Boolean)
                  .slice(0, 12)
              })
            }
          />
        </label>
        {mem.pendingNickname ? (
          <p className="text-[10px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">
            Apodo pendiente de confirmar: <strong>{mem.pendingNickname}</strong>
          </p>
        ) : null}
        <label className="text-[10px] text-kawaii-text-muted block">
          Resumen del vínculo
          <textarea
            className="input-kawaii w-full text-xs mt-0.5 min-h-[2.5rem]"
            value={mem.relationshipSummary || ''}
            placeholder="Cómo va la relación en el chat…"
            onChange={(e) =>
              updateMemory({ relationshipSummary: e.target.value.trim() || undefined })
            }
          />
        </label>
      </div>

      {/* Facts (sin INTIMACY_*) */}
      <div className="rounded-lg border border-kawaii-border bg-white/90 p-3 space-y-2">
        <p className="text-xs font-semibold text-kawaii-text flex items-center gap-1">
          <Pin className="w-3.5 h-3.5" /> Hechos recordados
          <span className="text-[10px] font-normal text-kawaii-text-muted">
            (sin tags íntimos)
          </span>
        </p>
        <ChipList
          items={generalFacts}
          empty="Aún no hay hechos. El chat puede aprenderlos o añádelos abajo."
          onRemove={(i) => {
            const target = generalFacts[i]
            const idx = facts.indexOf(target)
            if (idx >= 0) removeFact(idx)
          }}
        />
        <div className="flex gap-1.5">
          <input
            className="input-kawaii flex-1 text-xs"
            value={factDraft}
            placeholder="Nuevo hecho (ej. trabaja de noche)"
            onChange={(e) => setFactDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addFact()}
          />
          <Button className="text-[11px] shrink-0" onClick={addFact}>
            <Plus className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Likes / dislikes / goals */}
      <div className="grid sm:grid-cols-3 gap-2">
        <div className="rounded-lg border border-kawaii-border bg-white/90 p-2.5 space-y-1.5">
          <p className="text-[11px] font-semibold">Le gusta</p>
          <ChipList
            items={mem.likes || []}
            empty="—"
            onRemove={(i) =>
              updateMemory({ likes: (mem.likes || []).filter((_, idx) => idx !== i) })
            }
          />
          <div className="flex gap-1">
            <input
              className="input-kawaii flex-1 text-[10px]"
              value={likeDraft}
              onChange={(e) => setLikeDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && likeDraft.trim()) {
                  updateMemory({
                    likes: [...(mem.likes || []), likeDraft.trim()].slice(0, 16)
                  })
                  setLikeDraft('')
                }
              }}
              placeholder="+"
            />
          </div>
        </div>
        <div className="rounded-lg border border-kawaii-border bg-white/90 p-2.5 space-y-1.5">
          <p className="text-[11px] font-semibold">Favoritos</p>
          <ChipList
            items={mem.favorites || []}
            empty="Aún no hay favoritos"
            hint="Color, comida, lugares… (cosas favoritas)"
            onRemove={(i) =>
              updateMemory({
                favorites: (mem.favorites || []).filter((_, idx) => idx !== i)
              })
            }
            onEdit={(i, next) => {
              const arr = [...(mem.favorites || [])]
              arr[i] = next
              updateMemory({ favorites: arr.slice(0, 10) })
            }}
          />
        </div>
        <div className="rounded-lg border border-kawaii-border bg-white/90 p-2.5 space-y-1.5">
          <p className="text-[11px] font-semibold">No le gusta</p>
          <ChipList
            items={mem.dislikes || []}
            empty="—"
            onRemove={(i) =>
              updateMemory({ dislikes: (mem.dislikes || []).filter((_, idx) => idx !== i) })
            }
          />
          <input
            className="input-kawaii w-full text-[10px]"
            value={dislikeDraft}
            onChange={(e) => setDislikeDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && dislikeDraft.trim()) {
                updateMemory({
                  dislikes: [...(mem.dislikes || []), dislikeDraft.trim()].slice(0, 12)
                })
                setDislikeDraft('')
              }
            }}
            placeholder="+"
          />
        </div>
        <div className="rounded-lg border border-kawaii-border bg-white/90 p-2.5 space-y-1.5">
          <p className="text-[11px] font-semibold">Metas</p>
          <ChipList
            items={mem.goals || []}
            empty="—"
            onRemove={(i) =>
              updateMemory({ goals: (mem.goals || []).filter((_, idx) => idx !== i) })
            }
          />
          <input
            className="input-kawaii w-full text-[10px]"
            value={goalDraft}
            onChange={(e) => setGoalDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && goalDraft.trim()) {
                updateMemory({
                  goals: [...(mem.goals || []), goalDraft.trim()].slice(0, 12)
                })
                setGoalDraft('')
              }
            }}
            placeholder="+"
          />
        </div>
      </div>

      {/* People */}
      <div className="rounded-lg border border-kawaii-border bg-white/90 p-3 space-y-2">
        <p className="text-xs font-semibold text-kawaii-text">Personas importantes</p>
        {(mem.people || []).length === 0 ? (
          <p className="text-[10px] text-kawaii-text-muted italic">Ninguna aún.</p>
        ) : (
          <ul className="space-y-1">
            {(mem.people || []).map((p: NamedPerson, i: number) => (
              <li
                key={`${p.name}-${i}`}
                className="flex items-center justify-between text-[11px] border border-kawaii-border rounded px-2 py-1 bg-white"
              >
                <span>
                  <strong>{p.name}</strong>
                  {p.relation ? ` · ${p.relation}` : ''}
                  {p.note ? ` — ${p.note}` : ''}
                </span>
                <button
                  type="button"
                  className="text-kawaii-text-muted hover:text-rose-600"
                  onClick={() =>
                    updateMemory({
                      people: (mem.people || []).filter((_, idx) => idx !== i)
                    })
                  }
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-1.5">
          <input
            className="input-kawaii text-xs flex-1 min-w-[6rem]"
            placeholder="Nombre"
            value={personName}
            onChange={(e) => setPersonName(e.target.value)}
          />
          <input
            className="input-kawaii text-xs flex-1 min-w-[6rem]"
            placeholder="Relación (amigo, hermana…)"
            value={personRel}
            onChange={(e) => setPersonRel(e.target.value)}
          />
          <Button
            className="text-[11px]"
            onClick={() => {
              const name = personName.trim()
              if (!name) return
              const people = [...(mem.people || [])]
              const idx = people.findIndex((x) => x.name.toLowerCase() === name.toLowerCase())
              const entry = {
                name,
                relation: personRel.trim() || undefined
              }
              if (idx >= 0) people[idx] = { ...people[idx], ...entry }
              else people.push(entry)
              updateMemory({ people: people.slice(0, 12) })
              setPersonName('')
              setPersonRel('')
            }}
          >
            Añadir
          </Button>
        </div>
      </div>

        </>
      ) : null}

      {tab === 'assistant' ? (
        <div className="space-y-3">
          <p className="text-[10px] text-kawaii-text-muted">
            Individualidad del personaje (no del usuario). Origen: dicho por el asistente en chat o editado aquí. Se rellena si habla de sí en primera persona.
          </p>
          <div
            className={`rounded-lg border p-2 text-[10px] ${
              lastCollect?.changed
                ? 'border-emerald-200 bg-emerald-50/80 text-emerald-900'
                : lastCollect?.error
                  ? 'border-rose-200 bg-rose-50/80 text-rose-900'
                  : 'border-kawaii-border bg-white/80 text-kawaii-text-muted'
            }`}
          >
            <span className="font-semibold text-kawaii-text">Última extracción: </span>
            {formatMemoryCollectStatus(lastCollect)}
            {aMem.updatedAt ? (
              <span className="block mt-0.5">
                Memoria asistente actualizada: {new Date(aMem.updatedAt).toLocaleString()}
              </span>
            ) : null}
          </div>
          <div className="grid sm:grid-cols-2 gap-2">
            <div className="rounded-lg border border-kawaii-border bg-white/90 p-2.5 space-y-1.5">
              <p className="text-[11px] font-semibold">{aLabels.likes}</p>
              <ChipList
                items={aMem.likes || []}
                empty="—"
                hint="Gusto estable · dicho por el asistente"
                onRemove={(i) =>
                  updateAssistant({ likes: (aMem.likes || []).filter((_, idx) => idx !== i) })
                }
                onEdit={(i, next) => {
                  const arr = [...(aMem.likes || [])]
                  arr[i] = next
                  updateAssistant({ likes: arr.slice(-12) })
                }}
              />
              <div className="flex gap-1">
                <input
                  className="input-kawaii flex-1 text-[10px]"
                  value={aLikeDraft}
                  onChange={(e) => setALikeDraft(e.target.value)}
                  placeholder="ej. café"
                />
                <Button
                  className="text-[11px]"
                  onClick={() => {
                    const v = aLikeDraft.trim()
                    if (!v) return
                    updateAssistant({ likes: [...(aMem.likes || []), v].slice(-12) })
                    setALikeDraft('')
                  }}
                >
                  <Plus className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
            <div className="rounded-lg border border-kawaii-border bg-white/90 p-2.5 space-y-1.5 sm:col-span-2">
              <p className="text-[11px] font-semibold">Favoritos (ella/él)</p>
              <ChipList
                items={aMem.favorites || []}
                empty="Aún no hay favoritos guardados"
                hint="Ej. color: verde — dicho en chat en primera persona"
                onRemove={(i) =>
                  updateAssistant({
                    favorites: (aMem.favorites || []).filter((_, idx) => idx !== i)
                  })
                }
                onEdit={(i, next) => {
                  const arr = [...(aMem.favorites || [])]
                  arr[i] = next
                  updateAssistant({ favorites: arr.slice(-10) })
                }}
              />
            </div>
            <div className="rounded-lg border border-kawaii-border bg-white/90 p-2.5 space-y-1.5">
              <p className="text-[11px] font-semibold">{aLabels.dislikes}</p>
              <ChipList
                items={aMem.dislikes || []}
                empty="—"
                onRemove={(i) =>
                  updateAssistant({
                    dislikes: (aMem.dislikes || []).filter((_, idx) => idx !== i)
                  })
                }
                onEdit={(i, next) => {
                  const arr = [...(aMem.dislikes || [])]
                  arr[i] = next
                  updateAssistant({ dislikes: arr.slice(-10) })
                }}
              />
              <div className="flex gap-1">
                <input
                  className="input-kawaii flex-1 text-[10px]"
                  value={aDislikeDraft}
                  onChange={(e) => setADislikeDraft(e.target.value)}
                  placeholder="ej. el ruido"
                />
                <Button
                  className="text-[11px]"
                  onClick={() => {
                    const v = aDislikeDraft.trim()
                    if (!v) return
                    updateAssistant({ dislikes: [...(aMem.dislikes || []), v].slice(-10) })
                    setADislikeDraft('')
                  }}
                >
                  <Plus className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-violet-200 bg-violet-50/50 p-2.5 space-y-1.5">
            <p className="text-[11px] font-semibold text-violet-900">En la relación (contigo)</p>
            <p className="text-[9px] text-kawaii-text-muted">
              Cómo le gusta el vínculo — no es un gusto genérico (ej. que le digas un apodo, cocinar para ti).
            </p>
            <ChipList
              items={aMem.relational || []}
              empty="—"
              hint="Preferencia del vínculo · no es gusto genérico"
              onRemove={(i) =>
                updateAssistant({
                  relational: (aMem.relational || []).filter((_, idx) => idx !== i)
                })
              }
              onEdit={(i, next) => {
                const arr = [...(aMem.relational || [])]
                arr[i] = next
                updateAssistant({ relational: arr.slice(-12) })
              }}
            />
            <div className="flex gap-1">
              <input
                className="input-kawaii flex-1 text-[10px]"
                value={aRelDraft}
                onChange={(e) => setARelDraft(e.target.value)}
                placeholder="ej. que me digas amor"
              />
              <Button
                className="text-[11px]"
                onClick={() => {
                  const v = aRelDraft.trim()
                  if (!v) return
                  updateAssistant({
                    relational: [...(aMem.relational || []), v].slice(-12)
                  })
                  setARelDraft('')
                }}
              >
                <Plus className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>

          <div className="rounded-lg border border-kawaii-border bg-white/90 p-2.5 space-y-1.5">
            <p className="text-[11px] font-semibold">Hábitos</p>
            <ChipList
              items={aMem.habits || []}
              empty="—"
              onRemove={(i) =>
                updateAssistant({ habits: (aMem.habits || []).filter((_, idx) => idx !== i) })
              }
              onEdit={(i, next) => {
                const arr = [...(aMem.habits || [])]
                arr[i] = next
                updateAssistant({ habits: arr.slice(-10) })
              }}
            />
          </div>
          <div className="rounded-lg border border-kawaii-border bg-white/90 p-2.5 space-y-1.5">
            <p className="text-[11px] font-semibold">Límites</p>
            <ChipList
              items={aMem.boundaries || []}
              empty="—"
              onRemove={(i) =>
                updateAssistant({ boundaries: (aMem.boundaries || []).filter((_, idx) => idx !== i) })
              }
              onEdit={(i, next) => {
                const arr = [...(aMem.boundaries || [])]
                arr[i] = next
                updateAssistant({ boundaries: arr.slice(-8) })
              }}
            />
          </div>
          <Button
            className="text-[11px]"
            onClick={() => {
              if (!window.confirm('¿Borrar solo la memoria del asistente?')) return
              updateAssistant(emptyAssistantMemory())
            }}
          >
            Limpiar memoria del asistente
          </Button>
        </div>
      ) : null}

      {tab === 'user' && mem.updatedAt ? (
        <p className="text-[10px] text-kawaii-text-muted">
          Última actualización (usuario): {new Date(mem.updatedAt).toLocaleString()}
        </p>
      ) : null}
      {tab === 'assistant' && aMem.updatedAt ? (
        <p className="text-[10px] text-kawaii-text-muted">
          Última actualización (asistente): {new Date(aMem.updatedAt).toLocaleString()}
        </p>
      ) : null}

      {/* K3: import memories from LMS / Ollama export (not full chat dump) */}
      <div className="border border-kawaii-border/70 rounded-kawaii p-3 space-y-2 bg-white/50">
        <p className="text-[11px] font-semibold text-kawaii-text">Importar recuerdos (LMS / Ollama)</p>
        <p className="text-[10px] text-kawaii-text-muted leading-snug">
          Sube un JSON de chat exportado. Solo se extraen gustos y datos personales; no se carga el hilo
          completo en la memoria.
        </p>
        <input
          type="file"
          accept="application/json,.json"
          className="text-[11px] w-full"
          onChange={async (e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (!f) return
            try {
              const text = await f.text()
              const json = JSON.parse(text) as unknown
              const { extractMemoriesFromChatExport, mergeImportedMemories } = await import(
                '@core/conversation/import-memories'
              )
              const bundle = extractMemoriesFromChatExport(json)
              if (!bundle.likes.length && !bundle.facts.length) {
                alert(bundle.summary + '\n\nNo había frases de preferencias claras.')
                return
              }
              const go = window.confirm(
                bundle.summary +
                  '\n\n¿Fusionar con la memoria del asistente (likes + facts)?'
              )
              if (!go) return
              const prev =
                useSettingsStore.getState().settings.assistantMemory || emptyAssistantMemory()
              const merged = mergeImportedMemories(prev, bundle)
              useSettingsStore.getState().update({
                assistantMemory: {
                  ...prev,
                  ...merged,
                  updatedAt: Date.now()
                }
              })
              alert('Recuerdos fusionados: ' + merged.likes.length + ' likes, ' + merged.facts.length + ' facts.')
            } catch (err) {
              alert(
                'No se pudo leer el JSON: ' +
                  (err instanceof Error ? err.message : String(err))
              )
            }
          }}
        />
      </div>
    </div>
  )
}
