"""Gemini wrapper. Sync + streaming.

We expose a sync streaming iterator which FastAPI's StreamingResponse can consume
directly without an asyncio wrapper. Transient 5xx / 429 errors from the
Gemini API are retried with exponential backoff so a single throttling blip
doesn't surface a 503 to the user.
"""

from __future__ import annotations

import logging
import random
import time
from functools import lru_cache
from typing import Iterator

import google.generativeai as genai
from google.api_core import exceptions as gax_exceptions

from app.config import get_settings


_log = logging.getLogger(__name__)

# Errors that are worth retrying — quota / temporary unavailability.
_RETRYABLE = (
    gax_exceptions.ResourceExhausted,        # 429
    gax_exceptions.ServiceUnavailable,        # 503
    gax_exceptions.DeadlineExceeded,          # 504
    gax_exceptions.InternalServerError,       # 500
)


@lru_cache
def _model():
    settings = get_settings()
    if not settings.gemini_api_key:
        raise RuntimeError(
            "GEMINI_API_KEY is not set. Add it to backend/.env to use the LLM."
        )
    genai.configure(api_key=settings.gemini_api_key)
    return genai.GenerativeModel(settings.gemini_model)


def _retry_call(fn, *, label: str, max_attempts: int = 4):
    """Run `fn()` retrying on transient Gemini API errors. Exponential backoff
    with jitter; total wall time bounded at roughly 7s before bubbling up."""
    delay = 0.5
    last: Exception | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            return fn()
        except _RETRYABLE as exc:
            last = exc
            if attempt == max_attempts:
                break
            sleep = delay + random.uniform(0, delay * 0.5)
            _log.warning(
                "%s: transient %s on attempt %d/%d, sleeping %.2fs",
                label, type(exc).__name__, attempt, max_attempts, sleep,
            )
            time.sleep(sleep)
            delay *= 2
    assert last is not None
    raise last


# gemini-2.5-flash supports up to ~65k output tokens. 8k was crashing on
# "answer everything in this PDF" style asks because the model spent its
# budget on internal reasoning before emitting any visible text.
_MAX_OUTPUT_TOKENS = 32768


def _safe_chunk_text(chunk) -> str:
    """The SDK's `.text` accessor raises if the candidate has no Part — which
    happens when finish_reason is MAX_TOKENS / SAFETY without any output."""
    try:
        return getattr(chunk, "text", "") or ""
    except Exception:  # noqa: BLE001
        return ""


def generate(prompt: str, temperature: float = 0.2) -> str:
    model = _model()

    def _call():
        return model.generate_content(
            prompt,
            generation_config={"temperature": temperature, "max_output_tokens": _MAX_OUTPUT_TOKENS},
        )

    resp = _retry_call(_call, label="generate")
    try:
        return (resp.text or "").strip()
    except Exception:  # noqa: BLE001
        # No usable Part — usually MAX_TOKENS with all budget spent on reasoning.
        return "_The model couldn't fit a response in the output budget — try a smaller / more focused request._"


def generate_stream(prompt: str, temperature: float = 0.2) -> Iterator[str]:
    model = _model()

    def _start():
        return model.generate_content(
            prompt,
            generation_config={"temperature": temperature, "max_output_tokens": _MAX_OUTPUT_TOKENS},
            stream=True,
        )

    resp = _retry_call(_start, label="generate_stream:start")
    produced_any = False
    for chunk in resp:
        text = _safe_chunk_text(chunk)
        if text:
            produced_any = True
            yield text
    if not produced_any:
        yield (
            "_The model didn't emit any text — usually this means the request "
            "was too broad and the output budget was spent on reasoning. Try "
            "narrowing it (e.g. one subject or one section at a time)._"
        )
