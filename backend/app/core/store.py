"""Documents, conversations, and messages persisted in Postgres.

ChatGPT-style: docs are a single global pool, conversations are independent
threads, each with full message history.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

from app.core.db import get_conn


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _to_iso(value) -> str:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.isoformat(timespec="seconds")
    return str(value)


# ---------- documents ----------

def list_documents() -> list[dict]:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, filename, file_path, file_type, pages, chunks, status, created_at
                  FROM documents
                 ORDER BY created_at DESC
                """
            )
            rows = cur.fetchall()
    return [_doc_row(r) for r in rows]


def get_document(document_id: str) -> dict | None:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, filename, file_path, file_type, pages, chunks, status, created_at
                  FROM documents WHERE id = %s
                """,
                (document_id,),
            )
            r = cur.fetchone()
    return _doc_row(r) if r else None


def upsert_document(doc: dict) -> dict:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO documents (id, filename, file_path, file_type, pages, chunks, status)
                VALUES (%(id)s, %(filename)s, %(file_path)s, %(file_type)s,
                        %(pages)s, %(chunks)s, %(status)s)
                ON CONFLICT (id) DO UPDATE SET
                    filename  = EXCLUDED.filename,
                    file_path = EXCLUDED.file_path,
                    file_type = EXCLUDED.file_type,
                    pages     = EXCLUDED.pages,
                    chunks    = EXCLUDED.chunks,
                    status    = EXCLUDED.status
                """,
                doc,
            )
        conn.commit()
    return get_document(doc["id"]) or doc


def delete_document(document_id: str) -> dict | None:
    doc = get_document(document_id)
    if not doc:
        return None
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM documents WHERE id = %s", (document_id,))
        conn.commit()
    return doc


def total_documents() -> int:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) AS n FROM documents")
            r = cur.fetchone()
    return int(r["n"]) if r else 0


def _doc_row(r: dict) -> dict:
    return {
        "id": r["id"],
        "filename": r["filename"],
        "file_path": r["file_path"],
        "file_type": r["file_type"],
        "pages": int(r["pages"]),
        "chunks": int(r["chunks"]),
        "status": r["status"],
        "created_at": _to_iso(r["created_at"]),
    }


# ---------- conversations ----------

def list_conversations() -> list[dict]:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT c.id, c.title, c.created_at, c.updated_at,
                       COUNT(m.id) AS message_count
                  FROM conversations c
                  LEFT JOIN messages m ON m.conversation_id = c.id
                 GROUP BY c.id
                 ORDER BY c.updated_at DESC
                """
            )
            rows = cur.fetchall()
    return [_conv_row(r) for r in rows]


def get_conversation(conversation_id: str) -> dict | None:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, title, created_at, updated_at FROM conversations WHERE id = %s",
                (conversation_id,),
            )
            r = cur.fetchone()
    if not r:
        return None
    return {
        "id": r["id"],
        "title": r["title"],
        "created_at": _to_iso(r["created_at"]),
        "updated_at": _to_iso(r["updated_at"]),
        "message_count": 0,
    }


def create_conversation(conversation_id: str, title: str = "New chat") -> dict:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO conversations (id, title)
                VALUES (%s, %s)
                RETURNING id, title, created_at, updated_at
                """,
                (conversation_id, title),
            )
            r = cur.fetchone()
        conn.commit()
    return {
        "id": r["id"],
        "title": r["title"],
        "created_at": _to_iso(r["created_at"]),
        "updated_at": _to_iso(r["updated_at"]),
        "message_count": 0,
    }


def update_conversation_title(conversation_id: str, title: str) -> None:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE conversations SET title = %s, updated_at = now() WHERE id = %s",
                (title, conversation_id),
            )
        conn.commit()


def touch_conversation(conversation_id: str) -> None:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE conversations SET updated_at = now() WHERE id = %s",
                (conversation_id,),
            )
        conn.commit()


def delete_conversation(conversation_id: str) -> bool:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM conversations WHERE id = %s", (conversation_id,))
            deleted = cur.rowcount
        conn.commit()
    return deleted > 0


def _conv_row(r: dict) -> dict:
    return {
        "id": r["id"],
        "title": r["title"],
        "created_at": _to_iso(r["created_at"]),
        "updated_at": _to_iso(r["updated_at"]),
        "message_count": int(r["message_count"]) if "message_count" in r else 0,
    }


# ---------- messages ----------

def list_messages(conversation_id: str) -> list[dict]:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, conversation_id, role, content, sources, attachments, created_at
                  FROM messages
                 WHERE conversation_id = %s
                 ORDER BY created_at ASC, id ASC
                """,
                (conversation_id,),
            )
            rows = cur.fetchall()
    return [_msg_row(r) for r in rows]


def delete_last_assistant_message(conversation_id: str) -> bool:
    """Remove the most recent assistant message in a conversation, used by regenerate."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                DELETE FROM messages
                 WHERE id = (
                    SELECT id FROM messages
                     WHERE conversation_id = %s AND role = 'assistant'
                     ORDER BY created_at DESC, id DESC
                     LIMIT 1
                 )
                """,
                (conversation_id,),
            )
            deleted = cur.rowcount
        conn.commit()
    return deleted > 0


def last_user_question(conversation_id: str) -> str | None:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT content FROM messages
                 WHERE conversation_id = %s AND role = 'user'
                 ORDER BY created_at DESC, id DESC
                 LIMIT 1
                """,
                (conversation_id,),
            )
            r = cur.fetchone()
    return r["content"] if r else None


def add_message(
    message_id: str,
    conversation_id: str,
    role: str,
    content: str,
    sources: list[dict] | None = None,
    attachments: list[str] | None = None,
) -> dict:
    sources_payload = json.dumps(sources or [])
    attachments_payload = json.dumps(attachments or [])
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO messages (id, conversation_id, role, content, sources, attachments)
                VALUES (%s, %s, %s, %s, %s::jsonb, %s::jsonb)
                RETURNING id, conversation_id, role, content, sources, attachments, created_at
                """,
                (message_id, conversation_id, role, content, sources_payload, attachments_payload),
            )
            r = cur.fetchone()
            cur.execute(
                "UPDATE conversations SET updated_at = now() WHERE id = %s",
                (conversation_id,),
            )
        conn.commit()
    return _msg_row(r)


def _msg_row(r: dict) -> dict:
    sources = r["sources"]
    if isinstance(sources, str):
        try:
            sources = json.loads(sources)
        except json.JSONDecodeError:
            sources = []
    attachments = r.get("attachments") if isinstance(r, dict) else []
    if isinstance(attachments, str):
        try:
            attachments = json.loads(attachments)
        except json.JSONDecodeError:
            attachments = []
    return {
        "id": r["id"],
        "conversation_id": r["conversation_id"],
        "role": r["role"],
        "content": r["content"],
        "sources": sources or [],
        "attachments": attachments or [],
        "created_at": _to_iso(r["created_at"]),
    }
