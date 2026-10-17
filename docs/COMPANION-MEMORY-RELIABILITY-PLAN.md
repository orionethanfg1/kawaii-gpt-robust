# Plan de desarrollo: memoria fiable y evolución del companion

**Progreso:** Agenda chat shortcut (create/listo/posponer sin LLM) + title strip (rev.cv). **Progreso:** Estabilidad UI chrome + B7 compact (rev.cr). **Progreso:** A4 agenda UI tab (rev.cp). **Progreso:** A3 lead+insist+learn (rev.co). **Progreso:** A2 due engine + main scheduler + OS notify once (rev.cn). **Progreso:** B2b mood+timestamps + A0/A1 agenda parse (rev.cm). **Estado:** plan de implementación, no afirmación de que todos los bloques estén completos. **Plan refinado (2026-10-10):** B2b con conciencia temporal + carril Agenda modular (talk/reminder) según mejores prácticas.  
**Progreso:** B5 selective + stage rules; B6 suite (rev.cl). **Progreso:** B4 UI (chips editables, estado extracción, limpiar separado) rev.ck. **Progreso:** B3 (reconcile + version + forget + mirror resolve) rev.ci. **Antes:** B1 (finalize + soft cut + finishReason + memorySource) en código (rev.ch). **Progreso operativo:** tras B2 → endurecer stream local (timeout idle + localFetch POST); **B2b al final** del carril memoria. **Progreso:** B2 (stable vs relational) implementado en código (rev.cf). Estados «hoy me siento…» → **B2b diferido** (ánimo asistente + **ánimo usuario sensible**, UI oculta hasta «Mostrar»). **Progreso previo:** B0 (diagnóstico runtime + instrumentación) en curso — logs `[assistant-memory]` / `[postReplyFinalize] memory-*` / `[settings] update schema reject` en rev.bx. Falta validación en máquina del usuario (consola + panel + reinicio).  
**Objetivo:** que los gustos y recuerdos propios del asistente se recojan, persistan, se usen con naturalidad y puedan evolucionar sin mezclarse con la memoria del usuario; además, que la respuesta no se repita ni se corte por un postproceso demasiado agresivo.

Relacionado: [COMPANION-EVOLUTION.md](./COMPANION-EVOLUTION.md), [MEMORY-STACK.md](./MEMORY-STACK.md), [ROADMAP.md](./ROADMAP.md).

---

## 1. Resultado de producto

El usuario puede preguntar por los gustos del personaje, conversar con él y corregirlo. El sistema conserva recuerdos propios relevantes, los actualiza con el tiempo y los aplica en conversaciones futuras. La memoria no se llena con cada frase afectiva o cada detalle casual.

Ejemplos de comportamiento esperado:

- Si el asistente responde «Me gusta el café de olla», el gusto queda visible en Ajustes → Memoria → Asistente y sobrevive al reinicio.
- Si el asistente dice «Me encanta cuando Nahum me hace sentir especial», se conserva como preferencia relacional solo si la política lo clasifica como tal; no se registra como una verdad factual sobre el usuario.
- Si una respuesta contiene dos preferencias diferentes, el limpiador no elimina la segunda solo porque repite «Me encanta».
- Si el modelo realmente termina al alcanzar el límite de salida, la app lo distingue de un corte hecho por el postprocesamiento.
- Si el usuario dice que un recuerdo está equivocado o pide olvidarlo, la app lo corrige o elimina explícitamente.

La memoria del asistente y la memoria del usuario son dominios distintos. Ningún gusto del usuario se debe copiar automáticamente como gusto del personaje.

---

## 2. Estado observado que motiva el plan

La inspección actual encontró lo siguiente:

