"""Postgres connection pool + schema bootstrap.

We use psycopg3 with a sync connection pool. pgvector is registered on every
connection in the pool so `vector` parameters bind correctly.

Schema is ChatGPT-style:
- documents/chunks form one global knowledge base (no subjects).
- conversations + messages persist each chat thread.
"""

from __future__ import annotations

from contextlib import contextmanager
from functools import lru_cache
from typing import Iterator

import psycopg
from pgvector.psycopg import register_vector
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from app.config import get_settings


EMBEDDING_DIM = 384  # Gemini text-embedding-004 truncated via Matryoshka representation


SCHEMA_SQL = f"""
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS documents (
    id           TEXT PRIMARY KEY,
    filename     TEXT NOT NULL,
    file_path    TEXT NOT NULL,
    file_type    TEXT NOT NULL,
    pages        INT  NOT NULL,
    chunks       INT  NOT NULL,
    status       TEXT NOT NULL DEFAULT 'indexed',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chunks (
    id           TEXT PRIMARY KEY,
    document_id  TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    filename     TEXT NOT NULL,
    page         INT  NOT NULL,
    content      TEXT NOT NULL,
    embedding    vector({EMBEDDING_DIM}) NOT NULL,
    -- Generated lexical column for BM25-style full-text search.
    content_tsv  tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
);
CREATE INDEX IF NOT EXISTS chunks_document_idx ON chunks(document_id);

-- Approximate nearest neighbor index (cosine). HNSW is the modern default in pgvector >= 0.5.
CREATE INDEX IF NOT EXISTS chunks_embedding_idx
    ON chunks USING hnsw (embedding vector_cosine_ops);

-- Inverted index for lexical search.
CREATE INDEX IF NOT EXISTS chunks_tsv_idx
    ON chunks USING gin (content_tsv);

CREATE TABLE IF NOT EXISTS conversations (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL DEFAULT 'New chat',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS conversations_updated_idx ON conversations(updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
    id              TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content         TEXT NOT NULL,
    sources         JSONB NOT NULL DEFAULT '[]'::jsonb,
    attachments     JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_conversation_idx
    ON messages(conversation_id, created_at);

-- Backfill `attachments` column on databases created before it was introduced.
ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb;
"""


def _configure_connection(conn: psycopg.Connection) -> None:
    # Safe to call after init_schema() has run CREATE EXTENSION.
    register_vector(conn)


def _bootstrap_vector_extension(conninfo: str) -> None:
    """Ensure the `vector` extension exists via a raw connection.
    This MUST run before the pool opens, because the pool's configure callback
    calls `register_vector`, which queries the vector type's OID."""
    with psycopg.connect(conninfo, autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute("CREATE EXTENSION IF NOT EXISTS vector;")


@lru_cache
def _pool() -> ConnectionPool:
    settings = get_settings()
    if not settings.database_url:
        raise RuntimeError(
            "DATABASE_URL is not set. Add it to backend/.env (e.g. "
            "postgresql://examgpt:examgpt@localhost:5432/examgpt)."
        )
    _bootstrap_vector_extension(settings.database_url)
    pool = ConnectionPool(
        conninfo=settings.database_url,
        min_size=1,
        max_size=10,
        kwargs={"row_factory": dict_row},
        configure=_configure_connection,
        open=True,
    )
    return pool


@contextmanager
def get_conn() -> Iterator[psycopg.Connection]:
    pool = _pool()
    with pool.connection() as conn:
        yield conn


def init_schema() -> None:
    """Run on app startup. Idempotent. The `vector` extension is created
    in _pool() before the pool opens; here we create the rest of the schema."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(SCHEMA_SQL)
        conn.commit()
