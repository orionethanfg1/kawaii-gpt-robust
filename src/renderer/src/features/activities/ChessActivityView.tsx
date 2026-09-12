import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  parseFen,
  applyMove,
  legalMoves,
  aiPick,
  pieceGlyph,
  toFen,
  allLegal,
  type GameSnap
} from '@core/activities/chess-engine'
import { useActivityStore } from '@shared/lib/stores/activityStore'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'
import { companionAvatar, companionName, endActivityWithComment } from './companion'
import {
  askModelChessMove,
  generateCompanionLine,
  speakCompanionText,
  cancelCompanionSpeech
} from './companionLlm'

type Diff = 'easy' | 'medium' | 'hard' | 'adaptive'
type ChatLine = { id: string; role: 'user' | 'assistant' | 'system'; text: string }

function toUci(from: number, to: number) {
  const sq = (i: number) =>
    String.fromCharCode(97 + (i % 8)) + String(Math.floor(i / 8) + 1)
  return sq(from) + sq(to)
}

export function ChessActivityView() {
  const [game, setGame] = useState<GameSnap>(() => parseFen())
  const [selected, setSelected] = useState<number | null>(null)
  const [lastMove, setLastMove] = useState<{ from: number; to: number } | null>(null)
  const [msg, setMsg] = useState('Tu turno · blancas.')
  const [diff, setDiff] = useState<Diff>('adaptive')
  const [chat, setChat] = useState<ChatLine[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [voiceOn, setVoiceOn] = useState(true)
  const boot = useRef(false)
  const chatEnd = useRef<HTMLDivElement>(null)
  const startChess = useActivityStore((s) => s.startChess)
  const name = companionName()
  const avatar = companionAvatar()
  const personality = useSettingsStore((s) => s.settings.character?.personality || '')

  const pushChat = (role: ChatLine['role'], text: string) => {
    const t = (text || '').trim()
    if (!t) return
    setChat((prev) => [...prev, { id: `c_${Date.now()}_${prev.length}`, role, text: t }])
  }

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chat, busy])

  useEffect(() => {
    if (boot.current) return
    boot.current = true
    startChess()
    void (async () => {
      setBusy(true)
      try {
        const line = await generateCompanionLine(
          `Ajedrez en vivo con el usuario. Eres ${name}. ` +
            `Personalidad: ${personality.slice(0, 200)}. ` +
            `En 2–3 frases: saluda, di que juegas negras, elige dificultad inicial ` +
            `(fácil/media/difícil/adaptativa) según tu personalidad, y dile que puede ` +
            `charlar contigo mientras juegan (cajita de chat). No inventes jugadas aún.`,
          { speak: voiceOn, asUserVisible: false, timeoutMs: 18_000 }
        )
        pushChat('assistant', line)
        const low = line.toLowerCase()
        if (/dif[ií]cil|agresiv|compet/.test(low)) setDiff('hard')
        else if (/f[aá]cil|suave|tranqui|aprender/.test(low)) setDiff('easy')
        else if (/adapt/.test(low)) setDiff('adaptive')
        else setDiff('medium')
      } catch {
        pushChat(
          'assistant',
          `¿Jugamos? Yo soy ${name} con negras. Charla conmigo aquí abajo mientras mueves.`
        )
      } finally {
        setBusy(false)
      }
    })()
  }, [name, personality, startChess, voiceOn])

  const legals = useMemo(
    () => (selected == null ? [] : legalMoves(game, selected)),
    [game, selected]
  )

  const enginePick = useCallback(
    (g: GameSnap) => {
      // difficulty only affects fallback engine depth randomness
      const base = aiPick(g)
      if (!base) return null
      if (diff === 'hard') return base
      const all = allLegal(g)
      if (!all.length) return base
      if (diff === 'easy' && Math.random() < 0.45) {
        return all[Math.floor(Math.random() * all.length)]
      }
      if (diff === 'medium' && Math.random() < 0.2) {
        return all[Math.floor(Math.random() * Math.min(all.length, 5))]
      }
      return base
    },
    [diff]
  )

  const playAi = useCallback(
    async (g: GameSnap) => {
      setMsg(`${name} piensa…`)
      setBusy(true)
      const moves = allLegal(g)
      const legalUci = moves.map((x) => toUci(x.from, x.to))
      const lastUser = g.history[g.history.length - 1] || ''
      let pick = enginePick(g)
      let comment = ''
      try {
        const ans = await askModelChessMove(toFen(g), legalUci, lastUser)
        comment = ans.comment
        if (ans.uci) {
          const from = ans.uci.charCodeAt(0) - 97 + (parseInt(ans.uci[1], 10) - 1) * 8
          const to = ans.uci.charCodeAt(2) - 97 + (parseInt(ans.uci[3], 10) - 1) * 8
          if (legalUci.includes(ans.uci.slice(0, 4)) || legalUci.includes(ans.uci)) {
            pick = { from, to }
          }
        }
      } catch {
        /* engine */
      }
      if (!pick) {
        setMsg(g.over === 'checkmate' ? 'Jaque mate · ganas tú' : 'Fin de partida')
        setBusy(false)
        return
      }
      const next = applyMove(g, pick.from, pick.to)
      if (!next) {
        setBusy(false)
        return
      }
      setGame(next)
      setLastMove({ from: pick.from, to: pick.to })
      const last = next.history[next.history.length - 1]
      setMsg(
        next.over
          ? next.over === 'checkmate'
            ? `Jaque mate · ${name}`
            : 'Tablas'
          : `${name} jugó ${last} · tu turno`
      )
      if (comment) {
        pushChat('assistant', comment)
        if (voiceOn) void speakCompanionText(comment)
      }
      setBusy(false)
    },
    [enginePick, name, voiceOn]
  )

  const onSquare = (i: number) => {
    if (game.over || busy) return
    if (game.turn !== 'w') return
    if (selected == null) {
      if (game.board[i] && game.board[i] === game.board[i]!.toUpperCase()) setSelected(i)
      return
    }
    if (selected === i) {
      setSelected(null)
      return
    }
    const next = applyMove(game, selected, i)
    setSelected(null)
    if (!next) {
      if (game.board[i] && game.board[i] === game.board[i]!.toUpperCase()) setSelected(i)
      return
    }
    setGame(next)
    setLastMove({ from: selected, to: i })
    const last = next.history[next.history.length - 1]
    setMsg(next.over ? `Fin · ${next.over}` : `Jugaste ${last}…`)
    if (!next.over && next.turn === 'b') void playAi(next)
  }

  const sendChat = async () => {
    const t = draft.trim()
    if (!t || busy) return
    setDraft('')
    pushChat('user', t)
    setBusy(true)
    cancelCompanionSpeech()
    try {
      // Allow mid-game difficulty change via chat
      const low = t.toLowerCase()
      if (/m[aá]s\s+f[aá]cil|baja.*dificult/.test(low)) setDiff('easy')
      if (/m[aá]s\s+dif[ií]cil|sube.*dificult/.test(low)) setDiff('hard')
      if (/adaptativ/.test(low)) setDiff('adaptive')

      const reply = await generateCompanionLine(
        `Estás en una partida de ajedrez EN VIVO con el usuario (negras=${name}). ` +
          `Dificultad actual: ${diff}. FEN: ${toFen(game)}. ` +
          `Últimas jugadas: ${game.history.slice(-6).join(' ')}. ` +
          `El usuario dice (charla, no necesariamente una jugada): ${t}\n` +
          `Responde en personaje, 1–4 frases. Puedes bromear, animar, proponer cambiar dificultad, ` +
          `o comentar la posición. Si pide que muevas tú, invita a que mueva en el tablero.`,
        {
          speak: voiceOn,
          asUserVisible: false,
          timeoutMs: 20_000,
          sceneHistory: chat
            .filter((c) => c.role === 'user' || c.role === 'assistant')
            .slice(-8)
            .map((c) => ({ role: c.role as 'user' | 'assistant', content: c.text }))
        }
      )
      pushChat('assistant', reply)
    } catch {
      pushChat('assistant', '…se me fue la concentración un segundo. ¿Repites?')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="h-screen flex flex-col md:flex-row bg-gradient-to-br from-violet-950 via-stone-950 to-fuchsia-950 text-violet-50">
      {/* Board column */}
      <div className="flex-1 flex flex-col items-center p-3 min-w-0">
        <div className="w-full max-w-lg flex items-center gap-2 mb-2">
          {avatar ? (
            <img src={avatar} alt="" className="w-10 h-10 rounded-full object-cover border border-violet-400" />
          ) : (
            <div className="w-10 h-10 rounded-full bg-violet-800 flex items-center justify-center font-bold">
              {name.slice(0, 1)}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h1 className="font-bold truncate">Ajedrez con {name}</h1>
            <p className="text-[11px] text-violet-200/80">
              {msg} · {diff}
            </p>
          </div>
          <label className="text-[11px] flex items-center gap-1 cursor-pointer">
            <input type="checkbox" checked={voiceOn} onChange={(e) => setVoiceOn(e.target.checked)} />
            Voz
          </label>
          <select
            className="text-[11px] rounded-lg bg-violet-950 border border-violet-600 px-1 py-1"
            value={diff}
            onChange={(e) => setDiff(e.target.value as Diff)}
            title="Dificultad"
          >
            <option value="adaptive">Adaptativa</option>
            <option value="easy">Fácil</option>
            <option value="medium">Media</option>
            <option value="hard">Difícil</option>
          </select>
          <button
            type="button"
            className="text-xs px-2 py-1 rounded-full border border-violet-500/50 hover:bg-violet-500/20"
            onClick={() => endActivityWithComment('user-closed')}
          >
            Salir
          </button>
        </div>

        <div
          className="grid grid-cols-8 gap-0 rounded-xl overflow-hidden border-2 border-violet-400/50 shadow-[0_0_40px_rgba(139,92,246,0.35)]"
          style={{ width: 'min(92vw, 420px)', height: 'min(92vw, 420px)' }}
        >
          {Array.from({ length: 64 }, (_, idx) => {
            const r = 7 - Math.floor(idx / 8)
            const c = idx % 8
            const i = r * 8 + c
            const dark = (r + c) % 2 === 1
            const isSel = selected === i
            const isLegal = legals.includes(i)
            const isLast = Boolean(lastMove && (lastMove.from === i || lastMove.to === i))
            const p = game.board[i]
            return (
              <button
                key={i}
                type="button"
                onClick={() => onSquare(i)}
                className={
                  'relative flex items-center justify-center text-3xl sm:text-4xl select-none ' +
                  (isSel
                    ? 'bg-violet-400/50 scale-105 z-10'
                    : isLast
                      ? 'bg-fuchsia-500/35'
                      : isLegal
                        ? dark
                          ? 'bg-violet-700/80'
                          : 'bg-violet-300/40'
                        : dark
                          ? 'bg-[#2a1a4a]'
                          : 'bg-[#3d2a6b]')
                }
              >
                <span
                  className={
                    p && p === p.toUpperCase() ? 'text-violet-100 drop-shadow' : 'text-sky-300 drop-shadow'
                  }
                >
                  {pieceGlyph(p)}
                </span>
                {isLegal && !p ? (
                  <span className="absolute w-2.5 h-2.5 rounded-full bg-violet-200/50" />
                ) : null}
              </button>
            )
          })}
        </div>
      </div>

      {/* Live chat column */}
      <div className="w-full md:w-80 lg:w-96 border-t md:border-t-0 md:border-l border-violet-800/60 flex flex-col max-h-[45vh] md:max-h-none bg-black/30">
        <div className="px-3 py-2 text-xs font-semibold text-violet-200 border-b border-violet-800/50">
          Charla con {name}
          <span className="font-normal opacity-70"> · mientras juegas</span>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-2">
          {chat.map((c) => (
            <div
              key={c.id}
              className={
                c.role === 'user'
                  ? 'ml-6 rounded-xl bg-fuchsia-700/50 px-2.5 py-1.5 text-sm'
                  : 'mr-4 rounded-xl bg-violet-900/70 border border-violet-700/40 px-2.5 py-1.5 text-sm'
              }
            >
              {c.role === 'user' ? `Tú: ${c.text}` : c.text}
            </div>
          ))}
          {busy && <p className="text-center text-[11px] text-violet-300 animate-pulse">{name}…</p>}
          <div ref={chatEnd} />
        </div>
        <div className="p-2 border-t border-violet-800/50 flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void sendChat()
              }
            }}
            placeholder="Habla con ella mientras juegas…"
            className="flex-1 rounded-xl bg-violet-950 border border-violet-700 px-3 py-2 text-sm"
            disabled={busy}
          />
          <button
            type="button"
            onClick={() => void sendChat()}
            disabled={busy || !draft.trim()}
            className="rounded-xl bg-fuchsia-600 hover:bg-fuchsia-500 px-3 text-sm font-semibold disabled:opacity-40"
          >
            Enviar
          </button>
        </div>
      </div>
    </div>
  )
}