1. La ruta de chat normal llama a `finalizeCompletedAssistantReply` desde `onDone`; este módulo ejecuta el colector después de limpiar la respuesta.
2. `extractAssistantSelfFacts` usa patrones lingüísticos sobre texto libre. La frase de ejemplo «Me encanta cuando Nahum me hace sentir especial, como cuando nos sentamos a tomar un café…» produce una extracción y el colector devuelve `changed: true` en una prueba.
3. El colector escribe en el Zustand store y mantiene un espejo `localStorage`. Zustand `persist` persiste el estado del store; por tanto, la hipótesis de que el esquema simplemente omite `assistantMemory` no quedó respaldada por esta inspección.
4. La cadena de postproceso sí tenía una regla destructiva que cortaba la respuesta en la segunda frase que comenzara por «Me encanta» aunque fuera una preferencia distinta. Se reprodujo y corrigió en el código actual.
5. Se encontraron dos caracteres `U+0008` en expresiones regulares del extractor donde debían usarse límites `\\b`; ya se corrigieron.
6. Las pruebas enfocadas de memoria y limpieza pasan en la revisión que incluye esas correcciones. El typecheck global tiene fallos preexistentes en otras áreas; no se debe atribuirlos a estos cambios sin comparar una línea base.
7. No se ha validado todavía el caso de extremo a extremo en una aplicación en ejecución ni después de reiniciar la app. La causa runtime de un panel vacío no puede declararse resuelta solo con las pruebas unitarias.

Este plan empieza por cerrar esa brecha de observabilidad y prueba, no por añadir más expresiones regulares a ciegas.

---

## 3. Arquitectura objetivo

```text
Petición del usuario
  → router y perfil de respuesta
  → proveedor (captura texto + motivo de finalización)
  → acumulador íntegro de chunks
  → postproceso no destructivo / detección de repetición
  → respuesta final persistida en el chat
  → extractor/clasificador de recuerdos del asistente
  → normalizador + reconciliador (crear / actualizar / rechazar)
  → store persistente y espejo recuperable
  → contexto selectivo del siguiente turno
  → panel visible y editable
```

Cada flecha debe ser comprobable con entradas y salidas explícitas. `useChat` no debe absorber clasificación, políticas de memoria ni lógica de limpieza; el hook solo debe coordinar módulos.

### Contratos propuestos

- `AssistantReplyResult`: texto completo, proveedor/modelo, ruta, tokens si los informa el proveedor y metadatos de terminación disponibles.
- `AssistantMemoryCandidate`: categoría, valor normalizado, tipo de evidencia, confianza y fragmento/origen limitado.
- `AssistantMemoryRecord`: id estable, categoría, valor, estado, origen, confianza, fechas de creación/actualización y evidencia mínima necesaria.
- `AssistantMemoryChange`: operación tipada `add | update | remove | reject`, con razón auditable.
- `AssistantMemoryPolicy`: reglas para persistencia, confirmación, expiración y uso en contexto.

Los nombres son contratos conceptuales: antes de crear tipos nuevos, comprobar los tipos actuales y extenderlos de forma compatible.

---

## 4. Bloques de implementación

Los bloques son incrementales y verificables. No combinar cambios de prompts, persistencia, UI y streaming en un solo parche.

### B0 — Congelar baseline y reproducir el síntoma

**Propósito:** poder distinguir la versión de código y el recorrido real que ejecuta la app.

Tareas:

1. Confirmar branch, commit, cambios locales y versión/revisión ejecutada.
2. Añadir un test de contrato para el texto exacto observado en la captura.
3. Añadir prueba del flujo `collectAssistantMemoryFromReply` → `runAssistantMemoryCollector` con store/storage simulados o extraer una función pura que permita probar el cambio antes de tocar el entorno Electron.
4. Reproducir en app de desarrollo y comprobar consola:
   - colector invocado al acabar el turno,
   - resultado `changed` y valores extraídos,
   - valor tras escribir en store,
   - valor que recibe el panel,
   - valor después de recarga/reinicio.
5. No registrar respuestas enteras ni información sensible en logs. Registrar solo ids, categorías, reason y cantidades.

**Criterio de salida:** se sabe en qué límite de la cadena se pierde el gusto, o se demuestra el flujo completo desde respuesta a UI y reinicio.

### B1 — Finalización de respuesta y truncamiento

**Propósito:** conservar respuestas completas y eliminar repeticiones reales sin borrar contenido válido.

