"""Production-grade retrieval over Postgres + pgvector.

Pipeline per query:
    1. Embed the query with Gemini `text-embedding-004` (384-dim, RETRIEVAL_QUERY).
    2. Run two retrievers in parallel:
         - dense: pgvector cosine ANN search (HNSW)
         - lexical: Postgres full-text BM25-style search via `tsvector`
    3. Fuse the two ranked lists via Reciprocal Rank Fusion (RRF).
    4. Take the top fused candidates; score them by query-vs-chunk cosine
       similarity so the UI gets an interpretable [0, 1] confidence value.
"""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Optional

import numpy as np

from app.config import get_settings
from app.core.db import get_conn
from app.core.embeddings import embed_documents, embed_query


_log = logging.getLogger(__name__)


_RETRIEVE_POOL = ThreadPoolExecutor(max_workers=4, thread_name_prefix="retrieve")


@dataclass
class RetrievedChunk:
    document_id: str
    filename: str
    page: int
    text: str
    score: float


# ---------- writes ----------

def add_chunks(
    document_id: str,
    filename: str,
    chunks: list[tuple[int, str]],
) -> int:
    """Insert chunks for a single document. chunks = [(page, text), ...]

    If the embedding service is unavailable, persist the chunks with zero-vector
    placeholders so the document is still indexed for lexical (BM25) search.
    Dense retrieval will be no-op against those rows until they're re-embedded.
    """
    if not chunks:
        return 0
    texts = [c[1] for c in chunks]
    try:
        embeddings = embed_documents(texts)
    except Exception as exc:  # noqa: BLE001
        _log.warning(
            "embed_documents failed for %s; storing zero vectors so lexical search still works: %s",
            filename, exc,
        )
        embeddings = [np.zeros(384, dtype=np.float32) for _ in texts]
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


def count_zero_embeddings() -> int:
    """How many chunks still carry a zero-vector placeholder (i.e. were indexed
    while the embedding API was unavailable)."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            # A normalized real vector dotted with itself is 1; a zero vector is 0.
            cur.execute("SELECT COUNT(*) AS n FROM chunks WHERE (embedding <#> embedding) = 0")
            return int(cur.fetchone()["n"])


def backfill_missing_embeddings(batch_size: int = 100, *, all_chunks: bool = False) -> int:
    """Re-embed chunks stored with zero-vector placeholders and write the real
    vectors back. Idempotent and safe to run repeatedly. Returns the number of
    chunks re-embedded.

    Pass ``all_chunks=True`` to re-embed every chunk regardless of its current
    vector — needed if the embedding *model* changed and existing (non-zero)
    vectors live in a stale vector space.
    """
    where = "" if all_chunks else "WHERE (embedding <#> embedding) = 0"
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(f"SELECT id, content FROM chunks {where} ORDER BY id")
            rows = cur.fetchall()

    total = len(rows)
    if not total:
        return 0

    done = 0
    for start in range(0, total, batch_size):
        batch = rows[start : start + batch_size]
        texts = [r["content"] for r in batch]
        vecs = embed_documents(texts)
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.executemany(
                    "UPDATE chunks SET embedding = %s WHERE id = %s",
                    [(vecs[i], batch[i]["id"]) for i in range(len(batch))],
                )
            conn.commit()
        done += len(batch)
        _log.info("backfilled embeddings %d/%d", done, total)
    return done


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


def _cosine_scores_for(ids: list[str], embedding: np.ndarray) -> dict[str, float]:
    """Compute cosine similarity for an explicit set of chunk ids. Used to backfill
    scores for fused chunks that only came from the lexical retriever."""
    if not ids:
        return {}
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, 1 - (embedding <=> %s) AS score "
                "FROM chunks WHERE id = ANY(%s)",
                [embedding, ids],
            )
            return {row["id"]: float(row["score"]) for row in cur.fetchall()}


def query(
    text: str,
    top_k: Optional[int] = None,
    document_id: Optional[str] = None,
) -> list[RetrievedChunk]:
    """Hybrid retrieval (dense + lexical) → RRF fusion → top-k with cosine scores.

    If the embedding service is unavailable we degrade gracefully to lexical-only
    search rather than 500'ing the whole chat request — for attachment-driven
    turns the LLM still has the inline OCR context to work from.
    """
    settings = get_settings()
    final_k = top_k or settings.rerank_top_k

    embedding: Optional[np.ndarray] = None
    try:
        embedding = embed_query(text)
    except Exception as exc:  # noqa: BLE001
        _log.warning("embed_query failed; falling back to lexical-only search: %s", exc)

    dense: list[dict] = []
    if embedding is not None:
        dense_future = _RETRIEVE_POOL.submit(
            _dense_search, embedding, settings.retrieve_top_k, document_id
        )
        lexical_future = _RETRIEVE_POOL.submit(
            _lexical_search, text, settings.retrieve_top_k, document_id
        )
        dense = dense_future.result()
        lexical = lexical_future.result()
    else:
        lexical = _lexical_search(text, settings.retrieve_top_k, document_id)

    rankings = [r for r in (dense, lexical) if r]
    fused = _rrf_fuse(rankings, k=settings.rrf_k)
    if not fused:
        return []

    final = fused[:final_k]

    cosine_by_id = {r["id"]: float(r["score"]) for r in dense}
    if embedding is not None:
        missing = [r["id"] for r in final if r["id"] not in cosine_by_id]
        if missing:
            cosine_by_id.update(_cosine_scores_for(missing, embedding))

    out: list[RetrievedChunk] = []
    for r in final:
        # When we have no embedding, use the BM25 rank position to synthesize a
        # rough confidence score so the UI bar stays meaningful.
        score = cosine_by_id.get(r["id"])
        if score is None:
            score = 0.5
        score = max(0.0, min(1.0, float(score)))
        out.append(
            RetrievedChunk(
                document_id=r["document_id"],
                filename=r["filename"],
                page=int(r["page"]),
                text=r["content"],
                score=score,
            )
        )
    return out


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
