#!/usr/bin/env python3
"""List/delete exported diagnostics under Electron userData/diagnostics."""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path


def user_data_candidates() -> list[Path]:
    home = Path.home()
    return [
        home / "AppData" / "Roaming" / "kawaii-gpt-robust" / "diagnostics",
        home / ".config" / "kawaii-gpt-robust" / "diagnostics",
        home / "Library" / "Application Support" / "kawaii-gpt-robust" / "diagnostics",
    ]


def main() -> int:
    ap = argparse.ArgumentParser(description="Clean exported diagnostics (md/txt/json/log)")
    ap.add_argument("--dir", type=Path, help="Override diagnostics folder")
    ap.add_argument("--list", action="store_true", help="Only list files")
    ap.add_argument("--yes", action="store_true", help="Delete without prompt")
    args = ap.parse_args()

    dirs = [args.dir] if args.dir else user_data_candidates()
    target = next((d for d in dirs if d and d.exists()), None)
    if not target:
        print("No existe carpeta diagnostics. Candidatos:")
        for d in dirs:
            print(f"  · {d}")
        return 1

    files = [
        p
        for p in target.iterdir()
        if p.is_file() and p.suffix.lower() in {".md", ".txt", ".json", ".log"}
    ]
    print(f"Carpeta: {target}")
    print(f"Archivos: {len(files)}")
    for p in files:
        print(f"  · {p.name} ({p.stat().st_size} B)")

    if args.list or not files:
        return 0
    if not args.yes:
        ans = input("¿Borrar estos exports? [y/N] ").strip().lower()
        if ans not in {"y", "yes", "s", "si", "sí"}:
            print("Cancelado")
            return 0
    n = 0
    for p in files:
        try:
            p.unlink()
            n += 1
        except OSError as e:
            print(f"  skip {p.name}: {e}")
    print(f"Eliminados: {n}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