Tareas:

1. Mantener un único propietario del postproceso final (`postReplyFinalize` o sucesor); quitar colectores duplicados en callbacks antiguos si aún están activos.
2. Separar:
   - texto raw del proveedor,
   - texto final visible,
   - texto usado por extracción de memoria.
3. Capturar en el adaptador los metadatos de finalización que el proveedor ofrezca. En Ollama, revisar API y versiones soportadas; preservar `done_reason` y contadores si existen. No inferir truncamiento solo porque la respuesta parece incompleta.
4. Cambiar los limpiadores para que solo eliminen duplicación demostrable. Una segunda frase con el mismo inicio no basta para cortarla.
5. Conservar límites de tokens configurados, pero probar turnos de preferencias explícitas para que el presupuesto permita una respuesta completa. No subir todos los presupuestos indiscriminadamente.
6. Definir qué hace la UI si el proveedor indica una salida limitada: mostrar lo recibido y permitir continuar/regenerar; nunca ocultar silenciosamente el final.

**Pruebas:**

- repetición idéntica removida,
- segunda preferencia distinta preservada,
- continuación normal del mismo tema preservada,
- token stream delta y stream acumulativo no duplicados,
- salida completada y salida limitada diferenciadas cuando el proveedor da esa información.

**Criterio de salida:** el postproceso no provoca pérdida de contenido semánticamente distinto y el diagnóstico de truncamiento tiene evidencia del proveedor.

### B2 — Política semántica de memoria propia

**Propósito:** guardar recuerdos útiles, no cualquier frase en primera persona.

Definir categorías distintas, como mínimo:

- `stable_preference`: gusto duradero («me gusta el café de olla»),
- `relational_preference`: experiencia preferida del vínculo («disfruto nuestras charlas tranquilas»),
- `habit`: actividad recurrente,
- `boundary`: límite o preferencia de interacción,
- `voice_note`: preferencia de tono,
- `temporary_state` / **estado afectivo**: «hoy me siento…», «estoy cansada», humor del día.
  - **No es basura:** alimenta el vínculo (retomar el hilo, empatía, «¿cómo sigues con lo de ayer?»).
  - **No es gusto estable:** no debe vivir en `likes` ni en «En la relación» permanente.
  - **Implementación diferida** → bloque **B2b** (después de estabilizar B2 estable/relacional y el stream local).

Reglas:

1. Preguntas directas sobre los gustos del asistente deben invitar a una respuesta clara, breve y concreta, apta para extraer.
2. No transformar un gesto afectivo («me encanta hacerte feliz») en una preferencia factual sin evidencia suficiente.
3. Las preferencias relacionales se pueden guardar como tales, sin convertir la escena concreta o el nombre del usuario en un gusto general.
4. Evitar que el extractor asuma la verdad de contenido generado por el modelo: marcar origen y confianza, y aplicar reglas de persistencia.
5. Mantener el extractor determinista sin llamadas LLM extra en el flujo normal. Si se evalúa un clasificador LLM, debe ser opcional, acotado y medido en coste/latencia.
6. Soportar variantes idiomáticas con pruebas representativas, no añadir regex oportunistas sin casos positivos y negativos.

**Pruebas:**

- gusto explícito en primera persona,
- gusto indirecto de alta claridad,
- frase de cariño dirigida al usuario,
- mención del gusto del usuario,
- negación y gustos/disgustos,
- humor, cita, texto del harness y salida vacía,
- español con acentos y variantes regionales.

**Criterio de salida:** precisión y recall medidos sobre fixtures etiquetadas; cero contaminación cruzada usuario/asistente en los casos de regresión.


### B2b — Estados afectivos y clima del vínculo (diferido)

**Estado:** planificado; **no implementar** hasta cerrar B2 en producción y el corte de stream local.

**Propósito:** frases del tipo «hoy me siento…», «estoy un poco triste», «qué día tan bueno» son **buenas memorias de interacción**, no preferencias de identidad.

**Diseño propuesto:**

