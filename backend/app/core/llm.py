"""Gemini wrapper. Sync + streaming.

We expose a sync streaming iterator which FastAPI's StreamingResponse can consume
directly without an asyncio wrapper.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Iterator

import google.generativeai as genai

from app.config import get_settings


@lru_cache
def _model():
    settings = get_settings()
    if not settings.gemini_api_key:
        raise RuntimeError(
            "GEMINI_API_KEY is not set. Add it to backend/.env to use the LLM."
        )
    genai.configure(api_key=settings.gemini_api_key)
    return genai.GenerativeModel(settings.gemini_model)


def generate(prompt: str, temperature: float = 0.2) -> str:
    model = _model()
    resp = model.generate_content(
        prompt,
        generation_config={"temperature": temperature, "max_output_tokens": 8192},
    )
    return (resp.text or "").strip()


def generate_stream(prompt: str, temperature: float = 0.2) -> Iterator[str]:
    model = _model()
    resp = model.generate_content(
        prompt,
        generation_config={"temperature": temperature, "max_output_tokens": 8192},
        stream=True,
    )
    for chunk in resp:
        text = getattr(chunk, "text", None)
        if text:
            yield text
