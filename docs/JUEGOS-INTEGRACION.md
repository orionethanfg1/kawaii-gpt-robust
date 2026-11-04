# Integracion de mini-juegos visuales en KawaiiGPT

## Objetivo
Ventanas propias (BrowserWindow), controladas por la app y el modelo de chat.
El personaje puede narrar, proponer reglas y generar arte (Forge) para cartas/escenas.

## Opciones tecnicas (mejores practicas 2025-2026)

### 1. React + Canvas 2D (recomendado para v1)
- Librerias: `react-chessboard` + `chess.js` (ajedrez real con reglas).
- Aventura: UI propia (log + botones de opcion) sin motor pesado.
- Pros: mismo stack, facil de conectar al LLM e IPC.
- Contras: no es "AAA" visual.

### 2. Phaser 3 (2D atractivo)
- Motor HTML5 maduro, sprites, tilemaps, audio.
- Ideal para D&D visual, mapas, combates por turnos.
- Se embebe en una ruta React (`#/activity/...`) o iframe local.
- El modelo puede: elegir encuentros, generar prompts de escena -> Forge.

### 3. PixiJS
- Muy bueno en UI fantasy / efectos (similar al prototype "Aether Chess").
- Menos "game loop" que Phaser; excelente para tableros estilizados.

### 4. Three.js / R3F
- Solo si se busca 3D; coste alto de GPU junto a Forge/ACE.

### 5. No recomendar
- Python embebido solo para juegos (otro runtime, packaging doloroso).
- Unity WebGL completo (pesado para una app de chat).

## Arquitectura en KawaiiGPT
1. Main: `activity-windows.ts` abre BrowserWindow con hash `#/activity/chess|adventure`.
2. Renderer: pantallas de actividad leen `useActivityStore` + envian jugadas al chat (IPC o store).
3. Chat: `extraSystemBlock()` inyecta reglas FEN / HP / inventario.
4. Opcional: boton "Ilustrar esta escena" -> `imageGenerate` con estilo fantasy.

## Roadmap de juegos
- [x] Ventana separada + modo chat
- [ ] Tablero ajedrez con chess.js (legal moves + IA debil)
- [ ] Aventura con panel de opciones clicables
- [ ] Skins generadas por SD (piezas / fondos)
- [ ] Phaser demo de un dungeon de 3 habitaciones

## Referencia visual del usuario
Prototype tipo "Aether Chess" (fantasy, tablero oscuro, piezas estilizadas):
encaja con PixiJS o assets 2D + CSS; el LLM no mueve piezas ilegalmente si chess.js valida.


## Decision de producto (0.9.9)
- **Prioridad visual:** ajedrez en ventana (motor local + UI fantasy Aether-like).
- **No visual / chat-first:** aventura D&D ligera (narracion del modelo + estado HP/inventario).
- El LLM no sustituye reglas de ajedrez; solo puede narrar o sugerir.
