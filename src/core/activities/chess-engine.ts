/**
 * Minimal chess rules for visual board + weak AI.
 * Not Stockfish — validates moves, generates legal moves, random/quiet AI.
 */

export type Color = 'w' | 'b'
export type Piece = 'K' | 'Q' | 'R' | 'B' | 'N' | 'P' | 'k' | 'q' | 'r' | 'b' | 'n' | 'p'
export type Board = (Piece | null)[] // 64, a1=0 … h8=63

export type GameSnap = {
  board: Board
  turn: Color
  castling: string
  ep: number | null
  halfmove: number
  fullmove: number
  history: string[]
  over?: 'checkmate' | 'stalemate' | 'draw' | null
}

const START =
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

export function parseFen(fen = START): GameSnap {
  const [placement, turn, castling, ep, half, full] = fen.split(/\s+/)
  const board: Board = Array(64).fill(null)
  let r = 7
  let c = 0
  for (const ch of placement) {
    if (ch === '/') {
      r--
      c = 0
    } else if (/\d/.test(ch)) {
      c += parseInt(ch, 10)
    } else {
      board[r * 8 + c] = ch as Piece
      c++
    }
  }
  let epSq: number | null = null
  if (ep && ep !== '-') {
    const file = ep.charCodeAt(0) - 97
    const rank = parseInt(ep[1], 10) - 1
    if (file >= 0 && file < 8 && rank >= 0 && rank < 8) epSq = rank * 8 + file
  }
  return {
    board,
    turn: turn === 'b' ? 'b' : 'w',
    castling: castling || '-',
    ep: epSq,
    halfmove: parseInt(half || '0', 10) || 0,
    fullmove: parseInt(full || '1', 10) || 1,
    history: [],
    over: null
  }
}

export function toFen(g: GameSnap): string {
  const rows: string[] = []
  for (let r = 7; r >= 0; r--) {
    let empty = 0
    let row = ''
    for (let c = 0; c < 8; c++) {
      const p = g.board[r * 8 + c]
      if (!p) empty++
      else {
        if (empty) {
          row += String(empty)
          empty = 0
        }
        row += p
      }
    }
    if (empty) row += String(empty)
    rows.push(row)
  }
  const ep =
    g.ep == null
      ? '-'
      : String.fromCharCode(97 + (g.ep % 8)) + String(Math.floor(g.ep / 8) + 1)
  return `${rows.join('/')} ${g.turn} ${g.castling || '-'} ${ep} ${g.halfmove} ${g.fullmove}`
}

function isWhite(p: Piece) {
  return p === p.toUpperCase()
}
function enemy(c: Color): Color {
  return c === 'w' ? 'b' : 'w'
}

function sqName(i: number) {
  return String.fromCharCode(97 + (i % 8)) + String(Math.floor(i / 8) + 1)
}

function pathClear(board: Board, from: number, to: number): boolean {
  const fr = Math.floor(from / 8)
  const fc = from % 8
  const tr = Math.floor(to / 8)
  const tc = to % 8
  const dr = Math.sign(tr - fr)
  const dc = Math.sign(tc - fc)
  let r = fr + dr
  let c = fc + dc
  while (r !== tr || c !== tc) {
    if (board[r * 8 + c]) return false
    r += dr
    c += dc
  }
  return true
}

function attacks(board: Board, from: number, to: number): boolean {
  const p = board[from]
  if (!p) return false
  const fr = Math.floor(from / 8)
  const fc = from % 8
  const tr = Math.floor(to / 8)
  const tc = to % 8
  const dr = tr - fr
  const dc = tc - fc
  const ad = Math.abs(dr)
  const ac = Math.abs(dc)
  const low = p.toLowerCase()
  if (low === 'n') return (ad === 2 && ac === 1) || (ad === 1 && ac === 2)
  if (low === 'k') return ad <= 1 && ac <= 1
  if (low === 'p') {
    const dir = isWhite(p) ? 1 : -1
    if (dc === 0) return false
    return dr === dir && ac === 1
  }
  if (low === 'r') {
    if (dr !== 0 && dc !== 0) return false
    return pathClear(board, from, to)
  }
  if (low === 'b') {
    if (ad !== ac) return false
    return pathClear(board, from, to)
  }
  if (low === 'q') {
    if (dr !== 0 && dc !== 0 && ad !== ac) return false
    return pathClear(board, from, to)
  }
  return false
}

function inCheck(board: Board, color: Color): boolean {
  let king = -1
  for (let i = 0; i < 64; i++) {
    const p = board[i]
    if (p && p.toLowerCase() === 'k' && isWhite(p) === (color === 'w')) {
      king = i
      break
    }
  }
  if (king < 0) return true
  for (let i = 0; i < 64; i++) {
    const p = board[i]
    if (!p) continue
    if (isWhite(p) === (color === 'w')) continue
    if (attacks(board, i, king)) return true
  }
  return false
}

