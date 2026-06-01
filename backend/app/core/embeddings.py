"""Gemini text embeddings via the REST API.

We deliberately bypass `google-generativeai`'s `embed_content` because the
SDK's gRPC v1beta path was returning 404 for every embedding model on the
Render deployment, while the same API key works fine for `generateContent`.
Hitting the REST endpoint directly with httpx makes this robust to SDK
version drift and quietly-deprecated transports.

The model returns 768-dim vectors; we truncate to 384 to slot into the
existing `vector(384)` pgvector column without a schema migration.
"""

from __future__ import annotations

import numpy as np
import httpx

from app.config import get_settings


_API_HOST = "https://generativelanguage.googleapis.com"
_EMBED_MODEL = "models/embedding-001"
_EMBED_DIM = 384
_TIMEOUT = httpx.Timeout(connect=10.0, read=30.0, write=30.0, pool=10.0)


def _api_key() -> str:
    key = get_settings().gemini_api_key
    if not key:
        raise RuntimeError(
            "GEMINI_API_KEY is not set. Add it to backend/.env to use embeddings."
        )
    return key


def _normalize(values: list[float]) -> np.ndarray:
    arr = np.asarray(values[:_EMBED_DIM], dtype=np.float32)
    norm = float(np.linalg.norm(arr))
    if norm > 0:
        arr = arr / norm
    return arr


def _embed(texts: list[str], task_type: str) -> list[np.ndarray]:
    if not texts:
        return []
    url = f"{_API_HOST}/v1beta/{_EMBED_MODEL}:batchEmbedContents"
    payload = {
        "requests": [
            {
                "model": _EMBED_MODEL,
                "content": {"parts": [{"text": t}]},
                "taskType": task_type,
            }
            for t in texts
        ]
    }
    resp = httpx.post(
        url,
        params={"key": _api_key()},
        json=payload,
        timeout=_TIMEOUT,
    )
    resp.raise_for_status()
    data = resp.json()
    return [_normalize(e["values"]) for e in data["embeddings"]]


def embed_documents(texts: list[str]) -> list[np.ndarray]:
    return _embed(texts, task_type="RETRIEVAL_DOCUMENT")


def embed_query(text: str) -> np.ndarray:
    return _embed([text], task_type="RETRIEVAL_QUERY")[0]
