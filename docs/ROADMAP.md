# Roadmap KawaiiGPT Robust

## Actual: 0.12.0-beta

Prioridad inmediata: estabilizar beta publicada + smoke (`docs/BETA-0.12.md`, `docs/SMOKE-0.12.md`).

### Hecho (extracto reciente)

- Continuidad de escena, guardarropa, backup completo, map-reduce docs + **ETL índice canónico** (rev.fc)
- N1 iniciativas LLM (SILENCIO / MENSAJE)
- Un modelo LMS a la vez; lectura docs progressive + leer-y-recordar
- Tray / notificaciones: base existe; **click → chat** aún fallable

### Scene / Chat / Iniciativas

- [x] S1–S6 continuidad escena + tiempo en prompt
- [ ] S7 más tests E2E
- [x] Panel «Pensó» si hay reasoning
- [x] N1 decisión LLM iniciativas
- [ ] N2 modelo de decisión opcional (scoreDecision)
- [x] N3 quiet hours / tope diario UI

### Docs / memoria

- [x] Leer y recordar + seek
- [x] Map-reduce formal + seed índice 1× LLM + barra de ingesta (rev.fb–fc)
- [x] Delta re-ingest: fingerprint size:mtime / length (rev.fm)
- [ ] Validación usuario: índice en lecturas posteriores

---

## Fase Agente escritorio (post-0.12 estable → 0.13.x)

Orientación **Jarvis**: el LLM decide *qué* hacer; la app impone *cómo* (rutas, confirmación, un modelo).

### A1 — Conciencia de archivos y biblioteca

- [x] Tool `list_library` + dirs conocidas (rev.fd)
- [x] Inventario unificado: uploads, adjuntos, wardrobe, context, images, backups (rev.fm)
- [x] Tools: `list_library`, `describe_file`, `classify_file` (rev.fm)
- [x] Vision opcional en `describe_file` (LMS/Ollama VLM; rev.fn)
- [x] El LLM puede proponer; mutaciones = A2

### A2 — Mutaciones acotadas

- [x] Tools: `move_file`, `copy_file`, `delete_file` (papelera), `rename_file` (rev.fn)
- [x] Solo bajo `userData`; `dryRun` o `confirm:true` + aprobación UI en riesgos
- [x] Audit log: `userData/backups/file-audit.log`
- [x] A2+: `trustedFileRoots` en settings (carpetas opted-in fuera de userData)

### A4 — Edición de texto

- [x] `read_text_file`, `propose_file_edit` (diff), `apply_file_edit` (confirm) — rev.fo


### A3 — Residencia SO (bandeja + agenda)

- [x] Minimizar a **system tray** (rev.fd)
- Minimizar a **system tray**; consumo bajo cuando no hay generación
- Agenda / recordatorios con app “cerrada” (ventana oculta o scheduler del SO)
- [x] Click notificación → ventana + `convId`/`activeId` (rev.fd; validar en Windows)

### A4 — Host commands básicos

- [x] `show_in_folder` + `open_external_url` (rev.fd)
- Lista blanca inicial: abrir carpeta, abrir URL, revelar en explorador, lanzar app permitida
- **No** shell libre ni PowerShell arbitrario en la primera iteración
- Edición de archivos: resumir / corregir / parche con diff mostrado y “Aplicar”

### A5 — Modelo

- Preferir perfiles tools+vision+reasoning (p. ej. Gemma 4 26B-A4B) cuando el hardware aguante
- Sigue la regla: un residente; unload antes de cambiar

---

## Luego (producto)

- Performance lista virtual de mensajes
- Try-on / imagen más robusta
- Cifrado intimidad (con recovery keys + backups)
- Autoupdate en build empaquetada (IPC ya existe)
- Onboarding requisitos Ollama / LMS
- Export memorias → LMS (opcional)
- Pack instalable + E2E hacia 1.0.0

## No priorizar

- Refactor total de `useChat` de un golpe
- Paridad ChatGPT / biometría legal
- Catálogo HF completo
- Shell ilimitado o control total del SO sin consentimiento por acción
