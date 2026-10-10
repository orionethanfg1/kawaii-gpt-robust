# C3 — Política de identidad (autorretrato)

## Reglas

1. **Self** (`foto tuya`, autorretrato, avatar) → `requireFaceId` + **batch_size = 1**.
2. Si hay avatar/galería → usar refs; meta `imageHasReference` / `imageRefCount`.
3. Si FaceID falta en Forge → aviso en el mensaje (`⚠️ Autorretrato sin FaceID…`), no fingir biometría.
4. Pie/meta: `identidad: refs:N · FaceID:applied|missing · score:?`
5. Score bajo (<0.45) → sugerir regenerar o instalar FaceID.

## Criterio de hecho

- 3 autorretratos con FaceID OK: misma persona a ojo del usuario, o score/aviso documentado.
- Sin FaceID: nunca “silencioso” con cara genérica sin aviso.
