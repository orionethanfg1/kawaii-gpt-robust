#!/usr/bin/env python3
"""
Preview scene tags the app would emphasize (mirrors scene-spec / scene-force heuristics).
Does not call the LLM — quick offline check of Spanish prompts.
"""
from __future__ import annotations

import argparse
import re
import sys


def parse_scene(text: str) -> dict:
    t = text.lower()
    framing = "close"
    if re.search(
        r"cuerpo completo|cuerpo entero|full body|full-body|de pie|plano entero|head to toe",
        t,
    ):
        framing = "full"
    elif re.search(r"de cintura|medio cuerpo|half|waist", t):
        framing = "half"

    clothing = []
    if re.search(r"\bcatsuit\b", t):
        clothing.append("catsuit")
    m = re.search(
        r"(?:vestido|dress)\s+(rojo|roja|azul|verde|negro|negra|blanco|blanca|rosa)",
        t,
    ) or re.search(
        r"(azul|rojo|verde|negro|blanco|rosa)\s+(?:vestido|dress)",
        t,
    )
    if m:
        clothing.append(f"dress:{m.group(1)}")
    elif re.search(r"\bvestido\b|\bdress\b", t):
        clothing.append("dress")

    env = None
    if re.search(r"\bplaya\b|beach", t):
        env = "beach"
    if re.search(r"\bparque\b|park", t):
        env = "park"
    if re.search(r"\bciudad\b|calle|city", t):
        env = "city street"
    night = bool(re.search(r"de noche|\bnight\b|nocturn", t))
    eyes = None
    if re.search(r"ojos?\s+azules?|blue eyes", t):
        eyes = "blue eyes"
    is_self = bool(
        re.search(r"tuya|tuyo|de ti|autorretrato|selfie|foto tuya", t)
    ) and not re.search(r"otra persona|una chica|un chico", t)

    return {
        "framing": framing,
        "clothing": clothing,
        "environment": env,
        "night": night,
        "eyes": eyes,
        "is_self": is_self,
    }


def build_positive(scene: dict) -> list[str]:
    tags: list[str] = []
    if scene["framing"] == "full":
        tags += [
            "(full body:1.5)",
            "(head to toe:1.45)",
            "feet visible",
            "standing on floor",
        ]
    for c in scene["clothing"]:
        if c == "catsuit":
            tags += ["(catsuit:1.45)", "tight full-body catsuit", "legs covered"]
        elif c.startswith("dress:"):
            col = c.split(":", 1)[1]
            eng = {
                "azul": "blue",
                "rojo": "red",
                "roja": "red",
                "blanco": "white",
                "blanca": "white",
                "negro": "black",
                "negra": "black",
                "verde": "green",
                "rosa": "pink",
            }.get(col, col)
            tags.append(f"({eng} dress:1.45)")
    if scene["night"]:
        tags += ["(night scene:1.35)", "dark ambient"]
    if scene["environment"]:
        tags.append(f"({scene['environment']}:1.3)")
    if scene["eyes"] and not scene["is_self"]:
        tags.append(f"({scene['eyes']}:1.3)")
    return tags


def build_negative(scene: dict) -> list[str]:
    neg = ["green dress", "daylight portrait", "copy reference clothing"]
    if scene["framing"] == "full":
        neg += ["close-up", "headshot", "cropped legs", "missing feet"]
    if "catsuit" in scene["clothing"]:
        neg += ["nude", "bare shoulders only", "topless"]
    return neg


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("prompt", nargs="+", help="Texto del usuario (español)")
    args = ap.parse_args()
    text = " ".join(args.prompt)
    scene = parse_scene(text)
    pos = build_positive(scene)
    neg = build_negative(scene)
    print("== Scene preview (heurística app) ==")
    print(f"input: {text}")
    print(f"scene: {scene}")
    print("\nPOSITIVE (lead tags):")
    print(", ".join(pos) if pos else "(none)")
    print("\nNEGATIVE (anti-prior):")
    print(", ".join(neg))
    print("\nNota: la app también añade compose SD + FaceID en Forge.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
