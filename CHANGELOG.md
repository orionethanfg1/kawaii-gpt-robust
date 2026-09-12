## 0.9.15

## 0.9.26

### Objetivo / imagen / UX
- **parseImageIntent**: `explicitOther` ("no seas tú", "otra persona") anula identidad de personaje.
- Cuerpo completo: tokens FULL_BODY + negative anti-crop; anti multi-cabeza reforzado.
- **Copiar** en mensajes del chat.
- ROADMAP actualizado con brechas P0–P2 vs objetivo.
- `scripts/verify-source.mjs` restaurado (sanity).


## 0.9.25

### UX / imagen / harness
- **Renombrar chat**: extrae solo el título final (ej. «Retratos de prueba»), no «este chat a…».
- **Nombre de imagen** visible en el mensaje (`**título**` + meta `imageTitle`) y en el archivo adjunto.
- **Forge auto-arranque**: progreso % en el mismo mensaje del chat; timeout con instrucción clara si la API no sube.
- Cuerpo completo fuerza resolución recomendada; anti *two heads* reforzado en autorretratos.


## 0.9.24

### Imagen (identidad)
- **Identidad del personaje solo en autorretratos** ("foto tuya", selfie…). Pedidos de *otra* persona (ojos azules, pelo liso, etc.) ya no se fuerzan a Niamh.
- Traits en español se traducen a tags SD en sujetos no-self.
- Revisiones de imagen previas solo si el pedido sigue siendo "sobre ti".

### Harness / datos
- Tools `list_app_logs`, `clear_app_logs` (soft/hard), `rename_conversation`.
- Plan host para "limpia logs" y "renombra el chat a…".
- `imageTitle` en meta de imágenes generadas.


## 0.9.23

### Personaje / visión / iniciativa
- **Regenerar descripción (avatar + galería)**: analiza la principal y hasta 3 referencias para enriquecer la ficha (ropa/escena).
- Iniciativa usa **`localModel`**, personalidad, reacción de relación y un resumen visual; menos plantillas vacías.
- System prompt reconoce **etiquetas de la galería**.
- Tests generativos: presets de estilo, anti elf-ears, fuerza de ficha visual, conteo de galería.


## 0.9.22

### Generación local (calidad)
- **Presets de estilo** tipo Perchance (foto casual, estudio, cinemático, anime, retrato suave): inyectan positive/negative + CFG/steps.
- **Identidad reforzada** desde la ficha visual (pesos en pelo/ojos/ropa, anti elf-ears, anti second face).
- **Traducción ampliada** ES→tags SD para la descripción del personaje.
- Chat **prioriza Forge local** (ya no usa Pollinations en modo smart/local).
- Tamaños y steps recomendados por framing + estilo.


## 0.9.21

### Voz / TTS
- **`voiceTtsAutoPlay`** ahora sí se aplica: al terminar un mensaje del asistente se lee en voz alta (chat principal).
- Respeta “solo en actividades” (no auto-habla en el chat si está activo).
- Limpieza básica de markdown antes de sintetizar; `setSpeaking(false)` en errores (antes el botón quedaba colgado).

### Investigación imagen (docs)
- Notas sobre Perchance / estilo de prompts en respuesta de desarrollo (no integración de su API).


## 0.9.20

### Harness
- **Log de plan colapsable** en mensajes del asistente (solo UI avanzada): resumen del plan + lista de acciones ✓/✗.
- Oculto en modo Smart para no ensuciar el chat.


## 0.9.19

### Harness
- Informe de estado/modelos más claro (capas + modelo activo + roles).
- Mejor extracción de tags tras `Modelos:`.
- **Memoria de éxitos** (`success-memory`): preferencia de modelo local y tools que funcionaron.
- Documentación HARNESS alineada con lo implementado.


## 0.9.18

### Harness robusto (best practice)
- Inventario de **estado + modelos** es **100% host**: `forceStatusAndModelsReport` ejecuta tools y formatea viñetas; el LLM **no** participa.
- Intercept en `sendMessage` antes del chat normal.
- Iniciativa **no** interrumpe diagnósticos ni inventa nombres de modelos (Luna/Aurora…).


## 0.9.17

### Harness UX
- Strip de JSON de plan (`goal`/`steps`) aunque vaya sin marcadores APP_PLAN.
- Pedidos de **estado + lista de modelos**: respuesta **determinista del host** (capas + viñetas), sin 2.º turno LLM.
- Notificaciones: no envían ruido de plan/tags; cuerpo limpio.


