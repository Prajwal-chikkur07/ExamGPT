from __future__ import annotations

from pathlib import Path

from app.config import get_settings
from app.core import document_processor, store, vector_store
from app.utils.file_utils import new_id, safe_filename


SUPPORTED = document_processor.supported_extensions()


class DocumentError(Exception):
    pass


def _save_upload(filename: str, content: bytes) -> Path:
    settings = get_settings()
    upload_dir = Path(settings.upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)
    target = upload_dir / safe_filename(filename)
    stem, suffix = target.stem, target.suffix
    i = 1
    while target.exists():
        target = upload_dir / f"{stem}_{i}{suffix}"
        i += 1
    target.write_bytes(content)
    return target


def ingest_file(filename: str, content: bytes) -> dict:
    ext = Path(filename).suffix.lower()
    if ext not in SUPPORTED:
        raise DocumentError(f"Unsupported file type: {ext}. Supported: {sorted(SUPPORTED)}")

    saved = _save_upload(filename, content)

    try:
        pages = document_processor.extract_pages(saved)
    except Exception as exc:
        raise DocumentError(f"Failed to read file: {exc}") from exc

    if not pages:
        raise DocumentError("No extractable text found in document.")

    settings = get_settings()
    chunks = document_processor.chunk_pages(
        pages, chunk_size=settings.chunk_size, chunk_overlap=settings.chunk_overlap
    )
    if not chunks:
        raise DocumentError("Document produced no chunks after splitting.")

    document_id = new_id("doc_")
    doc = {
        "id": document_id,
        "filename": saved.name,
        "file_path": str(saved),
        "file_type": ext.lstrip("."),
        "pages": len(pages),
        "chunks": len(chunks),
        "status": "indexed",
    }
    store.upsert_document(doc)
    try:
        vector_store.add_chunks(
            document_id=document_id,
            filename=saved.name,
            chunks=[(c.page, c.text) for c in chunks],
        )
    except Exception:
        store.delete_document(document_id)
        raise
    return store.get_document(document_id) or doc


def remove_document(document_id: str) -> bool:
    doc = store.get_document(document_id)
    if not doc:
        return False
    vector_store.delete_document(document_id)
    try:
        Path(doc["file_path"]).unlink(missing_ok=True)
    except OSError:
        pass
    store.delete_document(document_id)
    return True
