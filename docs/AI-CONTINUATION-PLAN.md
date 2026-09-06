# KawaiiGPT Robust: plan de continuidad e implementación

## Propósito

KawaiiGPT Robust debe evolucionar desde un chat híbrido local/cloud hacia una aplicación inteligente independiente del runtime Ollama, capaz de observar su estado, elegir recursos, ejecutar herramientas con permisos, recuperarse de errores y mejorar su comportamiento de forma controlada.

Este documento es el contexto operativo para otra IA o desarrollador que continúe el proyecto. Describe el estado encontrado, las decisiones de arquitectura, el orden de implementación y los criterios de aceptación. No debe interpretarse como permiso para ejecutar acciones destructivas o descargar modelos grandes sin confirmación.

## Estado inicial verificado

- Aplicación Electron + React + TypeScript + Vite.
- Routing local/cloud con failover, memoria de usuario, resumen de contexto, búsqueda web y generación de imágenes.
- Ollama es actualmente el runtime local principal.
- Forge/A1111 se gestiona como pipeline de imágenes.
- Existe un harness v1 en `src/core/agent` y `src/renderer/src/features/chat/services/appAgent.ts`.
- El agente actual usa bloques textuales `<<<APP_ACTION>>>...<<<END_APP_ACTION>>>`.
- Herramientas existentes: estado, modo de proveedor, modelo local, imágenes, UI, Forge, Ollama y diagnóstico.
- Existe `AgentRuntime` con límites, validación, permisos y `runAgentLoop`; falta conectarlo al segundo turno real del LLM.
- Existe auditoría saneada en memoria y aprobación no modal; falta persistencia durable en main.
- El catálogo de modelos es estático y está centrado en Ollama/descargas de imágenes.
- Al comenzar había fallos de typecheck, contratos duplicados y dos tests de resumen; fueron corregidos.

## Diez pasos comprometidos

### 1. Base estable

Corregir los errores existentes de TypeScript, contratos preload/renderer, `relationshipHistory`, imports sin uso, la reasignación ilegal de `userContent` y los tests del resumen. El build no se considera válido si `typecheck` falla.

### 2. Registro de modelos

Crear un `ModelRegistry` local con modelos, runtimes, capacidades, requisitos de hardware, tamaño, licencia, versión, URL y hash. Debe poder cargar un catálogo remoto compatible, pero funcionar offline con el catálogo embebido.

### 3. Actualización de catálogo al inicio

Comprobar el catálogo al arrancar con timeout corto, conservar la última copia válida y no bloquear el chat. Verificar forma, versión y hashes del catálogo. Las descargas grandes serán explícitas y reanudables.

### 4. Runtime local desacoplado

Introducir una interfaz de runtime local. Mantener Ollama como adaptador existente y preparar un adaptador portable OpenAI-compatible/llama.cpp sin acoplar el router a Ollama. La instalación del runtime debe ser opt-in y visible.

### 5. Herramientas de modelos

Añadir herramientas validadas para listar modelos, recomendar modelo, comprobar runtime, descargar, pausar, cancelar, seleccionar y eliminar modelos. Ninguna herramienta debe aceptar rutas o modelos arbitrarios sin validación.

### 6. Agente multi-paso controlado

Crear un `AgentRuntime` con máximo de pasos, timeout, cancelación, deduplicación, resultados estructurados y verificación posterior. El resultado de cada herramienta vuelve al modelo solo cuando el presupuesto lo permite.

### 7. Permisos y auditoría

Clasificar herramientas como lectura, cambio reversible, consumo de recursos o destructivas. Las categorías sensibles requieren confirmación UI. Registrar acción, argumentos saneados, resultado, duración y origen, sin guardar secretos.

### 8. Selección por tarea

Ampliar el router con capacidades de modelos: chat, código, visión, herramientas, resumen y generación. Preferir local cuando sea suficiente, cloud como fallback y pedir consentimiento cuando cambie coste, modelo o runtime.

### 9. Evolución controlada

Separar memoria de conversación, preferencias explícitas, hechos aprobados, habilidades verificadas y propuestas de mejora. La app puede proponer cambios y medir resultados, pero no modificar su código ni sus pesos automáticamente.

### 10. Verificación y documentación

Añadir tests de contratos, permisos, cancelación, catálogo, recuperación y agente. Actualizar README, changelog, documentación del harness, versión y este documento con lo realmente implementado y las limitaciones restantes.

## Arquitectura objetivo

```text
Chat UI
  -> ChatOrchestrator
      -> Task Router
          -> ModelRegistry
              -> OllamaAdapter (opcional)
              -> PortableRuntimeAdapter (opcional)
              -> OpenAICompatibleAdapter
              -> CloudAdapter
      -> AgentRuntime
          -> Policy / permissions
          -> Tool registry
          -> Tool executor (main process)
          -> Audit log
      -> MemoryStore
          -> session memory
          -> user facts
          -> verified skills
          -> improvement proposals
```

## Principios de seguridad