## 0.9.16

### Harness / estado real
- El modelo **debe** basarse en estado vivo por capas (chat, Forge, música, voz, cloud keys ≠ modelos locales).
- UI: se ocultan tags `APP_ACTION` / `APP_PLAN` durante el stream.
- Lista de modelos: si alucina (Modelo A, Nombre 1, groq/gemini como instalados), **el host reescribe** con tags reales.
- `get_app_status` reporta capas honestas (running/stopped), no "todo OK".


### Harness
- Observaciones de herramientas con **DATOS REALES** (nombres de modelos); prohíbe inventar "Modelo A/B/C".
- Plan host ampliado: "lista de modelos" / "revisa Forge y modelos" → `list_installed_models`.
- Si la 1.ª respuesta alucina lista genérica, se **reemplaza** con el turno de seguimiento.
- Tests genéricos P0: anti-alucinación, plan host, plan adaptativo, auto-route código.

### Fixes
- Formato de `list_installed_models` con rol (chat/visión/código).

## 0.9.8

### Fixed
- activityStore: restaurados toasts activityInfo/Success/Error/Progress/withActivity (no pisar con solo juegos).

### Docs
- docs/JUEGOS-INTEGRACION.md (Phaser/Pixi/chess.js vs Python).

## 0.9.6

### Added
- ControlNet pack basico (openpose/canny) con recovery.
- Actividades: aventura y ajedrez narrado (Ajustes > Juegos).
- Docs README + docs/.

## 0.9.3

### Fixed
- Tester: likes/dislikes se leen antes de archivar; informe incluye activos+archivo; target **0.9.3**.
- Feedback: `recordFeedback` verifica escritura; checkbox de archivo por defecto OFF.

### Changed
- Forge **no** arranca al boot (VRAM libre para chat).
- Capas bajo demanda: imagen/música llaman `prepareHeavyLayer` desde generación.
- Fast path si Forge ya está activo; sticky ~8 min entre jobs de imagen para mitigar arranques lentos.

## 0.9.2

### Fixed
- Chat: al hacer failover a cloud se limpiaba el stream (texto duplicado en un solo mensaje).
- Forge: arranque automático al iniciar (`scheduleBootLayers({ autoImage: true })` + fallback `startForgeRuntime`).
### Changed
- Tester QA apunta a **0.9.2** (voz, Forge health, huecos del plan).

## 0.9.1

### Fixed
- Voz: reproducción en renderer con protocolo  + fallback Blob (Electron/CSP).
- Base de trabajo alineada con GitHub  + fix de audio.

## 0.9.0

### Imágenes inteligentes
- Smart prioriza Forge/SD local y usa OpenAI Images, Cloudflare FLUX y Pollinations solo como fallback.
- Los prompts cloud se mantienen narrativos y Forge los convierte a etiquetas SD con negativos específicos.
- Las revisiones conversacionales conservan identidad, composición y contexto visual.
- El avatar principal y la galería forman un ancla de identidad; Forge usa img2img local para variaciones de personaje.
- Integración opcional de ControlNet IP-Adapter FaceID local, con detección automática y fallback img2img.
- El tester añade el P0 `p0-avatar-reference-flow` para detectar regresiones de identidad antes de generar.
- Panel, README y versión sincronizados en 0.9.0.

## 0.8.65

### Fixed
- Music IPC: `generateMusicTrack is not a function` (export alias to `generateMusic`).

### Added
- System tester in Settings: layered checks + Markdown/JSON repair report.
- Docs: `docs/QA-SYSTEM-TESTER.md`; README tester + music manual checks.

## 0.8.24

- Adaptador local OpenAI-compatible: detección automática de LM Studio / llama.cpp / Ollama shim.
- Bootstrap transparente: inicia Ollama, descarga visión (moondream/llava) si hace falta, rellena descripción del avatar.
- Router local usa runtime resuelto (auto) sin que el usuario elija puerto.

## 0.8.22

- Prioridad 1: herramientas de modelos — list_installed_models, download_model, pause/resume/cancel_download, delete_model, list_download_jobs.
- Catálogo ampliado (Qwen 7B/14B, Llama 3.1 8B, LLaVA, Phi-3). Sync de instalados desde Ollama.
- Aprobación UI para descarga y borrado.

## 0.8.21

