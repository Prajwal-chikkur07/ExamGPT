from fastapi import APIRouter, File, HTTPException, UploadFile

from app.models.schemas import ExamAnswerRequest, ExamAnswerResponse, ExamSolveResponse
from app.services.exam_service import answer_for_marks, solve_question_paper

router = APIRouter()


@router.post("/solve", response_model=ExamSolveResponse)
async def solve(file: UploadFile = File(...)):
    content = await file.read()
    try:
        results = solve_question_paper(file.filename or "paper", content)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ExamSolveResponse(questions=results)


@router.post("/answer", response_model=ExamAnswerResponse)
def exam_answer(payload: ExamAnswerRequest):
    if payload.marks not in (2, 5, 10):
        raise HTTPException(status_code=400, detail="marks must be 2, 5, or 10")
    return ExamAnswerResponse(**answer_for_marks(payload.topic, payload.marks))
