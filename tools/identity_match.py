#!/usr/bin/env python3
"""
E4 identity-match — helper pre (analyze refs) + juez post (score gen vs refs).

Optional: insightface, onnxruntime, opencv-python-headless, numpy, pillow
Without deps → ok=false, reason=deps_missing (app keeps working).

  python tools/identity_match.py analyze --ref a.png [--ref b.png]
  python tools/identity_match.py score --ref a.png --image out.png [--threshold 0.45]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def emit(obj: dict, code: int = 0) -> None:
    obj.setdefault("tool", "identity_match")
    print(json.dumps(obj, ensure_ascii=False))
    raise SystemExit(code)


def load_bgr(path: str):
    try:
        import cv2  # type: ignore

        img = cv2.imread(path)
        if img is None:
            raise FileNotFoundError(path)
        return img
    except ImportError:
        from PIL import Image  # type: ignore
        import numpy as np  # type: ignore

        im = Image.open(path).convert("RGB")
        return np.array(im)[:, :, ::-1]


def cosine(a, b) -> float:
    import numpy as np  # type: ignore

    a = np.asarray(a, dtype=np.float32).reshape(-1)
    b = np.asarray(b, dtype=np.float32).reshape(-1)
    na = float(np.linalg.norm(a))
    nb = float(np.linalg.norm(b))
    if na < 1e-8 or nb < 1e-8:
        return 0.0
    return float(np.dot(a, b) / (na * nb))


def get_app():
    from insightface.app import FaceAnalysis  # type: ignore

    app = FaceAnalysis(name="buffalo_l")
    app.prepare(ctx_id=-1, det_size=(640, 640))
    return app


def analyze_one(app, path: str) -> dict:
    img = load_bgr(path)
    h, w = img.shape[:2]
    faces = app.get(img) or []
    if not faces:
        return {
            "path": path,
            "faces": 0,
            "quality": "none",
            "usable": False,
            "detail": "sin cara detectable",
        }
    face = max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))
    bw = float(face.bbox[2] - face.bbox[0])
    bh = float(face.bbox[3] - face.bbox[1])
    area_ratio = (bw * bh) / max(1.0, float(w * h))
    det = float(getattr(face, "det_score", 0.5) or 0.5)
    usable = area_ratio >= 0.04 and det >= 0.4 and len(faces) == 1
    quality = "good" if usable and area_ratio >= 0.08 else ("ok" if usable else "weak")
    return {
        "path": path,
        "faces": len(faces),
        "face_area_ratio": round(area_ratio, 4),
        "det_score": round(det, 4),
        "quality": quality,
        "usable": usable,
        "detail": f"{len(faces)} cara(s), area {area_ratio:.1%}, det {det:.2f}",
    }


def cmd_analyze(refs: list[str]) -> dict:
    try:
        import insightface  # noqa: F401
    except ImportError:
        return {
            "ok": False,
            "reason": "deps_missing",
            "mode": "analyze",
            "summary": (
                "identity-match analyze: falta insightface. "
                "Opcional: pip install insightface onnxruntime opencv-python-headless. "
                "FaceID de Forge sigue disponible."
            ),
            "refs": [],
        }
    app = get_app()
    rows = []
    for r in refs:
        if not Path(r).is_file():
            rows.append(
                {
                    "path": r,
                    "faces": 0,
                    "usable": False,
                    "quality": "missing",
                    "detail": "archivo ausente",
                }
            )
            continue
        try:
            rows.append(analyze_one(app, r))
        except Exception as e:
            rows.append(
                {
                    "path": r,
                    "usable": False,
                    "quality": "error",
                    "detail": str(e)[:160],
                }
            )
    usable = [x for x in rows if x.get("usable")]
    best = max(usable, key=lambda x: float(x.get("face_area_ratio") or 0), default=None)
    return {
        "ok": True,
        "mode": "analyze",
        "refs": rows,
        "usable_count": len(usable),
        "best_ref": (best or {}).get("path"),
        "summary": (
            f"Refs: {len(rows)} · usables: {len(usable)}"
            + (f" · mejor: {Path(best['path']).name}" if best else " · ninguna ref usable")
        ),
    }


def cmd_score(ref: str, image: str, threshold: float) -> dict:
    try:
        import insightface  # noqa: F401
    except ImportError:
        return {
            "ok": False,
            "reason": "deps_missing",
            "mode": "score",
            "summary": (
                "identity-match score: falta insightface (opcional). "
                "FaceID de Forge sigue activo sin este juez."
            ),
        }
    if not Path(ref).is_file():
        return {"ok": False, "reason": "ref_missing", "summary": f"No existe ref: {ref}"}
    if not Path(image).is_file():
        return {"ok": False, "reason": "image_missing", "summary": f"No existe image: {image}"}
    app = get_app()
    faces_r = app.get(load_bgr(ref)) or []
    faces_g = app.get(load_bgr(image)) or []
    if not faces_r or not faces_g:
        return {
            "ok": False,
            "reason": "no_face",
            "mode": "score",
            "ref_faces": len(faces_r),
            "image_faces": len(faces_g),
            "summary": "No se detecto cara en ref o generada",
        }
    fr = max(faces_r, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))
    fg = max(faces_g, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))
    sim = cosine(fr.normed_embedding, fg.normed_embedding)
    same = sim >= threshold
    return {
        "ok": True,
        "mode": "score",
        "score": round(sim, 4),
        "threshold": threshold,
        "same_person": same,
        "ref_faces": len(faces_r),
        "image_faces": len(faces_g),
        "summary": (
            f"Similitud {sim:.3f} "
            f"({'misma persona' if same else 'posible deriva'} · umbral {threshold})"
        ),
    }


def main() -> None:
    ap = argparse.ArgumentParser(description="E4 identity-match pre/post")
    sub = ap.add_subparsers(dest="cmd", required=True)

    pa = sub.add_parser("analyze", help="Pre-helper: calidad de refs")
    pa.add_argument("--ref", action="append", dest="refs", required=True)

    ps = sub.add_parser("score", help="Post-juez: gen vs ref")
    ps.add_argument("--ref", required=True)
    ps.add_argument("--image", required=True)
    ps.add_argument("--threshold", type=float, default=0.45)

    args = ap.parse_args()
    try:
        if args.cmd == "analyze":
            emit(cmd_analyze(list(args.refs or [])))
        else:
            emit(cmd_score(args.ref, args.image, float(args.threshold)))
    except SystemExit:
        raise
    except Exception as e:
        emit({"ok": False, "reason": "runtime_error", "summary": str(e)[:400]})


if __name__ == "__main__":
    main()
