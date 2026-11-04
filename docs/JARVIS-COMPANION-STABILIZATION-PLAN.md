# Plan de estabilización: asistente de escritorio + companion

**Propósito:** convertir la beta actual en una aplicación confiable para uso diario antes de ampliar su autonomía. Este plan se puede entregar a otra IA, incluso si no puede abrir el repositorio: define el orden de trabajo, los límites de seguridad, comandos, pruebas, criterios de aceptación y el formato de evidencia que debe devolver.

**Fecha de referencia:** 2026-10-30  
**Revisión inspeccionada:** `1d04437` (`v0.12.0-beta rev.fn`)  
**Alcance:** seguridad de archivos, fiabilidad de build/tests, agencia y agenda, memoria/companion, identidad visual y coherencia documental. No autoriza shell libre, acceso general al SO, cambios autónomos de código ni llamadas externas con datos privados.

## 1. Resumen ejecutivo

La prioridad no es añadir capacidades: es hacer verificables y seguras las que ya existen.

| Prioridad | Resultado requerido | Por qué va aquí |
|---|---|---|
| **P0 — seguridad** | Todas las operaciones de archivos aplican la misma frontera real de permisos en el proceso principal. | Una frontera de rutas débil puede exponer o modificar archivos fuera del espacio consentido. |
| **P1 — calidad de ingeniería** | Build, typecheck y suites relevantes tienen un baseline reproducible y fallos clasificados; no se ocultan errores existentes. | En el corte inspeccionado el build pasó, pero typecheck y pruebas tenían fallos significativos. |
| **P1 — flujos completos** | E2E cubre acciones aprobadas, persistencia de memoria, agenda/tray y errores; la aprobación representa la acción exacta. | El smoke actual solo comprueba carga básica de la interfaz. |
| **P2 — companion fiable** | Memoria propia y del usuario se mantienen separadas, se corrigen/olvidan y sobreviven al reinicio; respuestas no se cortan ni repiten. | Es la promesa central de companion, pero aún no está demostrada de extremo a extremo. |
| **P2 — agenda durable** | El comportamiento de recordatorios está definido para ventana oculta, app en bandeja, salida explícita y reinicio del proceso. | El scheduler observado mantiene el snapshot en memoria del proceso. |
| **P2 — identidad visual** | Un protocolo repetible evalúa que cara y cuerpo se mantengan al variar ropa, pose y escena. | Que la imagen se genere no demuestra consistencia de identidad. |
| **P3 — coherencia documental/release** | Los estados de capacidad y las instrucciones de pruebas concuerdan con la versión realmente probada. | Hay documentos antiguos que contradicen el changelog y el código más reciente. |

**Regla de avance:** no abrir el siguiente bloque si falla un criterio de salida del bloque anterior. Una excepción requiere una decisión explícita, riesgo documentado y mitigación; no se debe declarar el hito “hecho” por pasar solo el build.

## 2. Baseline observado; no confundirlo con una garantía actual

En la revisión de `1d04437`:

- `npm run build`: terminó correctamente.
- `npm run typecheck`: falló; el reporte resumido registró **370 líneas de diagnósticos TypeScript** en los dos proyectos de `tsc`. Primero se debe guardar el output completo y contar diagnósticos únicos, porque varias líneas pueden pertenecer a un mismo error.
- `npm run test -- src/core/agent src/core/agenda src/core/conversation src/core/chat`: **22 pruebas fallidas, 195 aprobadas; 18 archivos de prueba fallaron y 37 pasaron (55 en total)**. Hay fallos en memoria, contexto, iniciativa y lectura de documentos. No todos deben asumirse regresiones: clasificar cada uno contra el contrato actual.
- `tests/e2e/smoke.spec.ts`: únicamente verifica que cargue el body, aparezca el input o wizard y no haya banner fatal; necesita una app accesible y `KAWAII_E2E=1`.
- `src/main/agenda-scheduler.ts`: el snapshot y el conjunto de entregas están en memoria del proceso.
- `src/main/ipc/files-ipc.ts`: `files:describePath` y `files:classifyPath` leen cualquier ruta existente; su comprobación de ruta no rechaza efectivamente el exterior. `resolveUnderUserData`, usado por mutaciones, compara prefijos de ruta sin delimitar el directorio y no resuelve enlaces simbólicos. El canal de mutación recibe `confirm` del renderer; el proceso principal debe ser la autoridad de la autorización.
- El changelog en la raíz describe capacidades de agente y archivos como incorporadas hasta `rev.fn`, mientras `docs/MISSION.md` aún las llama planificadas, y `docs/COMPANION-EVOLUTION.md` conserva una versión y estados de memoria anteriores. `docs/ROADMAP.md` también mezcla checks de implementado con validaciones manuales pendientes.

