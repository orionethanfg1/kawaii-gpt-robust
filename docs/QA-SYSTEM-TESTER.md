# QA · System Tester & repair reports

## Goal

Produce a **single artifact** (Markdown + JSON) that a human or coding agent can use to fix the app without guessing.

## Where

**Ajustes → Tester de sistema** (`SystemTesterPanel`).

## What it checks

| ID | Layer | Meaning |
|----|--------|---------|
| preload | app | `window.kawaii` bridge |
| ollama | local | `/api/tags` on local base URL |
| forge | image | A1111/Forge health |
| music-runtime | music | ACE runtime state |
| music-health | music | `GET /health` |
| music-generate | music | Optional smoke `musicGenerate` |
| music-api-shape | music | `typeof musicGenerate === 'function'` |
| keys | cloud | Which provider keys exist (names only) |
| p0-avatar-reference-flow | image | Avatar principal y ancla de identidad preparados para Forge img2img |

Plus optional **feedback** (likes/dislikes) and **music log tail**.

El tester no sustituye una generación real: el check P0 confirma que el avatar, la descripción
canónica y las escenas de la galería pueden llegar al camino local. La prueba manual recomendada
es pedir en el chat «genera una foto mía en otra escena» y comprobar que el progreso indica Forge
y que la respuesta conserva rostro, cabello y ojos. Si Forge falla, el mismo pedido debe continuar
por los fallbacks cloud configurados.

Para probar FaceID/IP-Adapter, instala previamente ControlNet y el peso compatible en Forge. La
app no descarga pesos grandes de forma implícita: si `/controlnet/model_list` expone un modelo
FaceID, lo usa; si no, registra el flujo local como `img2img` y continúa sin bloquear la generación.

## How to use after a failure

1. Run tests (enable music generate only when ACE is already up).
2. Copy Markdown.
3. Paste to coding agent with: *“Prioritize FAIL rows; do not regress PASS layers.”*

## Known fixed issues (0.8.65)

- `generateMusicTrack is not a function` — IPC imported a missing export; alias `generateMusicTrack = generateMusic` in `music-runtime.ts`.

## Manual checklist (block music)

- [ ] ACE log shows Server ready + `/health` 200
- [ ] Chat request for **song** does not throw function error
- [ ] Chat request for **lyrics only** does not call generate
- [ ] Tester music-runtime + music-health PASS
- [ ] Optional generate smoke PASS or clear timeout/error
