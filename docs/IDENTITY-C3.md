# C3 — Política de identidad (autorretrato)

## Reglas

1. **Self** (`foto tuya`, autorretrato, avatar) → referencia facial obligatoria, `requireFaceId` y **batch_size = 1 por llamada Forge**; las seeds adicionales son secuenciales.
2. Si hay avatar/galería → usar refs; meta `imageHasReference` / `imageRefCount`.
3. Si FaceID falta en Forge → aviso en el mensaje (`⚠️ Autorretrato sin FaceID…`), no fingir biometría.
4. FaceID es aplicado solo si Forge acepta un modelo FaceID; IP-Adapter genérico no satisface el requisito. Plus v2 también requiere su LoRA.
5. ArcFace opcional ordena candidatos, pero el coseno no tiene umbral universal ni prueba identidad. Sin scorer se indica que no hubo evaluación automática.

## Criterio de hecho

- 3 autorretratos con FaceID OK: misma persona a ojo del usuario, o score/aviso documentado.
- Sin foto de referencia o sin FaceID aplicable: detener el autorretrato con una instrucción accionable; no entregar una cara genérica como si fuera el personaje.
