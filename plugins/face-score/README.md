Runtime local: `tools/face_similarity.py`.

El scorer usa embeddings ArcFace de InsightFace para comparar una referencia con
uno o más candidatos en una sola sesión del modelo. El resultado sirve únicamente
para ordenar candidatos: el coseno no está calibrado como umbral universal y no
demuestra que dos imágenes sean de la misma persona.

Se requiere que InsightFace, ONNX Runtime, OpenCV y NumPy estén instalados en el
intérprete Python y que el modelo `buffalo_l` ya exista en
`~/.insightface/models/buffalo_l`. El plugin no descarga paquetes ni modelos por
su cuenta. Si faltan dependencias/modelo o no se detecta una cara, devuelve un
estado sin score; no usa histogramas de color como sustituto.

Uso:

```text
python tools/face_similarity.py --ref reference.png --image candidate-1.png --image candidate-2.png --json
```
