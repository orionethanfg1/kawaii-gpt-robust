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
  const [factDraft, setFactDraft] = useState('')
  const [likeDraft, setLikeDraft] = useState('')
  const [dislikeDraft, setDislikeDraft] = useState('')
  const [goalDraft, setGoalDraft] = useState('')
  const [personName, setPersonName] = useState('')
  const [personRel, setPersonRel] = useState('')
  const [tab, setTab] = useState<'user' | 'assistant' | 'agenda'>('user')
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
        <div>
          <h3 className="font-bold text-sm text-kawaii-text flex items-center gap-1.5">
            <Brain className="w-4 h-4 text-violet-600" />
            Contexto y memoria del usuario
          </h3>
          <p className="text-[10px] text-kawaii-text-muted mt-0.5 max-w-xl">
            Datos que el chat usa para conocerte (nombre, gustos, personas, metas). Se actualizan al
            conversar y también puedes editarlos aquí. No guarda el historial completo, solo hechos
            curados.
            {settings.relationshipState?.stage ? (
              <span className="block mt-1 text-violet-700">
                Confianza: {settings.relationshipState.stage}
                {typeof settings.relationshipState.turnsTogether === 'number'
                  ? ' · ' + String(settings.relationshipState.turnsTogether) + ' turnos'
                  : ''}
              </span>
            ) : null}
          </p>
        </div>
        {tab === 'user' ? (
          <Button className="text-[11px] shrink-0" onClick={clearAll}>
            Limpiar memoria del usuario
          </Button>
        ) : null}
        {tab === 'agenda' ? null : null}
      </div>

      <div className="flex gap-1 border-b border-kawaii-border pb-2">
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
        <button
          type="button"
          className={`text-[11px] px-3 py-1 rounded-t ${tab === 'agenda' ? 'bg-white border border-b-0 border-kawaii-border font-semibold' : 'text-kawaii-text-muted'}`}
          onClick={() => setTab('agenda')}
        >
          Agenda
        </button>
      </div>
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
            Nombre preferido
            <input
              className="input-kawaii w-full text-xs mt-0.5"
              value={mem.preferredName || ''}
              placeholder="Ej. Nahum"
              onChange={(e) => updateMemory({ preferredName: e.target.value.trim() || undefined })}
            />
          </label>
          <label className="text-[10px] text-kawaii-text-muted block">
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

      {/* Facts */}
      <div className="rounded-lg border border-kawaii-border bg-white/90 p-3 space-y-2">
        <p className="text-xs font-semibold text-kawaii-text flex items-center gap-1">
          <Pin className="w-3.5 h-3.5" /> Hechos recordados
        </p>
        <ChipList
          items={facts}
          empty="Aún no hay hechos. El chat puede aprenderlos o añádelos abajo."
          onRemove={removeFact}
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
            <div className="rounded-lg border border-kawaii-border bg-white/90 p-2.5 space-y-1.5">
              <p className="text-[11px] font-semibold">{aLabels.dislikes}</p>
              <ChipList
                items={aMem.dislikes || []}
                empty="—"
                onRemove={(i) =>
                  updateAssistant({ dislikes: (aMem.dislikes || []).filter((_, idx) => idx !== i) })
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
    </div>
  )
}
