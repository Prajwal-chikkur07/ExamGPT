"""Cross-encoder reranker. Scores (query, passage) pairs directly — much higher
precision than vector similarity, at the cost of being a real LLM call (cheap,
local, sub-100ms for top-20)."""

from __future__ import annotations

from functools import lru_cache

from app.config import get_settings


@lru_cache
def _model():
    from sentence_transformers import CrossEncoder

    settings = get_settings()
    return CrossEncoder(settings.reranker_model)


def rerank(query: str, passages: list[str], top_k: int) -> list[tuple[int, float]]:
    """Return [(original_index, score), ...] sorted best-first, truncated to top_k."""
    if not passages:
        return []
    model = _model()
    pairs = [[query, p] for p in passages]
    scores = model.predict(pairs, show_progress_bar=False)
    ranked = sorted(enumerate(scores), key=lambda x: float(x[1]), reverse=True)
    return [(idx, float(s)) for idx, s in ranked[:top_k]]
