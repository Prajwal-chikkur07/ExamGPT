# ExamGPT - Personal Exam Assistant

ExamGPT is a local study assistant for semester exam prep. Upload notes into a
pgvector-backed library, ask questions in a ChatGPT-style answer sheet, attach
one-off files to a single question, and get exam-friendly answers from Gemini.

## Current Features

- Notes Library for permanent uploads: PDF, DOCX, PPTX, TXT, and Markdown.
- Chat answer sheet with streaming responses, saved conversations, variants, and source viewing.
- Per-question attachments: PDF, DOCX, PPTX, TXT, Markdown, PNG, JPG, JPEG, and WebP.
- Direct Gemini vision support for image attachments, so scanned question papers are read by the model instead of relying only on OCR.
- Exam-style formatting for 2-mark, 5-mark, 10-mark, MCQ, comparison, algorithm, and numerical answers.
- Hybrid retrieval over uploaded notes using Postgres full-text search plus pgvector embeddings.
- Docker Compose setup for Postgres, backend, and frontend.

## Tech Stack

- Frontend: Next.js 15, React 19, TypeScript, TailwindCSS
- Backend: FastAPI, Pydantic, Google Gemini SDK
- Storage: Postgres 16 with pgvector
- Retrieval: Sentence Transformers embeddings, Postgres full-text search, RRF, cross-encoder reranking
- Parsing/OCR: pypdf, python-docx, python-pptx, Tesseract, Poppler, Pillow

## Project Structure

```text
chatbot/
├── backend/
│   ├── app/
│   │   ├── core/          # DB, vector store, document processing, LLM wrapper
│   │   ├── models/        # Pydantic schemas
│   │   ├── routers/       # FastAPI routes
│   │   ├── services/      # Chat, exam, revision workflows
│   │   └── utils/         # Prompts and file helpers
│   ├── data/uploads/      # Uploaded source files, gitignored
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/
│   ├── app/               # Next.js App Router
│   ├── components/
│   ├── lib/
│   ├── Dockerfile
│   └── package.json
├── docker-compose.yml
└── README.md
```

## Quick Start With Docker

1. Create the backend env file:

```bash
cp backend/.env.example backend/.env
```

2. Edit `backend/.env` and set:

```bash
GEMINI_API_KEY=your_gemini_api_key_here
```

3. Build and start everything:

```bash
docker compose up --build
```

Docker URLs:

- Frontend: http://localhost:3000
- Backend API: http://localhost:8001
- Backend health: http://localhost:8001/health
- Postgres: localhost:55432

The Docker frontend is configured with `NEXT_PUBLIC_API_URL=http://localhost:8001`.

## Local Development

Start Postgres with Docker:

```bash
docker compose up -d db
```

Start the backend:

