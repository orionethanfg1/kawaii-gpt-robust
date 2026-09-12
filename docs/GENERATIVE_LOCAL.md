# Generación de imagen 100 % local

## Principio
La calidad no depende de APIs externas. Forge (A1111/SD) + buen **prompt** + **preset de estilo** + **ficha visual** del personaje.

## Flujo
1. Usuario pide imagen en el chat (o panel).
2. `parseImageIntent` → framing + estilo.
3. `composeImagePrompt` → quality + preset + identidad pesada + negative.
4. `recommendSdParams` → width/height/steps/CFG según estilo.
5. `imageGenerate` vía Forge (`provider: a1111`).

## Presets (`STYLE_PRESETS`)
| id | Uso |
|----|-----|
| casual_photo | Por defecto, natural |
| portrait_studio | Headshot / estudio |
| cinematic | Drama / escena |
| anime | Ilustración 2D |
| soft_portrait | Cálido / íntimo |

## Identidad
`settings.character.visualDescription` + avatar/galería. El host **no** deja que el modelo invente otro color de pelo si la ficha dice rojo.

## Próximas mejoras locales
- Batch 2–4 seeds y elegir la mejor
- IP-Adapter fijo al avatar
- Hi-res fix / upscale local opcional
