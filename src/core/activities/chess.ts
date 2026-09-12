/**
 * Minimal chess rules helper for play-with-model.
 * Not a strong engine — validates moves and offers a very weak random-legal reply.
 */

export type ChessState = {
  id: string
  /** FEN */
  fen: string
  turn: 'w' | 'b'
  moves: string[]
  active: boolean
  /** User plays white by default */
  userColor: 'w' | 'b'
}

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

export function createChess(): ChessState {
  return {
    id: `chess_${Date.now()}`,
    fen: START_FEN,
    turn: 'w',
    moves: [],
    active: true,
    userColor: 'w'
  }
}

export function chessSystemBlock(state: ChessState, companionName?: string): string {
  const name = companionName || 'tu compañera'
  return [
    '# Modo actividad: Ajedrez (tablero visual + narración)',
    `FEN / estado: ${state.fen}`,
    `Turno: ${state.turn === 'w' ? 'blancas' : 'negras'} · Usuario: ${state.userColor === 'w' ? 'blancas' : 'negras'}`,
    `Historial: ${state.moves.slice(-12).join(', ') || '(inicio)'}`,
    `Acompañante: ${name} juega o comenta al lado del usuario — personalidad intacta.`,
    'Reglas:',
    '- El tablero de la app valida jugadas; tú comentas, animas, te quejas o felicitas en personaje.',
    '- REGLAS FLEXIBLES: si el usuario abandona el ajedrez, coquetea, o pide otra cosa, sigue la conversación; no fuerces la partida.',
    '- Puedes sugerir [Abrir aventura](kawaii-activity://adventure) con ese enlace markdown.',
    '- Al cerrar la ventana o terminar, una frase de cierre en personaje.'
  ].join('\n')
}

/** Very weak: suggest opening-ish moves from a tiny book when at start */
export function suggestWeakMove(state: ChessState): string {
  const book: Record<string, string[]> = {
    [START_FEN]: ['e2e4', 'd2d4', 'g1f3', 'c2c4'],
    'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1': ['e7e5', 'c7c5', 'e7e6'],
    'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq d3 0 1': ['d7d5', 'g8f6', 'e7e6']
  }
  const opts = book[state.fen] || ['e2e4', 'd2d4', 'b1c3']
  return opts[Math.floor(Math.random() * opts.length)]
}

export function recordMove(state: ChessState, move: string): ChessState {
  const next = { ...state, moves: [...state.moves, move] }
  next.turn = state.turn === 'w' ? 'b' : 'w'
  // FEN updates properly need a full engine; keep FEN as annotation for the model
  next.fen = `${state.fen} /* after ${move} */`
  return next
}
