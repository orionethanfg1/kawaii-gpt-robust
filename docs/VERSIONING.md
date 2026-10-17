# Versionado KawaiiGPT Robust

## Formato

- **Semver npm / producto:** `package.json` + `APP_VERSION` (ej. `0.11.1-beta`, `0.11.1`, `0.12.0`)
- **Revisión de trabajo en la misma base:** `APP_REVISION` = `a`, `b`, `c`… (solo UI / CHANGELOG interno)

Ejemplo UI: `KawaiiGPT Robust · v0.11.1-beta rev.a`

## Política actual (post-primera beta)

| Situación | Acción |
|-----------|--------|
| Desarrollo diario sobre la beta | Subir **solo** `APP_REVISION` (a → b → c). **No** empaquetar. |
| Hotfix del mismo caso | Misma base + siguiente rev. |
| Beta validada, listo para usuarios | Quitar `-beta` → `0.11.1` (o `0.11.2` si hubo muchos parches) + **empaquetar**. |
| Hito grande (API, UX mayor, breaking) | Minor `0.12.0` (o major `1.0.0`) + empaquetar. |

## Empaquetado

- **No** generar NSIS/portable en cada rev.
- Empaquetar en: **0.11 estable** (sin beta) o **0.12+**.
- Los artefactos usan `package.json` `version` en el nombre del `.exe`.

## package.json

- En fase rev-only, `package.json` puede quedarse en `0.11.1-beta` hasta el tag estable.
- Al empaquetar estable: alinear `package.json` y `APP_VERSION`; `APP_REVISION` vacío o reiniciar en `a` solo si hay hotfix post-tag.

## Regla

Mismo hilo de bugs/features → misma `APP_VERSION` + revs. No inflar el patch (`.2`, `.3`) por cada commit en dev.
