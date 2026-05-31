from __future__ import annotations

import base64
import io
import re
from typing import Any, Iterator

from app.config import get_settings
from app.core import llm, store, vector_store
from app.models.schemas import ImageAttachment, SourceCitation
from app.utils.file_utils import new_id
from app.utils.prompts import (
    casual_chat_prompt,
    casual_with_attachments_prompt,
    chat_prompt,
    query_rewrite_prompt,
)


def _decode_images(images: list[ImageAttachment] | None) -> list[Any]:
    """Decode base64 image attachments into PIL images for Gemini multimodal."""
    if not images:
        return []
    from PIL import Image

    out: list[Any] = []
    for img in images:
        try:
            raw = base64.b64decode(img.data)
            pil = Image.open(io.BytesIO(raw))
            # Force load so the file is closed and the image is usable later.
            pil.load()
            out.append(pil)
        except Exception:
            continue
    return out


# Matches stray citation-style tags the model sometimes outputs despite being told not to,
# e.g. "[notes.pdf p.83]", "(file p. 711)", "[p.56]", "[Russell-Norvig p.997]".
_CITATION_TAG_RE = re.compile(
    r"\s*[\[\(][^\]\)\n]{0,200}?\bp\.?\s*\d+[a-zA-Z0-9\s\.,\-_]*[\]\)]",
    flags=re.IGNORECASE,
)


# Short, conversational messages that should skip the retrieval pipeline entirely
# and go straight to a chat-style response. Saves ~2-4 seconds for "hi" / "thanks".
_TRIVIAL_MESSAGES = {
    "hi", "hii", "hiii", "hey", "yo", "hello", "hola", "namaste",
    "thanks", "thank you", "thanks!", "thanks.", "thx", "ty", "tysm",
    "ok", "okay", "k", "cool", "great", "nice", "got it", "alright",
    "bye", "goodbye", "see you", "see ya", "cya",
    "good morning", "good night", "good afternoon", "good evening", "gm", "gn",
}
_TRIVIAL_PHRASES = (
    "how are you",
    "what can you do",
    "what are you",
    "who are you",
    "who made you",
    "what is your name",
    "what's your name",
)

# If the best reranker score is below this, treat as no-match and switch to casual mode.
_RELEVANCE_THRESHOLD = 0.30


def _is_trivial_message(text: str) -> bool:
    q = (text or "").strip().lower().rstrip("?!.,")
    if not q:
        return True
    if q in _TRIVIAL_MESSAGES:
        return True
    return any(q == p or q.startswith(p + " ") for p in _TRIVIAL_PHRASES)


def _strip_citations(text: str) -> str:
    if not text:
        return text
    cleaned = _CITATION_TAG_RE.sub("", text)
    # Collapse the double-spaces and orphan punctuation the strip can leave behind.
    cleaned = re.sub(r" {2,}", " ", cleaned)
    cleaned = re.sub(r"\s+([.,;:!?])", r"\1", cleaned)
    return cleaned


def _stream_strip_citations(iterator: Iterator[str]) -> Iterator[str]:
    """Wrap the LLM stream so citation tags are removed before reaching the client.

    We buffer up to ~300 chars and only flush text that's safely past any
    unclosed `[` / `(` — that way a multi-token tag like `[file p.83]` is
    rewritten before its `[` ever reaches the frontend.
    """
    HOLD = 300
    buffer = ""
    for chunk in iterator:
        if not chunk:
            continue
        buffer += chunk
        # Find a flush cutoff that doesn't split an in-progress bracket pair.
        unclosed = -1
        scan_start = max(0, len(buffer) - HOLD)
        for i in range(len(buffer) - 1, scan_start - 1, -1):
            c = buffer[i]
            if c in "[(":
                close = "]" if c == "[" else ")"
                if close not in buffer[i + 1:]:
                    unclosed = i
                    break
        if unclosed >= 0:
            cutoff = unclosed
        else:
            cutoff = max(0, len(buffer) - HOLD)
        if cutoff > 0:
            cleaned = _strip_citations(buffer[:cutoff])
            buffer = buffer[cutoff:]
            if cleaned:
                yield cleaned
    if buffer:
        tail = _strip_citations(buffer)
        if tail:
            yield tail


