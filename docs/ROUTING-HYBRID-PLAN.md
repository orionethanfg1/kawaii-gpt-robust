# Plan de ruteo híbrido (local + cloud)

## Objetivo
- Funcionar **con red y sin red**.
- **Local-first** para chat cotidiano (privacidad, latencia, sin quemar APIs).
- **Cloud** como respaldo real o cuando el usuario lo pide / hace falta web.
- Evitar failovers espurios (el fallo de `localFetch` en cloud ya se corrigió en 0.9.64).

## Capas

| Capa | Sin red | Con red |
|------|---------|---------|
| Chat | Solo Ollama/LM Studio | Local primero → cloud si local **caído de verdad** |
| Imagen | Forge local | Forge; cloud imagen solo si local imagen off |
| Host tools | Siempre local (FaceID, probe…) | Igual |
| Música/voz | Local si instalado | Igual |

## Política de failover (chat)

1. **Intentar local** si hay `localModel` + backend (aunque health sea flaky).
2. **Reintentar local** 1–2 veces (carga JIT de LM Studio).
3. **Cloud solo si:**
   - usuario en modo `cloud`, o
   - local **ECONNREFUSED / no running**, o
   - timeout local agotado y hay red, o
   - intención web explícita.
4. **No** escalar a cloud por:
   - un solo `PROVIDER_UNAVAILABLE` ambiguo,
   - telemetría “lean cloud”,
   - error de modelo no instalado (mejor mensaje: tira del modelo).

## Optimización de modelos locales

1. Lista de modelos instalados al vivo (Ollama + LM Studio).
2. Auto: elegir el más capaz que quepa en RAM (vision/tools si la tarea lo pide).
3. Pin de usuario respeta elección hasta que diga Auto.
4. Si el modelo pinneado falla → otro local instalado antes que cloud.

## Calidad de respuesta (por qué a veces “suena raro”)

- Historial largo → resumen heurístico (pierde matices).
- Modelo free cloud (OpenRouter) más genérico que tu 14B local.
- Failover a cloud = otra “voz” y menos contexto íntimo.
- Con local estable y sin failover, el personaje se mantiene mejor.

## Fases de implementación

- **Hecho:** proxy cloud vs localhost (0.9.64); telemetría no fuerza cloud; failover más estricto (0.9.65).
- **P1:** reintento local con backoff; segundo modelo local antes de cloud.
- **P2:** panel “ruta de este mensaje” (local/cloud + motivo) en UI simple.
- **P3:** perfiles de tarea (chat íntimo → local; código pesado → mayor; web → cloud).