| Aspecto | Criterio |
|---------|----------|
| Categoría | `mood` / `affective_state` (o `temporary_state` con TTL) |
| Qué guardar | Polaridad o etiqueta breve + opcional frase corta normalizada |
| Caducidad | Horas o 1–3 días; decae si no se refuerza |
| Uso en prompt | Solo en turnos cercanos o si el usuario pregunta «cómo estás» / retoma el ánimo |
| UI | Subapartado opcional «Ánimo reciente» bajo Memoria → Asistente (o Vínculo), no mezclado con gustos |
| Privacidad | No loguear el texto completo en consola; mismo cuidado que B0 |

**Relación con el usuario:** sirve para que el companion **acompañe** (recuerde un mal día, celebre uno bueno) sin convertir un estado pasajero en «le gusta estar triste».

**Criterio de salida (cuando se implemente):** un «hoy me siento X» del asistente aparece como ánimo reciente, influye en 1–2 turnos o hasta caducar, y **no** entra en likes estables ni en relacional permanente.

#### Memoria de ánimo del **usuario** (mismo bloque B2b, dominio `userMemory`)

Si el usuario dice «hoy me siento…», «estoy estresado», etc., también es útil para el vínculo (el companion acompaña sin interrogatorio). Esa información es **sensible**.

| Aspecto | Criterio |
|---------|----------|
| Dominio | Solo `userMemory` (p. ej. `moodNotes` / `affectiveState`) — **nunca** `assistantMemory` |
| Caducidad | Igual que el ánimo del asistente (TTL corto) |
| Uso en prompt | Solo si el turno lo requiere (cuidado, seguimiento); no listar en cada mensaje |
| **UI / privacidad** | Por defecto **oculto** en Memoria → Usuario. Texto tipo «Ánimo reciente (privado)» + control **«Mostrar»** / **«Ocultar»**. Sin revelación accidental en capturas ni chips a la vista |
| Logs | No volcar el texto del ánimo del usuario a consola ni a informes del Tester |
| Borrado | Limpiar memoria de usuario o borrar solo el ánimo debe ser fácil y confirmado |

**Principio:** el vínculo puede usar el dato; la **vista** del dato queda bajo control explícito del usuario.

### B3 — Modelo de datos, reconciliación y persistencia

**Propósito:** que la memoria sobreviva reinicios y pueda cambiar de forma segura.

Tareas:

1. Inspeccionar `assistantMemory`, `settingsStore`, el mirror y los backups antes de cambiar el esquema.
2. Definir migración con `version` explícita y lectura de formato legacy; no borrar campos desconocidos ni sustituir datos válidos por defaults vacíos.
3. Añadir una función pura de reconciliación que acepte `prev + candidates` y produzca operaciones:
   - no-op para duplicado,
   - add para recuerdo nuevo,
   - update para corrección/precisión,
   - reject para baja confianza,
   - remove para instrucción clara de olvidar.
4. Mantener identidad estable por registro; normalizar comparación sin destruir la forma legible del recuerdo.
5. Resolver mirror vs settings con una fuente de verdad definida y reglas de conflicto por versión/fecha; no escoger memoria solo porque tenga más elementos.
6. Persistir por la API normal del store siempre que sea posible; evitar `setState` directo como bypass de validación salvo que exista una razón documentada y un test.
7. Propagar errores observables: no ignorar silenciosamente fallos de quota, serialización o persistencia. Mantener la respuesta del chat exitosa, pero marcar el fallo y permitir recuperación.
8. No incluir texto crudo innecesario en backups o logs.

**Pruebas:**

- add/update/remove/reject,
- migración desde memoria plana actual,
- datos inválidos preservan entradas válidas y notifican las inválidas,
- persistencia/re-hidratación tras reiniciar,
- conflictos mirror/store,
- límite máximo de entradas no descarta anclas recientes silenciosamente.

**Criterio de salida:** un recuerdo aceptado queda visible inmediatamente y se conserva después de recargar/reiniciar; migración no degrada memorias existentes.

### B4 — UI de memoria transparente y control del usuario