def _format_history(messages: list[dict], window: int) -> str:
    if not messages:
        return ""
    lines = []
    for msg in messages[-window:]:
        role = msg.get("role", "user")
        content = (msg.get("content") or "").strip()
        if not content:
            continue
        lines.append(f"{role.capitalize()}: {content}")
    return "\n".join(lines)


def _to_citations(chunks) -> list[SourceCitation]:
    out: list[SourceCitation] = []
    for c in chunks:
        snippet = c.text.replace("\n", " ").strip()
        if len(snippet) > 220:
            snippet = snippet[:220] + "..."
        out.append(
            SourceCitation(
                document_id=c.document_id,
                filename=c.filename,
                page=c.page,
                snippet=snippet,
                score=round(c.score, 3),
            )
        )
    return out


def _maybe_set_title(conversation_id: str, question: str) -> None:
    history = store.list_messages(conversation_id)
    user_msgs = [m for m in history if m["role"] == "user"]
    if len(user_msgs) <= 1:
        title = question.strip().splitlines()[0][:60]
        if title:
            store.update_conversation_title(conversation_id, title)


_FOLLOWUP_HINTS = re.compile(
    r"\b("
    r"it|its|this|that|these|those|them|they|their|"
    r"more|continue|elaborate|expand|further|deeper|details|detail|examples?|"
    r"also|same|earlier|above|previous|prior|before|"
    r"simpler|easier|harder|shorter|longer|"
    r"why\??$|how\??$"
    r")\b",
    re.IGNORECASE,
)


def _needs_rewrite(question: str) -> bool:
    """Cheap heuristic — only spend a Gemini call to rewrite the question if it
    actually looks like a context-dependent follow-up. Saves ~1s on most turns."""
    q = question.strip()
    if not q:
        return False
    # Very short messages are usually vague follow-ups ("more?", "examples").
    if len(q.split()) <= 3:
        return True
    return bool(_FOLLOWUP_HINTS.search(q))


def _rewrite_query(history_text: str, question: str) -> str:
    if not history_text.strip() or not _needs_rewrite(question):
        return question
    try:
        rewritten = llm.generate(
            query_rewrite_prompt(history_text, question), temperature=0.0
        ).strip()
    except Exception:
        return question
    rewritten = rewritten.strip("\"' `\n")
    if rewritten.lower().startswith("standalone query:"):
        rewritten = rewritten[len("standalone query:"):].strip()
    return rewritten or question


def answer(
    conversation_id: str,
    question: str,
    style: str,
    regenerate: bool = False,
    inline_context: str | None = None,
    attachment_names: list[str] | None = None,
    images: list[ImageAttachment] | None = None,
) -> tuple[str, list[SourceCitation]]:
    settings = get_settings()
    decoded_images = _decode_images(images)
    image_count = len(decoded_images)
    if regenerate:
        existing = store.last_user_question(conversation_id) or question
        question = existing
    else:
        store.add_message(
            new_id("msg_"),
            conversation_id,
            "user",
            question,
            attachments=attachment_names,
        )
        _maybe_set_title(conversation_id, question)

    # When regenerating, the trailing message in the DB is the user message we're
    # re-answering; otherwise it's the one we just inserted. Either way, exclude it
    # from history (it goes in `question` instead).
    prior = store.list_messages(conversation_id)[:-1]
    history_text = _format_history(prior, settings.history_window)

    # Fast path: skip retrieval for greetings / meta chat WHEN there are no attachments.
    if _is_trivial_message(question) and not inline_context and not decoded_images:
        text = _strip_citations(llm.generate(casual_chat_prompt(question, history_text)))
        store.add_message(new_id("msg_"), conversation_id, "assistant", text, sources=[])
        return text, []

    search_query = _rewrite_query(history_text, question)
    chunks = vector_store.query(search_query) if not inline_context or search_query else []
    weak = not chunks or chunks[0].score < _RELEVANCE_THRESHOLD

    # If we have inline attachments, those are the primary source — answer even if retrieval is weak.
    if (inline_context or decoded_images) and weak:
        prompt = casual_with_attachments_prompt(
            question,
            history_text,
            inline_context or "(No extracted text. Read the attached image(s) directly.)",
            image_count=image_count,
        )
        text = _strip_citations(llm.generate(prompt, images=decoded_images))
        store.add_message(new_id("msg_"), conversation_id, "assistant", text, sources=[])
        return text, []

    if weak and not inline_context and not decoded_images:
        text = _strip_citations(llm.generate(casual_chat_prompt(question, history_text)))
        store.add_message(new_id("msg_"), conversation_id, "assistant", text, sources=[])
        return text, []

    context = vector_store.build_context(chunks)
    prompt = chat_prompt(
        question,
        context,
        history_text,
        style,
        inline_context=inline_context,
        image_count=image_count,
    )
    text = _strip_citations(llm.generate(prompt, images=decoded_images))
    citations = _to_citations(chunks)
    store.add_message(
        new_id("msg_"),
        conversation_id,
        "assistant",
        text,
        sources=[c.model_dump() for c in citations],
    )
    return text, citations


