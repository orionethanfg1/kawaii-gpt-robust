#!/usr/bin/env python3
"""
Extract plain text from .docx / .pdf for KawaiiGPT chat attachments.
docx: stdlib zipfile + XML (no deps).
pdf: optional pypdf / PyPDF2 / pdftotext.
stdout: UTF-8 text. Exit 0 on success, 2 on unsupported/missing, 1 on error.
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
    # w:t text nodes
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
    # 1) pypdf / PyPDF2
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
    # 2) pdftotext CLI
    import shutil
    import subprocess

    if shutil.which("pdftotext"):
        try:
            r = subprocess.run(
                ["pdftotext", "-layout", "-enc", "UTF-8", str(path), "-"],
                capture_output=True,
                timeout=60,
            )
            if r.returncode == 0 and r.stdout:
                return r.stdout.decode("utf-8", errors="replace").strip()
        except Exception:
            pass
    raise RuntimeError(
        "PDF: instala pypdf (pip install pypdf) o pdftotext para leer PDFs"
    )


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: doc_read.py <file>", file=sys.stderr)
        return 1
    path = Path(sys.argv[1])
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
        return 2
    # Cap ~200k chars for IPC safety
    sys.stdout.write(text[:200_000])
    return 0


if __name__ == "__main__":
    sys.exit(main())
