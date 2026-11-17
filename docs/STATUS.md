# Estado del proyecto

| Campo | Valor |
|-------|--------|
| Versión | **0.12.0-beta** |
| Revisión | **rev.iu** |
| Un residente LLM | **rev.gj + rev.gk** (sin reload por Auto suave) |

Última actualización docs: **rev.iu**.

## Rev.iu — Rendimiento de interacción

- La barra lateral observa solo los metadatos visibles de conversaciones; streaming y cambios de mensajes ya no reconstruyen la lista.
- El borrador de chat no vuelve a escanear estados de lectura documental en cada pulsación.
- Inputs de texto de ajustes agrupan confirmaciones y las vacían al salir del panel; la persistencia evita escrituras de identidad/visual y snapshots rotativos cuando no cambiaron sus datos.
- Chat, entrada y sidebar ignoran renders causados solo por renderizado del padre, manteniendo las suscripciones funcionales propias.

## Rev.it — Visibilidad del panel de plugins

- El contenedor emergente de plugins tiene prioridad de apilamiento sobre la lista de mensajes para que la conversación no lo tape al abrirlo.

## Rev.il — Iniciativas y diagnóstico de runtimes

- Las iniciativas pueden empezar una conversación útil aunque no exista una meta pendiente persistida; las decisiones siguen a cargo del LLM y el texto no usa fallback prefabricado.
- La iniciativa selecciona un solo protocolo/runtime. LM Studio usa `localOpenAIBaseUrl`; Ollama usa `localBaseUrl`; ya no hay reintentos enviando el protocolo del otro proveedor. Los mensajes también limpian surrogate UTF-16 incompletos antes de serializar.
- La app escribe `userData/diagnostics/local-runtime.jsonl` con motivos de programación/bloqueo y metadatos de solicitudes locales. Se excluye el contenido de mensajes/prompts y el log rota a 512 KB.

## Rev.ik — Iniciativas independientes

- El timer de iniciativas y la evaluación LLM ya no dependen de que la memoria del usuario conserve metas o enfoque; el modelo recibe el contexto reciente para decidir si existe un seguimiento natural.
- Cambiar modelo, runtime o endpoints locales reprograma la evaluación.
- Un error inesperado ya no deja el ciclo sin timer: se registra y se intenta programar de nuevo.

## Rev.ij — Memoria contextual

- La recuperación de memoria queda acotada al tema de la consulta; los saludos no reciben inventarios ni anclas irrelevantes.
- La revisión LLM del recuerdo del usuario se ejecuta solo ante señales explícitas y usa el runtime local; aplica solo datos fundamentados en el mensaje y descarta resultados si la memoria cambió mientras tanto.
- Los estados emocionales pasajeros permanecen en la memoria temporal con vencimiento, no como hechos biográficos permanentes.
