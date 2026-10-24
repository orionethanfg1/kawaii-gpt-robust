# Stack de identidad (auto-reparación)

## Problema Forge + batch
`KeyError: 0` en `postprocess_batch_list` (ControlNet) ocurre con **batch_size > 1** + FaceID.
**Mitigación app:** autorretrato / FaceID → siempre `batch_size = 1`.

## Descargas HF (ensure_faceid)
- `ip-adapter-faceid-plusv2_sd15.bin`
- `ip-adapter-faceid-plusv2_sd15_lora.safetensors` en `models/Lora` (no en `models/ControlNet`)
Repo: [h94/IP-Adapter-FaceID](https://huggingface.co/h94/IP-Adapter-FaceID)

## Prompt
La app inyecta `<lora:ip-adapter-faceid-plusv2_sd15_lora:0.8>` cuando FaceID está activo.
La comprobación del stack confirma tanto el modelo ControlNet como su LoRA; si una autorreferencia tiene avatar y Forge no puede aplicar la referencia, la generación se detiene en vez de presentar una identidad distinta como válida.

## Herramientas chat
- `instala FaceID` → ensure_faceid
- `assess_identity_stack` / diagnóstico identidad → qué falta del stack