- Agente: segundo micro-turno real tras ejecutar herramientas (observaciones estructuradas → modelo).
- Sync con plan de continuidad 0.8.20 + docs.

## 0.8.20

- Agente: bucle multi-turno observe/decide/execute/observe con presupuesto de turnos.
- Auditoría: registro saneado de herramientas, riesgos, aprobaciones, resultados y duración.
- Modelos: herramientas de listar, recomendar, comprobar runtime y activar modelos conocidos.
- Routing: selección por capacidades de chat, código, visión, tools y resumen.
- Runtime: contrato `LocalRuntimeAdapter` para Ollama, llama.cpp y OpenAI-compatible.
- Catálogo: verificación opcional antes de aceptar actualizaciones remotas.
- Evolución: persistencia validada de propuestas de mejora.
- Validación: 53 tests, typecheck, verify y build correctos.

## 0.8.19

- TypeScript: typecheck completo limpio en main, preload y renderer.
- Contexto local: historial completo cuando cabe; compactacion solo por limite real o overflow.
- Seguridad: aprobacion no modal para iniciar Ollama o Forge desde el agente.
- UI: solicitudes de permiso visibles con permitir/rechazar.

## 0.8.18

- Harness: runtime multi-paso con limites de pasos, timeout, validacion Zod y politica de permisos.
- Chat: acciones del agente conectadas al runtime con limite de cuatro pasos, timeout y deduplicacion.
- Contexto local: conserva el historial completo cuando cabe y reduce solo por exceso real o `CONTEXT_OVERFLOW`.
- Seguridad: arranque de Forge/Ollama desde el agente requiere confirmacion explicita.
- Tests: 50 tests pasan; typecheck queda con 20 diagnósticos heredados de UI/Forge.
- Modelos: registro offline-first con capacidades, requisitos, runtime, licencia y checksum opcional.
- Catalogo: sincronizacion remota con timeout y fallback seguro a cache o catalogo embebido.
- Arranque: refresco del catalogo en segundo plano con `KAWAII_MODEL_CATALOG_URL` opcional.
- Evolucion controlada: propuestas revisables sin auto-modificacion del codigo ni de los pesos.
- Base: contrato preload/renderer unificado y soporte de resumen local cuando el contexto lo requiere.

### Pendiente de integracion

- Conectar `AgentRuntime` al ciclo completo del chat y devolver resultados al modelo.
- Conectar `ModelRegistry` al arranque de Electron y a la UI de descargas.
- Añadir dialogos de aprobacion para acciones de recursos y destructivas.
- Limpiar los errores TypeScript heredados del renderer y completar los tests de retry.

## 0.8.16

- Chat: apariencia física con hechos canónicos (sin placeholders); refuerzo en preguntas de descripción.
- Router: prioriza cloud en prompts complejos cuando está disponible (inteligencia primero).
- Descargas: purge de jobs completados/fantasma; mensajes de recovery más claros.
- Forge: auto-arranque solo si hay instalación detectada; timeout ampliado.

## [0.6.1] — 2026-09-01

### Fixed
- Detección de Forge al generar: escaneo de puertos + intento de arranque
- Credenciales Cloudflare (Account ID en secure store + botón Guardar y probar)
- Launcher muestra version de package.json y limpia `out/` al arrancar
- UI de version: alerta si electron ≠ package.json


### Fixed
- Versión de UI hardcodeada (v0.5.0) → lee package.json / app.getVersion()
- Guardado fiable de Cloudflare (Account ID + Token)
- Cadena imagen: Local → Cloudflare FLUX → Pollinations con motivo de fallback

### Added
- Integración Cloudflare Workers AI (FLUX.1 Schnell)

---

# Changelog

## 0.9.14

### Harness
- Planes **adaptativos** al estado vivo: no `start_forge` si Forge ya corre; omite starts redundantes (Ollama/música).
- Routing automático de modelo por tarea (0.9.13+) + memoria de fallos.

### Fixes
- `buildTimeAwarenessBlock` acepta objeto `{ lastMessageAt, personality… }` (antes se ignoraba el tiempo en chat).
- Informe solo likes/dislikes sin correr todos los tests.
- Iniciativa: API LLM corregida + menos repetición.

## [0.5.1] — 2026-09-01

### Añadido
- **Chat natural de imágenes**: pide fotos en el mensaje («hazme una imagen de…»); feedback («el doble», «cambia el fondo»).
- Escala rápida ½ / 1× / 1½ / 2× en opciones de imagen; defaults imageGen **smart** activos.
- Listado de checkpoints desde **disco** si la API Forge devuelve 404.