_MAX_VARIANTS_PER_TURN = 5


def answer_stream(
    conversation_id: str,
    question: str,
    style: str,
    regenerate: bool = False,
    inline_context: str | None = None,
    attachment_names: list[str] | None = None,
    images: list[ImageAttachment] | None = None,
) -> tuple[Iterator[str], list[SourceCitation], callable]:
    """Streaming answer with citation stripping applied on finalize.

    Regenerate semantics: instead of deleting the previous assistant message we
    APPEND a new one. The frontend groups consecutive assistant messages after
    the same user turn as variants the student can flip between.
    """
    settings = get_settings()
    decoded_images = _decode_images(images)
    image_count = len(decoded_images)
    if regenerate:
        existing = store.last_user_question(conversation_id) or question
        question = existing
    else:
        store.add_message(
            new_id("msg_"),
            conversation_id,
            "user",
            question,
            attachments=attachment_names,
        )
        _maybe_set_title(conversation_id, question)

    prior = store.list_messages(conversation_id)[:-1]
    history_text = _format_history(prior, settings.history_window)

    def _make_casual_finalize():
        def finalize_empty(full_text: str) -> None:
            store.add_message(
                new_id("msg_"),
                conversation_id,
                "assistant",
                _strip_citations(full_text),
                sources=[],
            )

        return finalize_empty

    # On regenerate the LLM should produce a meaningfully different answer.
    temperature = 0.55 if regenerate else 0.2

    # Fast path: skip retrieval entirely for greetings / meta chat WHEN there are no attachments.
    if _is_trivial_message(question) and not inline_context and not decoded_images:
        iterator = _stream_strip_citations(
            llm.generate_stream(casual_chat_prompt(question, history_text), temperature=temperature)
        )
        return iterator, [], _make_casual_finalize()

    search_query = _rewrite_query(history_text, question)
    chunks = vector_store.query(search_query)
    weak = not chunks or chunks[0].score < _RELEVANCE_THRESHOLD

    if (inline_context or decoded_images) and weak:
        iterator = _stream_strip_citations(
            llm.generate_stream(
                casual_with_attachments_prompt(
                    question,
                    history_text,
                    inline_context or "(No extracted text. Read the attached image(s) directly.)",
                    image_count=image_count,
                ),
                temperature=temperature,
                images=decoded_images,
            )
        )
        return iterator, [], _make_casual_finalize()

    if weak and not inline_context and not decoded_images:
        iterator = _stream_strip_citations(
            llm.generate_stream(casual_chat_prompt(question, history_text), temperature=temperature)
        )
        return iterator, [], _make_casual_finalize()

    context = vector_store.build_context(chunks)
    prompt = chat_prompt(
        question,
        context,
        history_text,
        style,
        inline_context=inline_context,
        image_count=image_count,
    )
    iterator = _stream_strip_citations(
        llm.generate_stream(prompt, temperature=temperature, images=decoded_images)
    )
    citations = _to_citations(chunks)
    citation_payload = [c.model_dump() for c in citations]

    def finalize(full_text: str) -> None:
        store.add_message(
            new_id("msg_"),
            conversation_id,
            "assistant",
            _strip_citations(full_text),
            sources=citation_payload,
        )

    return iterator, citations, finalize
