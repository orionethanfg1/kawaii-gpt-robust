# Versionado

## Reglas

- **Semver de producto:** `package.json` + `APP_VERSION` en `src/shared/version.ts` y `src/renderer/src/shared/version.ts` (deben ser **idénticos**).
- **Revisión de desarrollo:** `APP_REVISION` (ej. `gi`) — **una letra (o secuencia) nueva por cada tanda de cambios** en dev; siempre bajo la base beta actual (`0.12.0-beta`).
- **No** volver a numeración 0.10.x / 0.11.x en código o UI tras el corte a `0.12.0-beta`.
- **Estable de verdad:** solo **`1.0.0`** (las 0.x llevan `-beta`).

## Etiqueta en UI

`KawaiiGPT Robust · v0.12.0-beta rev.gi`

## Historial de base

| Base | Uso |
|------|-----|
| `0.10.x` | Histórico pre-beta 0.11/0.12 (no usar en código actual) |
| `0.11.x-beta` | Histórico; supersedido por 0.12 |
| **`0.12.0-beta`** | **Corte actual** (Jarvis + companion, deflate, memoria, imagen, continuar…) |
| `0.12.0-beta rev.XX` | Cada tanda de fixes (ver `CHANGELOG.md`) |
| `1.0.0` | Primera estable pública |

## Checklist en cada tanda

1. Subir `APP_REVISION` en **ambos** `version.ts`.
2. Entrada al inicio de `CHANGELOG.md` (`## 0.12.0-beta rev.XX`).
3. Actualizar tabla en `docs/STATUS.md`.
4. `package.json` solo cambia cuando sube el semver de producto (ej. 0.12.1-beta), no en cada rev.

Empaquetar cuando: `release:check` + smoke 0.12 + portable probado fuera de la carpeta de dev.
