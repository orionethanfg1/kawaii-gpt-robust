# Qué puede hacer KawaiiGPT Robust · 0.12.0-beta (rev.gi)

Documento vivo: resume capacidades **reales** en código (no aspiracionales).  
Objetivo de producto: **Jarvis + companion** — utilidad de escritorio local y vínculo afectivo coherente, con el LLM como cerebro y la app como intermediaria segura.

---

## 1. Chat y modelos locales

- Chat con **Ollama** y **LM Studio** (OpenAI-compatible), más cloud opcional.
- Modo **Auto**: elige modelo según tarea (código, visión, chat, docs…) con scores.
- **DecisionPacket** (pre-LLM): clasifica turno (chat / docs / files / intimacy / tools…), decide qué inyectar al prompt (library, docs, harness, intimacy) y reduce prefill innecesario.
- **Un modelo residente en lectura de documentos** (no cambia de modelo a mitad de libro).
- Streaming, **continuar respuesta**, panel de **razonamiento** (thinking) separado cuando el modelo lo emite.
- Markdown en burbujas (negrita/cursiva con normalización).

## 2. Companion (persona y vínculo)

- Personaje configurable (nombre, vibe, rasgos, rol de relación).
- Memoria dual: usuario + asistente; hechos, gustos, apodos preferidos.
- **Iniciativas** (N1): el LLM decide SILENCIO o MENSAJE; timer anclado al **fin del stream** (X7), no al envío del usuario.
- Quiet hours y tope diario de iniciativas.
- **Intimidad** (opt-in adulta): etapas, fase de escena, memoria INTIMACY_FIRST / notas de escena; inyección de prompts **solo si** el packet lo pide (X8).
- Chip de cercanía / fase (UI); continuidad de escena menos plantilla.
- Guardarropa / galería de avatar: fotos en disco, tags, oferta de guardar, principal de chat.

## 3. Documentos

- Adjuntar PDF/DOCX/texto; extracción a disco.
- **Lectura progresiva** + checkpoint; “continuar lectura” / auto-chain limitado.
- Índice / recuerdos de documento (ETL canónico, map-reduce / seed); no reinyectar el libro entero en cada mensaje romántico.
- Opinión y resumen por tramos; memoria de progreso de lectura.

## 4. Jarvis / archivos y host

- Biblioteca y dirs conocidas (`list_library`, inventario uploads/wardrobe/context/backups).
- NL de archivos (X6): el modelo puede emitir `APP_ACTION` con tools allowlist (`list_library`, `describe_file`, `classify_file`, copy/move/rename/delete, `show_in_folder`, …).
- Mutaciones **solo bajo userData**, con approval / tickets / dryRun donde aplique.
- Diagnóstico de app, estado de capas, listado de modelos (harness completo solo cuando el packet lo requiere — X5).
- Web search opcional; agenda local (recordatorios con app abierta).
- Bandeja del sistema / notificaciones (click → foco mejorado en dev).
- Backup completo export/import; abrir carpeta de backups.

## 5. Imagen y visión

- Forge / SD local: generación, FaceID / identidad, presets de estilo.
- Visión: describir adjuntos; comparar con identidad del avatar cuando hay refs.
- Autodescripción física (mejor esfuerzo; calidad depende del VLM cargado).

## 6. Infra y mantenimiento

- Orquestador de chat **modularizado** (X0–X9): system-layers, docs path, stream helpers, route/model, agent tools, file NL, initiative hooks, intimacy inject, **idle review**.
- **Idle review** (X9): en reposo, harvest de nombres y pase de consistencia de memoria (sin LLM, fuera del turn).
- Testers in-app + vitest en módulos core (packet, layers, route, idle-review, …).
- Versionado `0.12.0-beta` + revisión `rev.*` en UI.

## 7. Lo que aún no es “cerrado”

Ver sección siguiente y `docs/ROADMAP.md`. En resumen: unload agresivo de VRAM, E2E amplios, plugin API pública, autoupdate, clima/STT pulidos, y que el LLM sea cada vez más el decisor con la app solo de guardrails.

---

*Última alineación docs: rev.gi · deflate X0–X9 completo.*
