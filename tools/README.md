# Tools (Python) — KawaiiGPT Robust

Utilidades locales para diagnóstico de Forge/SD, FaceID y limpieza.
No requieren la app en marcha (salvo que indiques `--user-data`).

```bash
# Desde la raíz del repo
python tools/forge_probe.py
python tools/faceid_check.py
python tools/clean_diagnostics.py --list
python tools/clean_diagnostics.py --yes
python tools/prompt_scene_preview.py "chica en catsuit blanco de noche en un parque"
```

Requisitos: Python 3.10+ (stdlib only).

## Plugins (contrato)

Cada script puede usarse desde la app (harness / python-ipc) o a mano:



| Plugin | Uso |
|--------|-----|
|  | Estado Forge / ControlNet / FaceID |
|  | Archivos FaceID en disco |
|  | Score ref vs generada (InsightFace opcional) |
|  | Preview de escena / prompt |
|  | Limpieza de diagnósticos |

 **no es obligatorio**: sin  devuelve  y la gen con FaceID de Forge sigue igual.

Ver plan: [docs/IDENTITY-LOCAL-PLAN.md](../docs/IDENTITY-LOCAL-PLAN.md)

