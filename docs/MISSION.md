# Objetivo principal — KawaiiGPT Robust

**Asistente operativo estilo Jarvis, con companion incluido.**

## En una frase

Ser una presencia digital local-first y persistente que, con permiso, conserva objetivos y contexto entre conversaciones, entiende señales autorizadas del entorno y decide cuándo ayudar, preguntar o esperar; a la vez mantiene una personalidad companion coherente y límites claros bajo control del usuario.

## Pilares

0. **Estabilidad primero** — un residente LLM, prefill acotado, datos que no se pierden, tools con allowlist.

1. **Utilidad primero en la tarea** — planes, tools, observaciones reales, un modelo en VRAM, fallos legibles.
2. **Companion en el cómo** — nombre, tono, memoria afectiva, iniciativa suave; no menús de producto.
3. **Local-first** — Ollama / LM Studio / Forge; cloud solo como respaldo consciente.
4. **Agencia acotada** — puede proponer y, con confirmación, actuar sobre archivos y servicios del host; no inventa capacidades ni reescribe el binario a ciegas.
5. **Un residente LLM** — nunca dos modelos de chat cargados a la vez en el servidor local.
6. **Residencia en el SO** — agenda y avisos útiles con la app en bandeja; notificaciones que devuelven al chat correcto.
7. **Continuidad event-driven** — objetivos y seguimientos sobreviven a conversaciones y reinicios. Persistencia no significa inferencia constante, observación total ni modelo obligado a permanecer en memoria.
8. **Control verificable** — fuentes opt-in, iniciativa pausada/revocable, razón visible, recuerdos corregibles/olvidables y aprobación exacta para acciones de riesgo.

## Capa agente (hacia Jarvis)

| Capacidad | Estado | Notas |
|-----------|--------|--------|
| Conciencia de biblioteca / userData | Base implementada | Inventario y tools existen; verificar cada flujo y su límite de permisos en E2E |
| Organizar / clasificar / mover / copiar / borrar archivos | Base implementada y acotada | Allowlist/tickets/audit; seguir probando rutas, symlinks, aprobación y cancelación |
| Agenda con app abierta/minimizada | Base local implementada | El contrato al salir/reiniciar debe definirse y probarse antes de prometer ejecución |
| Click en notificación → foco chat | Parcial / por validar en build | Confirmar Windows empaquetado, reinicio y conversación correcta |
| Comandos de host acotados | Planificado | Solo verbos seguros (abrir carpeta, lanzar app permitida); nunca shell libre al inicio |
| Editar / resumir / corregir archivos | Parcial → ampliar | Docs en chat; tools de lectura/escritura bajo confirmación |

Modelos tipo **Gemma 4** (tools + vision + reasoning) son el perfil objetivo para orquestar estas tools; la app sigue siendo el **harness** (límites, confirmaciones, un solo modelo en VRAM).

## No es

- Solo un chatbot de noviazgo.
- Solo un panel de modelos.
- Un sistema que se auto-parchee leyendo su código empaquetado.
- Un agente con shell ilimitado o acceso fuera de las rutas consentidas.

## Sí es

Un agente de escritorio que **hace** (cuando puede y el usuario consiente) y **acompaña** (siempre con coherencia de personaje), acercándose a un Jarvis accesible en PC de usuario.

## Capa de decisión (Jarvis + companion)

Antes del LLM: **DecisionPacket** (task, risk, scene, inject, modelHint, reason). Jarvis = utilidad/tools; companion = tono/vínculo; un solo modelo ejecuta ambos. Detalle: `docs/DECISION-LAYER-AND-JARVIS-COMPANION.md`.

Ver también: `docs/ROADMAP.md` (fase Agente), `docs/HARNESS.md`, `docs/MODEL-AGENCY.md`.

## Objetivo persistente

La nueva capa de continuidad extiende —no reemplaza— DecisionPacket, agenda, memoria dual, harness, tray e idle review. Sus fuentes deben ser opt-in; el modelo solo evalúa candidatos útiles tras filtros baratos y respeta un único residente LLM. Ninguna iniciativa equivale a permiso de actuar. Orden, contratos, gates de regresión y análisis de cambios recientes: [PERSISTENT-JARVIS-ROADMAP.md](./PERSISTENT-JARVIS-ROADMAP.md).
