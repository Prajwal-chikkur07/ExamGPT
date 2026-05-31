from fastapi import APIRouter

from app.models.schemas import ImportantQuestionsRequest, ImportantQuestionsResponse
from app.services.revision_service import important_questions

router = APIRouter()


@router.post("", response_model=ImportantQuestionsResponse)
def generate(payload: ImportantQuestionsRequest):
    items = important_questions(payload.kind, payload.unit, max(1, min(50, payload.count)))
    return ImportantQuestionsResponse(items=items)
