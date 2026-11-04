#!/usr/bin/env python3
"""Compare face embeddings locally for relative ranking, not identity verification."""
from __future__ import annotations

import argparse
import json
from pathlib import Path


METHOD = "insightface_arcface_cosine"


def emit(payload: dict, code: int = 0) -> None:
    payload.setdefault("tool", "face_similarity")
    print(json.dumps(payload, ensure_ascii=False))
    raise SystemExit(code)


def load_bgr(path: str):
    import cv2  # type: ignore

    image = cv2.imread(path)
    if image is None:
        raise ValueError(f"No se pudo leer la imagen: {Path(path).name}")
    return image


def cosine(a, b) -> float:
    import numpy as np  # type: ignore

    a = np.asarray(a, dtype=np.float32).reshape(-1)
    b = np.asarray(b, dtype=np.float32).reshape(-1)
    na = float(np.linalg.norm(a))
    nb = float(np.linalg.norm(b))
    if na < 1e-8 or nb < 1e-8:
        raise ValueError("Embedding facial vacío")
    return float(np.dot(a, b) / (na * nb))


def create_face_analyzer():
    from insightface.app import FaceAnalysis  # type: ignore

    model_root = Path.home() / ".insightface"
    model_dir = model_root / "models" / "buffalo_l"
    if not model_dir.is_dir() or not any(model_dir.glob("*.onnx")):
        raise FileNotFoundError(
            "No está instalado localmente el modelo InsightFace buffalo_l."
        )
    analyzer = FaceAnalysis(
        name="buffalo_l",
        root=str(model_root),
        providers=["CPUExecutionProvider"],
    )
    analyzer.prepare(ctx_id=-1, det_size=(640, 640))
    return analyzer


def score_images(ref_path: str, image_paths: list[str]) -> dict:
    import cv2  # type: ignore
    import numpy as np  # type: ignore

    analyzer = create_face_analyzer()
    reference = analyzer.get(load_bgr(ref_path))
    if not reference:
        return {
            "ok": False,
            "reason": "no_face_in_ref",
            "method": METHOD,
            "summary": "No se detectó una cara en la referencia.",
        }
    ref_face = max(
        reference,
        key=lambda face: (face.bbox[2] - face.bbox[0])
        * (face.bbox[3] - face.bbox[1]),
    )

    results = []
    for image_path in image_paths:
        try:
            image = cv2.imread(image_path)
            if image is None:
                raise ValueError(f"No se pudo leer la imagen: {Path(image_path).name}")
            faces = analyzer.get(image)
            if not faces:
                results.append(
                    {
                        "ok": False,
                        "reason": "no_face_in_image",
                        "summary": "No se detectó una cara en la imagen.",
                    }
                )
                continue
            face = max(
                faces,
                key=lambda item: (item.bbox[2] - item.bbox[0])
                * (item.bbox[3] - item.bbox[1]),
            )
            score = cosine(ref_face.normed_embedding, face.normed_embedding)
            if not np.isfinite(score):
                raise ValueError("El scorer devolvió un valor no finito")
            results.append({"ok": True, "score": round(score, 6)})
        except Exception as error:
            results.append(
                {
                    "ok": False,
                    "reason": "image_scoring_error",
                    "summary": str(error)[:240],
                }
            )

    scored = sum(1 for result in results if result["ok"])
    return {
        "ok": scored > 0,
        "method": METHOD,
        "results": results,
        "summary": (
            "Similitud coseno de embeddings ArcFace para ranking relativo; "
            "no es una decisión calibrada ni prueba de identidad."
        ),
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Local ArcFace embedding similarity for candidate ranking"
    )
    parser.add_argument("--ref", required=True, help="Local reference image path")
    parser.add_argument(
        "--image",
        action="append",
        required=True,
        help="Local candidate image path; repeat to score a batch in one model session",
    )
    parser.add_argument("--json", action="store_true", help="Emit JSON (the default)")
    args = parser.parse_args()

    ref = Path(args.ref)
    if not ref.is_file():
        emit({"ok": False, "reason": "ref_missing", "summary": "No existe la referencia."})
    missing = [Path(path).name for path in args.image if not Path(path).is_file()]
    if missing:
        emit(
            {
                "ok": False,
                "reason": "image_missing",
                "summary": "No existen uno o más candidatos.",
                "missing": missing,
            }
        )

    try:
        result = score_images(str(ref), [str(Path(path)) for path in args.image])
    except ImportError as error:
        result = {
            "ok": False,
            "reason": "deps_missing",
            "method": None,
            "summary": (
                "Faltan dependencias locales del scorer (InsightFace, ONNX Runtime, "
                "OpenCV o NumPy). No se usará un proxy de color."
            ),
            "detail": str(error)[:240],
        }
    except FileNotFoundError as error:
        result = {
            "ok": False,
            "reason": "model_missing",
            "method": None,
            "summary": f"{error} No se descargó nada automáticamente.",
        }
    except Exception as error:
        result = {
            "ok": False,
            "reason": "runtime_error",
            "method": METHOD,
            "summary": str(error)[:400],
        }
    emit(result)


if __name__ == "__main__":
    main()
