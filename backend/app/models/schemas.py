from typing import Any, Optional
from pydantic import BaseModel, Field


# ---------- Documents ----------

class DocumentMeta(BaseModel):
    id: str
    filename: str
    file_type: str
    pages: int
    chunks: int
    created_at: str
    status: str = "indexed"  # indexed | failed | processing


class UploadResponse(BaseModel):
    documents: list[DocumentMeta]
    indexed_chunks: int


# ---------- Conversations ----------

class Conversation(BaseModel):
    id: str
    title: str
    created_at: str
    updated_at: str
    message_count: int = 0


class ConversationCreate(BaseModel):
    title: Optional[str] = None


class ConversationUpdate(BaseModel):
    title: str = Field(..., min_length=1, max_length=120)


class Message(BaseModel):
    id: str
    conversation_id: str
    role: str
    content: str
    sources: list[dict] = []
    # Each attachment is either a legacy plain filename or an object like
    # {name, data_url?} for newer rows that persist image previews.
    attachments: list[Any] = []
    created_at: str


# ---------- Chat ----------

class SourceCitation(BaseModel):
    document_id: str
    filename: str
    page: int
    snippet: str
    score: float


class ChatRequest(BaseModel):
    conversation_id: str
    question: str = Field(..., min_length=1)
    answer_style: str = "detailed"  # short | detailed | exam
    regenerate: bool = False  # if true, drop the last assistant message and re-answer
    inline_context: Optional[str] = None  # one-shot context (chat attachments), not indexed
    # Each entry is either a legacy plain filename or an object like
    # {name, data_url?}. Persisted verbatim with the user message.
    attachments: list[Any] = Field(default_factory=list)
    # Legacy field — older clients send just filenames. Merged with `attachments`.
    attachment_names: list[str] = Field(default_factory=list)


class ChatResponse(BaseModel):
    answer: str
    sources: list[SourceCitation]
    conversation_id: str


# ---------- Exam ----------

class ExamSolveResponse(BaseModel):
    questions: list[dict]  # [{question, answer, marks, confidence, sources}]


class ExamAnswerRequest(BaseModel):
    topic: str
    marks: int = 5  # 2 | 5 | 10


class ExamAnswerResponse(BaseModel):
    topic: str
    marks: int
    answer: str
    confidence: float
    sources: list[SourceCitation]


# ---------- Important Questions ----------

class ImportantQuestionsRequest(BaseModel):
    unit: Optional[str] = None
    count: int = 10
    kind: str = "predicted"  # predicted | unit_wise | repeated | viva


class ImportantQuestionsResponse(BaseModel):
    items: list[dict]


# ---------- Revision ----------

class RevisionRequest(BaseModel):
    unit: Optional[str] = None


class RevisionNotesResponse(BaseModel):
    notes_markdown: str
    definitions: list[dict]


class FlashcardsResponse(BaseModel):
    cards: list[dict]
