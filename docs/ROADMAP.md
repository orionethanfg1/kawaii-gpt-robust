# Roadmap KawaiiGPT Robust

## Actual: 0.12.0-beta

Prioridad inmediata: empaquetado + smoke (ver `docs/BETA-0.12.md`).

### Scene continuity (S)
- [x] S2 salida (descansar / soft close)
- [x] S3 alineación fase + chip
- [ ] S1 entrada limpia
- [ ] S4 oferta verbal natural
- [ ] S5 chips interactivos opcionales
- [ ] S6 tiempo en prompt (parcial)
- [ ] S7 más tests E2E

### Iniciativas (N)
- [x] N1 decisión LLM (SILENCIO / MENSAJE) + sin plantilla con modelo local
- [ ] N2 modelo de decisión opcional (solo si catálogo tiene scoreDecision alto)
- [ ] N3 tope diario / quiet hours ya parcial — unificar UI

### Memoria / docs (reciente)
- [x] CORE + episodios + harvest apodos
- [x] Lectura progresiva hasta fin de archivo (cursor fix)

### Luego (post 0.12.0-beta empaquetado)
- Performance lista virtual
- Try-on / imagen robusta
- Un solo modelo LMS cargado (orden 3)
- Cifrado intimidad (con backups)
- Autoupdate firmado

### Histórico
Planes 0.10 / smoke 0.10 quedan obsoletos; no usar como checklist.

# Roadmap — ingeniería primero

**Producto:** ver objetivo canónico en [COMPANION-EVOLUTION.md](./COMPANION-EVOLUTION.md) y README.

**Actual:** v0.10.10 rev.bc (trabajo) — lectura progresiva docs

## Principio
1. Carril **E** (ingeniería) antes que features grandes nuevas.
2. Cada feature extrae módulo o plugin; no crecer useChat / image-ipc / forge-runtime.
3. Versionado: [VERSIONING.md](./VERSIONING.md) — misma base 0.10.10 + rev.n para hotfixes.

Detalle de reglas: [ENGINEERING.md](./ENGINEERING.md)

Propósito companion / relación / autodiagnóstico: [COMPANION-EVOLUTION.md](./COMPANION-EVOLUTION.md).

Memoria fiable del asistente (B0–B6): [COMPANION-MEMORY-RELIABILITY-PLAN.md](./COMPANION-MEMORY-RELIABILITY-PLAN.md).

## Hecho (base 0.10)

- M1–M4 monolitos principales
- P0.1 iniciativa, P0.2 ensureForgeReady, P0.3 web, P2.1 plugins panel, D1 backups
- R2 unload Ollama antes de Forge (rev.b)
- Face prompt corrections (commit 54c4898 — multiple faces, violet eyes, same person)

## En curso / validar en máquina

| ID | Qué | Notas |
|----|-----|-------|
| V1 | Forge desde chat | Mensaje de error real + R2 visible |
| V2 | Autorretrato | Face corrections + refs; no solo tags |

## Siguiente — Carril E

| ID | Bloque | Prioridad |
|----|--------|-----------|
| **E0** | Higiene repo + docs ingeniería | Ahora |
| **E1** | forge-api-resolve (image-ipc) | Hecho rev.c |
| **E2** | verify/smoke R2 + resolve | Hecho rev.d |
| **E3** | Release checklist 0.10.x honesto | Hecho rev.e |
| **E4** | Plugin identity-match (pre+post) | Tras E0–E2 |

## Ahora (post-autorretrato)

| ID | Bloque |
|----|--------|
| **M0+M1** | Dual memory + backup gate al clear | Hecho rev.bb |
| **M2** | Onboarding al vacío + chips | Hecho rev.bc |
| **M3** | Extract memoria asistente + pestaña panel | Hecho rev.bd |
| **M4** | Confianza / apodos evolutivos | Hecho rev.be |
| **M5** | MemoryChipBar + smoke M0–M5 | Hecho rev.bf |
| INI-H | Iniciativa UX (sin «plantilla» en meta) |
| PLUG-1 | Plugins / harness tools |

Identidad: **baseline congelada** — no priorizar más prompts FaceID.

## Hacia 0.11 / 1.0 (faltante prioritario)

| Área | Qué falta |
|------|-----------|
| **Companion** | Aperturas menos repetidas; memoria favoritos coherente en chat largo; iniciativa estable post-harness |
| **Docs** | Lectura progresiva HECHA (rev.bc); opcional: resumen LLM del tramo (map-reduce formal) |
| **Ollama auto-start** | Arranque fiable cuando el proceso está cerrado (aún intermitente) |
| **Web search** | Paridad UX (citas visibles); menos `web:0` con respuesta inventada |
| **UI** | Toggle Smart/Avanzada; set de iconos kawaii; panel lateral minimizable; opciones imagen depuradas |
| **Packaging** | `package` / portable + smoke E2E mínimo hacia 0.11 |
| **Plugins** | API más rica para terceros (doc_read ya existe) |

## Más adelante (1.0)

- Pack instalable, E2E Playwright, memoria evolutiva fina, plugins terceros

## No priorizar

- Refactor total de useChat de un golpe
- Paridad ChatGPT / biometría legal
- Catálogo HF completo