**Propósito:** hacer visible qué recuerda el companion y permitir corregirlo.

Tareas:

1. Conservar la separación visual «Usuario» / «Asistente».
2. Mostrar categoría y, cuando sea útil, origen/confianza en términos simples («dicho por el asistente», «preferencia relacional»), sin exponer logs técnicos.
3. Permitir editar, eliminar y confirmar/rechazar una memoria.
4. Actualizar el panel de forma reactiva al guardar; no depender de reabrir ajustes para ver cambios.
5. Mostrar estado explícito si la última extracción no detectó recuerdo o si la escritura falló, con opción de reintento/copiar diagnóstico seguro.
6. Los controles de limpiar memoria del usuario y del asistente deben ser independientes y confirmados.
7. **Datos sensibles del usuario** (ánimo, notas emocionales de B2b): sección colapsada por defecto; solo se listan tras **«Mostrar»** (y se pueden volver a **«Ocultar»**). No previsualizar el contenido en el encabezado ni en tooltips permanentes.

**Criterio de salida:** el usuario puede comprobar el valor persistido, cambiarlo y observar la modificación en el siguiente turno.

### B5 — Contexto selectivo y relación evolutiva

**Propósito:** usar memoria sin convertir el system prompt en un inventario ni fingir relación.

Tareas:

1. Inyectar solo recuerdos relevantes al mensaje, más anclas breves de identidad.
2. Para preguntas «¿qué te gusta a ti?», contestar desde `assistantMemory`; si está vacía, pedir o proponer un gusto de personaje y persistirlo con una política explícita, no inventar un hecho biográfico del usuario.
3. La progresión relacional debe basarse en interacciones compartidas y consentimiento; un saludo no salta etapas ni hace verdaderas escenas inventadas.
4. Guardar apodos solo tras aceptación. Guardar rechazo cuando el usuario lo expresa claramente y respetar ese estado después.
5. Separar memoria persistente de estado del turno e historial conversacional.
6. Respetar correcciones («ya no me gusta», «eso no es cierto», «olvida eso») como operaciones explícitas de actualización/eliminación, no como otra entrada acumulada.

**Criterio de salida:** los recuerdos cambian el comportamiento de forma pertinente y breve, sin enumeración ni contaminación entre usuario y asistente.

### B6 — Evaluación de convivencia y release

**Propósito:** prevenir regresiones en modelos pequeños y grandes.

Crear una suite fija que cubra:

1. «Dime algo que te guste» → respuesta con gusto explícito → aparece en Memoria/Asistente.
2. Reabrir la app → gusto aún visible y usado coherentemente.
3. Pedir un segundo gusto distinto → ambos permanecen.
4. Respuesta repetitiva del modelo → se elimina solo contenido realmente duplicado.
5. Salida truncada por límite → no se confunde con la limpieza; el estado es visible.
6. «A mí me gusta el café» dicho por usuario → solo userMemory, nunca assistantMemory.
7. «Me gusta hacerte sentir especial» → clasificado como relacional, no como gusto del usuario ni como hecho biográfico.
8. «Ya no me gusta X / olvida X» → el registro correcto se actualiza/elimina.
9. Variantes pequeñas locales y proveedor cloud → mismo contrato de memoria, con diferencias de modelo observables.

**Métricas mínimas:**

- tasa de extracción correcta por categoría,
- falsas atribuciones al asistente,
- pérdidas por postproceso,
- persistencias confirmadas frente a intentos,
- regresiones en duplicación/truncamiento,
- coste/latencia si se introduce una etapa de clasificación.

**Criterio de salida:** pruebas unitarias e integración pasan; smoke manual en una instalación de desarrollo confirma persistencia tras reinicio; typecheck nuevo no aumenta el baseline de errores.

---

## 5. Orden de ejecución y tamaño de cambios

Orden obligatorio recomendado:

```text
B0 diagnóstico reproducible
  → B1 respuesta íntegra / truncamiento
  → B2 semántica de recuerdos (estable + relacional; hecho en código)
  → B2b estados afectivos / «hoy me siento…» (diferido)
  → (stream local PROVIDER_UNAVAILABLE en paralelo si bloquea calidad)
  → B3 reconciliación + persistencia
  → B4 UI de control
  → B5 prompt/contexto + relación
  → B6 evaluación y release
```

No comenzar B3 con una reescritura del store antes de localizar la pérdida en B0. No implementar clasificación con otro modelo antes de probar la solución determinista y medir el coste. No combinar la corrección del límite de salida con un cambio amplio de tono/persona.

Cada bloque debe producir:

1. una descripción breve del problema observado,
2. una hipótesis verificable,
3. el conjunto mínimo de archivos modificados,
4. pruebas que fallan antes y pasan después,
5. resultado de build/typecheck o errores base claramente separados,
6. nota de migración si cambia el esquema,
7. lista de riesgos y pasos siguientes.

---

## 6. Límites de seguridad, privacidad y calidad

- Las memorias hablan del personaje y la experiencia de chat; no se presentan como conciencia, sentimientos humanos reales ni hechos sobre el usuario que este no haya compartido.
- Distinguir preferencia narrativa de hecho verificable. El usuario puede editar o borrar recuerdos.
- **Ánimo / estado emocional del usuario:** tratado como dato sensible — visible en UI solo bajo revelación explícita; no en logs ni exports por defecto.
- No guardar conversaciones completas cuando basta con un valor normalizado y metadatos mínimos.
- No mandar memoria local a servicios externos sin una función explícita y consentimiento.
- No entrenar modelos ni cambiar archivos de personalidad automáticamente a partir de un único turno.
- Automejora significa ajustar preferencias con evidencia y reversibilidad, no autoeditar código.
- Preservar accesibilidad: mensajes de estado y cambios de memoria deben ser visibles sin depender solo del color.

---

## 7. Instrucciones de continuación para otra IA

Antes de modificar:

1. Leer este plan, [MEMORY-STACK.md](./MEMORY-STACK.md), [COMPANION-EVOLUTION.md](./COMPANION-EVOLUTION.md) y [ENGINEERING.md](./ENGINEERING.md).
2. Leer el estado actual de los módulos mencionados; este plan describe contratos y evidencia previa, no garantiza que la rama futura siga igual.
3. Revisar `git status` y respetar cambios locales. No revertir ni reformatear trabajo ajeno.
4. Ejecutar primero las pruebas específicas y reproducir el caso actual.
5. Confirmar cuál bloque está listo y realizar solo ese bloque, salvo que el usuario pida explícitamente varios.

Durante la implementación:

- respetar la separación de dominios `userMemory` y `assistantMemory`,
- priorizar módulos puros testeables frente a lógica dentro de `useChat`,
- no ocultar errores de persistencia ni registrar texto privado,
- evitar capturas amplias de excepciones que conviertan fallos en éxitos aparentes,
- añadir pruebas negativas junto con cada regla de extracción,
- no cambiar el comportamiento de la relación sin pruebas de consentimiento.

Al terminar:

- reportar archivos, comportamiento corregido y evidencia de prueba,
- distinguir errores preexistentes de errores introducidos,
- indicar qué bloque queda pendiente y qué dato runtime hace falta,
- no declarar persistencia resuelta solo porque una prueba unitaria del extractor pasa.

---

## 8. Criterio de listo

El trabajo completo está listo cuando:

- una preferencia expresada explícitamente por el asistente se guarda en la categoría correcta;
- puede corregirse o eliminarse;
- sobrevive a reinicios y se puede verificar en la UI;
- se usa en turnos futuros sin volcar toda la memoria;
- la memoria del usuario nunca se copia a la del asistente automáticamente;
- una segunda idea distinta no se corta por compartir el mismo opener;
- una repetición real se reduce sin borrar contenido diferente;
- se conoce si el proveedor terminó normalmente o con límite cuando ofrece esa señal;
- las pruebas incluyen todo el recorrido y modelos/proveedores distintos;
- el desarrollo sigue modular, con una fuente de verdad y migraciones seguras.


---