- El modelo nunca ejecuta código arbitrario ni inventa nombres de herramientas.
- Todas las herramientas tienen esquema de entrada y salida.
- No se exponen API keys al renderer si una operación puede resolverse en el proceso main.
- Las descargas muestran tamaño, origen, licencia y checksum.
- El catálogo remoto no reemplaza una copia válida sin validación.
- Instalar runtime, descargar varios GB, borrar modelos, modificar claves o iniciar servicios requiere confirmación.
- Hay límites de pasos, tiempo, disco, memoria y coste.
- La memoria evolutiva no ejecuta cambios de código ni entrenamiento no aprobado.

## Criterios de aceptación globales

- `npm run typecheck` termina con código 0.
- `npm test` termina sin fallos.
- `npm run verify` termina sin warnings.
- `npm run build` termina correctamente.
- La aplicación puede iniciar sin Ollama instalado y muestra el estado de runtime disponible.
- El catálogo offline sigue funcionando sin red.
- Un modelo no existente no puede seleccionarse por acción del agente.
- Una descarga o borrado sensible puede cancelarse y queda auditado.
- El usuario puede revisar y borrar memoria, propuestas y auditoría.
- La documentación coincide con el código y la versión publicada.

## Estado de esta implementación

Este archivo se crea antes de los cambios de código. Las secciones siguientes deben actualizarse al finalizar cada fase:

- Paso 1: completado; contratos, resumen, mutabilidad y typecheck corregidos.
- Paso 2: base completada en `src/core/models/registry.ts`.
- Paso 3: completado en `src/core/models/catalog-sync.ts` y `src/main/model-catalog-runtime.ts`; se refresca en segundo plano al arrancar con caché y fallback.
- Paso 4: contrato `LocalRuntimeAdapter` completado; Ollama sigue siendo el adaptador local real y llama.cpp queda pendiente.
- Paso 5: herramientas de listar/recomendar/comprobar/activar modelos conectadas; descargas y borrado desde agente pendientes.
- Paso 6: bucle multi-turno reusable completado; falta conectarlo a un segundo turno real del LLM.
- Paso 7: política, confirmación no modal y auditoría saneada completadas; persistencia main de auditoría pendiente.
- Paso 8: routing por capacidades completado como módulo reusable; falta incorporarlo plenamente al router principal.
- Paso 9: propuestas evolucionables con serialización validada completadas; falta persistencia y UI de revisión.
- Paso 10: documentación, tests y versión 0.8.20 completados.

## Validación de esta fase

- `npm test`: 53/53 tests pasan.
- `npm run verify`: correcto, 127 archivos y 0 warnings.
- `npm run build`: correcto.
- `git diff --check`: correcto.
- `npm run typecheck`: correcto en main, preload, core y renderer.

## Archivos nuevos relevantes

- `src/core/agent/runtime.ts` y `runtime.test.ts`: ejecución multi-paso acotada y política de riesgos.
- `src/core/agent/evolution.ts`: propuestas de mejora revisables.
- `src/core/models/registry.ts` y `registry.test.ts`: registro de modelos offline-first.
- `src/core/models/catalog-sync.ts` y `catalog-sync.test.ts`: sincronización remota con fallback.
- `src/renderer/src/features/chat/services/appAgent.ts`: acciones existentes ejecutadas a través de `AgentRuntime`, con máximo de 4 acciones, timeout y deduplicación.
- Contexto local: `packContext` conserva el transcript completo si cabe; el resumen/recorte se activa solo al superar el presupuesto o tras `CONTEXT_OVERFLOW`.
- Permisos: `AgentRuntime` admite aprobador; `appAgent` solicita confirmación para `start_forge` y `start_ollama`, mientras lecturas y cambios reversibles siguen automáticos.
- Multi-turno: `runAgentLoop` devuelve observaciones de herramientas al driver con límite de turnos y cancelación.
- Auditoría: `AgentAuditLog` conserva hasta 500 entradas y redacciona claves/tokens antes de exportar.
- Modelos: `list_models`, `recommend_model`, `check_local_runtime` y `set_active_model` validan contra `ModelRegistry`.
- Runtime: `LocalRuntimeAdapter` desacopla el contrato de chat del backend concreto.
- Routing: `routeByCapability` justifica la elección por tarea y hardware.
- `docs/PROJECT-STATE-0.8.20.md`: inventario completo, método de implementación, hallazgos, validación y pendientes.
- Validación 0.8.20: `npm run typecheck`, `npm test` (53/53), `npm run verify` (127 archivos) y `npm run build` correctos.
- Segundo micro-turno LLM tras herramientas: integrado en useChat (0.8.21).
- Pendiente de integración profunda restante: runtime llama.cpp portable, descargas/borrado de modelos desde agente, auditoría persistida en main y UI de propuestas evolutivas.

## Roadmap de la siguiente fase completa

### Fase A: agente verificable

1. Devolver cada `AgentStepRecord` al modelo en un segundo micro-turno.
2. Permitir que el modelo observe el resultado y continúe, corrija o finalice.
3. Añadir idempotencia por acción y una clave de ejecución por conversación.
4. Persistir una auditoría sin secretos: herramienta, riesgo, resultado, duración y usuario/aprobación.
5. Añadir cancelación del plan desde el chat y límite de tiempo total.

