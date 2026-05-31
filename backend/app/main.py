from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.core.db import init_schema
from app.routers import conversations, documents, chat, exam, revision, important_questions


@asynccontextmanager
async def lifespan(_app: FastAPI):
    get_settings()
    init_schema()
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