export function legalMoves(g: GameSnap, from: number): number[] {
  const p = g.board[from]
  if (!p) return []
  if (isWhite(p) !== (g.turn === 'w')) return []
  const out: number[] = []
  const fr = Math.floor(from / 8)
  const fc = from % 8
  const low = p.toLowerCase()
  const tryMove = (to: number) => {
    if (to < 0 || to > 63) return
    const target = g.board[to]
    if (target && isWhite(target) === isWhite(p)) return
    const next = g.board.slice() as Board
    next[to] = next[from]
    next[from] = null
    // promotion default Q
    if (next[to] && next[to]!.toLowerCase() === 'p') {
      const tr = Math.floor(to / 8)
      if (tr === 7 || tr === 0) {
        next[to] = (isWhite(p) ? 'Q' : 'q') as Piece
      }
    }
    if (!inCheck(next, g.turn)) out.push(to)
  }

  if (low === 'n') {
    for (const [dr, dc] of [
      [2, 1],
      [2, -1],
      [-2, 1],
      [-2, -1],
      [1, 2],
      [1, -2],
      [-1, 2],
      [-1, -2]
    ]) {
      const r = fr + dr
      const c = fc + dc
      if (r >= 0 && r < 8 && c >= 0 && c < 8) tryMove(r * 8 + c)
    }
  } else if (low === 'k') {
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue
        const r = fr + dr
        const c = fc + dc
        if (r >= 0 && r < 8 && c >= 0 && c < 8) tryMove(r * 8 + c)
      }
  } else if (low === 'p') {
    const dir = isWhite(p) ? 1 : -1
    const start = isWhite(p) ? 1 : 6
    const one = (fr + dir) * 8 + fc
    if (one >= 0 && one < 64 && !g.board[one]) {
      tryMove(one)
      if (fr === start) {
        const two = (fr + 2 * dir) * 8 + fc
        if (!g.board[two]) tryMove(two)
      }
    }
    for (const dc of [-1, 1]) {
      const c = fc + dc
      if (c < 0 || c > 7) continue
      const to = (fr + dir) * 8 + c
      if (to < 0 || to > 63) continue
      const t = g.board[to]
      if (t && isWhite(t) !== isWhite(p)) tryMove(to)
      else if (g.ep === to) tryMove(to)
    }
  } else {
    const rays: number[][] =
      low === 'r'
        ? [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1]
          ]
        : low === 'b'
          ? [
              [1, 1],
              [1, -1],
              [-1, 1],
              [-1, -1]
            ]
          : [
              [1, 0],
              [-1, 0],
              [0, 1],
              [0, -1],
              [1, 1],
              [1, -1],
              [-1, 1],
              [-1, -1]
            ]
    for (const [dr, dc] of rays) {
      let r = fr + dr
      let c = fc + dc
      while (r >= 0 && r < 8 && c >= 0 && c < 8) {
        const to = r * 8 + c
        const t = g.board[to]
        if (!t) tryMove(to)
        else {
          if (isWhite(t) !== isWhite(p)) tryMove(to)
          break
        }
        r += dr
        c += dc
      }
    }
  }
  return out
}

export function allLegal(g: GameSnap): Array<{ from: number; to: number }> {
  const moves: Array<{ from: number; to: number }> = []
  for (let i = 0; i < 64; i++) {
    for (const to of legalMoves(g, i)) moves.push({ from: i, to })
  }
  return moves
}

export function applyMove(g: GameSnap, from: number, to: number): GameSnap | null {
  if (!legalMoves(g, from).includes(to)) return null
  const board = g.board.slice() as Board
  const p = board[from]!
  // en passant capture
  if (p.toLowerCase() === 'p' && to === g.ep && !board[to]) {
    const dir = isWhite(p) ? -1 : 1
    board[to + dir * 8] = null
  }
  board[to] = p
  board[from] = null
  if (p.toLowerCase() === 'p' && (Math.floor(to / 8) === 7 || Math.floor(to / 8) === 0)) {
    board[to] = (isWhite(p) ? 'Q' : 'q') as Piece
  }
  let ep: number | null = null
  if (p.toLowerCase() === 'p' && Math.abs(Math.floor(to / 8) - Math.floor(from / 8)) === 2) {
    ep = ((Math.floor(from / 8) + Math.floor(to / 8)) / 2) * 8 + (from % 8)
  }
  const next: GameSnap = {
    board,
    turn: enemy(g.turn),
    castling: g.castling,
    ep: ep != null ? Math.floor(ep) : null,
    halfmove: p.toLowerCase() === 'p' || g.board[to] ? 0 : g.halfmove + 1,
    fullmove: g.turn === 'b' ? g.fullmove + 1 : g.fullmove,
    history: [...g.history, `${sqName(from)}${sqName(to)}`],
    over: null
  }
  const leg = allLegal(next)
  if (leg.length === 0) {
    next.over = inCheck(next.board, next.turn) ? 'checkmate' : 'stalemate'
  }
  return next
}

export function aiPick(g: GameSnap): { from: number; to: number } | null {
  const moves = allLegal(g)
  if (!moves.length) return null
  // Prefer captures
  const captures = moves.filter((m) => g.board[m.to])
  const pool = captures.length ? captures : moves
  return pool[Math.floor(Math.random() * pool.length)]
}

export function pieceGlyph(p: Piece | null): string {
  if (!p) return ''
  const map: Record<string, string> = {
    K: '♔',
    Q: '♕',
    R: '♖',
    B: '♗',
    N: '♘',
    P: '♙',
    k: '♚',
    q: '♛',
    r: '♜',
    b: '♝',
    n: '♞',
    p: '♟'
  }
  return map[p] || p
}
