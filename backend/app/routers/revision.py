from fastapi import APIRouter

from app.models.schemas import FlashcardsResponse, RevisionNotesResponse, RevisionRequest
from app.services.revision_service import flashcards, revision_notes

router = APIRouter()


@router.post("/notes", response_model=RevisionNotesResponse)
def notes(payload: RevisionRequest):
    return RevisionNotesResponse(**revision_notes(payload.unit))


@router.post("/flashcards", response_model=FlashcardsResponse)
def cards(payload: RevisionRequest):
    return FlashcardsResponse(cards=flashcards(payload.unit))