**Aceptación:** una petición como «prepara el entorno local» puede ejecutar varios pasos, ver resultados reales y detenerse cuando el objetivo esté cumplido, sin superar el presupuesto configurado.

### Fase B: herramientas de modelos

1. Exponer `list_installed_models`, `recommend_model`, `check_runtime` y `set_active_model`.
2. Conectar `ModelRegistry` al estado vivo del catálogo y hardware.
3. Validar que el modelo solicitado existe, es compatible y está instalado antes de seleccionarlo.
4. Añadir `download_model`, `pause_download`, `resume_download`, `cancel_download` y `delete_model`.
5. Mostrar tamaño, licencia, origen, checksum, RAM/VRAM requerida y espacio disponible.

**Aceptación:** el chat puede recomendar un modelo y preparar una descarga, pero nunca descarga o borra varios GB sin aprobación visible.

### Fase C: runtime local independiente

1. Definir `LocalRuntimeAdapter` con `health`, `listModels`, `chat`, `chatStream`, `pull` y `stop`.
2. Mantener Ollama como adaptador opcional.
3. Integrar un runtime portable compatible con OpenAI API, preferiblemente basado en llama.cpp.
4. Descargar el runtime por manifiesto versionado y verificar SHA-256.
5. Elegir runtime/modelo por capacidad, hardware y disponibilidad, sin acoplar el router a Ollama.

**Aceptación:** la aplicación puede conversar localmente en una instalación limpia sin Ollama previamente instalado, después de una instalación guiada y aprobada.

### Fase D: catálogo y actualización segura

1. Firmar el catálogo remoto y verificar firma antes de aceptarlo.
2. Separar actualización de metadatos de descarga de pesos grandes.
3. Ejecutar la comprobación al inicio sin bloquear la ventana.
4. Reanudar descargas, verificar hash y conservar la versión anterior si falla.
5. Añadir rollback de runtime/modelo y canal estable/beta.

**Aceptación:** una caída de red, catálogo inválido o hash incorrecto no deja la aplicación inutilizable ni reemplaza una instalación sana.

### Fase E: routing por capacidades

1. Clasificar tareas en chat, código, visión, herramientas, resumen e imagen.
2. Asociar cada tarea con capacidades del `ModelRegistry`.
3. Elegir modelo local/cloud según calidad, privacidad, latencia, coste y hardware.
4. Registrar métricas anónimas locales de éxito, latencia y errores por modelo.
5. Permitir que el usuario fije preferencias y prohíba proveedores/modelos.

**Aceptación:** el router explica por qué eligió un modelo y respeta la política de privacidad y coste configurada.

### Fase F: memoria y evolución controlada

1. Separar memoria de sesión, preferencias, hechos aprobados, habilidades y propuestas.
2. Añadir UI para revisar, editar y borrar cada memoria.
3. Crear propuestas de mejora con evidencia y estado pendiente/aprobada/rechazada/aplicada.
4. Medir si una propuesta mejora la tasa de éxito antes de recomendarla de nuevo.
5. Prohibir auto-modificación de código, binarios y pesos sin flujo de actualización firmado y aprobado.

**Aceptación:** la app aprende preferencias y procedimientos verificables, pero no cambia su propia conducta crítica sin revisión.

### Fase G: privacidad, seguridad y recuperación

1. Mantener secretos en main y evitar exponer claves al renderer.
2. Aplicar allowlists a URLs, hosts locales, puertos y rutas de archivos.
3. Limitar disco, RAM/VRAM, red, concurrencia y coste cloud.
4. Añadir exportación/borrado de memoria y auditoría.
5. Probar reinicio durante descarga, instalación, acción del agente y actualización.

**Aceptación:** cada operación sensible es explicable, cancelable, recuperable y auditable.

### Orden recomendado de ejecución

1. Fase A, porque convierte el agente actual en un bucle observable y comprobable.
2. Fase B, porque aporta control real sobre modelos desde el chat.
3. Fase C, porque elimina la dependencia estructural de Ollama.
4. Fase D, porque permite evolución de modelos sin romper instalaciones.
5. Fase E, porque mejora la inteligencia práctica del routing.
6. Fase F, porque añade aprendizaje controlado.
7. Fase G, porque endurece la distribución y el uso diario.

La siguiente IA debe comenzar por los errores restantes de `npm run typecheck`, después exponer el estado del catálogo al renderer y finalmente sustituir el parser textual del agente por un adaptador que use `AgentRuntime` y confirmaciones UI.

## Continuación recomendada

Leer primero este documento, `docs/AGENT-HARNESS.md`, `src/core/agent`, `src/core/models`, `src/main/index.ts` y los tests existentes. Ejecutar primero `npm run typecheck`, `npm test`, `npm run verify` y `npm run build`. No borrar cambios locales del usuario y no introducir descargas grandes durante tests.
