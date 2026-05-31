from __future__ import annotations

from pathlib import Path

from app.config import get_settings
from app.core import llm, ocr, vector_store
from app.models.schemas import SourceCitation
from app.utils.file_utils import extract_json_block, new_id, safe_filename
from app.utils.prompts import exam_answer_prompt, question_paper_extraction_prompt


def _save_question_paper(filename: str, content: bytes) -> Path:
    settings = get_settings()
    qp_dir = Path(settings.upload_dir) / "_question_papers"
    qp_dir.mkdir(parents=True, exist_ok=True)
    path = qp_dir / f"{new_id('qp_')}_{safe_filename(filename)}"
    path.write_bytes(content)
    return path


def _to_citations(chunks) -> list[SourceCitation]:
    out: list[SourceCitation] = []
    for c in chunks:
        snippet = c.text.replace("\n", " ").strip()
        if len(snippet) > 220:
            snippet = snippet[:220] + "..."
        out.append(
            SourceCitation(
                document_id=c.document_id,
                filename=c.filename,
                page=c.page,
                snippet=snippet,
                score=round(c.score, 3),
            )
        )
    return out


def _confidence_from_chunks(chunks) -> float:
    if not chunks:
        return 0.0
    top = chunks[0].score
    avg = sum(c.score for c in chunks) / len(chunks)
    return round(min(1.0, 0.6 * top + 0.4 * avg), 2)


def solve_question_paper(filename: str, content: bytes) -> list[dict]:
    saved = _save_question_paper(filename, content)
    raw_text = ocr.extract_text_from_any(saved)
    if not raw_text.strip():
        return []

    extraction = llm.generate(question_paper_extraction_prompt(raw_text), temperature=0.0)
    data = extract_json_block(extraction) or {}
    questions = data.get("questions", []) if isinstance(data, dict) else []

    results: list[dict] = []
    for q in questions:
        text = (q.get("text") or "").strip()
        if not text:
            continue
        marks = q.get("marks") if isinstance(q.get("marks"), int) else 5
        chunks = vector_store.query(text)
        if chunks:
            context = vector_store.build_context(chunks)
            answer = llm.generate(exam_answer_prompt(text, marks, context))
            confidence = _confidence_from_chunks(chunks)
            citations = _to_citations(chunks)
        else:
            answer = "Not found in your uploaded notes."
            confidence = 0.0
            citations = []
        results.append(
            {
                "number": q.get("number"),
                "question": text,
                "marks": marks,
                "answer": answer,
                "confidence": confidence,
                "sources": [c.model_dump() for c in citations],
            }
        )
    return results


def answer_for_marks(topic: str, marks: int) -> dict:
    chunks = vector_store.query(topic)
    if not chunks:
        return {
            "topic": topic,
            "marks": marks,
            "answer": "Not found in your uploaded notes.",
            "confidence": 0.0,
            "sources": [],
        }
    context = vector_store.build_context(chunks)
    answer = llm.generate(exam_answer_prompt(topic, marks, context))
    return {
        "topic": topic,
        "marks": marks,
        "answer": answer,
        "confidence": _confidence_from_chunks(chunks),
        "sources": [c.model_dump() for c in _to_citations(chunks)],
    }
