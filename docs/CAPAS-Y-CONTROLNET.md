# Capas generativas y ControlNet

## Politica de VRAM
- Al arranque: chat listo; Forge y ACE no se levantan juntos.
- Al pedir imagen: prepareHeavyLayer('image') arranca Forge y libera ACE.
- Al pedir musica: se libera Forge y se prepara ACE.
- Si Forge ya esta en marcha, se reutiliza (fast path / sticky).

## ControlNet
Forge incluye el script ControlNet (alwayson_scripts). La app:
1. Detecta la carpeta models/ControlNet.
2. Puede descargar pesos basicos (openpose + canny) con descarga reanudable.
3. Usa IP-Adapter/FaceID cuando hay modelos y avatar de referencia.

Ruta en la UI: Ajustes > Capas > Extensiones Forge / ControlNet.
