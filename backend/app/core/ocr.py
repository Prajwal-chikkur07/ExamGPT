"""OCR helpers — extract text from images and from PDFs that are scans."""

from __future__ import annotations

from pathlib import Path

import pytesseract
from PIL import Image


def ocr_image(path: Path) -> str:
    img = Image.open(str(path))
    return pytesseract.image_to_string(img)


def ocr_pdf(path: Path, dpi: int = 200) -> str:
    """Render PDF pages to images and OCR them."""
    from pdf2image import convert_from_path

    images = convert_from_path(str(path), dpi=dpi)
    parts: list[str] = []
    for i, img in enumerate(images, start=1):
        text = pytesseract.image_to_string(img)
        if text.strip():
            parts.append(f"--- page {i} ---\n{text}")
    return "\n\n".join(parts)


def extract_text_from_any(path: Path) -> str:
    """For question papers — PDFs may already have a text layer; fall back to OCR."""
    ext = path.suffix.lower()
    if ext == ".pdf":
        try:
            from pypdf import PdfReader

            reader = PdfReader(str(path))
            text = "\n\n".join((p.extract_text() or "") for p in reader.pages).strip()
            if len(text) > 100:  # sufficient text layer present
                return text
        except Exception:
            pass
        return ocr_pdf(path)
    if ext in {".png", ".jpg", ".jpeg", ".bmp", ".tiff", ".webp"}:
        return ocr_image(path)
    if ext in {".txt", ".md"}:
        return path.read_text(encoding="utf-8", errors="ignore")
    raise ValueError(f"Unsupported question-paper file type: {ext}")
