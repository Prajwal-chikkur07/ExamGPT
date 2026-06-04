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

import time

import numpy as np
import httpx

from app.config import get_settings


_API_HOST = "https://generativelanguage.googleapis.com"
# `embedding-001` / `text-embedding-004` are gone from the v1beta REST API
# (they 404). `gemini-embedding-001` is the current model; it defaults to
# 3072 dims but supports Matryoshka truncation via outputDimensionality, so we
# request 384 to slot straight into the existing vector(384) column.
_EMBED_MODEL = "models/gemini-embedding-001"
_EMBED_DIM = 384
# The batch endpoint caps how many contents it accepts per call; stay well under.
_MAX_BATCH = 100
_TIMEOUT = httpx.Timeout(connect=10.0, read=60.0, write=60.0, pool=10.0)


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
    key = _api_key()
    out: list[np.ndarray] = []
    # Split into sub-batches so large documents don't blow the per-call limit.
    for start in range(0, len(texts), _MAX_BATCH):
        batch = texts[start : start + _MAX_BATCH]
        payload = {
            "requests": [
                {
                    "model": _EMBED_MODEL,
                    "content": {"parts": [{"text": t}]},
                    "taskType": task_type,
                    "outputDimensionality": _EMBED_DIM,
                }
                for t in batch
            ]
        }
        data = _post_with_retry(url, key, payload)
        out.extend(_normalize(e["values"]) for e in data["embeddings"])
    return out


def _post_with_retry(url: str, key: str, payload: dict, max_attempts: int = 6) -> dict:
    """POST with exponential backoff on 429 (rate limit) and 5xx. The free tier
    enforces a per-minute quota, so we honor Retry-After and back off."""
    delay = 2.0
    for attempt in range(1, max_attempts + 1):
        try:
            resp = httpx.post(url, params={"key": key}, json=payload, timeout=_TIMEOUT)
        except httpx.TransportError:
            # Connection reset / server disconnect / timeout — retry with backoff.
            if attempt == max_attempts:
                raise
            time.sleep(delay)
            delay = min(delay * 2, 60.0)
            continue
        if resp.status_code == 429 or resp.status_code >= 500:
            if attempt == max_attempts:
                resp.raise_for_status()
            retry_after = resp.headers.get("retry-after")
            wait = float(retry_after) if retry_after and retry_after.isdigit() else delay
            time.sleep(wait)
            delay = min(delay * 2, 60.0)
            continue
        resp.raise_for_status()
        return resp.json()
    raise RuntimeError("unreachable")


def embed_documents(texts: list[str]) -> list[np.ndarray]:
    return _embed(texts, task_type="RETRIEVAL_DOCUMENT")


def embed_query(text: str) -> np.ndarray:
    return _embed([text], task_type="RETRIEVAL_QUERY")[0]
