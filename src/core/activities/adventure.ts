export type AdventurePlayer = {
  id: string
  name: string
  role: 'companion' | 'player' | 'npc'
  /** Present in the scene / party */
  inParty: boolean
  hp: number
  maxHp: number
}

export type AdventureState = {
  active: boolean
  title: string
  location: string
  turn: number
  hp: number
  maxHp: number
  inventory: string[]
  flags: string[]
  log: string[]
  players: AdventurePlayer[]
  startedAt: number
}

export function createAdventure(title?: string, companionName = 'Niamh'): AdventureState {
  return {
    active: true,
    title: title || 'Nueva aventura',
    location: 'Inicio',
    turn: 0,
    hp: 10,
    maxHp: 10,
    inventory: [],
    flags: [],
    log: [],
    players: [
      {
        id: 'companion',
        name: companionName,
        role: 'companion',
        inParty: true,
        hp: 10,
        maxHp: 10
      },
      {
        id: 'player',
        name: 'Tú',
        role: 'player',
        inParty: true,
        hp: 10,
        maxHp: 10
      }
    ],
    startedAt: Date.now()
  }
}

export function adventureSystemBlock(state: AdventureState, companionName: string): string {
  const party = (state.players || [])
    .filter((p) => p.inParty)
    .map((p) => `${p.name}(${p.role} HP ${p.hp}/${p.maxHp})`)
    .join(', ')
  return [
    `# Actividad: Aventura interactiva`,
    `Título: ${state.title}`,
    `Lugar: ${state.location}`,
    `Turno: ${state.turn}`,
    `HP grupo (legado): ${state.hp}/${state.maxHp}`,
    `Inventario: ${state.inventory.join(', ') || '(vacío)'}`,
    `Grupo: ${party || companionName}`,
    `Eres ${companionName} DENTRO de la escena (no narrador omnisciente frío).`,
    `Cuando ofrezcas opciones, numéralas 1. 2. 3. para que la UI las muestre como botones.`,
    `Si el usuario cambia el título o añade/quita jugadores, respétalo.`,
    `Reglas flexibles: si pide romper el juego (meta, romance, OOC), sigue con naturalidad.`
  ].join('\n')
}

export function applyAdventurePlayerMove(
  state: AdventureState,
  playerText: string
): AdventureState {
  const next: AdventureState = {
    ...state,
    inventory: [...state.inventory],
    flags: [...state.flags],
    log: [...state.log],
    players: (state.players || []).map((p) => ({ ...p })),
    maxHp: state.maxHp || 10
  }
  next.turn += 1
  next.log.push(`Jugador: ${playerText.slice(0, 200)}`)
  if (/\b(ataco|peleo|corro hacia|salto)\b/i.test(playerText) && next.hp > 1) {
    if (Math.random() < 0.25) {
      next.hp -= 1
      const me = next.players.find((p) => p.role === 'player')
      if (me && me.hp > 1) me.hp -= 1
    }
  }
  if (/\b(pico|tomo|cojo|agarro)\b/i.test(playerText)) {
    const m = playerText.match(/\b(llave|gema|poción|pocion|espada|amuleto)\b/i)
    if (m && !next.inventory.includes(m[0].toLowerCase())) {
      next.inventory.push(m[0].toLowerCase())
    }
  }
  return next
}

export function setAdventureTitle(state: AdventureState, title: string): AdventureState {
  return { ...state, title: title.trim().slice(0, 80) || state.title }
}

export function toggleAdventurePlayer(
  state: AdventureState,
  playerId: string,
  inParty?: boolean
): AdventureState {
  return {
    ...state,
    players: (state.players || []).map((p) =>
      p.id === playerId
        ? { ...p, inParty: inParty !== undefined ? inParty : !p.inParty }
        : p
    )
  }
}

export function addAdventureNpc(
  state: AdventureState,
  name: string
): AdventureState {
  const id = `npc_${Date.now().toString(36)}`
  return {
    ...state,
    players: [
      ...(state.players || []),
      {
        id,
        name: name.trim().slice(0, 40) || 'Aliado',
        role: 'npc',
        inParty: true,
        hp: 8,
        maxHp: 8
      }
    ]
  }
}