Este baseline es una observación histórica del corte indicado, no una afirmación de que la rama actual conserve exactamente los mismos resultados. El primer bloque debe repetir las verificaciones y registrar revisión, fecha, entorno y logs.

## 3. Protocolo para cualquier IA que continúe el trabajo

Antes de editar:

1. Identifica la revisión/branch y cambios locales. Nunca sobrescribas cambios ajenos.
2. Lee el código y los tests del bloque asignado; los nombres de archivos de este plan son puntos de entrada, no prueba de que la implementación siga igual.
3. Ejecuta los comandos de baseline y conserva resultados completos. Si no tiene acceso al proyecto, **no inventes resultados ni afirmes cambios implementados**: devuelve el checklist exacto que una persona debe ejecutar y solicita los artefactos requeridos.
4. Formula una hipótesis comprobable para cada fallo. Diferencia regresión, test obsoleto, entorno/configuración y defecto de producción.
5. Implementa un bloque pequeño y coherente, con pruebas que fallen antes del cambio y pasen después. No mezcles seguridad, prompts, persistencia y UI en un parche amplio.
6. Ejecuta las pruebas dirigidas y la verificación de salida del bloque. Después, corre la regresión ampliada que indique este plan.
7. No relajes una aserción solo para poner verde la suite. Si un test es obsoleto, actualiza el contrato y documenta por qué.
8. No uses servicios externos con conversaciones, recuerdos, rutas o imágenes privadas sin autorización específica. Usa fixtures sintéticos o locales para automatización.

### Comandos de referencia

Desde la raíz del proyecto:

```text
npm run build
npm run typecheck
npm run test
npm run test -- src/core/agent src/core/agenda src/core/conversation src/core/chat
npm run test:e2e
```

En PowerShell, habilitar el smoke que usa URL en vivo:

```powershell
$env:KAWAII_E2E = '1'
$env:KAWAII_E2E_URL = 'http://localhost:5173'
npm run test:e2e -- tests/e2e/smoke.spec.ts
```

El comando E2E requiere que la aplicación/Vite esté arrancada y accesible; un test omitido por variable ausente no cuenta como aprobado.

### Evidencia que debe devolver cada IA

Cada entrega debe incluir:

- revisión inicial y final, sistema operativo, versión de Node/npm y si el árbol estaba limpio;
- archivos modificados y razón de cada cambio;
- comandos completos ejecutados y código de salida;
- conteo de pruebas aprobadas/fallidas/omitidas y lista de fallos que permanecen;
- diagnósticos TypeScript únicos antes/después, agrupados por archivo/categoría;
- pruebas manuales realizadas, pasos, resultado observado y cualquier limitación;
- riesgos residuales y evidencia pendiente;
- declaración explícita de si se alteró algún contrato, permiso o comportamiento visible.

No usar “todo correcto” si faltó una suite, un test quedó omitido o el flujo manual no se pudo ejecutar.

## 4. Bloques de trabajo y criterios de salida

### G0 — Congelar y reproducir baseline

**Objetivo:** saber qué está roto antes de cambiarlo.

**Trabajo**

- Confirmar revisión, árbol local y configuración de Node/npm.
- Ejecutar build, typecheck y los selectores de agente/agenda/conversación/chat.
- Guardar logs completos con timestamp, código de salida y conteos.
- Para cada fallo, registrar archivo, test, expectativa, valor obtenido, contrato vigente y clasificación: producción, prueba obsoleta, entorno o indeterminado.
- Agrupar los diagnósticos TypeScript por error raíz; no arreglar errores ajenos para mejorar el conteo.

