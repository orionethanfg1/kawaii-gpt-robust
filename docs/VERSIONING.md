# Versionado

- **Semver producto:** `package.json` + `APP_VERSION` (ej. `0.12.0-beta`)
- **Revisión de desarrollo:** `APP_REVISION` (ej. `cn`) — cambia en cada tanda de fixes en dev
- **Estable de verdad:** solo **`1.0.0`** (no hay 0.x estable sin `-beta`)

UI: `KawaiiGPT Robust · v0.12.0-beta rev.cn`

| Etiqueta | Uso |
|----------|-----|
| `0.12.0-beta` | Corte de producto actual (intimidad, guardarropa, robustez chat) |
| `0.12.0-beta.N` | Parches de beta si hace falta |
| `1.0.0` | Primera estable pública |

Empaquetar cuando: `release:check` + smoke 0.12 + portable probado fuera de la carpeta de dev.
