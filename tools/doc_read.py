#!/usr/bin/env python3
"""
Extract plain text from .docx / .pdf for KawaiiGPT.
  doc_read.py <file>
  doc_read.py <file> --out <path>          # write FULL extract (no char limit)
  doc_read.py <file> --out <path> --part 0 --part-size 1500000

stdout: text OR "OK total=<n> path=<out>" when --out is used.
"""
from __future__ import annotations

import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path


def extract_docx(path: Path) -> str:
    with zipfile.ZipFile(path, "r") as z:
        data = z.read("word/document.xml")
    root = ET.fromstring(data)
    texts: list[str] = []
    for el in root.iter():
        if el.tag.endswith("}t") and el.text:
            texts.append(el.text)
        elif el.tag.endswith("}tab"):
            texts.append("\t")
        elif el.tag.endswith("}br") or el.tag.endswith("}cr"):
            texts.append("\n")
        elif el.tag.endswith("}p"):
            texts.append("\n")
    raw = "".join(texts)
    raw = re.sub(r"\n{3,}", "\n\n", raw)
    return raw.strip()


def extract_pdf(path: Path) -> str:
    for mod in ("pypdf", "PyPDF2"):
        try:
            m = __import__(mod)
            reader_cls = getattr(m, "PdfReader", None)
            if reader_cls is None:
                continue
            reader = reader_cls(str(path))
            parts = []
            for page in reader.pages:
                try:
                    parts.append(page.extract_text() or "")
                except Exception:
                    continue
            text = "\n".join(parts).strip()
            if text:
                return text
        except Exception:
            continue
    import shutil
    import subprocess

    if shutil.which("pdftotext"):
        try:
            r = subprocess.run(
                ["pdftotext", "-layout", "-enc", "UTF-8", str(path), "-"],
                capture_output=True,
                timeout=180,
            )
            if r.returncode == 0 and r.stdout:
                return r.stdout.decode("utf-8", errors="replace").strip()
        except Exception:
            pass
    raise RuntimeError("PDF: instala pypdf (pip install pypdf) o pdftotext")


def main() -> int:
    args = sys.argv[1:]
    if not args:
        print("usage: doc_read.py <file> [--out path]", file=sys.stderr)
        return 1
    path = Path(args[0])
    out_path: Path | None = None
    i = 1
    while i < len(args):
        if args[i] == "--out" and i + 1 < len(args):
            out_path = Path(args[i + 1])
            i += 2
        else:
            i += 1
    if not path.is_file():
        print(f"not found: {path}", file=sys.stderr)
        return 1
    suf = path.suffix.lower()
    try:
        if suf == ".docx":
            text = extract_docx(path)
        elif suf == ".pdf":
            text = extract_pdf(path)
        elif suf in (".txt", ".md", ".csv", ".json", ".log"):
            text = path.read_text(encoding="utf-8", errors="replace")
        else:
            print(f"unsupported: {suf}", file=sys.stderr)
            return 2
    except Exception as e:
        print(str(e), file=sys.stderr)
        return 1
    if not text.strip():
        print("(vacío)", file=sys.stderr)
        return 1
    total = len(text)
    if out_path is not None:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        # Single full file — novels fit; if huge, also write parts for streaming readers
        out_path.write_text(text, encoding="utf-8")
        PART = 1_500_000
        if total > PART:
            base = str(out_path).replace(".extract.txt", "").replace(".txt", "")
            n = 0
            for off in range(0, total, PART):
                part = Path(f"{base}.extract.part{n:03d}.txt")
                part.write_text(text[off : off + PART], encoding="utf-8")
                n += 1
            manifest = Path(f"{base}.extract.manifest.json")
            import json
            manifest.write_text(
                json.dumps(
                    {
                        "totalChars": total,
                        "parts": n,
                        "complete": True,
                        "source": str(path),
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
        print(f"OK total={total} path={out_path}")
        return 0
    # stdout full text (Node may still clip — prefer --out)
    sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