**Automático**

- Repetir los comandos de baseline dos veces cuando el fallo parezca intermitente.
- Ejecutar los tests fallidos individualmente para confirmar reproducibilidad.

**Manual**

- Ninguno; es un bloque de diagnóstico y no justifica cambios funcionales.

**Salida obligatoria**

- Baseline versionado como artefacto de CI o adjunto a la tarea.
- Tabla de fallos que permita a otra persona reconstruir la clasificación.
- No declarar regresión sin comparar el contrato y la ruta real de ejecución.

### G1 — P0: cerrar la frontera de archivos en el proceso principal

**Puntos de entrada a reexaminar:** `src/main/ipc/files-ipc.ts`; IPC/preload relacionados; `src/renderer/src/features/chat/services/hostTools/executeAppTool.ts`; `src/renderer/src/features/chat/services/appAgent.ts`.

**Objetivo de seguridad**

- Definir una política explícita y única de directorios permitidos por operación. No asumir que todos los archivos de la app o toda `userData` son automáticamente seguros.
- En el proceso principal, validar de forma centralizada **lectura, descripción, clasificación, copia, movimiento, renombrado y papelera**, tanto origen como destino.
- Comparar rutas canónicas con delimitación de directorio; `C:\...\userData-extra` no pertenece a `C:\...\userData`.
- Resolver enlaces simbólicos/junctions y validar el destino real; rechazar escapes por symlink, rutas relativas, traversal, UNC/raíces del sistema y rutas malformadas salvo que exista una excepción deliberada, mínima y probada.
- Validar que la invocación IPC proviene de la ventana/frame de la app esperado y que la autorización no dependa de un booleano `confirm` arbitrariamente enviado por el renderer.
- La aprobación de UI debe mostrar operación, origen, destino y efecto exactos; estar ligada a esa operación y expirar. Un cambio en parámetros requiere nueva aprobación.
- El proceso principal vuelve a validar permisos en el momento de ejecutar. Registrar éxito y rechazo de manera útil; los fallos de auditoría no deben convertirse silenciosamente en “operación segura”.
- Preservar el principio de mínimo privilegio y no añadir shell libre.

**Pruebas automáticas obligatorias**