### Cambiado
- Prioridad cloud: inteligencia (OpenRouter/Gemini) antes que velocidad (Groq).
- Panel de imagen = opciones avanzadas; el chat es la interfaz principal.

---

## [0.5.0] — 2026-09-01

### Añadido

- **Estado de modelos en vivo** (instalados / en curso / fallidos) en barra compacta, panel de imagen y workspace SD.
- **Modo UI Smart vs Avanzado** con diferencias reales de panel (memoria de errores, workspace Forge).
- **Pruebas de red reales** (Cloudflare, httpbin, OpenRouter, Groq) en Autodiagnóstico y al fallar el chat.
- Tips contextuales del asistente durante el uso (no solo onboarding).
- Recovery SD/Forge más claro: fallidos no se muestran como “running”; **Continuar** reanuda desde disco.
- Guía de botones en Datos locales / Stable Diffusion.

### Cambiado

- Descargas SD: no borrar `.partial` al cambiar de mirror; más reintentos; mirrors en cadena tras `fetch failed`.
- Barra de descargas: badges `descargando` / `pausado` / `falló`; incluye Ollama, SD y Forge.
- Ajustes: banner explicativo del modo UI.
- Documentación alineada con el flujo launcher + datos en disco no-sistema.

### Corregido

- Claves React duplicadas en catálogo SD / recovery.
- Jobs de recovery marcados erróneamente como en curso tras `fetch failed`.
- Detección de checkpoints ya instalados (botón “Ya instalado”).
- Sincronización barra inferior ↔ estado en disco (poll periódico).

### Notas

- Objetivo hacia **1.0**: chat estable, imágenes local/cloud usables, recovery fiable, empaquetado opcional.
- Web search in-app para el modelo sigue siendo capa futura (la app sí mide red; el LLM no navega solo todavía).

---

## [0.4.0] — 2026-08-30

### Añadido
- **Reenviar** mensajes fallidos (sin reescribir el texto).
- **Eliminar** mensajes individuales del chat.
- **Memoria del usuario**: hechos cortos (nombre, gustos…) inyectados en el system prompt sin volcar todo el historial.
- **Forge boot**: progreso en vivo (logs + toast), timeouts largos, recovery de descargas, filtro de logs ruidosos.
- Sincronización de checkpoints → Forge; pipeline local de imagen.

### Cambiado
- Si Ollama no está disponible en modo smart, se usa cloud directamente (menos errores «modelo no disponible (ollama)» engañosos).
- Cloud solo usa proveedores **Activo** + key (A4).
- Descarga resumible con reintentos ante red inestable.

### Corregido
- Escritura atómica de `machine-profile.json` (race ENOENT).
- Export `listRecoveryJobs` tras refactor de descargas.
- Preload `onForgeBootProgress` (sintaxis).
- Toast de arranque de Forge sincronizado con progreso real.

## [0.3.0]
## Multi-generative layers

- Core generative module: intent + capability registry
- Text hub invokes image/music/video only when needed
- Settings flags for experimental music/video
- Header badge for layer status

# Changelog

Todos los cambios relevantes de **KawaiiGPT Robust** se documentan aquí.