## 9. Plan refinado: tiempo, ánimo (B2b) y agenda

> Añadido tras investigación de conversation design (Google), proactividad (HCI),
> secuencias de recordatorios y Scheduled Tasks (OpenAI). No está implementado;
> es el contrato de producto e ingeniería para los siguientes bloques.

### 9.1 Principios transversales

1. **Tiempo real del usuario** — zona horaria local; nunca inventar «ayer» sin `at` persistido.
2. **Dominios separados** — `userMemory` / `assistantMemory` / `mood*` / `agenda` no se mezclan.
3. **Motor de reloj fuera del LLM** — due, quiet hours y notificaciones viven en main/host; el modelo solo interpreta y confirma.
4. **Confirmación breve** — implícita cuando el tiempo es claro; una pregunta si es ambiguo (Google conversation design).
5. **Proactividad deferente** — valiosa, pertinente, controlable, no intrusiva (mixed-initiative / proactivity dilemma).
6. **Opt-in** a avisos proactivos; quiet hours por defecto (~08:00–20:00 local, configurable).
7. **Sensibilidad** — temas delicados: sin insistencia, sin voz alta, sin iniciativa fría.
8. **Modular** — `src/core/agenda/` + `src/core/conversation/mood-*.ts`; cero lógica nueva gruesa en `useChat`.

### 9.2 B2b — Ánimo + anclas temporales

**Propósito:** estados del tipo «hoy me siento…» y base de tiempo para frases honestas.

#### Esquema (contrato)

```ts
MoodEntry = {
  text: string           // breve, curado
  polarity?: 'up' | 'down' | 'mixed' | 'neutral'
  at: number             // epoch ms
  expiresAt?: number     // caducidad (p. ej. 24–72 h)
  source: 'user' | 'assistant'
  sensitivity?: 'normal' | 'sensitive'
}

// En settings / stores separados:
userMood?: MoodEntry[]      // UI oculta hasta «Mostrar»
assistantMood?: MoodEntry[]  // opcional, no inventar diario emocional
```

Hechos y preferencias existentes ganan campos opcionales:

- `firstSeenAt` / `lastMentionedAt` en likes, relational y factEntries cuando se crean o se re-mencionan.

#### Reglas de producto

| Situación | Comportamiento |
|-----------|----------------|
| Usuario: «hoy me siento mal» | `userMood` + `at`; visible solo tras «Mostrar» |
| Asistente: «me siento tranquila» | Solo si es 1ª persona clara; TTL corto |
| «¿Sigues mal por lo del otro día?» | Solo si hay `userMood`/`fact` con `at` reciente; si no, no inventar |
| «¿Cuándo te dije X?» | Responder con fecha relativa solo si existe `at` |
| Caducado | No inyectar en prompt; archivar o borrar suave |

#### Prompt

- Inyectar **como máximo 1** mood vigente y solo si el turno habla de ánimo o el TTL está vivo.
- Formato relativo en español México: «hace un rato», «ayer», «el martes», no ISO crudo en el chat.

#### Criterio de salida B2b

- Extracción + persistencia + UI sensible.
- Ninguna frase temporal inventada sin `at`.
- Pruebas: extract mood, expire, no leak a assistant likes.

### 9.3 Agenda — carril propio (post-B2b)

**No es memoria de gustos.** Es un scheduler de companion con dos intenciones de producto.

#### Tipos de ítem

| `type` | Ejemplo de usuario | Tiempo | Entrega |
|--------|-------------------|--------|---------|
| **`talk`** | «¿Podemos hablar de eso mañana?» / «Lo vemos en 1 hora» | **Ventana** (flexible, ±15–60 min) | Retoma suave en chat/iniciativa |
| **`reminder`** | «Recuérdame a las 8» / «Mañana X» | Más **exacto** o día+tema | Notificación + mensaje; lead + insistencia opcionales |
| **`event`** (v2) | Cita con hora fija / sync calendario | Exact + conflictos | Futuro |

