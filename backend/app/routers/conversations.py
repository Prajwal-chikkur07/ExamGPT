from fastapi import APIRouter, HTTPException

from app.core import store
from app.models.schemas import Conversation, ConversationCreate, ConversationUpdate, Message
from app.utils.file_utils import new_id

router = APIRouter()


@router.get("", response_model=list[Conversation])
def list_conversations():
    return store.list_conversations()


@router.post("", response_model=Conversation)
def create_conversation(payload: ConversationCreate):
    conversation_id = new_id("conv_")
    title = (payload.title or "").strip() or "New chat"
    return store.create_conversation(conversation_id, title)


@router.get("/{conversation_id}", response_model=Conversation)
def get_conversation(conversation_id: str):
    conv = store.get_conversation(conversation_id)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conv


@router.patch("/{conversation_id}", response_model=Conversation)
def rename_conversation(conversation_id: str, payload: ConversationUpdate):
    if not store.get_conversation(conversation_id):
        raise HTTPException(status_code=404, detail="Conversation not found")
    store.update_conversation_title(conversation_id, payload.title.strip())
    return store.get_conversation(conversation_id)


@router.delete("/{conversation_id}")
def delete_conversation(conversation_id: str):
    ok = store.delete_conversation(conversation_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"ok": True}


@router.get("/{conversation_id}/messages", response_model=list[Message])
def list_messages(conversation_id: str):
    if not store.get_conversation(conversation_id):
        raise HTTPException(status_code=404, detail="Conversation not found")
    return store.list_messages(conversation_id)
