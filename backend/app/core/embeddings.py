"""Gemini text embeddings.

We use Google's `embedding-001` instead of a local Sentence-Transformers model
so the API server doesn't need to load torch + a 130 MB checkpoint into RAM.
The model returns 768-dim vectors; we truncate to 384 to slot into the
existing `vector(384)` pgvector column without a schema migration.
"""

from __future__ import annotations

import numpy as np
import google.generativeai as genai

from app.config import get_settings


_EMBED_MODEL = "models/embedding-001"
_EMBED_DIM = 384


def _ensure_configured() -> None:
    settings = get_settings()
    if not settings.gemini_api_key:
        raise RuntimeError(
            "GEMINI_API_KEY is not set. Add it to backend/.env to use embeddings."
        )
    genai.configure(api_key=settings.gemini_api_key)


def _normalize(vec: list[float]) -> np.ndarray:
    arr = np.asarray(vec, dtype=np.float32)
    norm = float(np.linalg.norm(arr))
    if norm > 0:
        arr = arr / norm
    return arr


def _embed(texts: list[str], task_type: str) -> list[np.ndarray]:
    """Embed via Gemini. We ask for the model's native 768-dim vector and
    truncate to 384 ourselves — text-embedding-004 is Matryoshka-trained,
    so the prefix is a valid lower-dim embedding once re-normalized. This
    avoids needing `output_dimensionality` support in the SDK version."""
    if not texts:
        return []
    _ensure_configured()
    resp = genai.embed_content(
        model=_EMBED_MODEL,
        content=texts,
        task_type=task_type,
    )
    raw = resp["embedding"]
    # The SDK returns a list[list[float]] for batch input, list[float] for a single string.
    if raw and isinstance(raw[0], (int, float)):
        raw = [raw]
    return [_normalize(v[:_EMBED_DIM]) for v in raw]


def embed_documents(texts: list[str]) -> list[np.ndarray]:
    return _embed(texts, task_type="RETRIEVAL_DOCUMENT")


def embed_query(text: str) -> np.ndarray:
    vectors = _embed([text], task_type="RETRIEVAL_QUERY")
    return vectors[0]
