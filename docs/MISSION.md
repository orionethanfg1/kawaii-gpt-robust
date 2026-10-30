# Objetivo principal — KawaiiGPT Robust

**Asistente operativo estilo Jarvis, con companion incluido.**

## En una frase

Ayudar de verdad en el escritorio del usuario (herramientas, archivos, imagen, voz, web, modelos locales) y, al mismo tiempo, mantener un vínculo continuo con personalidad — sin que el roleplay sustituya a la utilidad cuando hay una tarea clara.

## Pilares

1. **Utilidad primero en la tarea** — planes, tools, observaciones reales, un modelo en VRAM, fallos legibles.
2. **Companion en el cómo** — nombre, tono, memoria afectiva, iniciativa suave; no menús de producto.
3. **Local-first** — Ollama / LM Studio / Forge; cloud solo como respaldo consciente.
4. **Agencia acotada** — puede proponer y, con confirmación, actuar sobre archivos y servicios del host; no inventa capacidades ni reescribe el binario a ciegas.
5. **Un residente LLM** — nunca dos modelos de chat cargados a la vez en el servidor local.
6. **Residencia en el SO** — agenda y avisos útiles con la app en bandeja; notificaciones que devuelven al chat correcto.

## Capa agente (hacia Jarvis)

| Capacidad | Estado | Notas |
|-----------|--------|--------|
| Conciencia de biblioteca / userData | Parcial | Lista dirs, adjuntos, guardarropa; ampliar a inventario + decisión del LLM |
| Organizar / clasificar / mover / copiar / borrar archivos | Planificado | Allowlist de rutas, confirmación UI, audit log; tools + (opcional) vision |
| Agenda con app cerrada / minimizada | Planificado | Tray + proceso ligero o tareas programadas del SO |
| Click en notificación → foco chat | Defecto conocido | Debe abrir ventana + conversación |
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

Ver también: `docs/ROADMAP.md` (fase Agente), `docs/HARNESS.md`, `docs/MODEL-AGENCY.md`.
