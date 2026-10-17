#!/usr/bin/env python3
"""Probe A1111/Forge API: health, checkpoints, ControlNet models, FaceID presence."""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from typing import Any


def get_json(url: str, timeout: float = 8.0) -> Any:
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return json.loads(res.read().decode("utf-8", errors="replace"))


def main() -> int:
    ap = argparse.ArgumentParser(description="Probe Forge / A1111 local API")
    ap.add_argument(
        "--base",
        default="http://127.0.0.1:7860",
        help="Forge base URL (default http://127.0.0.1:7860)",
    )
    args = ap.parse_args()
    root = args.base.rstrip("/")
    print(f"== Forge probe · {root} ==")

    # options / progress
    try:
        opts = get_json(f"{root}/sdapi/v1/options")
        ckpt = opts.get("sd_model_checkpoint") or "(unknown)"
        print(f"[ok] API viva · checkpoint actual: {ckpt}")
    except Exception as e:
        print(f"[fail] API no responde: {e}")
        print("  → Arranca Forge con --api o usa «Arrancar Forge» en la app.")
        return 1

    try:
        models = get_json(f"{root}/sdapi/v1/sd-models")
        names = [
            m.get("model_name") or m.get("title") or m.get("filename") or "?"
            for m in (models or [])
        ]
        print(f"[ok] Checkpoints: {len(names)}")
        for n in names[:12]:
            print(f"     · {n}")
        if len(names) > 12:
            print(f"     … +{len(names) - 12} más")
    except Exception as e:
        print(f"[warn] sd-models: {e}")

    cn: list[str] = []
    for path in (
        f"{root}/controlnet/model_list",
        f"{root}/sdapi/v1/controlnet/model_list",
    ):
        try:
            raw = get_json(path)
            if isinstance(raw, dict):
                cn = list(raw.get("model_list") or raw.get("models") or [])
            elif isinstance(raw, list):
                cn = [str(x) for x in raw]
            if cn:
                break
        except Exception:
            continue

    if not cn:
        print("[warn] No se listó ControlNet (¿extensión instalada?)")
    else:
        print(f"[ok] ControlNet models: {len(cn)}")
        face = [m for m in cn if "faceid" in m.lower() or "face-id" in m.lower()]
        ipa = [m for m in cn if "ip-adapter" in m.lower() or "ip_adapter" in m.lower()]
        print(f"     FaceID-like: {len(face)} · IP-Adapter-like: {len(ipa)}")
        for m in (face or ipa)[:8]:
            print(f"     · {m}")
        if not face:
            print(
                "[!] Sin FaceID → autorretratos débiles. Instala "
                "ip-adapter-faceid-plusv2 en models/ControlNet."
            )
        else:
            print("[ok] FaceID detectado — self debería poder usar ControlNet.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
