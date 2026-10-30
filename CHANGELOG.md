## 0.12.0-beta rev.fr (fix)

- **Continuar escribiendo:** el placeholder `(Acción de la aplicación en curso.)` hacía que el modelo «pausara» la escena. Ahora la instrucción de sistema exige continuidad (misma voz/escena) y el texto de usuario pide continuar sin reiniciar.

## 0.12.0-beta rev.fr

- **Notificaciones → app:** `focusMainWindow` unificado (show, skipTaskbar, alwaysOnTop flash, `app:open-chat`); agenda y `app:notify` lo usan.
- Icono en toasts de agenda; log de click en consola main.
- **G1 tickets de mutación:** `files:issueMutationTicket` + `mutatePath` exige ticket (no basta `confirm:true` del renderer).
- Tools copy/move/rename/delete: aprobación UI → ticket → mutar.

## 0.12.0-beta rev.fq

- **Carpetas falsas:** el atajo «dónde…» ya no se dispara por RP (`dónde` + `ver`); exige intención de archivos/música/imagen/carpeta de la app.
- **Agenda durable (P2 parcial):** snapshot + delivered en `userData/backups/agenda-snapshot-v1.json`; se recarga al arrancar el scheduler.
- **P3 docs:** README apunta a 0.12.0-beta + plan de estabilización.
- (prev) G1/P0 `path-boundary` + memory-write log.

## 0.12.0-beta rev.fp

- **Memory write log:** cada persistencia emite `[memory-write]` (side, reason, fields, samples, persistOk).
- Tests: `getMemoryWriteLog` / `memoryWriteLogHasSample` / `clearMemoryWriteLog`.
- Disco: `userData/backups/memory-write.log` (IPC `memory:appendWriteLog`).

## 0.12.0-beta rev.fo

- **Memoria usuario:** cada turno fusiona likes/favoritos/hechos del mensaje del usuario (café, gustos, etc.); extractor de bebidas reforzado.
- **A2+:** `trustedFileRoots` en settings; mutaciones/lectura respetan userData + carpetas de confianza.
- **A4:** `read_text_file`, `propose_file_edit` (diff unificado), `apply_file_edit` con confirm/dryRun + audit.

## 0.12.0-beta rev.fn

- **A2:** `copy_file` / `move_file` / `rename_file` / `delete_file` (papelera SO) solo bajo userData; dryRun o confirm + aprobación UI; audit `backups/file-audit.log`.
- **A1+:** `describe_file` intenta visión (LMS/Ollama VLM) en imágenes; fallback a meta.
- IPC: `files:mutatePath`, `files:readDataUrl`.

## 0.12.0-beta rev.fm

- **A1 agente:** inventario unificado (uploads, adjuntos, wardrobe, context, images, backups).
- Tools host: `describe_file`, `classify_file` (+ IPC `files:describePath` / `files:classifyPath`).
- **Delta docs:** `sourceFingerprint` size:mtime + detección de cambio al re-adjuntar.
- Catalog / capabilities / humanize actualizados.

## 0.12.0-beta rev.fl

- **Client disconnected / mid-stream cut:** watchdog de UI a 5 min ya no aborta ni borra `isStreaming`; solo desbloquea input.
- Stream LMS: timeout por **inactividad de bytes** (10 min) + techo 40 min (antes wall-clock fijo).
- `armLoading` local ≥20 min; backend local timeout 30 min.
- Respuesta parcial tras abort se conserva (no se tira el texto ya generado).

## 0.12.0-beta rev.fk

- **Causa raíz prefill lento:** `enable_thinking: true` por defecto + ~10k tok (12 system + historial RP).
- Thinking **apagado** en local salvo `thinkMode=on`.
- System prompts **fusionados** a 1 bloque y tope ~5k chars; historial 6×~600 chars.
- `max_tokens` local más bajo; barra doc oculta en «listo».

## 0.12.0-beta rev.fj

- **Prompt local 26B:** presupuesto reducido (no 56k/32k system) — menos tokens, menos tiempo de prefill.
- Descripción visual en chat recortada (~900 caracteres).
- Barra de lectura del libro se oculta a los 12s en estado «listo».
- Meta UI: se elimina la etiqueta falsa «documento» del reason.

## 0.12.0-beta rev.fi

- **Contexto liviano:** HARNESS completo (tools + inventario) solo si pides diagnóstico/herramientas; el chat diario usa un hint mínimo.
- **Etiqueta «documento»:** solo cuando hay bloque real DOCUMENTOS_ADJUNTOS / MODO_DOCUMENTO en el turno.
- **LMS:** cola serial de chat local — evita 3 «PROCESSING PROMPT» a la vez en la misma GPU.

## 0.12.0-beta rev.fh

- **Contexto docs:** no inyectar MEMORIA_DOCUMENTO / DOC_INDEX / hechos DOC_READ en cada turno de charla.
- Solo cuando el mensaje pide lectura, capítulo, opinión del libro o «continuar lectura».
- Routing deja de marcar «documento» por basura residual en el system prompt.

## 0.12.0-beta rev.fg

- **Harness vs usuario:** mensajes `[APP]` / `app-doc-continue` van como *system*, no como texto del usuario.
- **Iniciativas:** el timer arranca al terminar el streaming del asistente (no al enviar el usuario).
- **Ingesta docs REDUCE/seed:** en cola hasta que el chat deje de generar.

## 0.12.0-beta rev.ff

- **Encuadre avatar:** modo Auto (prioriza cara) y Manual (sliders H/V) en Guardarropa.
- Chat bubble usa `object-position` según focus; preview circular en ajustes.

## 0.12.0-beta rev.fe

- **Doc ingest UI:** no se queda en REDUCE 75% si el libro ya terminó; pasa a listo con resumen heurístico.
- **REDUCE/seed LLM:** timeout 90s; si el modelo está ocupado en el chat, no bloquea la barra 15+ min.
- Barra: auto-cierre a «listo» tras 3 min atascada.

## 0.12.0-beta rev.fd

- **Tray:** minimizar/cerrar ventana → bandeja; menú Mostrar / Salir (agenda sigue en main).
- **Notificaciones:** click enfoca app + `convId` opcional → chat activo.
- **Tools agente:** `list_library`, `show_in_folder`, `open_external_url` (solo lectura / http).
- Catálogo host + capabilities actualizados.

## 0.12.0-beta rev.fc

- **ETL de documentos (local):** Extract → MAP → REDUCE → seed LLM 1× → Load (`document-ingest-etl`).
- **Índice canónico** `canonicalIndex` + bloque `[DOC_INDEX]` en lecturas posteriores (sin re-meter el libro).
- **UI** `DocIngestStatusBar`: fase, % y detalle de ingesta.
- Tester: `doc-ingest-etl`.

## 0.12.0-beta rev.fb

- **Map-reduce documentos (formal):** REDUCE con dedupe de líneas; hint `[MAP-REDUCE LECTURA]` en progreso.
- Refine LLM: prompt REDUCE + memorias por capítulo; umbral más bajo; tope de resumen ampliado.
- Tester: check `doc-map-reduce-hint`.

