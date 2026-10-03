import { useEffect, useMemo, useRef, useState } from 'react'
import { useActivityStore } from '@shared/lib/stores/activityStore'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'
import {
  companionAvatar,
  companionName,
  endActivityWithComment,
  renameAdventure
} from './companion'
import { generateCompanionLine, cancelCompanionSpeech, speakCompanionText } from './companionLlm'
import {
  addAdventureNpc,
  createAdventure,
  setAdventureTitle,
  toggleAdventurePlayer,
  type AdventureState
} from '@core/activities'

type Phase = 'booting' | 'propose' | 'play'
type LogEntry = { id: string; kind: 'narration' | 'player' | 'system'; text: string }

function buildSceneHistory(log: LogEntry[]): { role: 'user' | 'assistant'; content: string }[] {
  const out: { role: 'user' | 'assistant'; content: string }[] = []
  for (const e of log) {
    if (e.kind === 'player') out.push({ role: 'user', content: e.text })
    else if (e.kind === 'narration') out.push({ role: 'assistant', content: e.text })
  }
  return out.slice(-12)
}

function normalizeAdventure(raw: AdventureState | null, title: string, companion: string): AdventureState {
  if (!raw || !raw.active) return createAdventure(title, companion)
  const players =
    Array.isArray(raw.players) && raw.players.length > 0
      ? raw.players
      : createAdventure(title, companion).players
  return {
    ...raw,
    title: raw.title || title,
    location: raw.location || 'Inicio',
    turn: raw.turn ?? 0,
    hp: raw.hp ?? 10,
    maxHp: raw.maxHp || 10,
    inventory: Array.isArray(raw.inventory) ? raw.inventory : [],
    flags: Array.isArray(raw.flags) ? raw.flags : [],
    log: Array.isArray(raw.log) ? raw.log : [],
    players,
    startedAt: raw.startedAt || Date.now()
  }
}

function parseChoices(text: string): string[] {
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean)
  const out: string[] = []
  for (const line of lines) {
    const m = line.match(/^(?:\d+[\).:-]|[-•*])\s*(.+)$/)
    if (m && m[1].length > 2 && m[1].length < 160) out.push(m[1].trim())
  }
  if (out.length < 2) {
    const inline = [...text.matchAll(/(?:^|\s)(\d+)[\).:-]\s*([^0-9\n]{4,120})/g)]
    for (const m of inline) {
      const t = m[2].trim()
      if (t && !out.includes(t)) out.push(t)
    }
  }
  return out.slice(0, 6)
}

