# KawaiiGPT Robust 0.8.20: estado para continuidad

## Cómo usar este documento

Este es el resumen operativo para otra IA o desarrollador. Describe lo que existe realmente en el código de la versión 0.8.20, cómo se llegó a ello, qué se verificó y qué debe hacerse después. Leerlo junto con `docs/AI-CONTINUATION-PLAN.md` y `docs/AGENT-HARNESS.md`.

No asumir que una interfaz significa que la capacidad ya está conectada: las secciones de pendientes distinguen contratos preparados de integraciones funcionales.

## Propósito del proyecto

KawaiiGPT Robust es una aplicación Electron/React de chat híbrido. El objetivo es que pueda:

- conversar con modelos locales y cloud;
- elegir recursos según tarea, hardware, privacidad y disponibilidad;
- gestionar su propio entorno mediante herramientas controladas;
- descargar y actualizar modelos de forma verificable;
- conservar memoria y proponer mejoras sin auto-modificar código o pesos;
- funcionar sin depender estructuralmente de Ollama.

## Estado actual resumido

### Funciona y está conectado

- Chat local/cloud con routing, failover y recuperación de contexto.
- Ollama como runtime local real.
- Forge/A1111, Pollinations y Cloudflare para imágenes.
- Búsqueda web, memoria de usuario, relación/personaje y resumen de conversación.
- Harness de acciones textuales `APP_ACTION` conectado al chat.
- Límite de cuatro acciones, timeout, validación Zod, deduplicación y auditoría en memoria.
- Confirmación no modal para iniciar Ollama o Forge desde el chat.
- Catálogo de modelos offline-first, caché y actualización al iniciar.
- Herramientas conectadas: `list_models`, `recommend_model`, `check_local_runtime`, `set_active_model`.
- TypeScript estricto sin errores.

### Contratos preparados pero aún no conectados completamente

- `runAgentLoop` existe y tiene tests, pero el LLM real todavía no recibe automáticamente el resultado para producir un segundo turno.
- `LocalRuntimeAdapter` define la abstracción, pero solo Ollama está implementado como backend local operativo.
- `routeByCapability` selecciona por capacidades, pero el router principal todavía no lo usa para todas las tareas.
- `AgentAuditLog` redacta y conserva auditoría en memoria del renderer; todavía no hay almacenamiento durable en main.
- `EvolutionStore` serializa propuestas; todavía no hay persistencia/UI para revisarlas.
- El catálogo admite verificación callback; todavía no hay firma criptográfica configurada en producción.

### No implementado

- Runtime portable llama.cpp descargable y gestionado por la aplicación.
- Descarga, pausa, reanudación y borrado de modelos desde herramientas del agente.
- Segundo turno real del LLM después de una herramienta.
- Rollback completo de runtime/modelos y canales estable/beta.
- UI de memoria, propuestas evolutivas y auditoría.
- Eliminación completa de exposición de secretos al renderer.
- Límites de disco/RAM/VRAM/coste cloud integrados en todas las operaciones.

## Inventario de cambios y cómo se hicieron

### Estabilidad y contratos

- Se alineó `CharacterProfile.relationshipHistory.at` con el esquema Zod usando `number`.
- Se unificó el contrato `KawaiiAPI` para que renderer y preload compartan la interfaz real.
- Se corrigieron campos de progreso y estado de Forge/SD.
- Se corrigieron referencias antiguas de perfiles (`dataRoot`, `sdWorkRoot`) y el nombre de resolución de Ollama.
- Se eliminaron imports, variables y helpers muertos.
- Se sustituyó la reasignación ilegal de `userContent` por una variable mutable explícita.
- Se corrigieron los tests del resumen y del retry de contexto.

Archivos principales: `src/preload/index.ts`, `src/renderer/src/env.d.ts`, `src/main/index.ts`, `src/main/forge-runtime.ts`, `src/main/machine-profile.ts`, `src/renderer/src/features/chat/hooks/useChat.ts`.

### Contexto de modelos locales

La política anterior descartaba pronto los turnos antiguos. Se cambió `packContext` para conservar el transcript completo mientras quepa en el presupuesto. El resumen es aditivo cuando existe y el recorte ocurre solo cuando el payload supera el presupuesto o el proveedor devuelve `CONTEXT_OVERFLOW`. El retry reduce el presupuesto progresivamente.

Archivos: `src/core/conversation/context-window.ts`, `src/core/conversation/context-router.ts`, `src/renderer/src/features/chat/services/chatOrchestrator.ts`.

### Registro y actualización de modelos

`ModelRegistry` valida catálogo y descriptors con Zod. Conoce runtime, versión, capacidades, licencia, requisitos, URL, hash opcional e instalación. Rechaza seleccionar modelos desconocidos o sin la capacidad solicitada.

`syncModelCatalog` carga catálogo remoto con timeout y usa caché o catálogo embebido si hay error. `model-catalog-runtime.ts` lo conecta al arranque Electron y guarda en `userData`. La descarga de pesos grandes permanece separada y requiere aprobación.

Archivos: `src/core/models/registry.ts`, `src/core/models/catalog-sync.ts`, `src/main/model-catalog-runtime.ts`, `src/core/models/*test.ts`.

### Agente y herramientas

`AgentRuntime` registra herramientas con esquema Zod y riesgo: `read`, `reversible`, `resource`, `destructive`. Aplica máximo de pasos, timeout, cancelación y aprobador.

