# identity-match (E4)

- **Pre (`analyze`):** calidad de refs (cara detectable, área, usable).
- **Post (`score`):** similitud gen vs ref.

Script: `tools/identity_match.py`

Deps opcionales:

```bash
pip install insightface onnxruntime opencv-python-headless numpy pillow
```

Sin deps la app sigue con FaceID de Forge; el plugin responde `deps_missing`.
