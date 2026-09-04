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