El formato se inspira en [Keep a Changelog](https://keepachangelog.com/es-ES/1.0.0/),
y el proyecto usa [Semantic Versioning](https://semver.org/lang/es/).

## [Unreleased]

### Añadido

- **Launcher Windows para principiantes**: comprobaciones Node/npm, logs, `pause` siempre, `Diagnostico.bat`.

- **Wizard: paso Imágenes**: activar/cloud/smart/local, detección GPU, probar A1111; checklist post-setup.
- **Checkpoints A1111**: listado en desplegable (panel + Ajustes), `override_settings.sd_model_checkpoint`.
- **Imagen Fases 2–7**: adjuntar al hilo, meta, GPU hints, A1111/Forge, smart fallback, `/image`, estilo de personaje, limpieza de disco, tests de recomendaciones.
- **Imagen Fase 0–1**: contratos `ImageProvider`, errores tipados, settings `imageGenEnabled` (default off).
- **Pollinations**: IPC `image:generate` / `image:cancel`, guardado en `userData/images`, panel UI en chat.
- Tests de URL Pollinations y clasificación de errores de imagen.

### Cambiado

### Corregido

## [0.3.0] — 2026-08-22

### Añadido

- **Resumen en segundo plano**: pre-comprime chats largos en idle; se pausa durante el stream.
- **Resumen background vía cloud** (opt-in): si no hay Ollama, usa el primer proveedor cloud con key (aviso de cuota en Ajustes).
- **Indicador de resumen** en el header del chat: fuente y antigüedad (“hace X min”).
- **Empaquetado NSIS + portable**: `Empaquetar-NSIS.bat` / `Empaquetar-Portable.bat`, iconos, `installer.nsh`, idiomas ES/EN.
- **CI Windows** (GitHub Actions): tests + build NSIS/portable; release en tags `v*`; firma opcional vía `CSC_LINK`.
- **Tests de integración del orquestador** (failover, rotación cloud, overflow, resumen); DI `deps` en `sendChatMessage`.
- **Checklist post-setup** en el estado vacío del chat.
- **Exportar / importar** conversaciones (JSON y Markdown).
- **Indicador en vivo** de ruta/modelo durante la respuesta.
- **Rotación multi-proveedor cloud** (OpenRouter, Groq, Gemini, OpenAI).
- IPC de keys por proveedor + UI de slots en Ajustes.
- **Resumen de contexto con modelo** (fallback heurístico) y persistencia `rollingSummary`.

### Cambiado

- Orquestador: resume solo cuando hay turnos nuevos fuera de la ventana reciente.
- Versión de producto **0.3.0**.

### Corregido

- Merge de ajustes: `traits` / `cloudSlots` al actualizar no se corrompen con parches parciales.
- Flag de resumen en background: default activo; off solo con `false` explícito.

## [0.2.0] — 2026-08-22

### Añadido

- **Personalidad y avatar**: nombre, tagline, instrucciones, estilo, rasgos; emoji o imagen en el chat.
- **Asistente de configuración** mejorado: progreso, detección de Ollama, sugerencias por hardware, descarga de modelos, proveedores cloud free.
- **Gestión de modelos Ollama**: descargar (segundo plano), detener/cancelar, eliminar; listado de instalados.
- **Intentar iniciar Ollama** desde la app si no responde.
- **Ventana de contexto deslizante** + resumen heurístico de turnos antiguos.
- **Reintentos ante overflow** de contexto/tokens (presupuesto reducido automático).
- **Failover automático** local ↔ cloud (rate limit, cuota, red, indisponibilidad).
- **Metadatos de ruta** en mensajes: modelo, ruta, motivo, hora, failover, contexto ajustado.
- **Autodiagnóstico** en Ajustes + disparo opcional al fallar un proveedor (incluye intento de arrancar Ollama).
- Catálogo de modelos cloud gratuitos (OpenRouter, Groq, Gemini, OpenAI).
- Tests unitarios para el empaquetado de contexto.

### Cambiado

- Orquestador de chat reescrito: personalidad + pack de contexto + failover transparente.
- Settings persistidos en clave `kawaii-settings-v2` con merge seguro al actualizar.
- README alineado con el estado real del proyecto (launcher, no empaquetado obligatorio).

### Corregido

- Clasificación de errores de contexto/tokens (precedencia y más patrones).
- Posible **duplicación del mensaje de usuario** al construir el historial para el proveedor.
- Merge incompleto de `character` al actualizar ajustes parciales.
- Formato del handler `before-quit` en el proceso main.
- Tipos/API de preload para pull cancel y delete de modelos.

### Notas

- Empaquetado NSIS/portable sigue configurado pero **no es el flujo por defecto** hasta aprobar una build.
- “Pausar” descarga de Ollama no existe en la API oficial: **Detener** cancela; volver a descargar suele reanudar capas ya bajadas.

## [0.1.0] — 2026-08-22

### Añadido

- Scaffold Electron + Vite + React + TypeScript + Tailwind (tema kawaii).
- Providers Ollama y OpenAI-compatible.
- Smart router básico (local / cloud / web-augmented).
- Circuit breaker y retries.
- IPC: secrets, web search, hardware profile, single-instance, window state.
- UI de chat, sidebar y ajustes mínimos.
- Launchers Windows (`.bat`) y scripts de icono/shortcuts.
- Configuración electron-builder (NSIS + portable).

---

[0.2.0]: https://github.com/your-username/kawaii-gpt-robust/releases/tag/v0.2.0
[0.1.0]: https://github.com/your-username/kawaii-gpt-robust/releases/tag/v0.1.0