`appAgent.ts` mantiene compatibilidad con `APP_ACTION`, pero ejecuta acciones a través de `AgentRuntime`, elimina duplicados y registra resultados. Las acciones de iniciar Ollama/Forge solicitan aprobación usando Zustand y `AgentApprovalBanner`, no `window.confirm`.

Se añadieron herramientas de modelos: listar, recomendar, comprobar runtime y activar modelo validado.

Archivos: `src/core/agent/runtime.ts`, `src/core/agent/loop.ts`, `src/core/agent/audit.ts`, `src/core/agent/types.ts`, `src/core/agent/parseActions.ts`, `src/renderer/src/features/chat/services/appAgent.ts`, `src/renderer/src/shared/lib/stores/agentApprovalStore.ts`, `src/renderer/src/shared/ui/AgentApprovalBanner.tsx`.

### Runtime y routing

`LocalRuntimeAdapter` establece el contrato común para Ollama, llama.cpp y OpenAI-compatible. `routeByCapability` usa `ModelRegistry` para escoger modelos por tarea y RAM disponible, y devuelve una razón legible.

Archivos: `src/core/providers/runtime.ts`, `src/core/routing/capability.ts`.

### Evolución controlada

`EvolutionStore` conserva propuestas con evidencia y estados `pending`, `approved`, `rejected`, `applied`. Incluye serialización y restauración validada. No ejecuta cambios automáticamente.

Archivos: `src/core/agent/evolution.ts`.

## Hallazgos importantes

1. La app ya tenía muchas capacidades de producto, pero el harness solo controlaba configuración; faltaba conectar modelo, permisos y resultados.
2. El contrato preload/renderer duplicado causaba una cascada de errores falsos y ocultaba errores reales.
3. El contexto local se compactaba demasiado pronto. Ahora el modelo conserva historial siempre que el presupuesto lo permita.
4. La salida textual del modelo no es un sustituto completo de function calling: por eso se añadieron límites, esquemas, deduplicación y auditoría.
5. El catálogo remoto sin verificación criptográfica no debe considerarse una cadena de confianza completa.
6. Build correcto no implica typecheck correcto; ambos comandos deben ejecutarse.
7. Las API keys todavía tienen superficie de exposición en preload/renderer y necesitan migración a ejecución main.
8. `npm install` reporta 14 vulnerabilidades: 13 high y 1 critical. No ejecutar `npm audit fix --force` sin revisar el diff.

## Validación comprobada en 0.8.20

- `npm run typecheck`: correcto.
- `npm test`: 53 tests correctos.
- `npm run verify`: correcto, 127 archivos y 0 warnings.
- `npm run build`: correcto.
- `git diff --check`: correcto.

Los tests nuevos cubren runtime/política, aprobación, bucle multi-turno, auditoría, catálogo, routing por capacidad y sincronización remota.

## Pendientes priorizados

### Prioridad 0: cerrar el agente real

1. Integrar `runAgentLoop` en `useChat`/`chatOrchestrator`.
2. Enviar al modelo una observación estructurada con cada resultado de herramienta.
3. Permitir que el modelo termine, continúe o corrija hasta un presupuesto total.
4. Asociar cada ejecución a `conversationId` para idempotencia y cancelación.

### Prioridad 1: herramientas de modelos reales

1. Exponer estado del `ModelRegistry` al snapshot del agente y al renderer.
2. Implementar handlers main para listar modelos instalados y comprobar hardware/espacio.
3. Reutilizar `resumableDownload` para descargar modelos con checksum SHA-256.
4. Añadir pausa, reanudación, cancelación y borrado con aprobación.
5. Auditar cada operación en main, sin guardar secretos.

### Prioridad 2: independencia de Ollama

1. Implementar un adaptador portable llama.cpp/OpenAI-compatible.
2. Gestionar descarga y versión del runtime desde el catálogo.
3. Seleccionar runtime/modelo con `LocalRuntimeAdapter` y routing por capacidades.
4. Probar instalación limpia sin Ollama.

### Prioridad 3: confianza y evolución

1. Firmar catálogo con mecanismo verificable y documentar claves públicas.
2. Persistir auditoría y propuestas en main/userData.
3. Añadir UI para revisar, aprobar, rechazar, editar y borrar propuestas/memoria.
4. Medir éxito por modelo/tarea sin enviar datos privados.
5. Añadir rollback de modelos/runtime y recuperación tras interrupciones.

### Prioridad 4: seguridad y dependencias

1. Mover lectura de secretos fuera del renderer cuando sea posible.
2. Añadir allowlists de URLs, hosts, puertos y rutas.
3. Aplicar límites de disco, RAM/VRAM, concurrencia y coste.
4. Revisar las 14 vulnerabilidades de npm una por una.
5. Añadir pruebas de prompt injection, URLs maliciosas, acciones duplicadas y cancelación.

## Orden de continuación recomendado

1. Leer este documento y ejecutar `npm run typecheck`, `npm test`, `npm run verify`, `npm run build`.
2. Implementar segundo turno real del agente, sin añadir todavía descargas grandes.
3. Mover auditoría al main y añadir IPC mínimo saneado.
4. Implementar herramientas de modelos instalados y runtime.
5. Implementar runtime portable.
6. Firmar catálogo y añadir rollback.
7. Crear UI de memoria/propuestas/auditoría.
8. Revisar dependencias y endurecer límites.

No borrar cambios locales existentes ni ejecutar `npm audit fix --force` sin revisión. No descargar modelos grandes durante tests. Mantener `npm run typecheck` y `npm run verify` obligatorios en cada fase.