```bash
cd backend
cp .env.example .env
# Add GEMINI_API_KEY to .env
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Start the frontend:

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

Local dev URLs:

- Frontend: http://localhost:3000, or the next free port shown by Next.js
- Backend API: http://localhost:8000
- Backend health: http://localhost:8000/health

If you run the backend through Docker but the frontend locally, set
`frontend/.env.local` to:

```bash
NEXT_PUBLIC_API_URL=http://localhost:8001
```

## Environment Variables

Backend (`backend/.env`):

```bash
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-2.5-flash
EMBEDDING_MODEL=sentence-transformers/all-MiniLM-L6-v2
DATABASE_URL=postgresql://examgpt:examgpt@localhost:5432/examgpt
UPLOAD_DIR=./data/uploads
CHUNK_SIZE=1000
CHUNK_OVERLAP=150
TOP_K=6
CORS_ORIGINS=http://localhost:3000
```

For Docker Compose, `DATABASE_URL` and `CORS_ORIGINS` are overridden in
`docker-compose.yml` so the backend talks to the `db` service and allows common
frontend dev ports.

Frontend (`frontend/.env.local`):

```bash
NEXT_PUBLIC_API_URL=http://localhost:8000
```

## Using The App

1. Open the frontend.
2. Go to Notes Library and upload study materials you want indexed permanently.
3. Open a new answer sheet and ask questions.
4. Use the `+` button in chat to attach files for only the current question.
5. Attach scanned exam-paper images directly; image files are sent to Gemini vision.
6. Attach PDFs/DOCX/PPTX/TXT/MD when you want text extracted and included as turn-only context.

Chat layout:

- Desktop: answer on the left, question and attachment preview on the right.
- Mobile: stacked question/answer layout.

## How Attachments Work

Permanent Notes Library uploads are parsed, chunked, embedded, and stored in
Postgres for future retrieval.

Per-question chat attachments are not indexed permanently:

- Images (`png`, `jpg`, `jpeg`, `webp`) are base64-encoded in the frontend and
  sent to Gemini as multimodal input.
- Non-image files are sent to `/api/chat/extract`; extracted text is passed into
  the next chat request as `inline_context`.
- Mixed uploads work: images go to Gemini vision while documents are text-extracted.

This avoids the old failure mode where Tesseract OCR misread scanned exam paper
images and the model answered from general AI knowledge instead of the paper.

## API Overview

| Method | Path | Description |
| --- | --- | --- |
| GET | `/health` | Liveness check |
| GET | `/api/conversations` | List conversations |
| POST | `/api/conversations` | Create a conversation |
| GET | `/api/conversations/{id}/messages` | List messages |
| POST | `/api/documents/upload` | Upload and index notes |
| GET | `/api/documents` | List indexed documents |
| DELETE | `/api/documents/{doc_id}` | Delete a document and its chunks |
| POST | `/api/chat/extract` | Extract text from one-off chat attachments |
| POST | `/api/chat` | Non-streaming chat response |
| POST | `/api/chat/stream` | Streaming chat response with SSE |
| POST | `/api/exam/solve` | OCR/extract and solve an uploaded question paper |
| POST | `/api/exam/answer` | Generate a 2/5/10-mark answer for a topic |
| POST | `/api/important-questions` | Generate important questions |
| POST | `/api/revision/notes` | Generate revision notes |
| POST | `/api/revision/flashcards` | Generate flashcards |

## Retrieval Pipeline

1. Follow-up questions may be rewritten into standalone search queries.
2. Dense retrieval uses pgvector cosine similarity over local embeddings.
3. Lexical retrieval uses Postgres full-text search.
4. Reciprocal Rank Fusion merges the dense and lexical results.
5. A local cross-encoder reranks candidate chunks.
6. Gemini generates the final answer using retrieved notes plus any current-turn attachments.

## Database

Tables are auto-created on backend startup:

- `documents`
- `chunks`
- `conversations`
- `messages`

Messages store source metadata and attachment filenames in JSONB. Deleting a
document removes its chunks; deleting a conversation removes its messages.

## Troubleshooting

### Browser Shows "Internal Server Error"

This usually means the Next.js dev server is stale or was started before the
latest build/config changes.

1. Stop the frontend terminal with `Ctrl+C`.
2. Restart from `frontend/`:

```bash
npm run dev
```

3. If Next chooses port `3001`, use the URL it prints.

If you are mixing Docker backend with local frontend, make sure
`frontend/.env.local` points to the Docker backend:

```bash
NEXT_PUBLIC_API_URL=http://localhost:8001
```

### Backend Health Check

```bash
curl http://localhost:8000/health
# or, with Docker backend:
curl http://localhost:8001/health
```

Expected response:

```json
{"status":"ok","service":"examgpt-api"}
```

### Rebuild Backend After Code Changes

```bash
docker compose build backend
docker compose up -d backend
```

### Next.js Workspace Root Warning

The frontend config sets `outputFileTracingRoot` to the repository root to avoid
Next.js accidentally selecting a parent directory when another lockfile exists
above this project.

## Verification Commands

```bash
python3 -m compileall backend/app
cd frontend && npm run build
```

`npm run lint` may ask Next.js to initialize ESLint if the repo has no ESLint
config yet.

## Limitations

- Gemini vision quality depends on image clarity, resolution, crop, and rotation.
- The older `/api/exam/solve` route still uses OCR/extraction; chat image attachments use Gemini vision directly.
- Raw uploads live under `backend/data/uploads/`; back up Postgres and this folder if you need full persistence.

## License

MIT - for personal and educational use.
