# ExamGPT - Personal Semester Exam Assistant

An AI-powered Exam Intelligence Agent that learns from your study materials (PDFs, DOCX, PPTX, TXT) and helps you prepare for exams by answering questions, solving question papers, and generating revision notes — all grounded in your uploaded content with page citations.

## Features

- **Knowledge Base Builder** — Upload PDFs, DOCX, PPTX, TXT. Auto chunk, embed, and index into ChromaDB.
- **Ask Anything Chat** — ChatGPT-style streaming chat with source page citations.
- **Question Paper Solver** — Upload a question paper (PDF/image), OCR-extract questions, and auto-generate answers from your notes.
- **Important Questions Generator** — Probable exam questions, unit-wise breakdown, frequently occurring concepts, and viva questions.
- **Revision Mode** — One-page notes, flashcards, definitions, formula sheets.
- **Exam Mode** — 2-mark, 5-mark, and 10-mark formatted answers with confidence scores.
- **Multi-subject** isolation, dark-themed modern UI, mobile responsive.

## Tech Stack

**Frontend:** Next.js 15 (App Router), TypeScript, TailwindCSS, ShadCN UI
**Backend:** FastAPI, LangChain, Postgres + **pgvector**, Sentence Transformers, Tesseract OCR
**LLM:** Gemini 2.5 Flash

## Project Structure

```
chatbot/
├── backend/                    # FastAPI service
│   ├── app/
│   │   ├── main.py
│   │   ├── config.py
│   │   ├── core/               # Document processing, vector store, LLM, OCR
│   │   ├── routers/            # documents, chat, exam, revision, subjects
│   │   ├── services/           # Business logic
│   │   ├── models/             # Pydantic schemas
│   │   └── utils/              # Prompts, file utils
│   ├── data/uploads/           # Uploaded files (gitignored). Vectors live in Postgres.
│   ├── requirements.txt
│   ├── Dockerfile
│   └── .env.example
├── frontend/                   # Next.js 15 app
│   ├── app/                    # App router pages (chat, upload, exam, revision, important-questions)
│   ├── components/             # UI components (ShadCN) + custom
│   ├── lib/                    # API client, store, utils
│   ├── package.json
│   ├── Dockerfile
│   └── .env.example
├── docker-compose.yml
└── README.md
```

## Quick Start

### Prerequisites

- Python 3.11+
- Node.js 20+
- **Postgres 14+** with the `pgvector` extension installed
  - Mac: `brew install postgresql@16 pgvector`
  - Linux: `apt-get install postgresql postgresql-16-pgvector`
  - Or run the included Docker service: `docker compose up -d db`
- Tesseract OCR (`brew install tesseract` on macOS, `apt-get install tesseract-ocr` on Linux)
- A Google Gemini API key (https://aistudio.google.com/apikey)

### Create the database

```bash
# Using the Docker service (easiest)
docker compose up -d db

# Or manually with a local Postgres
createdb examgpt
psql examgpt -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

The app auto-creates tables (`subjects`, `documents`, `chunks` with the HNSW
cosine index) on startup.

### 1. Backend

```bash
cd backend
cp .env.example .env
# Edit .env and add your GEMINI_API_KEY
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Backend runs at http://localhost:8000. Docs at http://localhost:8000/docs.

### 2. Frontend

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

Frontend runs at http://localhost:3000.

### 3. Docker (one-shot)

```bash
cp backend/.env.example backend/.env
# add GEMINI_API_KEY
docker compose up --build
```

## Environment Variables

### Backend (`backend/.env`)

```
GEMINI_API_KEY=your_gemini_key_here
GEMINI_MODEL=gemini-2.0-flash-exp
EMBEDDING_MODEL=sentence-transformers/all-MiniLM-L6-v2
DATABASE_URL=postgresql://examgpt:examgpt@localhost:5432/examgpt
UPLOAD_DIR=./data/uploads
CHUNK_SIZE=1000
CHUNK_OVERLAP=150
CORS_ORIGINS=http://localhost:3000
```

### Frontend (`frontend/.env.local`)

```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

## API Overview

| Method | Path | Description |
|--------|------|-------------|
| GET    | `/health` | Liveness check |
| GET    | `/api/subjects` | List subjects |
| POST   | `/api/subjects` | Create subject |
| DELETE | `/api/subjects/{subject_id}` | Delete subject |
| POST   | `/api/documents/upload` | Upload + index documents |
| GET    | `/api/documents?subject_id=...` | List documents |
| DELETE | `/api/documents/{doc_id}` | Delete document |
| POST   | `/api/chat` | Ask a question (streaming SSE) |
| POST   | `/api/exam/solve` | Upload question paper, get answers |
| POST   | `/api/exam/answer` | Generate 2/5/10-mark answer for a topic |
| POST   | `/api/important-questions` | Generate important questions |
| POST   | `/api/revision/notes` | One-page revision notes |
| POST   | `/api/revision/flashcards` | Flashcards |

## How It Works

### Indexing pipeline

1. **Upload** — File is saved locally and parsed (PyPDF/python-docx/python-pptx/plain).
2. **Chunk** — LangChain `RecursiveCharacterTextSplitter` produces ~1000-char chunks with overlap.
3. **Embed** — Sentence Transformers `BAAI/bge-small-en-v1.5` produces 384-dim embeddings locally (no API call).
4. **Store** — Chunks + metadata (doc_id, page) saved to Postgres. Each chunk gets:
   - a `vector(384)` embedding column with an **HNSW cosine** index
   - a `tsvector` lexical column (auto-generated) with a **GIN** index

### Retrieval pipeline (per chat message)

1. **Query rewriting** — If the user message is a follow-up ("tell me more"), Gemini rewrites it into a standalone search query using the conversation history.
2. **Hybrid retrieval** — Two retrievers run in parallel:
   - **Dense** (semantic): pgvector cosine ANN search
   - **Lexical** (keyword): Postgres full-text BM25-style search via `websearch_to_tsquery`
3. **Reciprocal Rank Fusion (RRF)** — The two ranked lists are merged into a single ranking that benefits from both signals.
4. **Cross-encoder reranking** — A small local cross-encoder (`ms-marco-MiniLM-L-6-v2`) scores (query, passage) pairs directly, surfacing the most semantically precise top-k.
5. **Generation** — Gemini 2.5 Flash answers using only the top reranked chunks, with inline `[filename p.N]` citations.

### Database schema (auto-created)

- `documents(id, filename, file_path, file_type, pages, chunks, status, created_at)`
- `chunks(id, document_id → documents, filename, page, content, embedding vector(384), content_tsv tsvector)`
- `conversations(id, title, created_at, updated_at)`
- `messages(id, conversation_id → conversations, role, content, sources jsonb, created_at)`

`ON DELETE CASCADE` propagates, so deleting a document removes its chunks, and deleting a conversation removes its messages.

## Limitations

- OCR quality depends on input image clarity.
- PPTX page numbers map to slide numbers.
- Back up Postgres (`pg_dump examgpt`) for full persistence. Uploaded raw files live under `backend/data/uploads/` and should be backed up too if you want to re-index later.

## License

MIT — for personal/educational use.