- Unit tests del helper canónico: dentro del directorio permitido; hermano con prefijo parecido; `..`; separadores `/` y `\`; mayúsculas/minúsculas según Windows; ruta relativa; inexistente; destino fuera; symlink/junction que sale de la raíz.
- IPC tests para los canales de descripción, clasificación y mutación: una ruta externa siempre se deniega sin leer/alterar el fixture; `dryRun` no muta; sin aprobación válida no hay mutación; autorización para A no autoriza B.
- Pruebas de copia/move/rename/trash verifican fuente, destino, rechazo y audit log; incluir fallos de filesystem/audit con resultado explícito.
- Tests de regresión para rutas legítimas de `userData` realmente usadas por biblioteca, wardrobe y adjuntos.
- No probar con rutas reales del usuario; usar directorios temporales aislados y limpiar solo esos fixtures.

**Pruebas manuales**

- Desde la UI, describir y clasificar archivo permitido; comprobar que se muestra un error claro al seleccionar fuera de las áreas permitidas.
- Aprobar una operación de movimiento y confirmar en disco el destino exacto; rechazar otra y confirmar que no hubo cambio.
- Modificar el destino después de abrir la confirmación y verificar que se exige nueva aprobación.
- Reiniciar la aplicación y comprobar que el registro de auditoría no contiene secretos ni texto privado innecesario.

**Gate P0:** ningún handler permite leer o mutar una ruta no permitida; todas las pruebas de traversal, prefijo parecido y symlink/junction pasan en Windows. Si los tests de symlink/junction no se pueden ejecutar en el entorno CI, el gate queda pendiente hasta una ejecución Windows real. No avanzar a más autonomía de host mientras esté abierto.

### G2 — P1: reparar tests y calidad TypeScript sin esconder errores

**Objetivo:** suite entendible y typecheck estricto para código de producción.

**Trabajo**

- Resolver los 22 fallos observados por causa, no por archivo a ciegas. Priorizar contratos de contexto, memoria, iniciativa, lectura de documentos y deduplicación de respuestas.
- Añadir una prueba de regresión para cada defecto confirmado antes de corregirlo.
- Arreglar imports/tipos/código muerto que impida compilar. Un `@ts-expect-error` sin error asociado debe revisarse, no conservarse para silenciar.
- Mantener una puerta de typecheck que no excluya errores de producción. Si tests comparten tsconfig, separar configuración de producción y tests solo si resulta necesario y con cobertura explícita: la compilación de tests también debe tener un gate.
- No aceptar `|| true`, supresión amplia, casts inseguros ni desactivar reglas para obtener verde.

**Automático**

1. Repetir cada test fallido individualmente.
2. Suite enfocada: `npm run test -- src/core/agent src/core/agenda src/core/conversation src/core/chat`.
3. Suite completa: `npm run test`.
4. `npm run typecheck`, anotando errores únicos por proyecto.
5. `npm run build`.
6. Repetir el test de repetición/corte con respuestas de varias frases, incluyendo dos gustos distintos que comienzan igual y una respuesta que realmente excede `max_tokens`.

**Manual**

- Conversación corta (“hola”), pregunta por un gusto concreto y mensaje largo; comprobar una respuesta completa, sin apertura duplicada ni corte a mitad.
- Probar una pregunta sobre la persona asistente y otra sobre el usuario: no intercambiar sus recuerdos.
- Continuar lectura de documento por varios turnos y verificar avance real, sin repetir el mismo fragmento.

**Gate P1**

- Cero tests fallidos ni omitidos inadvertidamente en las suites que se presentan como completas.
- Build y typecheck de producción pasan.
- Cualquier fallo excluido tiene issue, dueño y motivo documentados; no se etiqueta la release como estable mientras haya defectos P0/P1 abiertos.
- Las pruebas completas se ejecutan en CI Windows, no solo en una máquina local.

### G3 — P1: E2E de seguridad, aprobación y flujos reales

**Puntos de entrada:** `tests/e2e/smoke.spec.ts`, fixtures Playwright, proceso principal/preload e interfaz de aprobación.

**Objetivo:** probar el producto como usuario y comprobar que los canales renderer → IPC → sistema de archivos se comportan igual que los tests unitarios.

**Automático**

- Extender el smoke más allá de “body visible”:
  - arranque hasta input o wizard;
  - enviar mensaje con proveedor simulado o determinista;
  - mostrar una acción de archivo con resumen de la operación;
  - aceptar y rechazar acciones y verificar resultado/no resultado;
  - error de proveedor visible, sin éxito falso ni bloqueo permanente;
  - ninguna excepción fatal renderer/main.
- Usar fixtures temporales y un proveedor falso; no depender de modelos, Forge, red ni credenciales para CI.
- Comprobar que los tests no se marcan verdes por `test.skip` debido a una variable ausente. Publicar explícitamente skipped como estado distinto.
- Adjuntar traces/screenshots solo cuando fallen; eliminar artefactos con datos privados antes de publicarlos.

**Manual (Windows, instalador y desarrollo)**

- Ejecutar los flujos principales desde build de desarrollo y build empaquetada.
- Reiniciar la app, abrir conversación y verificar que el canal de notificación navegue a la conversación correcta.
- Confirmar que la UI de permiso identifica qué archivo, destino y efecto se van a aplicar antes del clic.
- Comprobar que un rechazo/cancelación no deja spinner, acción pendiente ni mutación parcial.

**Gate:** E2E no depende de credenciales/red y cubre al menos una acción permitida, una denegada, una aprobada y un error realista.

### G4 — P2: memoria, identidad de companion y naturalidad

**Puntos de entrada:** `src/core/conversation/assistant-memory*.ts`, `selective-memory-context.ts`, colector/finalización de respuesta, stores, UI de memoria y rutas de persistencia del chat.

**Objetivo:** que la memoria sea verificable, editable, reversible y no mezcle al asistente con el usuario.

**Automático**

- Test unitario por cada clase de entrada:
  - gusto propio expreso del asistente;
  - hecho/preferencia del usuario;
  - frase hipotética, roleplay, cita o ficción que no debe guardarse como hecho;
  - dos gustos diferentes en una misma respuesta;
  - corrección, olvido, duplicado y conflicto de memoria;
  - salida vacía, truncada, abortada o solo de razonamiento.
- Test de integración: respuesta finalizada → extracción → reconciliación → persistencia → rehidratación tras reinicio → selección para contexto.
- Comprobar trazabilidad suficiente para explicar por qué se añadió/actualizó/omitió un recuerdo, evitando almacenar más conversación sensible de la necesaria.
- Test de presupuesto: anclas estables preservadas; recuerdos selectivos pertinentes; saludo casual no inyecta una ficha larga.
- Tests del pipeline de respuesta: no duplicar aperturas entre turnos, no truncar frases distintas, conservar respuesta parcial ante abort y distinguir `finishReason` de limpieza de texto.

**Manual**

1. Preguntar por un gusto propio del asistente y verificar el panel de memoria.
2. Reiniciar la app y verificar que el gusto continúa allí y aparece cuando la conversación lo hace pertinente.
3. Corregir ese gusto; comprobar que se actualiza sin duplicado.
4. Pedir olvidar el recuerdo; confirmar que desaparece de UI y del contexto de un turno posterior.
5. Declarar un gusto del usuario y confirmar que no se transforma en preferencia del asistente.
6. Hacer una charla casual y una tarea operativa: el companion mantiene calidez sin desplazar la respuesta útil ni mostrar datos internos.
7. Repetir con un modelo local pequeño y uno grande si ambos están disponibles; reportar proveedor, modelo, cuantización, hardware y parámetros relevantes.

**Gate:** los casos de persistencia/corrección/olvido pasan tras reinicio; cero contaminación cruzada en los casos de prueba; las respuestas naturales no se evalúan solo por un test de regex. La evaluación humana registra ejemplos y criterios antes de comparar versiones.

### G5 — P2: agenda y continuidad de escritorio

**Puntos de entrada:** `src/main/agenda-scheduler.ts`, IPC de agenda, store renderer, `useAgendaDue.ts`, tray y click de notificación.

**Decisión de producto requerida antes de implementar:** documentar claramente la diferencia entre cerrar/ocultar la ventana (la app sigue en bandeja) y elegir **Salir** (el proceso termina). Definir si los recordatorios deben sobrevivir al cierre explícito/reinicio. No anunciar recordatorios garantizados si no hay proceso o tarea persistente que los dispare.

**Automático**

- Unit tests de recurrencia, snooze, quiet hours, zona horaria, cambio de reloj, entrega única, edición y cancelación.
- Integration test: snapshot UI → proceso principal → vencimiento → notificación/evento → actualización persistida y rehidratada.
- Pruebas de duplicado después de reiniciar proceso y de no perder/duplicar un recordatorio al actualizar el snapshot.
- Si el alcance incluye recordatorios tras salir o reiniciar el equipo, probar el mecanismo elegido en Windows; de lo contrario, probar que al salir la UI explique que no se ejecutarán.

**Manual**

- Minimizar a bandeja, esperar recordatorio corto, abrir desde notificación y confirmar conversación correcta.
- Salir explícitamente, iniciar de nuevo y comprobar comportamiento documentado.
- Repetir tras editar, posponer y cancelar un recordatorio.

**Gate:** no hay promesa engañosa. Entrega exactamente una notificación en el escenario contratado, con evidencia de un test de reinicio de proceso.

### G6 — P2: consistencia de identidad en imágenes

**Puntos de entrada:** documentación de identidad existente, selector de modelos, composición de prompt/referencias, integración Forge/FaceID y archivos de resultados generados.

**Objetivo:** mejorar reproduciblemente la misma cara y cuerpo, permitiendo variar ropa, pose y escena. No prometer igualdad perfecta entre motores incompatibles ni afirmar “hiperrealismo” como garantía universal.

**Protocolo de evaluación**

- Preparar un conjunto de referencia autorizado y local, de una sola identidad de personaje; registrar resolución, vistas disponibles, modelo/LoRA/adapter, pipeline, seed, sampler, steps y configuración de FaceID/reference.
- Congelar prompts de evaluación que cambien una variable cada vez: escena, ropa, pose e iluminación. Incluir texto ambiguo y petición simple de “una foto tuya”.
- Mantener un baseline de la versión/pipeline anterior y guardar resultados en un directorio de evaluación privado, no en fixtures de CI.
- Generar como mínimo 12 prompts × 3 seeds por pipeline evaluado; separar evaluación facial de cuerpo y de calidad de escena.
- Hacer revisión ciega por dos evaluadores: “misma identidad”, “cara/cuerpo alterados”, “artefacto”, “sigue la petición”. Resolver desacuerdos registrándolos, no borrándolos.
- Si se usa un scorer automático de similitud, calibrarlo con pares positivos/negativos del mismo conjunto; no inventar un umbral universal ni usar el score como única aceptación.

**Automático**

- Tests del planner/router: preserva referencia canónica, pasa condiciones de identidad, no confunde imagen adjunta del usuario con imagen previa generada por el asistente y selecciona únicamente modelos/pipelines disponibles.
- Tests de fallos: referencia ausente, proveedor inactivo, timeout/cancelación, imagen corrupta y fallback. La respuesta debe ser honesta; no afirmar que generó/guardó imagen si no ocurrió.
- Test de metadata: cada resultado de evaluación se vincula a prompt/configuración/modelo/seed sin persistir secretos ni datos del usuario.

**Manual**

- Ejecutar el mismo set antes y después; comparar en orden aleatorio con referencia visible.
- Evaluar cara y cuerpo, no ropa. Confirmar que cambios de ropa/pose/escena no intercambian la identidad.
- Revisar resultados locales de la carpeta de imágenes indicada por la persona usuaria y comprobar que cancelación, reintento y aprobación de foto principal no mezclen outputs antiguos/nuevos.

**Gate:** meta inicial propuesta: al menos **90 %** de imágenes válidas calificadas “misma identidad” por ambos evaluadores sobre el set acordado, sin regresión en cumplimiento de escena; publicar el tamaño de muestra y desacuerdos. Si el baseline ya está por encima o el scorer no está calibrado, revisar la meta antes de optimizar, no ajustar la evaluación después de ver resultados.

### G7 — P3: alinear documentos y preparar una beta confiable

**Documentos de referencia:** `docs/MISSION.md`, `docs/ROADMAP.md`, `docs/COMPANION-EVOLUTION.md`, `docs/BETA-0.12.md`, `docs/SMOKE-0.12.md`, `CHANGELOG.md`.

**Este bloque sí debe corregir contradicciones** cuando toque actualizar documentación, pero la solicitud original no pide actualizar ahora los documentos con versiones desfasadas. En esta entrega se registran como deuda explícita, sin modificarlos.

**Trabajo**

- Comparar cada capacidad con código, pruebas y flujo visible; usar estados `Implementada y probada`, `Implementada pero no verificada en entorno`, `Parcial`, `Planeada` o `Retirada`.
- Evitar que el changelog de implementación se interprete como validación de producto.
- Sincronizar versión/revisión, estado de features, límites de agenda, permisos y smoke de release en una tarea posterior.
- Enlazar este plan como referencia para quien lo ejecute y conservar evidencias de los gates.

**Automático**

- Un checker sencillo de release comprueba que los comandos exigidos existen y que las pruebas E2E críticas no están silenciosamente omitidas.
- Revisar enlaces relativos y nombres de scripts en CI.

**Manual**

- Una persona que no participó en el cambio usa únicamente las instrucciones de instalación/smoke y reporta pasos ambiguos.

**Gate de release:** no hay contradicciones de estado que induzcan a pensar que una capacidad está validada cuando no lo está; todos los gates P0/P1 están aprobados; limitaciones conocidas y datos de versión están visibles.

## 5. Matriz de regresión de producto

Mantener estos casos como smoke manual y, cuando sea estable, automatizarlos con proveedor falso:

| ID | Entrada/acción | Resultado requerido |
|---|---|---|
| C1 | “Hola” en conversación nueva | Respuesta breve y coherente; no recita gustos/memoria irrelevantes. |
| C2 | Preguntar un gusto concreto del asistente | El recuerdo se guarda una vez, se muestra y persiste tras reiniciar. |
| C3 | Declarar/corregir/olvidar un gusto propio | No se mezcla con el usuario; corrección y olvido cambian store y contexto. |
| C4 | Dos preferencias en una respuesta | Ambas sobreviven si son hechos distintos; ninguna se elimina por frase repetida. |
| C5 | Respuesta larga o abortada | No duplica bloques ni oculta texto parcial; fallo/truncamiento se comunica con honestidad. |
| D1 | Leer/continuar un documento | Avanza el cursor y no contamina el contexto de charla normal. |
| A1 | Listar y describir archivo permitido | Resultado corresponde al archivo real y la ruta permitida. |
| A2 | Describir/clasificar/mutar ruta prohibida | Rechazo explícito; fixture externo sin cambios ni lectura. |
| A3 | Aprobar/rechazar acción en UI | Se ejecuta solo la acción exacta aprobada; rechazo/cambio de destino no muta. |
| R1 | Recordatorio con ventana oculta | Una notificación; abre la conversación correcta. |
| R2 | Salir/reiniciar | Resultado idéntico al contrato visible de persistencia; sin promesas falsas. |
| I1 | Retrato del personaje con ropa/escena distinta | Misma identidad verificable y petición de escena respetada; output trazable a su configuración. |
| M1 | Fallo de modelo/Forge | Mensaje claro y estado recuperable; no indica éxito ni deja busy bloqueado. |

## 6. Gestión de fallos y releases

- **P0 abierto:** detener nuevas herramientas de archivos/host; beta no apta para expandir acciones.
- **P1 abierto:** no etiquetar como estable; permitir solo una beta de prueba con limitación visible y plan de corrección.
- **P2 abierto:** puede publicarse una beta solo si la limitación está explícita y no contradice una promesa principal de la interfaz.
- Las pruebas manuales se repiten en una instalación limpia o perfil temporal, no solo con el perfil de desarrollo.
- Para fallos intermitentes, registrar frecuencia y entorno; no clasificar como “flaky” para ignorarlos.
- Toda regresión de seguridad, pérdida de memoria o acción no autorizada bloquea release aunque build y smoke básico pasen.

## 7. Deudas documentales encontradas en la fecha de referencia

No se modificaron aquí los documentos antiguos. El agente que ejecute **G7** debe volver a comprobarlos, pues este inventario puede quedar obsoleto:

1. `docs/MISSION.md` todavía presenta como planificadas organización/mutación de archivos y agenda, y llama defecto conocido al click de notificación; el changelog hasta `rev.fn` registra herramientas de archivo, tray y notificación implementadas.
2. `docs/COMPANION-EVOLUTION.md` declara `0.10.x` y muestra bloques de memoria como pendientes, aunque su contenido también menciona avances posteriores y el proyecto inspeccionado es `0.12.0-beta`.
3. `docs/ROADMAP.md` mezcla checks implementados con frases de validación futura para agenda/notificación; no asumir que el check `[x]` equivale a prueba E2E.
4. `CHANGELOG.md` sirve para saber qué se cambió, no sustituye evidencia de test automatizado o validación Windows empaquetada.

## 8. Condición para considerar alcanzada la meta de “Jarvis + companion”

No usar un porcentaje global. La beta puede llamarse **confiable para tareas y companion** solo cuando:

- G1 no permite acceso/alteración de archivos fuera de las rutas consentidas y está probado en Windows;
- build, typecheck y suites acordadas pasan sin fallos escondidos;
- E2E demuestra aprobación, rechazo, persistencia y ruta de error;
- memoria de usuario/asistente puede crearse, editarse, olvidarse y rehidratarse después de reiniciar;
- la agenda cumple su contrato de ventana oculta/salida/reinicio;
- el protocolo visual muestra consistencia de identidad en el set preregistrado, con límites publicados;
- los documentos de estado describen lo probado, no solo lo implementado.

“Automejora” debe seguir significando diagnóstico medible, propuesta y acción aprobada/reversible. No significa que la aplicación modifique su código, amplíe permisos o ejecute comandos del host por iniciativa propia.
