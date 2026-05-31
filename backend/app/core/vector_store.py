"""Production-grade retrieval over Postgres + pgvector.

Pipeline per query:
    1. Embed the query with the configured local model.
    2. Run two retrievers in parallel:
         - dense: pgvector cosine ANN search (HNSW)
         - lexical: Postgres full-text BM25-style search via `tsvector`
    3. Fuse the two ranked lists via Reciprocal Rank Fusion (RRF).
    4. Rerank the top candidates with a cross-encoder for final ordering.

This combination consistently beats either retriever alone on RAG benchmarks.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from functools import lru_cache
from typing import Optional

import numpy as np

from app.config import get_settings
from app.core import reranker
from app.core.db import get_conn


# Bounded thread pool so dense + lexical retrievers run in parallel.
_RETRIEVE_POOL = ThreadPoolExecutor(max_workers=4, thread_name_prefix="retrieve")


@dataclass
class RetrievedChunk:
    document_id: str
    filename: str
    page: int
    text: str
    score: float


@lru_cache
def _embedder():
    """Local embedding model. Imported lazily because it's heavy."""
    from sentence_transformers import SentenceTransformer

    settings = get_settings()
    return SentenceTransformer(settings.embedding_model)


def _embed(texts: list[str]) -> list[np.ndarray]:
    model = _embedder()
    vectors = model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
    return [np.asarray(v, dtype=np.float32) for v in vectors]


# ---------- writes ----------

def add_chunks(
    document_id: str,
    filename: str,
    chunks: list[tuple[int, str]],
) -> int:
    """Insert chunks for a single document. chunks = [(page, text), ...]"""
    if not chunks:
        return 0
    texts = [c[1] for c in chunks]
    embeddings = _embed(texts)
    rows = [
        (
            f"{document_id}_{i}",
            document_id,
            filename,
            int(chunks[i][0]),
            chunks[i][1],
            embeddings[i],
        )
        for i in range(len(chunks))
    ]
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.executemany(
                """
                INSERT INTO chunks (id, document_id, filename, page, content, embedding)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO NOTHING
                """,
                rows,
            )
        conn.commit()
    return len(chunks)


def delete_document(document_id: str) -> None:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM chunks WHERE document_id = %s", (document_id,))
        conn.commit()


# ---------- retrieval ----------

def _dense_search(
    embedding: np.ndarray, limit: int, document_id: Optional[str] = None
) -> list[dict]:
    sql = """
        SELECT id, document_id, filename, page, content,
               1 - (embedding <=> %s) AS score
          FROM chunks
    """
    params: list = [embedding]
    if document_id:
        sql += " WHERE document_id = %s"
        params.append(document_id)
    sql += " ORDER BY embedding <=> %s LIMIT %s"
    params.extend([embedding, limit])
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchall()


def _lexical_search(
    query: str, limit: int, document_id: Optional[str] = None
) -> list[dict]:
    """Postgres full-text search using websearch_to_tsquery (handles natural input)."""
    sql = """
        SELECT id, document_id, filename, page, content,
               ts_rank_cd(content_tsv, websearch_to_tsquery('english', %s)) AS score
          FROM chunks
         WHERE content_tsv @@ websearch_to_tsquery('english', %s)
    """
    params: list = [query, query]
    if document_id:
        sql += " AND document_id = %s"
        params.append(document_id)
    sql += " ORDER BY score DESC LIMIT %s"
    params.append(limit)
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchall()


def _rrf_fuse(rankings: list[list[dict]], k: int = 60) -> list[dict]:
    """Reciprocal Rank Fusion. Each ranking is a best-first list of dicts with an `id`.
    Returns a single deduped list sorted by fused score (best first)."""
    scores: dict[str, float] = {}
    rows_by_id: dict[str, dict] = {}
    for ranking in rankings:
        for rank, row in enumerate(ranking, start=1):
            rid = row["id"]
            scores[rid] = scores.get(rid, 0.0) + 1.0 / (k + rank)
            rows_by_id[rid] = row
    fused_ids = sorted(scores.keys(), key=lambda rid: scores[rid], reverse=True)
    out = []
    for rid in fused_ids:
        row = dict(rows_by_id[rid])
        row["fused_score"] = scores[rid]
        out.append(row)
    return out


def query(
    text: str,
    top_k: Optional[int] = None,
    document_id: Optional[str] = None,
) -> list[RetrievedChunk]:
    """Hybrid retrieval → RRF → cross-encoder rerank."""
    settings = get_settings()
    final_k = top_k or settings.rerank_top_k

    embedding = _embed([text])[0]
    # Run dense + lexical concurrently — each is its own DB round-trip.
    dense_future = _RETRIEVE_POOL.submit(
        _dense_search, embedding, settings.retrieve_top_k, document_id
    )
    lexical_future = _RETRIEVE_POOL.submit(
        _lexical_search, text, settings.retrieve_top_k, document_id
    )
    dense = dense_future.result()
    lexical = lexical_future.result()

    fused = _rrf_fuse([dense, lexical], k=settings.rrf_k)
    if not fused:
        return []

    # Rerank just enough candidates to get a solid final-k — fewer is faster.
    rerank_pool = fused[: max(final_k * 2, 8)]
    passages = [r["content"] for r in rerank_pool]
    ranked = reranker.rerank(text, passages, top_k=final_k)

    out: list[RetrievedChunk] = []
    for idx, score in ranked:
        r = rerank_pool[idx]
        out.append(
            RetrievedChunk(
                document_id=r["document_id"],
                filename=r["filename"],
                page=int(r["page"]),
                text=r["content"],
                # Normalize cross-encoder score to roughly [0, 1] for the UI confidence bar.
                # ms-marco scores are unbounded logits; a sigmoid keeps them comparable.
                score=_sigmoid(score),
            )
        )
    return out


def _sigmoid(x: float) -> float:
    import math

    return 1.0 / (1.0 + math.exp(-x))


def stats() -> dict:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) AS n FROM chunks")
            row = cur.fetchone()
    return {"chunks": int(row["n"]) if row else 0}


def build_context(chunks: list[RetrievedChunk], max_chars: int = 12000) -> str:
    """Concatenate chunks into a single context string with source labels."""
    pieces: list[str] = []
    used = 0
    for c in chunks:
        header = f"[{c.filename} p.{c.page}]"
        piece = f"{header}\n{c.text}"
        if used + len(piece) > max_chars and pieces:
            break
        pieces.append(piece)
        used += len(piece)
    return "\n\n---\n\n".join(pieces)
