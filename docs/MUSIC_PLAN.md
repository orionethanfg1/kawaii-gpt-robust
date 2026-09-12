# Música — plan de implementación

## Fase 1 (0.8.45) — hecha
- Análisis hardware ACE vs YuE
- Workspace + install código fuente reanudable

## Fase 2 (0.8.46) — hecha
- `uv` portable automático
- `uv sync` + `acestep-download` (turbo)
- Runtime API (`acestep-api`) puertos 8001+
- Health `/health`, generate `/release_task` + poll
- Chat: modality music → `musicGenerate`
- YuE sigue deshabilitado si VRAM baja (solo ACE)

## Fase 3
- Reproductor embebido en burbuja
- 2 variantes, letras estructuradas desde el LLM
- YuE runtime si eligible
- Consola de log embebida