function StatBar({
  label,
  value,
  max,
  color
}: {
  label: string
  value: number
  max: number
  color: string
}) {
  const safeMax = Math.max(1, max || 10)
  const pct = Math.max(0, Math.min(100, Math.round((value / safeMax) * 100)))
  return (
    <div className="min-w-[88px]">
      <div className="flex justify-between text-[10px] text-amber-100/90 mb-0.5">
        <span>{label}</span>
        <span>
          {value}/{safeMax}
        </span>
      </div>
      <div className="h-2 rounded-full bg-black/40 overflow-hidden border border-amber-800/50">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export function AdventureActivityView() {
  const adventure = useActivityStore((s) => s.adventure)
  const startAdventure = useActivityStore((s) => s.startAdventure)
  const noteAdventureMove = useActivityStore((s) => s.noteAdventureMove)
  const voiceActivitiesOnly = useSettingsStore((s) => s.settings.voiceTtsActivitiesOnly)
  const voiceEnabled = useSettingsStore((s) => s.settings.voiceTtsEnabled)
  const updateSettings = useSettingsStore((s) => s.update)

  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState<Phase>('booting')
  const [log, setLog] = useState<LogEntry[]>([])
  const [proposedTitle, setProposedTitle] = useState('Las ruinas de Emberfall')
  const [customTitle, setCustomTitle] = useState('Las ruinas de Emberfall')
  const [choices, setChoices] = useState<string[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [partyOpen, setPartyOpen] = useState(false)
  const [newPlayer, setNewPlayer] = useState('')
  const bootOnce = useRef(false)
  const logEnd = useRef<HTMLDivElement>(null)
  const avatar = useMemo(() => companionAvatar(), [])
  const name = useMemo(() => companionName(), [])

  const pushLog = (kind: LogEntry['kind'], line: string) => {
    const clean = (line || '').trim()
    if (!clean) return
    setLog((prev) => [...prev, { id: `l_${Date.now()}_${prev.length}`, kind, text: clean }])
  }

  useEffect(() => {
    logEnd.current?.scrollIntoView({ behavior: 'smooth' })
  }, [log, busy])

  // Ensure store has a valid adventure shape (persist may be stale)
  useEffect(() => {
    const cur = useActivityStore.getState().adventure
    const norm = normalizeAdventure(cur, 'Nueva aventura', name)
    if (!cur || !cur.players || cur.maxHp == null) {
      useActivityStore.setState({ mode: 'adventure', adventure: norm, chess: null })
    }
  }, [name])

  useEffect(() => {
    if (bootOnce.current) return
    bootOnce.current = true
    void (async () => {
      setPhase('booting')
      pushLog('system', `${name} se acerca…`)
      if (!useActivityStore.getState().adventure?.active) {
        startAdventure('Nueva aventura')
      }
      const adv0 = useActivityStore.getState().adventure
      if (adv0) {
        useActivityStore.setState({
          adventure: normalizeAdventure(
            {
              ...adv0,
              players: (adv0.players || []).map((p) =>
                p.role === 'companion' ? { ...p, name } : p
              )
            },
            adv0.title,
            name
          )
        })
      }
      setBusy(true)
      try {
        const line = await generateCompanionLine(
          `Propón UNA aventura corta (tú eres ${name}). Formato exacto en 3 líneas:\n` +
            `TITULO: <nombre en español>\n` +
            `LUGAR: <dónde empiezan>\n` +
            `INTRO: <2 frases en personaje preguntando si le gusta el título>`,
          { speak: false, asUserVisible: false, timeoutMs: 22_000 }
        )
        const tm = line.match(/TITULO:\s*(.+)/i)
        const lm = line.match(/LUGAR:\s*(.+)/i)
        const im = line.match(/INTRO:\s*([\s\S]+)/i)
        const title = (tm?.[1] || 'Las ruinas de Emberfall').trim().slice(0, 80)
        const place = (lm?.[1] || 'Entrada misteriosa').trim().slice(0, 80)
        let intro = (im?.[1] || '').trim()
        if (!intro || intro.length < 8) {
          intro =
            line.replace(/TITULO:.*|LUGAR:.*/gi, '').trim() ||
            `¿Te gusta el título «${title}» o prefieres otro, Orion?`
        }
        setProposedTitle(title)
        setCustomTitle(title)
        renameAdventure(title)
        const adv = useActivityStore.getState().adventure
        if (adv) {
          useActivityStore.setState({
            adventure: {
              ...setAdventureTitle(normalizeAdventure(adv, title, name), title),
              location: place
            }
          })
        }
        pushLog('narration', intro)
        setPhase('propose')
        // Voice only the intro the user sees (not TITULO/LUGAR scaffold)
        void speakCompanionText(intro)

      } catch (e) {
        console.error('[adventure boot]', e)
        pushLog(
          'system',
          `No pude inventar el título ahora. Puedes escribir uno y pulsar Empezar.`
        )
        setPhase('propose')
      } finally {
        setBusy(false)
      }
    })()
  }, [name, startAdventure])

  const applyTitle = (title: string) => {
    const t = title.trim().slice(0, 80)
    if (!t) return
    renameAdventure(t)
    const adv = useActivityStore.getState().adventure
    if (adv) {
      useActivityStore.setState({
        adventure: setAdventureTitle(normalizeAdventure(adv, t, name), t)
      })
    }
    setProposedTitle(t)
    setCustomTitle(t)
  }

  const acceptTitle = async () => {
    const finalTitle = (customTitle || proposedTitle || 'Aventura').trim()
    applyTitle(finalTitle)
    setPhase('play')
    pushLog('system', `Historia fijada: «${finalTitle}».`)
    setBusy(true)
    try {
      const reply = await generateCompanionLine(
        `Continúa la aventura «${finalTitle}». Eres ${name} EN la escena ya fijada (no cambies de título ni reinicies). ` +
          `Describe el inicio (2–4 frases) y ofrece EXACTAMENTE 3 opciones numeradas:
1. …
2. …
3. …`,
        {
          speak: true,
          asUserVisible: false,
          timeoutMs: 24_000,
          sceneHistory: buildSceneHistory(log)
        }
      )
      pushLog('narration', `${name}: ${reply}`)
      setChoices(parseChoices(reply))
      setSelected(new Set())
    } catch (e) {
      pushLog('system', `Error al narrar: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const toggleChoice = (c: string) => {
    setSelected((prev) => {
      const n = new Set(prev)
      if (n.has(c)) n.delete(c)
      else n.add(c)
      return n
    })
  }

  const submitAction = async (actionText: string) => {
    const t = actionText.trim()
    if (!t || busy) return
    cancelCompanionSpeech()
    const adv = normalizeAdventure(
      useActivityStore.getState().adventure,
      proposedTitle,
      name
    )
    setBusy(true)
    noteAdventureMove(t)
    pushLog('player', t)
    setText('')
    setChoices([])
    setSelected(new Set())
    try {
      const party = (adv.players || [])
        .filter((p) => p.inParty)
        .map((p) => p.name)
        .join(', ')
      cancelCompanionSpeech()
      const sceneHistory = buildSceneHistory(log)
      const reply = await generateCompanionLine(
        `VENTANA DE AVENTURA — misma historia «${adv.title}». Lugar ${adv.location}. ` +
          `HP ${adv.hp}/${adv.maxHp}. Grupo: ${party}. ` +
          `Acción del jugador: ${t}. ` +
          `Continúa desde el historial (no inventes otra aventura). 2–5 frases. ` +
          `Termina con 2–4 opciones numeradas (1. 2. 3.).`,
        {
          speak: true,
          asUserVisible: false,
          timeoutMs: 24_000,
          sceneHistory
        }
      )
      pushLog('narration', `${name}: ${reply}`)
      setChoices(parseChoices(reply))
      setPhase('play')
    } catch (e) {
      pushLog('system', `Error: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const submit = () => {
    const parts = [...selected]
    if (text.trim()) parts.push(text.trim())
    if (!parts.length) return
    void submitAction(parts.join(' · '))
  }

  const hp = adventure?.hp ?? 10
  const maxHp = adventure?.maxHp ?? 10
  const companionHp = adventure?.players?.find((p) => p.role === 'companion')?.hp ?? 10
  const companionMax = adventure?.players?.find((p) => p.role === 'companion')?.maxHp ?? 10
  const voiceOn = Boolean(voiceActivitiesOnly) || voiceEnabled !== false

  return (
    <div className="h-screen flex flex-col bg-gradient-to-b from-stone-950 via-amber-950/50 to-stone-950 text-amber-50">
      <header className="sticky top-0 z-20 bg-stone-950/95 border-b border-amber-900/50 px-3 py-2 backdrop-blur">
        <div className="flex gap-3 items-center max-w-2xl mx-auto">
          <div className="shrink-0">
            {avatar ? (
              <img
                src={avatar}
                alt={name}
                className={'w-12 h-12 rounded-full object-cover border-2 border-amber-400 ' + (busy ? 'animate-pulse' : '')}
              />
            ) : (
              <div className="w-12 h-12 rounded-full bg-amber-800 flex items-center justify-center font-bold">
                {name.slice(0, 1)}
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-bold truncate">{adventure?.title || proposedTitle}</h1>
            <p className="text-[11px] text-amber-200/80 truncate">
              {adventure?.location || '…'} · Turno {adventure?.turn ?? 0} · Con {name}
            </p>
          </div>
          <label className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg bg-stone-900 border border-amber-800/40 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={voiceOn}
              onChange={(e) => {
                if (e.target.checked) {
                  updateSettings({ voiceTtsActivitiesOnly: true, voiceTtsEnabled: true })
                } else {
                  updateSettings({ voiceTtsActivitiesOnly: false, voiceTtsEnabled: false })
                }
              }}
            />
            Voz
          </label>
          <button
            type="button"
            className="text-[11px] px-2 py-1 rounded-lg bg-amber-900/50 border border-amber-700/50"
            onClick={() => setPartyOpen((v) => !v)}
          >
            Grupo
          </button>
          <button
            type="button"
            className="text-[11px] px-2 py-1 rounded-lg bg-stone-800 border border-stone-600"
            onClick={() => endActivityWithComment('user-closed')}
          >
            Cerrar
          </button>
        </div>
        <div className="flex flex-wrap gap-3 mt-2 max-w-2xl mx-auto items-end">
          <StatBar label="Vitalidad" value={hp} max={maxHp} color="bg-rose-500" />
          <StatBar label={name} value={companionHp} max={companionMax} color="bg-pink-400" />
          <div className="text-[10px] text-amber-100/80 flex-1">
            Inventario:{' '}
            {(adventure?.inventory || []).length ? adventure!.inventory.join(', ') : '—'}
          </div>
        </div>
        {partyOpen && adventure && (
          <div className="max-w-2xl mx-auto mt-2 p-2 rounded-xl bg-stone-900 border border-amber-900/50 text-xs space-y-1">
            {(adventure.players || []).map((p) => (
              <label key={p.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={p.inParty}
                  disabled={p.role === 'player'}
                  onChange={() => {
                    const cur = useActivityStore.getState().adventure
                    if (!cur) return
                    useActivityStore.setState({ adventure: toggleAdventurePlayer(cur, p.id) })
                  }}
                />
                <span>
                  {p.name} ({p.role}) {p.hp}/{p.maxHp}
                </span>
              </label>
            ))}
            <div className="flex gap-2 pt-1">
              <input
                value={newPlayer}
                onChange={(e) => setNewPlayer(e.target.value)}
                placeholder="Añadir aliado…"
                className="flex-1 rounded-lg bg-black/40 border border-amber-800/40 px-2 py-1"
              />
              <button
                type="button"
                className="px-2 py-1 rounded-lg bg-amber-700 text-xs"
                onClick={() => {
                  if (!newPlayer.trim()) return
                  const cur = useActivityStore.getState().adventure
                  if (!cur) return
                  useActivityStore.setState({
                    adventure: addAdventureNpc(cur, newPlayer.trim())
                  })
                  setNewPlayer('')
                }}
              >
                Añadir
              </button>
            </div>
          </div>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2 max-w-2xl mx-auto w-full">
        {log.length === 0 && (
          <p className="text-center text-sm text-amber-200/60">Preparando la escena…</p>
        )}
        {log.map((e) => (
          <div
            key={e.id}
            className={
              e.kind === 'player'
                ? 'ml-6 rounded-2xl bg-amber-800/70 border border-amber-600/50 px-3 py-2 text-sm text-amber-50'
                : e.kind === 'system'
                  ? 'text-center text-[11px] text-amber-200/60'
                  : 'mr-4 rounded-2xl bg-stone-900/90 border border-amber-800/40 px-3 py-2 text-sm leading-relaxed text-amber-50'
            }
          >
            {e.kind === 'player' ? `Tú: ${e.text}` : e.text}
          </div>
        ))}
        {busy && (
          <div className="text-center text-xs text-amber-300 animate-pulse">{name} actúa…</div>
        )}
        <div ref={logEnd} />
      </div>

      <footer className="sticky bottom-0 border-t border-amber-900/50 bg-stone-950/95 px-3 py-3 max-w-2xl mx-auto w-full">
        {phase === 'propose' && (
          <div className="space-y-2 mb-2">
            <p className="text-xs text-amber-100">¿Te gusta el título o lo cambias?</p>
            <input
              value={customTitle}
              onChange={(e) => setCustomTitle(e.target.value)}
              className="w-full rounded-xl bg-stone-900 border border-amber-700/50 px-3 py-2 text-sm text-amber-50"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => void acceptTitle()}
              className="w-full rounded-xl bg-amber-500 hover:bg-amber-400 text-stone-950 font-semibold py-2 text-sm disabled:opacity-50"
            >
              Empezar con este título
            </button>
          </div>
        )}

        {phase === 'play' && choices.length > 0 && (
          <div className="space-y-1.5 mb-2">
            <p className="text-[11px] text-amber-200/80">Elige una o varias opciones:</p>
            {choices.map((c) => (
              <label
                key={c}
                className={
                  'flex items-start gap-2 rounded-xl border px-3 py-2 text-sm cursor-pointer ' +
                  (selected.has(c)
                    ? 'bg-amber-800/60 border-amber-400'
                    : 'bg-stone-900 border-amber-900/50')
                }
              >
                <input type="checkbox" className="mt-1" checked={selected.has(c)} onChange={() => toggleChoice(c)} />
                <span className="text-amber-50">{c}</span>
              </label>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
            disabled={busy || phase === 'booting'}
            placeholder={phase === 'play' ? 'O escribe tu propia acción…' : 'Espera un momento…'}
            className="flex-1 rounded-xl bg-stone-900 border border-amber-800/50 px-3 py-2 text-sm text-amber-50 disabled:opacity-50"
          />
          <button
            type="button"
            disabled={busy || phase === 'booting' || (!text.trim() && selected.size === 0)}
            onClick={submit}
            className="rounded-xl bg-amber-500 text-stone-950 font-semibold px-4 py-2 text-sm disabled:opacity-40"
          >
            Enviar
          </button>
        </div>
      </footer>
    </div>
  )
}
