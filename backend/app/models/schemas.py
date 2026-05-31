from typing import Optional
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
    attachments: list[str] = []
    created_at: str


# ---------- Chat ----------

class SourceCitation(BaseModel):
    document_id: str
    filename: str
    page: int
    snippet: str
    score: float


class ImageAttachment(BaseModel):
    filename: str
    mime_type: str = "image/png"
    data: str  # base64-encoded raw bytes (no data: URL prefix)


class ChatRequest(BaseModel):
    conversation_id: str
    question: str = Field(..., min_length=1)
    answer_style: str = "detailed"  # short | detailed | exam
    regenerate: bool = False
    inline_context: Optional[str] = None  # extracted text from non-image attachments
    attachment_names: list[str] = Field(default_factory=list)
    images: list[ImageAttachment] = Field(default_factory=list)  # vision input, this turn only


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
