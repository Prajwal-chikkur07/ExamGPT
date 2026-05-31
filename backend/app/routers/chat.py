import json
import tempfile
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from app.core import document_processor, store
from app.models.schemas import ChatRequest, ChatResponse
from app.services.chat_service import answer, answer_stream
from app.utils.file_utils import safe_filename

router = APIRouter()


@router.post("/extract")
async def extract(files: list[UploadFile] = File(...)):
    """Extract text from files for use as one-shot chat context.

    Unlike /api/documents/upload, this does NOT persist the file, does NOT add
    chunks to the vector store, and does NOT register a Document row. The
    extracted text is returned directly so the frontend can pass it back as
    `inline_context` on the next chat turn.
    """
    out: list[dict] = []
    for f in files:
        suffix = Path(f.filename or "").suffix.lower() or ".bin"
        if suffix not in document_processor.supported_extensions():
            out.append(
                {
                    "filename": f.filename,
                    "text": "",
                    "error": f"Unsupported file type: {suffix}",
                }
            )
            continue
        content = await f.read()
        # Write to a temp file because the extractors expect a Path.
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(content)
            tmp_path = Path(tmp.name)
        try:
            pages = document_processor.extract_pages(tmp_path)
            text = "\n\n".join(p.text for p in pages).strip()
            out.append(
                {
                    "filename": safe_filename(f.filename or "attachment"),
                    "text": text,
                    "pages": len(pages),
                }
            )
        except Exception as exc:  # noqa: BLE001
            out.append(
                {"filename": f.filename, "text": "", "error": str(exc)}
            )
        finally:
            try:
                tmp_path.unlink(missing_ok=True)
            except OSError:
                pass
    return {"files": out}


@router.post("", response_model=ChatResponse)
def chat(payload: ChatRequest):
    if not store.get_conversation(payload.conversation_id):
        raise HTTPException(status_code=404, detail="Conversation not found")
    text, citations = answer(
        payload.conversation_id,
        payload.question,
        payload.answer_style,
        regenerate=payload.regenerate,
        inline_context=payload.inline_context,
        attachment_names=payload.attachment_names,
        images=payload.images,
    )
    return ChatResponse(
        answer=text, sources=citations, conversation_id=payload.conversation_id
    )


@router.post("/stream")
def chat_stream(payload: ChatRequest):
    """Server-Sent Events stream.

    Events:
      - sources : initial citation list
      - token   : a chunk of generated text
      - done    : end-of-stream
      - error   : something went wrong
    """
    if not store.get_conversation(payload.conversation_id):
        raise HTTPException(status_code=404, detail="Conversation not found")

    iterator, citations, finalize = answer_stream(
        payload.conversation_id,
        payload.question,
        payload.answer_style,
        regenerate=payload.regenerate,
        inline_context=payload.inline_context,
        attachment_names=payload.attachment_names,
        images=payload.images,
    )

    def event_stream():
        sources_payload = json.dumps({"sources": [c.model_dump() for c in citations]})
        yield f"event: sources\ndata: {sources_payload}\n\n"
        full = []
        try:
            for piece in iterator:
                if piece:
                    full.append(piece)
                    yield f"event: token\ndata: {json.dumps({'text': piece})}\n\n"
        except Exception as exc:  # noqa: BLE001
            yield f"event: error\ndata: {json.dumps({'message': str(exc)})}\n\n"
        finally:
            try:
                finalize("".join(full))
            except Exception:
                pass
        yield "event: done\ndata: {}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