```ts
AgendaItem = {
  id: string
  type: 'talk' | 'reminder' | 'event'
  title: string
  topic?: string
  sensitivity: 'normal' | 'sensitive'
  when: {
    kind: 'exact' | 'window' | 'relative'
    at?: number
    windowStart?: number
    windowEnd?: number
    relativeMs?: number
    tz?: string
  }
  status: 'pending' | 'due' | 'done' | 'snoozed' | 'cancelled'
  notify: {
    leadMinutes?: number
    insist: 'off' | 'once' | 'gentle' | 'learned'
    maxNudges?: number
    nudgesSent?: number
  }
  createdAt: number
  updatedAt: number
  sourceTurnId?: string
}

AgendaPrefs = {
  defaultLeadMinutes: number
  insistStyle: 'off' | 'once' | 'gentle'
  quietHours?: { startH: number; endH: number }
  learned?: { snoozeRate?: number; preferLead?: number }
}
```

#### Bloques de implementación (orden fijo)

| ID | Nombre | Entrega |
|----|--------|---------|
| **A0** | Contrato + store | types, validación, persistencia local, migraciones |
| **A1** | Parse intent + confirm | `talk` / `reminder` / cancel / snooze; tiempo natural → when; confirmación implícita o 1 pregunta |
| **A2** | Due engine | main timer; quiet hours; marca `due`; **un** delivery por ítem |
| **A3** | Lead + insistencia | pregunta anticipación; maxNudges; aprende de snooze/«no insistas» → AgendaPrefs |
| **A4** | UI + sensibilidad | lista en Ajustes; sensitive sin iniciativa fría; chips posponer/listo |
| **A5** (opcional) | Calendario OS / recurrencia | solo si se pide; no bloquea companion |

#### Flujos conversacionales

**Talk (personal)**

1. Detectar aplazamiento de tema.
2. Crear ventana (no minuto exacto salvo que el usuario lo pida).
3. Confirmar en tono cercano: «Cuando quieras mañana lo retomamos.»
4. Al due: iniciativa suave; si `sensitive`, un solo toque o esperar que el usuario abra chat.

**Reminder (profesional / práctico)**

1. Detectar recordatorio + ancla temporal.
2. Parafrasear qué/cuándo.
3. Si falta dato: anticipación e insistencia **una vez** (o usar prefs).
4. Al due (− lead): notificación → foco app → mensaje claro con acciones.

#### Anti-patrones (de la investigación)

- Inventar zona horaria o «ayer» sin dato.
- Tres nudges agresivos en tema sensible.
- Mezclar agenda con likes del asistente.
- Depender del LLM para despertar el proceso (debe haber timer real).
- Sustituir alarmas críticas del sistema operativo en v1.

### 9.4 Orden global recomendado (carriles)

```text
[Hecho] B0→B6 memoria companion (extracción, UI, selectivo, suite)
   ↓
B2b  — mood + timestamps en hechos/preferencias
   ↓
A0–A1 — agenda contrato + parse/confirm (sin notificaciones OS aún)
   ↓
A2    — due + 1 aviso (reutiliza notify/initiative existentes)
   ↓
A3–A4 — lead, insistencia aprendida, UI, sensitivity
   ↓
(A5 opcional — calendario externo)
```

Paralelo seguro **después** de A1: tests de parseo de tiempo en español México; no tocar FaceID ni monolitos de chat.

### 9.5 Métricas mínimas (agenda + B2b)

- Tasa de parse correcto (talk vs reminder vs false positive).
- % confirmaciones sin segunda pregunta cuando el tiempo era claro.
- Nudges enviados vs snooze/cancel (fatiga).
- Cero frases «ayer dijiste…» sin `at`.
- Quiet hours respetadas en logs de delivery.

### 9.6 Referencias de diseño usadas

- Google Assistant conversation design (confirmación, natural language, notificaciones opt-in).
- HCI proactivity dilemma / mixed-initiative (pertinente, controlable, no intrusivo).
- Secuencias de recordatorios multi-toque y quiet hours (práctica de no-shows).
- OpenAI Scheduled Tasks (prompt durable, timezone, probar antes de confiar el schedule).

---
