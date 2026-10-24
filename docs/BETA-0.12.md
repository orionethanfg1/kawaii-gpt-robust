# Beta 0.12.0 — companion local-first

## Qué incluye (respecto a 0.11.x)

- Continuidad de escena íntima (entrada/salida, aftercare, chip de fase)
- Guardarropa clasificado + iniciativas visuales contextuales
- Persistencia más robusta (cuota, recovery, ficha en disco)
- Stream / continuar respuesta / markdown RP
- Corrector nativo del sistema (ES)
- **N1 iniciativas:** el LLM decide SILENCIO/MENSAJE (sin plantilla si hay modelo local)
- Lectura docs: progressive + **Leer y recordar** (ingesta + seek)
- Lectura docs: cursor hasta el final del archivo; visitas por capítulo
- Versionado: **solo betas hasta 1.0.0**

## Requisitos de usuario

| Modo | Necesita |
|------|----------|
| Solo cloud | Internet + API key |
| Local | Ollama **o** LM Studio (server ON) + modelo chat |
| Imagen | Forge/A1111 opcional |

## Build (desarrollador)

```bash
npm run release:check
npm run package:portable   # o package:nsis
```

Artefactos en `dist/`. Sin firma de código → SmartScreen puede avisar.

## Checklist antes de publicar 0.12.0-beta

1. `npm run release:check` verde  
2. Smoke: chat local, “descansar un poco” → chip **aftercare** (no “sin escena” con guion activo)  
3. Continuar respuesta / Detener sin freeze  
4. Descripción visual no se pisa al reiniciar  
5. Iniciativa con modelo local: tras idle, o mensaje natural o silencio (no plantilla repetida)
6. README + tag `v0.12.0-beta`

## Documentación obsoleta

- `BETA-0.11.md`, `SMOKE-0.10.md`, `RELEASE-0.10.md`, `PLAN-ROBUSTEZ-0.10.md` → históricos; usar este doc y `SMOKE-0.12.md` si existe.
