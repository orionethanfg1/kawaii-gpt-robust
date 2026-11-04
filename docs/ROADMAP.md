# Roadmap KawaiiGPT Robust

## Estado · 0.12.0-beta rev.gd

**Deflate del orquestador X0–X9: cerrado.**  
Capacidades resumidas: `docs/CAPABILITIES-0.12.md`.  
Decision layer: `docs/DECISION-LAYER-AND-JARVIS-COMPANION.md`.  
Extracción turn: `docs/ORCHESTRATOR-DEFLATE-PLAN.md`.

### Prioridad de trabajo (sigue vigente)

1. **Estabilidad** — single-resident VRAM (S1 completo), prefill bajo, escena/chip honestos, memoria limpia, tickets de archivo, gates/tests.
2. **Jarvis** — NL archivos + approval (base hecha), biblioteca bajo demanda, host allowlist, agenda/tray fiables.
3. **Companion** — iniciativas naturales (N1+X7), intimacy gated (X8), guardarropa estable.
4. **Extensiones** — idle review deterministic (X9 ✓); embeddings / Python decision opcional más adelante.

### Hecho reciente (deflate + decision)

- [x] DecisionPacket D0–D1 + tests
- [x] X1 system-layers · X2 document path · X3 stream helpers · X4 route/sticky
- [x] X5 agent/tools gated · X6 file NL · X7 initiative stream-done · X8 intimacy inject · X9 idle review
- [x] Continuidad escena, docs progressive + índice, backup completo, tools archivos A1/A2 base

### Pendiente prioritario (plan general)

| ID | Tema | Notas |
|----|------|--------|
| **S1+** | Un solo modelo en VRAM siempre | Unload al cambiar de ruta Auto; no 14B+26B a la vez |
| **S3** | Memoria confiable / sin basura | ✓ rev.ge noise filter + sanitize lists |
| **S4** | Chip cercanía = fase real | ✓ sticky scenePhase + lastIntimateSceneAt |
| **S5** | Escena salir/entrar natural | ✓ labels + no idle falso en sticky |
| **S6** | Prefill mínimo | Packet ya filtra; auditar system messages restantes |
| **N2** | Modelo decisión opcional | scoreDecision / modelo ligero solo para iniciativas |
| **Tray** | Click notificación → chat | Mejorado en dev; verificar empaquetado |
| **E2E** | Tests de recorrido UI | Ampliar suite essential |
| **Plugins** | API plugins estable | Documentar + versionar contratos |
| **Autoupdate** | Canal beta | Tras más estabilidad |
| **STT / clima** | Conciencia tiempo+clima | Clima parcial; STT según roadmap |
| **Imagen** | Gen estable + cancel limpio | Forge freeze / cancel a medias |
| **Vision** | Autodescripción robusta | Sin abliterated; VLM con visión real |
| **Orquestador** | &lt;1000 / &lt;500 líneas | Meta de mantenibilidad; facades ya fuera |

### Scene / Chat / Iniciativas

- [x] S1–S6 continuidad escena + tiempo en prompt (base)
- [ ] S7 más tests E2E
- [x] Panel «Pensó» si hay reasoning
- [x] N1 decisión LLM iniciativas
- [ ] N2 modelo de decisión opcional (scoreDecision)
- [x] N3 quiet hours / tope diario UI
- [x] X7 timer post-stream

### Docs / memoria

- [x] Leer y recordar + seek
- [x] Map-reduce / índice canónico
- [x] Delta re-ingest fingerprint
- [x] Idle harvest + consistency (X9)
- [ ] Validación usuario exhaustiva en lecturas largas


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
