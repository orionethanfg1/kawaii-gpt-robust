#!/usr/bin/env python3
"""Scan common Forge/A1111 folders for FaceID / IP-Adapter weight files."""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

KEYWORDS = ("faceid", "face-id", "ip-adapter-faceid", "ip_adapter_faceid", "ip-adapter")


def default_roots() -> list[Path]:
    home = Path.home()
    candidates = [
        home / "stable-diffusion-webui" / "models" / "ControlNet",
        home / "stable-diffusion-webui-forge" / "models" / "ControlNet",
        home / "webui" / "models" / "ControlNet",
        home / "Documents" / "stable-diffusion-webui" / "models" / "ControlNet",
        home / "AppData" / "Roaming" / "kawaii-gpt-robust" / "sd-workspace",
    ]
    # env override
    extra = os.environ.get("FORGE_CONTROLNET_DIR") or os.environ.get("A1111_CONTROLNET_DIR")
    if extra:
        candidates.insert(0, Path(extra))
    return candidates


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", action="append", type=Path, help="Extra ControlNet folder")
    args = ap.parse_args()
    roots = list(default_roots())
    if args.dir:
        roots = list(args.dir) + roots

    print("== FaceID / IP-Adapter file scan ==")
    found_any = False
    for root in roots:
        if not root.exists():
            continue
        print(f"\n[{root}]")
        hits = []
        for p in root.rglob("*"):
            if not p.is_file():
                continue
            name = p.name.lower()
            if any(k in name for k in KEYWORDS) and p.suffix.lower() in {
                ".safetensors",
                ".pt",
                ".pth",
                ".bin",
                ".onnx",
            }:
                hits.append(p)
        if not hits:
            print("  (sin coincidencias)")
            continue
        found_any = True
        face = [h for h in hits if "faceid" in h.name.lower() or "face-id" in h.name.lower()]
        for h in hits[:20]:
            tag = " FACEID" if h in face else ""
            print(f"  · {h.name}{tag} ({h.stat().st_size // (1024 * 1024)} MB)")
        if not face:
            print("  [!] Hay IP-Adapter genérico pero no FaceID Plus v2.")
        else:
            print(f"  [ok] {len(face)} archivo(s) FaceID")
    if not found_any:
        print("\nNo se encontraron carpetas/archivos. Pasa --dir RUTA_CONTROLNET")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())


# Note: the Electron app downloads FaceID automatically via forge:installFaceId
# (h94/IP-Adapter-FaceID on Hugging Face) when a self portrait is requested
# without FaceID models. This script only *detects* files on disk.
