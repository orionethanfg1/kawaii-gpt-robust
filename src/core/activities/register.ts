import { registerCapability } from '../capabilities'

/** Side-effect: ensures games layer is known even if CORE list is trimmed later. */
registerCapability({
  id: 'games',
  label: 'Juegos',
  modality: 'games',
  order: 40,
  whenAvailable:
    'Ajedrez y Aventura en ventanas; juegas en personaje. Enlaces kawaii-activity://chess y kawaii-activity://adventure.',
  whenOff: 'juegos no disponibles'
})
