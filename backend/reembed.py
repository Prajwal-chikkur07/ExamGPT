"""Re-embed chunks whose stored embedding is a zero vector.

Earlier indexing ran while the embedding API was 404'ing, so every chunk was
saved with a zero-vector placeholder and dense/semantic search never worked.
This backfills real embeddings using the current model. Idempotent — rerunnable.

The deployed backend now also runs this automatically on startup (see
app/main.py), so you only need this script for a manual run or a full re-embed.

Usage:
    ./.venv/bin/python reembed.py          # backfill only zero-vector chunks
    ./.venv/bin/python reembed.py --all    # re-embed EVERY chunk (use after a
                                           # model change invalidates old vectors)
"""

from __future__ import annotations

import sys

from app.core.vector_store import (
    backfill_missing_embeddings,
    count_zero_embeddings,
)


def main() -> None:
    all_chunks = "--all" in sys.argv[1:]
    if all_chunks:
        print("re-embedding ALL chunks (model-change mode)")
    else:
        pending = count_zero_embeddings()
        print(f"{pending} chunks need embeddings")
        if not pending:
            return

    done = backfill_missing_embeddings(all_chunks=all_chunks)
    print(f"done — re-embedded {done} chunks.")


if __name__ == "__main__":
    main()
