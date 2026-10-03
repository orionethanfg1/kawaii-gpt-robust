# Versionado KawaiiGPT Robust

## Formato

- Semver npm / base: 0.10.10 (package.json + APP_VERSION)
- Revision de la misma base: rev.a, rev.b, ... (APP_REVISION)

Ejemplo UI: KawaiiGPT Robust · v0.10.10 rev.a

## Cuando subir que

| Cambio | Accion |
|--------|--------|
| Hotfix del mismo caso | Subir revision (a a b a c). No pasar a 0.10.11 |
| Feature o hito cerrado | Subir patch (0.10.10 a 0.10.11) y reiniciar revision |
| Cambio incompatible | minor 0.11.0 o major 1.0.0 |

## Regla

Si se persigue el mismo error, permanecer en 0.10.10 rev.n hasta cerrarlo.
