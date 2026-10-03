#!/usr/bin/env python3
"""
Plugin: face_similarity — score identity between reference and generated image.

Optional deps: insightface, onnxruntime, opencv-python-headless, numpy, pillow
Without deps → JSON ok=false, reason=deps_missing (does not crash the app).

Usage:
  python tools/face_similarity.py --ref path/to/ref.png --image path/to/out.png
  python tools/face_similarity.py --ref a.png --image b.png --threshold 0.5 --json
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def emit(obj: dict, code: int = 0) -> None:
    obj.setdefault("tool", "face_similarity")
    print(json.dumps(obj, ensure_ascii=False))
    raise SystemExit(code)


def load_bgr(path: str):
    try:
        import cv2  # type: ignore
    except ImportError:
        # pillow fallback path for existence check only
        from PIL import Image  # type: ignore
        import numpy as np  # type: ignore

        im = Image.open(path).convert("RGB")
        arr = np.array(im)[:, :, ::-1]  # RGB → BGR-like
        return arr
    img = cv2.imread(path)
    if img is None:
        raise FileNotFoundError(path)
    return img


def cosine(a, b) -> float:
    import numpy as np  # type: ignore

    a = np.asarray(a, dtype=np.float32).reshape(-1)
    b = np.asarray(b, dtype=np.float32).reshape(-1)
    na = float(np.linalg.norm(a))
    nb = float(np.linalg.norm(b))
    if na < 1e-8 or nb < 1e-8:
        return 0.0
    return float(np.dot(a, b) / (na * nb))


def score_insightface(ref_path: str, img_path: str) -> dict:
    from insightface.app import FaceAnalysis  # type: ignore

    app = FaceAnalysis(name="buffalo_l")
    # ctx_id=-1 CPU; 0 = first GPU if available
    app.prepare(ctx_id=-1, det_size=(640, 640))

    ref = load_bgr(ref_path)
    gen = load_bgr(img_path)
    faces_r = app.get(ref)
    faces_g = app.get(gen)
    if not faces_r:
        return {
            "ok": False,
            "reason": "no_face_in_ref",
            "summary": "No se detectó cara en la imagen de referencia.",
        }
    if not faces_g:
        return {
            "ok": False,
            "reason": "no_face_in_image",
            "summary": "No se detectó cara en la imagen generada.",
        }

    # largest face each
    fr = max(faces_r, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))
    fg = max(faces_g, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))
    emb_r = fr.normed_embedding
    emb_g = fg.normed_embedding
    sim = cosine(emb_r, emb_g)
    return {
        "ok": True,
        "score": round(sim, 4),
        "ref_faces": len(faces_r),
        "image_faces": len(faces_g),
        "summary": f"Similitud facial: {sim:.3f}",
    }


def main() -> None:
    ap = argparse.ArgumentParser(description="Face identity similarity (optional InsightFace)")
    ap.add_argument("--ref", required=True, help="Reference face image path")
    ap.add_argument("--image", required=True, help="Generated image path")
    ap.add_argument("--threshold", type=float, default=0.5, help="Same-person threshold")
    ap.add_argument("--json", action="store_true", help="JSON only (default behavior)")
    args = ap.parse_args()

    ref = Path(args.ref)
    img = Path(args.image)
    if not ref.is_file():
        emit({"ok": False, "reason": "ref_missing", "summary": f"No existe ref: {ref}"})
    if not img.is_file():
        emit({"ok": False, "reason": "image_missing", "summary": f"No existe image: {img}"})

    try:
        import insightface  # noqa: F401
    except ImportError:
        emit(
            {
                "ok": False,
                "reason": "deps_missing",
                "summary": (
                    "Plugin face_similarity: falta insightface (y onnxruntime). "
                    "Opcional: pip install insightface onnxruntime opencv-python-headless. "
                    "La app sigue generando con FaceID de Forge sin este filtro."
                ),
                "deps": ["insightface", "onnxruntime", "opencv-python-headless", "numpy"],
            }
        )

    try:
        result = score_insightface(str(ref), str(img))
    except Exception as e:
        emit(
            {
                "ok": False,
                "reason": "runtime_error",
                "summary": str(e)[:400],
            }
        )

    if not result.get("ok"):
        emit(result)

    score = float(result["score"])
    same = score >= float(args.threshold)
    result["threshold"] = args.threshold
    result["same_person"] = same
    result["summary"] = (
        f"Similitud {score:.3f} ({'misma persona' if same else 'posible deriva'} "
        f"· umbral {args.threshold})"
    )
    emit(result)


if __name__ == "__main__":
    main()
