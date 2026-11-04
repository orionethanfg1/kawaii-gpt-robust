# identity-match (E4)

- **Pre (`analyze`):** calidad de refs (cara detectable, área, usable).
- **Post (`score`):** score coseno de embeddings ArcFace para comparación relativa;
  no es una decisión calibrada ni prueba de identidad. Comparte el scorer local de
  `tools/face_similarity.py`.

Script: `tools/identity_match.py`

Deps opcionales:

```bash
pip install insightface onnxruntime opencv-python-headless numpy pillow
```

Sin deps la app sigue con FaceID de Forge; el plugin responde `deps_missing`.

El scorer requiere que `buffalo_l` ya esté disponible en
`~/.insightface/models/buffalo_l`; no descarga modelos automáticamente. Si no
detecta una cara o no puede cargar el scorer, no presenta un resultado positivo.