## 0.12.0-beta rev.fa

- Tester: I4 acepta `filePath` / `kawaii-file:` (no exige dataUrl en memoria).
- MD normalize: checks puros sin importar Vitest en el renderer.

## 0.12.0-beta rev.ez

- Clasificación: heurística más rica + `parseClassificationHintsFromText`; Reclasificar en galería sin duplicar.
- Intimidad UI: detección de escena más sensible al tono romántico; sticky `scene_active` alineado con el prompt.
- Markdown: `normalizeMarkdownForBubble` equilibra `*`/`_` antes de ReactMarkdown.

## 0.12.0-beta rev.ey

- Regresión imagen: busy con `since`; desbloqueo automático si >8 min o sin controllers.
- Tester: APIs `backupExportFull` / `Import` / `OpenBackupsDir`.
- Tests: dedupe wardrobe-approve + manifest full-backup.

## 0.12.0-beta rev.ex

- **B1 Respaldo completo:** carpeta portable `kawaii-full-…` con settings, character, chats, memory, primary y `wardrobe/`.
- UI: Respaldo completo / Importar completo / Carpeta backups (sidebar).
- Import merge: identidad + memorias + fotos; chats por id (más mensajes gana).

## 0.12.0-beta rev.ew

- Iniciativas: si N1 ya escribió el mensaje, **no** se lanza un segundo job a LMS.
- Deseos de guardarropa más raros (4%, cooldown 36h, persistido); no monopolizan otras iniciativas.
- Guardarropa: al aprobar, **merge** si es la misma imagen (path/fingerprint); tope suave por rol.

## 0.12.0-beta rev.ev

- **Foto principal al reiniciar:** ya no cae al primer ítem de la galería al strippear dataUrls.
- Puntero durable `kawaii-chat-primary-v1` (ruta en localStorage) + restore en hydrate.
- pickRicher / thinCharacter conservan path de principal.

## 0.12.0-beta rev.eu

- Oferta guardarropa con **filePath** (mensajes sin dataUrl al regenerar).
- postReply recupera imagen del último mensaje de usuario si no hay pending.
- Continuar escribiendo reenvía adjuntos de imagen del turno.

## 0.12.0-beta rev.et

- Oferta guardarropa **no se consume** al finalizar el primer mensaje: sobrevive «Continuar escribiendo».
- Se limpia solo al aceptar/descartar chips (o tras 1h).

## 0.12.0-beta rev.es

- **Foto principal:** al aceptarla desde el chat se guarda en disco y `visualImageUrl` queda como **ruta**, no solo dataUrl (sobrevive reinicio).
- Sync a characterStore + gallery filePath.

## 0.12.0-beta rev.er

- Avatar en burbuja ~1.7× más grande; resuelve `kawaii-media` si la principal está en disco.
- Si había un WARDROBE_WISH de iniciativa y el usuario manda foto, el sistema lo recuerda al modelo.
- Al guardar en guardarropa se marca el deseo como cumplido en memoria.

## 0.12.0-beta rev.eq

- **C5:** Foto adjunta → clasificar (kind/tags) + sistema ver/opinar/pedir permiso.
- Oferta guardarropa no exige solo frases de regalo; basta imagen relevante.
- Chips de confirmación muestran clase/tags; al guardar se aplican al ítem.

## 0.12.0-beta rev.ep

- **Personalidad / estilo:** dejan de perderse al rehidratar (pickRicher ya no pisa texto con el score visual).
- Escritura dual settings + characterStore; flush al cerrar Ajustes.
- Disco `userData/identity/character-visual.json` incluye personality, style, tagline, rol.

## 0.12.0-beta rev.eo

- **Iniciativa:** N1 acepta texto libre del modelo como mensaje; solo SILENCIO explícito cancela.
- Busy de chat caduca a los 3 min (no bloquea iniciativas eternamente).
- Propuesta de cercanía íntima algo más frecuente si hay opt-in adulto.

## 0.12.0-beta rev.en

- **Cancelar imagen en chat** llama `image:cancel` + `forceUnlock` + interrupt Forge.
- Reintento automático si llega `IMAGE_BUSY` tras cancelación residual.
- Busy “fantasma” (sin controllers) se limpia al pedir una nueva gen.

## 0.12.0-beta rev.em

- Tests anti-falso-positivo imagen (piropos).
- `npm run audit:wiring` cableado crítico.

## 0.12.0-beta rev.el

- **Guardarropa:** al abrir el panel, elimina entradas fantasma (archivo ya no está en disco).
- Reasigna Principal / FaceID si apuntaban a un archivo borrado.
- Sincroniza con los PNG reales en `userData/wardrobe`.

## 0.12.0-beta rev.ej

- **Guardarropa:** miniaturas vía `kawaii-media://wardrobe/<archivo>` (protocolo Electron, sin base64).
- CSP `img-src` incluye `kawaii-media:`.
- Avatar principal usa el mismo protocolo.

## 0.12.0-beta rev.ei

- **No gen de imagen por piropos:** "tu cabello/piel… hermosa" ya no fuerza revisión de imagen.
- Solo cuentan imágenes *generadas* por el asistente como “previas”, no adjuntos del usuario.
- **Cancelar imagen** libera el flag busy aunque Forge ignore AbortSignal.

## 0.12.0-beta rev.eh

