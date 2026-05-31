from __future__ import annotations

from app.core import llm, vector_store
from app.utils.file_utils import extract_json_block
from app.utils.prompts import (
    flashcards_prompt,
    important_questions_prompt,
    revision_notes_prompt,
)


def _broad_context(query_text: str, top_k: int = 18) -> str:
    # Revision / overview tasks want a wider context window than the chat default.
    chunks = vector_store.query(query_text, top_k=top_k)
    return vector_store.build_context(chunks, max_chars=14000)


def important_questions(kind: str, unit: str | None, count: int) -> list[dict]:
    seed = f"important exam questions {unit or ''} {kind}".strip()
    context = _broad_context(seed)
    if not context:
        return []
    raw = llm.generate(important_questions_prompt(kind, count, unit, context), temperature=0.3)
    data = extract_json_block(raw) or {}
    items = data.get("items", []) if isinstance(data, dict) else []
    return [i for i in items if isinstance(i, dict) and i.get("question")]


def revision_notes(unit: str | None) -> dict:
    seed = f"key concepts definitions {unit or 'overview'}"
    context = _broad_context(seed)
    if not context:
        return {"notes_markdown": "_No notes uploaded yet._", "definitions": []}
    raw = llm.generate(revision_notes_prompt(unit, context), temperature=0.2)
    data = extract_json_block(raw) or {}
    definitions = data.get("definitions", []) if isinstance(data, dict) else []
    import re

    notes_markdown = re.sub(r"```json.*?```", "", raw, flags=re.DOTALL).strip()
    return {"notes_markdown": notes_markdown, "definitions": definitions}


def flashcards(unit: str | None, count: int = 15) -> list[dict]:
    seed = f"flashcards key facts {unit or 'overview'}"
    context = _broad_context(seed)
    if not context:
        return []
    raw = llm.generate(flashcards_prompt(unit, context, count), temperature=0.3)
    data = extract_json_block(raw) or {}
    cards = data.get("cards", []) if isinstance(data, dict) else []
    return [c for c in cards if isinstance(c, dict) and c.get("front") and c.get("back")]
