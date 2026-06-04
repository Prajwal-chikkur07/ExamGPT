import logging
import threading
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.core.db import init_schema
from app.core.vector_store import backfill_missing_embeddings, count_zero_embeddings
from app.routers import conversations, documents, chat, exam, revision, important_questions


_log = logging.getLogger("app.main")


def _startup_backfill() -> None:
    """Heal chunks that were indexed with zero-vector placeholders (embedding
    API was unavailable at the time). Runs in a daemon thread so it never blocks
    startup or Render's health checks. No-op when there's nothing to fix."""
    try:
        pending = count_zero_embeddings()
        if not pending:
            return
        _log.info("startup: %d chunks missing embeddings — backfilling in background", pending)
        n = backfill_missing_embeddings()
        _log.info("startup: backfilled embeddings for %d chunks", n)
    except Exception:  # noqa: BLE001
        _log.exception("startup embedding backfill failed (semantic search may be degraded)")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    get_settings()
    init_schema()
    threading.Thread(target=_startup_backfill, name="embed-backfill", daemon=True).start()
    yield


app = FastAPI(
    title="ExamGPT API",
    description="Personal Semester Exam Assistant — answers grounded in your uploaded notes.",
    version="1.0.0",
    lifespan=lifespan,
)

settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok", "service": "examgpt-api"}


app.include_router(conversations.router, prefix="/api/conversations", tags=["conversations"])
app.include_router(documents.router, prefix="/api/documents", tags=["documents"])
app.include_router(chat.router, prefix="/api/chat", tags=["chat"])
app.include_router(exam.router, prefix="/api/exam", tags=["exam"])
app.include_router(revision.router, prefix="/api/revision", tags=["revision"])
app.include_router(important_questions.router, prefix="/api/important-questions", tags=["important-questions"])