- **Guardarropa:** carga robusta de rutas (kawaii-file/file://, separadores, basename).
- Reconciliación con `files:listWardrobe` (disco = fuente de verdad).
- IPC `files:toDataUrl` normaliza rutas antes de leer.

## 0.12.0-beta rev.eg

- **Guardarropa:** dedupe por `filePath`; ya no escribe `kawaii-file:` en `dataUrl` (CSP).
- Limpieza one-shot de duplicados al abrir el panel.
- CSP `unsafe-eval`: esperado en **dev** (Vite HMR); en empaquetado el aviso de Electron desaparece.

## 0.12.0-beta rev.ef

- **Guardarropa UI:** miniatura vía IPC → `data:` (CSP bloquea `file://` y `kawaii-file:`).
- Avatar de personalidad resuelve path en disco igual.

## 0.12.0-beta rev.ee

- **Autodescripción:** prompt que exige párrafo real (no checklist); rechaza eco de instrucciones; LMS con `enable_thinking:false` + imagen comprimida.
- Tras regenerar: sincroniza textarea, characterStore y ficha en disco.
- Estimaciones de complexión/proporciones si el cuerpo se ve (claras como aproximadas).

## 0.12.0-beta rev.ed

- **Guardarropa:** borrar quita de settings **y** borra el archivo en disco (no reaparece al reiniciar); ya no asigna otra foto como principal al borrar.
- **Hydrate:** no fuerza `visualImageUrl` al primer item de la galería.
- **Fase íntima:** si no hay señales recientes ni ventana sticky, `scene_active`/`aftercare` pasan a `open`/`idle` (UI y system prompt alineados).

## 0.12.0-beta rev.ec

- **Foto de personaje:** si el usuario comparte «nueva foto de ti», el modelo pide guardarropa y/o principal; chips **Guardarropa / Foto principal / Ambas / No**.
- Oferta en meta del mensaje (confirmación explícita; no auto-guarda).

## 0.12.0-beta rev.eb

- **CSP:** `compressDataUrlForVision` ya no usa `fetch(data:image…)` (bloqueado por connect-src); comprime con `Image` + canvas.
- Evita fallos de visión / respuestas vacías al adjuntar fotos en dev.

## 0.12.0-beta rev.ea

- **Adjuntos seguros:** classify image/doc/audio/video; toast si imagen falla o es >12MB; docs de tipo desconocido avisan.
- Turno con audio/vídeo: hint de sistema honesto (sin inventar contenido, sin crash).
- Compresión de imagen al elegir archivo (menos cuota / errores LMS).

## 0.12.0-beta rev.dz

- **Desalojo de contexto:** turnos de foto/charla no inyectan el libro completo; solo `[MEMORIA_DOCUMENTO]` (progreso + resumen).
- Texto completo del doc solo en `doc_active` (adjunto fresco, continuar, seek, pregunta al libro).
- Pack: quita bloques pesados de lectura y `image_url` de turnos anteriores del historial.

## 0.12.0-beta rev.dy

- **Visión + Gemma/LMS:** comprime fotos grandes antes de enviar; `enable_thinking=false` en turnos multimodales (evita content vacío).
- Si solo llega reasoning, se promociona texto legible a la burbuja con más agresividad.

## 0.12.0-beta rev.dx

- **Visión real:** las fotos del chat se envían al modelo como `image_url` (LM Studio) / `images[]` (Ollama), no solo un hint de texto.
- Auto-route `vision` solo si el adjunto es imagen (no documentos).
- Hint VISION: priorizar lo que se **ve** en la foto frente a la ficha canónica.

## 0.12.0-beta rev.dw

- **S5:** chips de escena junto a Cercanía — Seguir cerca / Bajar ritmo / Descansar (mensaje natural del usuario).
- **S6:** bloque `[CONTEXTO_TEMPORAL]` en cada turno + hora breve en decisión de iniciativa; clima si hay snapshot fresco.
- **N3:** horario silencioso configurable + máx. iniciativas/día en Persona; cableado a `shouldSendInitiative`.

## 0.12.0-beta rev.dv

- **Reparación de extractos a medias:** `ensureDocExtract` busca el `.docx`/`.pdf` original en `user-uploads`, `app-context` y adjuntos por nombre (fuzzy) y reescribe el `.extract.txt` completo.
- Hidratar en cada lectura/continuar fuerza esa reparación y lee el extracto completo de disco.
- Si no hay original: mensaje claro pidiendo re-adjuntar el libro.

## 0.12.0-beta rev.du

- **Extracción completa a disco** (`doc_read.py --out`): sin tope 500k/2M en el archivo `.extract.txt`.
- Partes automáticas si el texto supera 1.5M (`*.extract.partNNN.txt` + manifest).
- **`files:ensureDocExtract`**: al continuar lectura, re-extrae el `.docx`/`.pdf` original, compara longitudes y repara extractos a medias (p. ej. cortados en cap. 10).
- Hidratar adjuntos siempre prefiere el extracto más largo en disco.

## 0.12.0-beta rev.dt

- **Causa raíz Cap. 10:** extracción Office limitada a 500k caracteres → subida a **2M**.
- Cursor `streamOffset` con avance mínimo garantizado; progreso explícito en el prompt (chars + %).
- Hidratar de disco si el extracto es &lt;600k (recoger extractos nuevos más largos).
- Cierre automático al ≥98% del texto disponible.

## 0.12.0-beta rev.ds

- **Lectura progresiva:** cursor absoluto `streamOffset` dentro de capítulos largos (evita repetir siempre el inicio del Cap. 10).
- Cada «Continuar lectura» avanza caracteres/tramo; el botón desaparece al llegar al final del archivo.
- Soft-match de estado por nombre de archivo si cambió el tamaño del extracto.

## 0.12.0-beta rev.dr

- **LMS un solo modelo:** `resolveLmStudioChatModelId` conserva el residente en VRAM; evita cargar el de settings y expulsarlo después.
- Chat/stream OpenAI-compat reescribe `request.model` al id resuelto y re-verifica dual-load tras switch.
- Iniciativas usan el residente LMS + `ensureLmStudioSingleResident` (no segundo modelo).

## 0.12.0-beta rev.dq

- **Lecturas pendientes al arranque:** detecta progressive a medias o ingesta «leer y recordar» incompleta; aviso en boot + detalle del paso Chats.
- `listPendingDocReadings` / `summarizePendingDocReadings` para pre-update y diagnóstico.

## 0.12.0-beta rev.dp

- **Leer y recordar:** documentos grandes se indexan offline (mapa de tramos + resumen), una respuesta global; preguntas por capítulo/pasaje re-leen el extracto y enriquecen memoria.
- Progressive por turnos se mantiene para docs pequeños o si el usuario pide «continuar lectura».
- UI: sin botón Continuar lectura cuando la ingesta está completa.

## 0.12.0-beta rev.do

- **Thinking UI:** al finalizar el turno se fusiona reasoning del stream + CoT extraído del content en `meta.thinking` (panel «Pensó»); si no hay razonamiento, no se muestra.
- **S1** entrada íntima limpia por invitación del usuario (`s1_invite`).
- **S4** prompts de oferta verbal natural (sin «modo escena» ni menús).
- Providers LMS: también leen `reasoning` / `thinking` además de `reasoning_content`.

## 0.12.0-beta (dev)

- **N1 iniciativas:** decisión transparente SILENCIO/MENSAJE; sin plantilla genérica si hay modelo local.
- Lectura de documentos: no atascar en último capítulo; visitas por tramo.
- Markdown de burbuja: no romper `**negrita**`.
- Memoria asistente: filtros anti-basura + episodios.

## 0.11.1-beta rev.bx — Resumen heurístico + ficha EN detect

- heuristicConversationSummary: roll gratis en hilos largos locales (sin LLM extra)
- Orchestrator actualiza rolling summary cuando se omite summarize modelo
- looksEnglishVisualDescription helper
- characterStore sin dataUrl en LS (rev.bw)
- Test P0 summary-heuristic-roll

## 0.11.1-beta rev.bv — Ollama single-resident + stream UI + ficha clean

- ensureOllamaSingleResident: libera otros modelos/visión antes de cada turno Ollama
- Stream UI: paint ~24ms; onDone pone isStreaming=false al volcar buffer
- Boot: limpia y persiste visualDescription sin !!!
- Test P0 ensureOllamaSingleResident exportado

## 0.11.1-beta rev.bu — Rendimiento / ficha / catálogo

- isWeakVisualDescription: evalúa tras sanitize (!!! ya no tumba ficha con rasgos)
- LMS single-resident: descarga moondream/visión al usar LLM de chat
- Catalog HTTP 404 silenciado (builtin/cache offline)
- Antes: Regenerar texto (bt), cuota LS (bs)

## 0.11.1-beta rev.br — Cuota localStorage chats (anti pantalla en blanco)

- Persistencia chats: tiers de emergencia (12→5→activo→skeleton) si QuotaExceeded
- Menos peso en LS (msgs/convs/imágenes/docs)
- Spill a disco siempre al fallar setItem
- Boot: hard timeout 25s para no quedarse en splash vacío


## 0.11.1-beta rev.bq — C4 iniciativa visual contextual (anti-spam)

- Gate qué/por qué/modo (coherente | espontáneo) antes de proponer foto
- Solo full_look / portrait (no prenda/escena sola como primary)
- Hora del día en scorer; clima opcional si hay dato en settings (no inventa)
- Cooldown 48h; rechazo → lastWardrobeRejectAt; modo pro y escena íntima bloquean
- Mensajes con variantes naturales; wish de guardarropa más raro
- Tests + check P0 System Report wardrobe-c4-contextual

## 0.11.1-beta rev.bp — Guardarropa C0–C3 (clasificar + regalo)

- C0: límites upload (JPEG/PNG/WebP, 12MB) + schema WardrobeKind
- C1: classify heurístico + parse JSON VLM + needsUserKindConfirm
- C2: secciones en galería (filtros UI) + tags kind:* al subir
- C3: intent regalo en chat + system nudge; approve no pone primary si es prenda/escena/accesorio
- Tests: wardrobe-classify.test.ts + check P0 en System Report
- max wardrobe items 48 (approve)


## 0.11.1-beta rev.bo — Stream al día con LMS + descripción manual estable

- Stream UI: pinta en lotes (~48ms) y hace flush al terminar (LMS ya no "sigue escribiendo" en la app)
- Descripción física: la edición manual gana siempre; no revive la ficha antigua con !!! en inglés
- settings + identity store alineados al guardar visualDescription

## 0.11.1-beta rev.bn — Autodescripción detallada con LMS/Ollama vision (sin abliterated)

- LMS sigue en el flujo de visión: elige VLM usable ya cargado (nunca abliterated/uncensored)
- Prompt de descripción más denso (5–10 frases: cabello, rostro, piel, silueta, ropa)
- Ollama prioriza qwen-vl / llava / moondream no-abliterated
- No fuerza un segundo load si LMS ya tiene otro modelo residente
- Sigue permitiendo editar a mano (tallas/medidas) sin descartar el auto

## 0.11.1-beta rev.bm — Descripción sin basura + un solo modelo LMS

- Rechaza textos meta (Task/Analyze/Source Text) al regenerar descripción
- Polish NO usa abliterated/26B ni fuerza carga en LMS (solo Ollama ligero o skip)
- Si el id pedido no está en catálogo LMS, conserva el modelo ya cargado (no dual-load)
- No guarda descripción basura en Ajustes

## 0.11.1-beta rev.bl — Abliterated: sin fuga de ficha + autodescripción

- System: prohibido volcar bloque de apariencia en inglés / con !!! en el chat
- Post-proceso: stripLeakedVisualDescription quita hojas visuales pegadas al final
- Género femenino forzado (Niamh / novia) — evita «todo tuyo»
- Continuar escribiendo: mantiene el mismo modelo del mensaje previo
- Polish de descripción: resuelve modelo cargado en LMS (no id fantasma)
- Guardado de visualDescription sin prefijos !!!

## 0.11.1-beta rev.bk — Fase live, iniciativas, flujo relación, cumpleaños, refine robusto

- Persiste scenePhase live en cada turno (postReply)
- Más variantes de propuesta íntima; menos frecuencia; evita repetir plantillas recientes
- UI Flujo de relación (profesional → compañero → cercanía → íntimo)
- Refine INTIMACY_FIRST resuelve modelo cargado en LMS (no falla si settings apunta a id viejo)
- Celebración de cumpleaños (1×/año si hay fecha de nacimiento)
- Chip de fase oculto en modo profesional / solo asistente temprano

## 0.11.1-beta rev.bj — Respuestas largas sin corte en RP

- Eliminados topes 384/768 tokens en mensajes cortos del usuario (causaban "soy toda tu…")
- Suelo de generación local ~1536–2048+ tokens; techo 4096
- Detecta corte a mitad de frase y marca limited → botón Continuar
- Reintento por overflow reduce menos el maxTokens (×0.9, mínimo 1024)

## 0.11.1-beta rev.bi — Refine LLM de INTIMACY_FIRST

- Tras el extractor heurístico, el modelo local reescribe la primera memoria (tono natural, anclado al diálogo)
- Validación: rechaza plantillas de iniciativa, meta-comentarios y textos demasiado cortos
- Fallback seguro al heurístico si no hay runtime local o falla la llamada
- Cableado en «Reconstruir» (pestaña Íntimo) y al detectar primera vez en postReply

## 0.11.1-beta rev.bh — Fase live, tab Íntimo, sin iniciativas en memoria

- Chip de fase usa mensajes recientes (escena activa aunque relationship diga idle)
- Extractor ignora plantillas de iniciativa / «acercarme un poco más…»
- Pestaña Memoria: Usuario | Asistente | Íntimo | Agenda (Íntimo solo si hay contexto íntimo/opt-in)
- parseScenePhase elige la señal más activa entre facts y relationship

## 0.11.1-beta rev.bg — Bloques restantes intimidad

- mergeUserMemory protege INTIMACY_* (no se pierden al cap de hechos)
- Chip de fase íntima en cabecera del chat
- Reconstruir desde cualquier chat (selector)
- Auto-privado retroactivo de chats con señales íntimas si ya hay INTIMACY_FIRST

## 0.11.1-beta rev.bf — Nombre identidad vs trato

- userName (identidad) separado de preferredName (cómo le dicen)
- Extractor: ya no toma «soy tuyo» como nombre; «me llamo/mi nombre es» → identidad; «llámame» → trato
- UI Memoria: dos campos; auto-cura preferredName inválido (tuyo) al abrir el panel

## 0.11.1-beta rev.be — INTIMACY_FIRST más amplio y nombre correcto

- Ya no usa "tuyo"/apodos de trato como nombre del usuario (resuelve Nahum desde chat/resumen)
- Narrativa estructurada en líneas, más citas, ventana de escena más ancha (~4.2k chars)
- Reconstruir con forceFirst regenera y mejora la memoria privilegiada existente

## 0.11.1-beta rev.bd — Candado no deja la UI en blanco

- Pantalla de PIN con estilos inline (siempre visible, z-index máximo)
- Con candado activo solo se muestra el gate (no UI vacía detrás)
- Modo discreto: bloquea solo al ocultar la pestaña/documento (no cada blur)
- Candado mal configurado se auto-desactiva
- Tras 3 PIN fallidos: botón de emergencia para quitar el candado
- Quitar candado deja la sesión usable

## 0.11.1-beta rev.bc — Sección Intimidad visible y separada

- Bloque «Sección especial · Intimidad» más visible (borde rosa, título claro)
- Tags INTIMACY_* salen de «Hechos recordados» y viven solo en esa sección
- Botón reconstruir más evidente

## 0.11.1-beta rev.bb — Intimidad I5–I8

- I5: panel Memoria íntima en Ajustes→Memoria (muestra INTIMACY_FIRST + fase + botón reconstruir)
- I6: auto chat privado al escribir memoria íntima
- I7: (ya) disabled + un residente; sin cambios extra
- I8: tests en System Report (extractor, fase, protect, live session)

## 0.11.1-beta rev.ba — Intimidad I1–I4 + extractor

- Extractor aparte: INTIMACY_FIRST (amplio), INTIMACY_MEMORY, INTIMACY_PHASE
- I1 scenePhase: idle → invited → open → scene_active → aftercare
- I2 primera vez privilegiada (no se pierde al trim de facts)
- I3 notas cortas de escenas posteriores
- I4 prompts: aftercare, no re-permiso en escena, framing first_shared
- postReplyFinalize aplica extractor sobre el chat activo (recupera escena ya ocurrida)
- Iniciativa formal bloqueada en scene_active / aftercare

## 0.11.1-beta rev.az — Iniciativas de cercanía menos robóticas

- No re-pide permiso si intimacyOpen, etapa adult ya activa, o la escena ya es explícita
- Variantes de texto (deja de repetir el mismo párrafo)
- Cooldown más largo; probabilidad de propuesta formal más baja
- Prompt de etapa: si ya hubo aceptación, continúa natural sin plantilla

## 0.11.1-beta rev.ay — Build fix + notificación → chat

- Repara sintaxis rota en `loadLmStudioModel` (build esbuild)
- Click en notificación OS: enfoca ventana y abre superficie de chat (cierra ajustes/overlays)

## 0.11.1-beta rev.ax — No cargar modelos desmarcados

- Match de disabled: qwen/qwen3-14b ≡ qwen3-14b (sin confundir 8b/32b)
- Auto excluye deshabilitados del catálogo elegible
- Residente en VRAM deshabilitado se ignora (no “current”)
- Si localModel en settings está desmarcado, se limpia antes de decidir

## 0.11.1-beta rev.aw — Stream merge (espacios) + sin doble volcado

- mergeStreamToken ya no descarta deltas cortos repetidos (« de», « la») → evitaba «míoNahum»
- Stream local: no re-inyecta el cuerpo completo al terminar (solo si casi no hubo deltas)
- Formato markdown se conserva en el texto; al cerrar el stream ReactMarkdown lo pinta

## 0.11.1-beta rev.av — Auto no recarga de más

- Antes: a veces se cargaba el modelo de settings, luego Auto lo expulsaba y cargaba otro
- Ahora: se lee el residente en VRAM (LMS) **antes** de decidir
- Preferencia fuerte por mantener el ya cargado (minDelta↑)
- Lifecycle unload/load solo si el destino **no** es ya el único residente
- Intimacy: runLifecycle solo cuando hay cambio real de modelo

## 0.11.1-beta rev.au — Streaming local + timeouts largos

- Causa: proxy local sin stream + timeout 3–5 min mientras LMS seguía a ~5 t/s → abort/reintento («reinicia»)
- `net:localFetchStream`: SSE vía main → UI progresiva en chat local
- Timeouts POST local hasta 30 min; watchdog UI no aborta la petición LMS
- Mensaje de aviso más claro (generación en segundo plano)

## 0.11.1-beta rev.at — Privacidad propia (bloque B)

- Candado PIN local (PBKDF2), sin Windows Hello ni biometría del SO
- Auto-lock por inactividad + modo discreto (blur / bloqueo al ocultar ventana)
- Chats privados (título oculto en sidebar)
- Export JSON de privados exige PIN si el candado está activo
- Ajustes → Memoria → panel Privacidad / Candado

## 0.11.1-beta rev.as — Primer uso + edad (bloque C)

- Wizard: paso de personalidad abre CharacterSetupAssistant (obligatorio para continuar)
- Wizard: paso cumpleaños / fecha de nacimiento (local)
- Settings: userBirthDate, ageGateCompleted, hasCompletedCharacterSetup
- age-gate: evaluateAgeGate, effectiveAdultIntimacyOptIn; router y UI respetan 18+
- Memoria usuario: campo DOB + checkbox adulto deshabilitado si menor

## 0.11.1-beta rev.ar — Concordancia de género (bloque A)

- A1: system prompt refuerza femenino/masculino e íntimo («toda tuya» / «todo tuyo»)
- A2: post-proceso `correctSelfGenderSpanish` en pipeline de respuesta
- A3: tests vitest gender-agreement + pronoun hint
- A4: UI Personalidad recomienda fijar género (no Auto) en chats íntimos

## 0.11.1-beta rev.aq — Harness no interrumpe intimidad

- «muéstrame lo que puedes hacer» en RP ya no dispara lista de plugins/capacidades
- Solo «¿qué puedes hacer?» / «lista de capacidades» (meta-app) van al host
- Evita cortar conversaciones íntimas con informes de herramientas

## 0.11.1-beta rev.ap — Texto enriquecido en burbujas

- Usuario y asistente renderizan markdown (negrita / cursiva / listas)
- Emparejado de `*` y `_` más robusto; quita asteriscos sueltos de RP
- Solo el streaming parcial se muestra en texto plano (hasta que cierra el turno)

## 0.11.1-beta rev.ao — Descripción visual: schema + CORS

- Causa 1: `SettingsSchema` rechazaba `character` (role/gallery) → no se guardaba ni borrar ni regenerar
- Soft-accept del merge de character si el schema falla
- Galería: role libre, max 48 ítems, id opcional
- Polish LMS vía `localHttp` (IPC main) — sin CORS / OPTIONS vacío

## 0.11.1-beta rev.an — Timeouts para modelos grandes (Gemma 26B)

- Watchdog del chat: ≥10 min (hasta 20) según localTimeoutMs — no cortar a los 4 min
- Stream local: gracia hasta el **primer token** (prefill lento) + idle ≥10 min
- LM Studio provider timeout 15 min; localMaxTokens por defecto 3072
- Mensaje de error más claro si aún se agota el tiempo

## 0.11.1-beta rev.am — Descripción visual editable y limpia

- Sanitiza prefijos `!!!` de VLMs
- Regenerar usa avatar o galería (filePath → dataUrl)
- Botón **Borrar texto** + edición manual sin bloquear
- Polish también vía LM Studio; Preparar visión explica el siguiente paso

## 0.11.1-beta rev.al — Historial companion a prueba de cierres

Regla: el vínculo no se pierde por un crash o un hot-reload.

- Escritura **atómica** de chats (`*.tmp` → rename)
- Snapshots rotativos en `userData/chats-backup/{id}/` (últimos 8)
- Volcado a disco **después de cada respuesta** completada
- Autosave cada **45 s** + al ocultar/cerrar ventana
- Recuperar chats también lee snapshots (el más rico gana)

Futuro (ingresos): respaldos en nube / disco externo — fuera de alcance ahora.

## 0.11.1-beta rev.ak — Recuperación profunda + diag LM Studio

- Recuperar chats: disco + todas las claves localStorage de chats; detalle disco vs local
- Autodiagnóstico: sonda LM Studio `/v1/models` además de Ollama
- «Modelo local» ya no marca vacío si Gemma está en LMS

## 0.11.1-beta rev.aj — Recuperación de chats

- IPC `files:listChatBodies` + `recoverChatsFromDisk` (merge por id de mensaje)
- Sidebar: **Recuperar chats** y **Respaldar ahora**
- Boot: recuperación automática desde userData/chats
- Autodiagnóstico: check de respaldos en disco
- Si hay hueco de historial, el LLM puede sugerir «Recuperar chats» (sin inventar msgs)

## 0.11.1-beta rev.ai — Guardarropa a prueba de pérdida

- Nunca borrar dataUrl del settings si no hay `filePath` en disco
- `ensureCharacterVisualsOnDisk` antes de adelgazar / al boot / al rehydrate
- `files:listWardrobe` + recuperación de huérfanos en la galería
- Copia en `userData/wardrobe-backup/` al guardar cada imagen
- Lectura desde backup si falta el original

## 0.11.1-beta rev.ah — No perder historial de chat

- Eliminado el recorte forzoso a 40 msgs en partialize (causa de pérdida al actualizar)
- Spill a disco siempre del snapshot **completo** en memoria, no del JSON recortado
- Hidratar = merge por id de mensaje (LS ∪ disco)
- beforeunload / pagehide / visibility: flush a disco
- LS hasta 200 msgs/chat; emergencia de cuota sigue existiendo pero tras intentar spill

## 0.11.1-beta rev.ag — Formato visual + * más limpios

- Normalización * : empareja o elimina huérfanos; quita * pegados a emoji/puntuación
- Barra sobre el input: **N** / *I* / lista (markdown que el LLM ya entiende)
- Tester: md-strip-emoji-stars, md-wrap-bold

## 0.11.1-beta rev.af — Markdown companion (cursiva / *acciones*)

- `balanceSingleAsterisks`: cierra `*` huérfanos para que Gemma/RP no deje asteriscos crudos
- `em` en MessageBubble: cursiva visible
- Tester MD normalize

## 0.11.1-beta rev.ae — Un solo modelo LMS + UTF-16

- Causa del Channel Error: surrogate huérfano (`\ud83d`) en system prompt → `sanitizeLoneSurrogates` en body OpenAI-compat
- `ensureLmStudioSingleResident` antes de cada chat/stream local
- `switchLmStudioToModel` con lock serializado + pasadas de unload hasta ≤1 chat model
- `docs/MISSION.md` objetivo Jarvis + companion
- Tester: `phase9-*`

## 0.11.1-beta rev.ad — STT (dictado)

- Web Speech API (es-MX): hook `useSpeechToText` + botón Mic en ChatInput
- Errores en español (permiso, sin voz, red, no soportado)
- No auto-envía: rellena el cuadro de texto
- Tester: `phase8-*` + plan-gap-stt deja de ser skip

## 0.11.1-beta rev.ac — Chats en disco + biblioteca consciente

- Spill: `userData/chats/{id}.json` + cola de 40 msgs en localStorage
- IPC: `files:saveChatBody` / `readChatBody` / `listLibrary`
- Biblioteca sidebar: sección «En disco» + preview
- LLM: bloque `[BIBLIOTECA_LOCAL]` en cada turno
- Boot: hidrata chats spillados
- Tester: `phase7-*`

## 0.11.1-beta rev.ab — Fase 6 imagen UX jobs

- `job-ux.ts`: fases en español, progreso suavizado, errores humanizados (timeout/Forge/FaceID/cancel)
- `chatImageFlow`: barra live + mensajes de fallo sin volcar stack técnico
- Tester: `phase6-*`

## 0.11.1-beta rev.aa — Fase 5 companion

- K1: cooldown foto 36h + mín. 14 mensajes + random ~12%
- K2: tags/galería ya con autosave (sin cambios rotos)
- K3: `import-memories` + UI en Memoria (JSON LMS/Ollama → likes/facts, no chat entero)
- Tester: `phase5-*`

## 0.11.1-beta rev.z — Fase 4 persistencia + resiliencia LMS

- Runtime: `classifyRuntimeError` + mensajes ES (image/mmproj/OOM/…)
- OpenAI-compat: `sanitizeMessagesForModel` no envía imágenes a modelos solo-texto
- Chats: si hay `filePath`, no se guarda el extracto completo en localStorage
- Boot: paso «Chats e índices» + `persistMissingChatAttachments`
- Tester: `phase4-*`

## 0.11.1-beta rev.y — Fase 3 documentos + uncensored heretic

- D1: `files:readTextPath` + `hydrateAttachmentTextsFromDisk` antes del tramo progresivo
- D2/D3: tests avance «sigue» / cap. N + reglas opinión larga (sin ###)
- D4: refine rolling con LM Studio OpenAI-compat si hay base local
- Catálogo intimacy: reconoce `heretic` / uncensored (p. ej. gpt-oss-20b-heretic-uncensored)
- Tester: `phase3-*` P0

## 0.11.1-beta rev.x — Fase 2 catálogo / LMS

- C1: `dedupeCatalogByFingerprint` + UI Modelos (live gana)
- C2: `diskOnly` / `autoEligible`; badge «solo disco»; Auto no elige solo-disco
- C3: rescan disco al refrescar Modelos
- C4: unload LMS solo con state loaded/active
- C5: `lmStudioApiToken` en settings + Bearer en load/unload
- Tester: `phase2-*` P0

## 0.11.1-beta rev.w — Fase 1 router contrato

- R1: `decideAutoRoute` (`model-router.ts`); host solo discovery + settings + lifecycle
- R2: `src/core/routing/route-scores.md`
- R3: `docs/adr/001-model-disable-exact.md`
- R4: pin cede en intimacy si hay abliterated (`docs/adr/002-auto-route-precedence.md`)
- R5: sticky por conversación; clear al cambiar chat / opt-in off
- Tester: `phase1-*` P0

## 0.11.1-beta rev.v — Fase 0 Auto (A1–A5)

- A2: tests fingerprint + mergeDisk (1 fila abliterated)
- A1: classify «besar labios» + resolveIntimate → abliterated (Tester P0)
- A3: `switchToModel` único (`model-lifecycle.ts`); Auto usa solo ese path
- A5: meta ruta `task` + `from→to` + `lifecycle: …`
- A4: `isNearEchoOfPrevious`; marca eco + fuerza thinking off 5 min; abliterated sin thinking
- Tester: bloque `phase0-*` P0

## 0.11.1-beta rev.u — Dedup abliterated + sin thinking en uncensored

- `modelFingerprint`: cuantización se quita **antes** de separadores → unifica `mlabonne_qwen3-14b-abliterated` (API) y `…-Q6_K_L` (disco)
- OpenAI-compat: `enable_thinking=false` en abliterated/uncensor/dolphin (menos eco/repetición de historial)
- Penalties locales algo más altas en esos ids

## 0.11.1-beta rev.t — Auto intimacy + un solo modelo en VRAM

### Intimidad / Auto
- Léxico intimidad (soft/mid/strong) + frases ES/EN (`intimacy-lexicon`)
- Ruta `intimacy` con opt-in / stage íntimo / rol novios
- Disable de modelos **exacto** (no fuzzy): desmarcar un id openai-compatible ya no anula el abliterated de disco
- `preferLiveAbliteratedId`: mapea disco → id API cargable
- `resolveIntimateModelId` prioriza pool abliterated/uncensor

### Memoria de modelos (un solo residente)
- LM Studio: `POST /api/v1/models/load|unload` + listado `/api/v0/models` con `state`
- Tras switch: segunda pasada unload de todo lo que no sea el keep
- Ollama: `unloadAllExcept` sin vaciar si keep no está en Ollama
- Iniciativa: mismo modelo que el chat (sin segundo LLM de reintento)

### Persistencia / UX
- `kawaii-chats-v1`: thin docs/imágenes, tope mensajes, recovery de cuota
- Markdown burbuja: sin h2/h3 duplicados; normaliza `###` mid-párrafo
- Lectura progresiva: avance de capítulo + límites de extracto

### Docs
- Esta entrada; `APP_REVISION = t`

## 0.11.1-beta rev.o — Quota localStorage + avatar 20MB

- partialize settings sin dataURLs grandes; safeStorage sin throw
- purge agresivo + retry si QuotaExceeded
- Avatar hasta 20MB → disco wardrobe (no límite 2MB artificial)

## 0.11.1-beta rev.n — I4–I7 imagen

- I4 filePath → FaceID (kawaii-file + hydrate en main)
- I5 cascade smart: Fast local → cloud con diagnostics
- I6 CTAs error: Arrancar Forge / Fast / Smart
- I7 tests P0 contract + identity filePath

## 0.11.1-beta rev.m — I1/I2/I3 generación de imagen

- I1 gen-contract + job phase logs
- I2 resolve Forge: unload LLM, verify sdapi, 1 restart controlado
- I3 perfiles fast/balanced/quality; FaceID batch=1; retry Fast en batch

## 0.11.1-beta rev.l — C1–C5 catálogo + route íntimo

- C1 hardwareModelBudget (comfort/ok/skip, resumen UI)
- C2 abliterated prioritario; RP opcional (Tifa) oculto por defecto
- C3 localModelIntimate + task intimacy + sticky 2 min
- C4 Usar para íntimo + filtro RP + presupuesto en Modelos
- C5 tests unitarios + Tester

## 0.11.1-beta rev.k — toast negativa → catálogo

- detectModelRefusal + tip con cooldown 25 min
- Toast con CTA «Abrir catálogo de modelos» (kawaii:open-settings)
- SettingsModal initialSection=models

## 0.11.1-beta rev.j — R3/R4/R5 modelos + boundary + tests

- Catálogo companion uncensored (Dolphin, Hermes, tags)
- Auto-route favorece uncensored si adultIntimacyOptIn
- Soft-no con TTL 7d y reapertura por frase del usuario
- Tester P0/P1 intimacy + catálogo

## 0.11.1-beta rev.i — R1/R2 vínculo + opt-in adulta

- Stages: intimate_adult solo con opt-in + aceptación
- UI Memoria: chips de nivel + toggle cercanía adulta
- Propuestas de cercanía con Sí / Ahora no / Prefiero no
- Reglas de prompt por etapa y consentimiento

## 0.11.1-beta rev.h — wardrobe hydrate/purge + wish

- Hidratar dataUrl desde filePath al rehydrate de settings
- Purgar dataURL grandes tras persistir a disco (límite ~48k chars)
- Iniciativa: pedir look nuevo en texto (sin generar imagen) + WARDROBE_WISH en memoria

## 0.11.1-beta rev.g — wardrobe disco + dual primary + autosave

- userData/wardrobe/ via files:saveWardrobeImage
- facePrimaryUrl (FaceID) ≠ visualImageUrl (chat)
- Auto-guardado de título/tags/rol/intimidad en el editor

## 0.11.1-beta rev.f — wardrobe W4/W5

- Iniciativa visual: propone cambio de foto principal (Sí/No), cooldown 3h, no en stranger
- Botón «+ Guardarropa» en autorretratos generados
- approveImageToWardrobe / setChatPrimaryFromWardrobe

## 0.11.1-beta rev.e — wardrobe W2/W3

- Modelo wardrobe + migrate/enrich no destructivo de visualGallery
- pickWardrobeRefs: cara + style por tags/prompt
- planIdentityLock usa wardrobe (fallback legacy)
- Auto-enrich al abrir guardarropa en Ajustes

## 0.11.1-beta rev.d — guardarropa W1

- Galería: editor por imagen (título, rol, tags, intimidad)
- Lightbox con navegación
- Presets de tags; eliminado input global confuso
- identity-ref usa role/tags al puntuar refs FaceID

## 0.11.1-beta rev.c — títulos de chat

- Título inicial = tema derivado (no el texto crudo del primer mensaje)
- Renombrar en sidebar + 2–3 sugerencias (heurística + LLM opcional)
- Re-etiqueta títulos viejos que eran truncado del primer mensaje

## 0.11.1-beta rev.b — memoria largos + citas + plugins

- Favoritos del usuario como anclas estables en chats largos (≥16 msgs)
- Citas web como chips clicables bajo el mensaje
- Plugins: catálogo de tools + feedback de última ejecución
- Iniciativa: anti-repetición por solapamiento de stems

## 0.11.1-beta rev.a — línea de desarrollo (sin empaquetar)

- Política: solo `APP_REVISION` hasta 0.11 estable o 0.12
- Base de código = features listadas bajo 0.11.1-beta + trabajo posterior en revs

## 0.11.1-beta — Primera beta instalable

- Resumen LLM del tramo (refine async del rolling summary tras lectura progresiva)
- Ollama: reintentos serve + app Windows + mensajes de descarga
- Web: fuentes clicables en el pie del mensaje
- Plugins: IPC `plugins:run` / `plugins:roots`
- Auto-update: electron-updater + Ajustes → Avanzado → Buscar actualizaciones
- Empaquetado NSIS + portable (Windows x64)
- Wizard: modo Solo cloud para PCs sin modelo local; enlaces Ollama / LM Studio y verificación de requisitos
- Lectura de documentos: map-reduce heurístico en resumen rolling; reseñas más densas; Continuar escribiendo transparente (chip de app)
- Carpetas separadas: `user-uploads` (originales) vs `app-context` (extractos)
- Ollama: arranque con espera ~45s + hint de descarga
- Web 0 hits: no inventar fuentes
- Forge no arranca al boot; idle release de VRAM
- Tester Essential + UI journey por versión
- Docs: `docs/BETA-0.11.md`, smoke 0.11

## 0.10.10 rev.be — Modelos deshabilitados + web iniciativa + biblioteca + continuar

- Auto **no** reabre el catálogo completo si el usuario deshabilitó modelos (pool vacío → null)
- Match de `disabledLocalModels` más estricto
- Iniciativa: web solo con tema claro en líneas del **usuario** (no por gustos genéricos); meta web solo si hubo modelo + hits
- Iniciativa respeta modelos deshabilitados
- `standingInstructions` en memoria de usuario + inyección por turno
- Preguntas de progreso de lectura usan estado guardado de documentos
- Botón **Continuar lectura** + biblioteca de adjuntos en el lateral

## 0.10.10 rev.bd — Web search operativa + iniciativa proactiva

- Backends: Wikipedia en paralelo, Google News RSS, Brave HTML + cascade existente
- `shouldAutoWebSearch` + `suggestInitiativeSearchQuery`
- Chat: web automática en temas actuales si `webSearchEnabled`
- Iniciativa: puede buscar y pasar hits al modelo; meta con web hits
- 0 hits: no inventar hallazgos

## 0.10.10 rev.bc — Lectura progresiva + resumen rolling (docs largos)

- `document-reading-state.ts`: cursor por capítulo, resumen compacto de tramos ya leídos (patrón refine)
- `buildDocumentsWithState`: persiste progreso; «sigue» / capítulo N avanza de verdad
- Recuperación de texto desde historial si el usuario no re-adjunta el archivo
- `documentReadingStore` (localStorage): puntero + resumen por conversación
- Soft-complete y párrafos más robustos en respuestas largas cortadas a media frase
- Smoke: contratos progressive + reading state + orchestrator wire

## 0.10.10 rev.bb — M0+M1 dual memory + backup gate

- assistant-memory / dual-memory / memory-backup-gate modules
- Snapshot user memory before clear; restore vs start fresh in settings panel
- Settings: assistantMemory, memoryGatePending, relationshipState shell
- Orchestrator injects assistant memory prompt when present

## 0.10.10 rev.x

### E-ORCH-2
- orchestratorRun.ts (runOn + cloud queue)
- orchestratorTypes.ts

## 0.10.10 rev.w

### chatOrchestrator modular
- orchestratorProviders.ts
- orchestratorWebSearch.ts

## 0.10.10 rev.v

### Monoliths
- chatMusicFlow extract from useChat

## 0.10.10 rev.u

### Checkpoints message + capability replies
- modelsCount fallback disco/sync (sd-models 500)
- chatCapabilityReplies extract

## 0.10.10 rev.t

### Fix Forge start from chat
- Preflight GPU no bloquea arranque
- Probe API antes de preflight
- ensureForgeReady: más puertos + strip GPU scare

## 0.10.10 rev.s

### E-USECHAT-2 + E-IMG-GEN
- chatMediaPlan.ts
- image-ipc-generate.ts + shell image-ipc

## 0.10.10 rev.r

### useChat modular (parcial)
- chatNotify.ts, chatLocalShortcuts.ts
- useChat ~1326 LOC (antes ~1583)

## 0.10.10 rev.q

### image-ipc modular
- image-pollinations.ts
- image-ipc-meta.ts (health/models/folders)
- image-ipc.ts ~generate only + secureStore via globalThis

## 0.10.10 rev.p

### E-FORGE-RT
- forge-launch.ts: root, python, webui-user, bat launcher
- forge-runtime ~935 LOC (ciclo vida)
- fix orphan syntax post-ports extract

## 0.10.10 rev.o

### E-FORGE-RT (parcial)
- Nuevo src/main/forge-ports.ts (puertos + probe/scan health)
- forge-runtime reexporta; ~200 LOC menos de proceso puro

## 0.10.10 rev.n

### E-FAILMEM
- start_forge nunca bloqueado por cooldown
- éxito Forge limpia fallos de la familia health/start/probe
- mensajes sin URL :7890; humanize oculta omit health si start OK

## 0.10.10 rev.m

### Fix health Forge puerto muerto
- refreshForgeHealth: limpia baseUrl muerto (:7890); mensaje genérico 7860-7890
- strip fetch failed @ URL en humanize y health_forge
- Versiones: package + shared + renderer alineados 0.10.10 rev.m

## 0.10.10 rev.l

### E-TC
- scripts/typecheck-gate.mjs (tsc web+node si typescript instalado)
- engines node >=20
- npm run typecheck:gate

## 0.10.10 rev.k

### E-SMOKE+
- smoke-step3: contratos E-INIT, E-HMSG2, E4, planner, health_forge
- verify-step1: mismos contratos

## 0.10.10 rev.j

### E4 identity-match
- plugins/identity-match + tools/identity_match.py (analyze + score)
- host tools analyze_identity_refs, score_identity_match
- registry + catalog

## 0.10.10 rev.i

### E-HMSG2
- health_forge: ok solo si running; sin JSON; stopped=fail
- strip GPU NVIDIA scare
- LM Studio no se sugiere en flujos Forge

## 0.10.10 rev.h

### E-INIT fix fuerte
- Timer por tiempo absoluto desde ultimo mensaje user (no reset por settings genéricos)
- Streaming: reintento 4s, no reinicio del intervalo completo
- Modo fijo: sin horario silencioso; idle ~40% del intervalo
- Plantilla inmediata si modelo es LM Studio (id con /); Ollama LLM timeout 12s
- Harness no bloquea iniciativa; console.debug [initiative]

## 0.10.10 rev.g

### E-HMSG + E-INTENT
- planner: revisa Ollama/LM/Forge -> get_app_status
- start_forge human summary (R2 note not error)
- humanize start_forge/health_forge
- catalog phrases

## 0.10.10 rev.f

### E-INIT iniciativa
- shouldSendInitiative: waitMinOverride + minUserIdleMs (modo fijo 1 min ya no choca con gate de 3 min)
- useConversationInitiative: no reinicia el timer en cada pointer/key (solo mensajes user + settings)
- maxPerDay 8; reanuda al salir de actividad (mini-juego)
- Test: fixed mode short idle

## 0.10.10 rev.e

### E3 checklist release honesto
- docs/RELEASE-0.10.md reescrito para 0.10.10 (auto + manual + limitaciones)
- Criterio de uso diario separado de “perfecto”

### Limitaciones 0.10.x (declaradas)
- Plugin identity-match (E4) pendiente
- Typecheck global puede fallar fuera de módulos recientes
- R2 unload prioritario en Ollama; LM Studio best-effort
- Hi-Res 2K puede saturar VRAM baja
- FaceID sin score InsightFace no garantiza similitud numérica

## 0.10.10 rev.d

### E2 contratos automatizados
- verify-step1: R2 unload, forge-runtime skipUnload, ensureForgeReady, preload models:unloadLocal, forge-api-resolve, image-ipc wire, image-size, subject-prompt
- smoke-step3: archivos + recover_settings/web_search en hostTools + R2/resolve
- npm run release:check = verify + smoke (ambos OK)

## 0.10.10 rev.c

### E1 ingeniería
- Nuevo : resolveForgeApiForGeneration (status → scan → start → probe)
-  tryA1111 delega en ese módulo (~40 LOC menos de lógica duplicada)

### Aprendizaje face corrections r2
- Módulos pequeños con contrato claro (mismo estilo que image-size / subject-prompt)

## 0.10.10 rev.b — engineering docs

### Ingeniería
- docs/ENGINEERING.md: carril E0–E4, inventario LOC, reglas de módulo
- ROADMAP reorientado: ingeniería antes que features nuevas
- package.json kawaiiRevision alineado a b

